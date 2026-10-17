import { zValidator } from "@hono/zod-validator";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ISSUE_SOURCES,
  ISSUE_STATES,
  PRIORITIES,
  type IssueState,
} from "@tallyline/types";
import { db } from "../db/client.js";
import {
  agentSessions,
  agents,
  comments,
  cycles,
  dispatches,
  events,
  issueLabels,
  issueRelationTypes,
  issueRelations,
  issueSuggestionKinds,
  issueSuggestions,
  issues,
  labels,
  projects,
  slackLinks,
  teams,
  users,
  workspaceMembers,
  type IssueSuggestionKind,
} from "../db/schema.js";
import { actorFromHeaders } from "../lib/actor.js";
import { apiError, HttpError } from "../lib/errors.js";
import { postActivity } from "../services/agent-sessions.js";
import { createAssist } from "../services/assist.js";
import { llmEnabled } from "../services/llm.js";
import { decodeCursor, encodeCursor } from "../lib/pagination.js";
import { createDispatch } from "../services/dispatch.js";
import {
  mirrorIssueComment,
  mirrorIssueLabels,
} from "../services/github-sync.js";
import { createIssue, transitionIssue, type Actor } from "../services/issues.js";
import { notifyUsers } from "../services/notifications.js";
import { queueDeliveries } from "../services/outbound.js";
import { createSlack } from "../services/slack.js";
import { requireHumanReviewer } from "../services/members.js";
import { requireWorkspace } from "./workspaces.js";
import { track } from "../services/background.js";
import { clock } from "../services/clock.js";

const assist = createAssist();
const slack = createSlack();

const createSchema = z.object({
  teamKey: z.string().min(1).max(6).optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(ISSUE_SOURCES).optional(),
  state: z.enum(["triage", "backlog"]).default("backlog"),
  assigneeType: z.enum(["human", "agent"]).optional(),
  assigneeId: z.uuid().optional(),
  delegateType: z.enum(["agent"]).nullable().optional(),
  delegateId: z.uuid().nullable().optional(),
  cycleId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  labelIds: z.array(z.uuid()).max(10).optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).nullable().optional(),
  state: z.enum(ISSUE_STATES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  estimate: z.number().int().nonnegative().nullable().optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  assigneeType: z.enum(["human", "agent"]).nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  delegateType: z.enum(["agent"]).nullable().optional(),
  delegateId: z.uuid().nullable().optional(),
  cycleId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  labelIds: z.array(z.uuid()).max(10).optional(),
});

const listQuerySchema = z.object({
  state: z
    .string()
    .transform((s) => s.split(","))
    .pipe(z.array(z.enum(ISSUE_STATES)))
    .optional(),
  priority: z
    .string()
    .transform((s) => s.split(","))
    .pipe(z.array(z.enum(PRIORITIES)))
    .optional(),
  team: z.string().optional(),
  assignee: z.uuid().optional(),
  cycle: z.uuid().optional(),
  project: z.uuid().optional(),
  label: z.uuid().optional(),
  source: z.enum(ISSUE_SOURCES).optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const commentSchema = z.object({
  body: z.string().min(1).max(50_000),
});

// An `x-actor-id` header claiming an agent actor must name a real agent in
// this workspace — otherwise any session could forge agent provenance.
async function validateAgentActor(
  workspaceId: string,
  actor: Actor,
): Promise<void> {
  if (actor.type !== "agent" || !actor.id) return;
  const [a] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, actor.id), eq(agents.workspaceId, workspaceId)));
  if (!a) {
    throw new HttpError(422, "INVALID_ACTOR", "x-actor-id is not an agent in this workspace");
  }
}

async function validateAssignee(
  workspaceId: string,
  type: "human" | "agent",
  id: string,
): Promise<void> {
  if (type === "agent") {
    const [a] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    if (!a)
      throw new HttpError(422, "INVALID_ASSIGNEE", "agent not in workspace");
  } else {
    const [m] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, id),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      );
    if (!m)
      throw new HttpError(422, "INVALID_ASSIGNEE", "user not in workspace");
  }
}

async function validateDelegate(
  workspaceId: string,
  type: "agent" | null | undefined,
  id: string | null | undefined,
): Promise<void> {
  if (type === undefined && id === undefined) return;
  if (type === null && id === null) return;
  if ((type === "agent") !== Boolean(id)) {
    throw new HttpError(
      400,
      "INVALID_DELEGATE",
      "delegateType='agent' and delegateId must be provided together",
    );
  }
  if (type === "agent" && id) {
    const [a] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    if (!a) {
      throw new HttpError(422, "INVALID_DELEGATE", "agent not in workspace");
    }
  }
}

// A cycle assignment is only meaningful inside the issue's own team —
// cross-team or foreign-workspace cycle ids are rejected, not silently kept.
async function validateCycle(
  workspaceId: string,
  teamId: string,
  cycleId: string,
): Promise<void> {
  const [cycle] = await db
    .select({ teamId: cycles.teamId })
    .from(cycles)
    .where(and(eq(cycles.id, cycleId), eq(cycles.workspaceId, workspaceId)));
  if (!cycle) {
    throw new HttpError(422, "INVALID_CYCLE", "cycle not in workspace");
  }
  if (cycle.teamId !== teamId) {
    throw new HttpError(
      422,
      "INVALID_CYCLE",
      "cycle belongs to a different team",
    );
  }
}

// Same rule as cycles: the project must live in the issue's workspace, and a
// team-scoped project only accepts issues from its own team. Workspace-level
// projects (teamId null) accept issues from any team.
async function validateProject(
  workspaceId: string,
  teamId: string,
  projectId: string,
): Promise<void> {
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    );
  if (!project) {
    throw new HttpError(422, "INVALID_PROJECT", "project not in workspace");
  }
  if (project.teamId !== null && project.teamId !== teamId) {
    throw new HttpError(
      422,
      "INVALID_PROJECT",
      "project belongs to a different team",
    );
  }
}

// A parent must be another issue in the SAME workspace — an id from another
// tenant would otherwise be stored and surface in that tenant's `children`.
async function validateParent(
  workspaceId: string,
  parentId: string,
  selfKey?: string,
): Promise<void> {
  const [parent] = await db
    .select({ key: issues.key })
    .from(issues)
    .where(and(eq(issues.id, parentId), eq(issues.workspaceId, workspaceId)));
  if (!parent) {
    throw new HttpError(422, "INVALID_PARENT", "parent issue not in workspace");
  }
  if (selfKey !== undefined && parent.key === selfKey) {
    throw new HttpError(422, "INVALID_PARENT", "an issue cannot be its own parent");
  }
}

export const issueRoutes = new Hono()
  .post(
    "/workspaces/:ws/issues",
    zValidator("json", createSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const actor = actorFromHeaders(c);
      await validateAgentActor(ws.id, actor);

      const [team] = body.teamKey
        ? await db
            .select()
            .from(teams)
            .where(
              and(eq(teams.workspaceId, ws.id), eq(teams.key, body.teamKey)),
            )
        : await db
            .select()
            .from(teams)
            .where(eq(teams.workspaceId, ws.id))
            .orderBy(teams.createdAt)
            .limit(1);
      if (!team) throw new HttpError(404, "NOT_FOUND", "team not found");
      if (body.cycleId) await validateCycle(ws.id, team.id, body.cycleId);
      if (body.projectId)
        await validateProject(ws.id, team.id, body.projectId);
      if (body.parentId) await validateParent(ws.id, body.parentId);
      // validate before creating: a 422 must not leave an orphan issue behind
      if (body.assigneeId && body.assigneeType) {
        await validateAssignee(ws.id, body.assigneeType, body.assigneeId);
      }
      await validateDelegate(ws.id, body.delegateType, body.delegateId);

      const issue = await createIssue({
        workspaceId: ws.id,
        teamId: team.id,
        title: body.title,
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.source !== undefined ? { source: body.source } : {}),
        state: body.state,
        creator: actor,
      });

      if (body.labelIds?.length) {
        await setIssueLabels(issue.id, ws.id, body.labelIds);
      }
      let result = issue;
      if (
        body.priority !== undefined ||
        body.assigneeId !== undefined ||
        body.delegateType !== undefined ||
        body.delegateId !== undefined ||
        body.cycleId !== undefined ||
        body.projectId !== undefined ||
        body.parentId !== undefined
      ) {
        const [updated] = await db
          .update(issues)
          .set({
            ...(body.priority !== undefined
              ? { priority: body.priority }
              : {}),
            ...(body.assigneeType !== undefined
              ? { assigneeType: body.assigneeType }
              : {}),
            ...(body.assigneeId !== undefined
              ? { assigneeId: body.assigneeId }
              : {}),
            ...(body.delegateType !== undefined
              ? { delegateType: body.delegateType }
              : {}),
            ...(body.delegateId !== undefined
              ? { delegateId: body.delegateId }
              : {}),
            ...(body.cycleId !== undefined ? { cycleId: body.cycleId } : {}),
            ...(body.projectId !== undefined
              ? { projectId: body.projectId }
              : {}),
            ...(body.parentId !== undefined
              ? { parentId: body.parentId }
              : {}),
          })
          .where(eq(issues.id, issue.id))
          .returning();
        if (updated) result = updated;
      }

      if (body.assigneeType === "agent") {
        await db.insert(events).values({
          workspaceId: ws.id,
          entityType: "issue",
          entityId: result.id,
          action: "deprecated_agent_assignee",
          actorType: actor.type,
          actorId: actor.id,
          after: { assigneeId: body.assigneeId ?? null },
        });
      }

      if (body.delegateType === "agent" && body.delegateId) {
        await createDispatch({
          workspaceId: ws.id,
          issueId: result.id,
          agentId: body.delegateId,
          trigger: "assign",
        });
      }

      // create-time human assignment → inbox row (agent assignment at
      // create does NOT dispatch — dispatch is PATCH/mention only)
      if (body.assigneeType === "human" && body.assigneeId) {
        await notifyUsers(ws.id, [body.assigneeId], {
          kind: "assigned",
          issueId: result.id,
          actor,
        });
      }

      // `?dupCheck=1` runs semantic duplicate detection on the way out —
      // opt-in per request, LLM-disabled workspaces just get the issue back
      if (c.req.query("dupCheck") && llmEnabled()) {
        try {
          const possibleDuplicates = await assist.checkDuplicates(
            ws.id,
            body.title,
            body.description,
          );
          return c.json({ ...result, possibleDuplicates }, 201);
        } catch {
          // dup detection is advisory — never fail the create over it
        }
      }
      return c.json(result, 201);
    },
  )
  .get(
    "/workspaces/:ws/issues",
    zValidator("query", listQuerySchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const q = c.req.valid("query");

      const filters: SQL[] = [eq(issues.workspaceId, ws.id)];
      if (q.state?.length) filters.push(inArray(issues.state, q.state));
      if (q.priority?.length)
        filters.push(inArray(issues.priority, q.priority));
      if (q.assignee) filters.push(eq(issues.assigneeId, q.assignee));
      if (q.cycle) filters.push(eq(issues.cycleId, q.cycle));
      if (q.project) filters.push(eq(issues.projectId, q.project));
      if (q.source) filters.push(eq(issues.source, q.source));
      if (q.search) filters.push(ilike(issues.title, `%${q.search}%`));
      if (q.team) {
        const [team] = await db
          .select({ id: teams.id })
          .from(teams)
          .where(
            and(eq(teams.workspaceId, ws.id), eq(teams.key, q.team)),
          );
        if (!team) return apiError(c, 404, "NOT_FOUND", "team not found");
        filters.push(eq(issues.teamId, team.id));
      }
      if (q.label) {
        filters.push(
          inArray(
            issues.id,
            db
              .select({ id: issueLabels.issueId })
              .from(issueLabels)
              .where(eq(issueLabels.labelId, q.label)),
          ),
        );
      }
      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        if (!cur) {
          return apiError(c, 400, "BAD_CURSOR", "invalid cursor");
        }
        filters.push(
          or(
            lt(issues.createdAt, new Date(cur.createdAt)),
            and(
              eq(issues.createdAt, new Date(cur.createdAt)),
              lt(issues.id, cur.id),
            ),
          )!,
        );
      }

      const rows = await db
        .select()
        .from(issues)
        .where(and(...filters))
        .orderBy(desc(issues.createdAt), desc(issues.id))
        .limit(q.limit + 1);

      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const last = page.at(-1);
      // one batched label read per page — rows render chips without N+1
      const pageIds = page.map((i) => i.id);
      const labelRows = pageIds.length
        ? await db
            .select({
              issueId: issueLabels.issueId,
              id: labels.id,
              name: labels.name,
              color: labels.color,
            })
            .from(issueLabels)
            .innerJoin(labels, eq(labels.id, issueLabels.labelId))
            .where(inArray(issueLabels.issueId, pageIds))
        : [];
      const labelsByIssue = new Map<
        string,
        { id: string; name: string; color: string }[]
      >();
      for (const l of labelRows) {
        const arr = labelsByIssue.get(l.issueId) ?? [];
        arr.push({ id: l.id, name: l.name, color: l.color });
        labelsByIssue.set(l.issueId, arr);
      }
      return c.json({
        issues: page.map((i) => ({
          ...i,
          labels: labelsByIssue.get(i.id) ?? [],
        })),
        nextCursor:
          hasMore && last
            ? encodeCursor({
                createdAt: last.createdAt.toISOString(),
                id: last.id,
              })
            : null,
      });
    },
  )
  .get("/workspaces/:ws/issues/:key", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const children = await db
      .select({ id: issues.id, key: issues.key, title: issues.title })
      .from(issues)
      .where(
        and(
          eq(issues.workspaceId, ws.id),
          eq(issues.parentId, issue.id),
        ),
      );
    const issueLabelRows = await db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .innerJoin(
        issueLabels,
        and(
          eq(issueLabels.labelId, labels.id),
          eq(issueLabels.issueId, issue.id),
        ),
      );
    return c.json({ ...issue, children, labels: issueLabelRows });
  })
  .patch(
    "/workspaces/:ws/issues/:key",
    zValidator("json", patchSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const key = c.req.param("key");
      const body = c.req.valid("json");
      const actor = actorFromHeaders(c);

      // Validate mutations before committing any of them — a 422 must not
      // leave a half-applied patch (e.g. state moved, cycle rejected).
      if (body.assigneeId && body.assigneeType) {
        await validateAssignee(ws.id, body.assigneeType, body.assigneeId);
      }
      await validateDelegate(ws.id, body.delegateType, body.delegateId);
      if (body.parentId) await validateParent(ws.id, body.parentId, key);
      if (body.labelIds?.length) {
        const found = await db
          .select({ id: labels.id })
          .from(labels)
          .where(
            and(
              eq(labels.workspaceId, ws.id),
              inArray(labels.id, body.labelIds),
            ),
          );
        if (found.length !== new Set(body.labelIds).size) {
          throw new HttpError(
            422,
            "INVALID_LABELS",
            "label id not in workspace",
          );
        }
      }
      if (body.cycleId || body.projectId) {
        const issue = await findIssue(ws.id, key);
        if (body.cycleId)
          await validateCycle(ws.id, issue.teamId, body.cycleId);
        if (body.projectId)
          await validateProject(ws.id, issue.teamId, body.projectId);
      }
      if (body.state !== undefined) {
        // approving (-> done) or sending back (-> in_progress) a review item
        // is a human decision; agents may only move work INTO in_review
        if (c.get("agentAuth")) {
          const current = await findIssue(ws.id, key);
          if (
            current.state === "in_review" &&
            (body.state === "done" || body.state === "in_progress")
          ) {
            requireHumanReviewer(c);
          }
        }
        await transitionIssue(ws.id, key, body.state as IssueState, actor);
        // terminal transition → resolution reply in the linked slack thread
        if (["done", "canceled", "duplicate"].includes(body.state)) {
          const updated = await findIssue(ws.id, key);
          slack.notifyResolution(updated.id, body.state, actor).catch(() => {});
        }
      }

      const fields: Partial<typeof issues.$inferInsert> = {};
      if (body.title !== undefined) fields.title = body.title;
      if (body.description !== undefined)
        fields.description = body.description;
      if (body.priority !== undefined) fields.priority = body.priority;
      if (body.estimate !== undefined) fields.estimate = body.estimate;
      if (body.dueDate !== undefined)
        fields.dueDate = body.dueDate ? new Date(body.dueDate) : null;
      if (body.assigneeType !== undefined)
        fields.assigneeType = body.assigneeType;
      if (body.assigneeId !== undefined) fields.assigneeId = body.assigneeId;
      if (body.delegateType !== undefined)
        fields.delegateType = body.delegateType;
      if (body.delegateId !== undefined) fields.delegateId = body.delegateId;
      if (body.cycleId !== undefined) fields.cycleId = body.cycleId;
      if (body.projectId !== undefined) fields.projectId = body.projectId;
      if (body.parentId !== undefined) fields.parentId = body.parentId;

      // prior assignee / delegate for the change-detection below — one extra read only
      // when the patch touches assignment or delegation
      const prevAssignment =
        body.assigneeId !== undefined ||
        body.assigneeType !== undefined ||
        body.delegateId !== undefined ||
        body.delegateType !== undefined
          ? await db
              .select({
                assigneeType: issues.assigneeType,
                assigneeId: issues.assigneeId,
                delegateType: issues.delegateType,
                delegateId: issues.delegateId,
              })
              .from(issues)
              .where(
                and(
                  eq(issues.workspaceId, ws.id),
                  eq(issues.key, key),
                ),
              )
              .then((r) => r[0] ?? null)
          : null;

      let issue;
      if (Object.keys(fields).length > 0) {
        fields.updatedAt = clock.now();
        [issue] = await db
          .update(issues)
          .set(fields)
          .where(
            and(eq(issues.workspaceId, ws.id), eq(issues.key, key)),
          )
          .returning();
        // no row matched: unknown key (or another tenant's) is a 404, never a
        // 200 with an empty body
        if (!issue) issue = await findIssue(ws.id, key);
      } else {
        issue = await findIssue(ws.id, key);
      }
      if (body.labelIds !== undefined && issue) {
        await replaceIssueLabels(issue.id, ws.id, body.labelIds);
      }
      if (body.assigneeType === "agent" && issue) {
        await db.insert(events).values({
          workspaceId: ws.id,
          entityType: "issue",
          entityId: issue.id,
          action: "deprecated_agent_assignee",
          actorType: actor.type,
          actorId: actor.id,
          after: { assigneeId: body.assigneeId ?? null },
        });
      }
      if (body.assigneeType === "agent" && body.assigneeId && issue) {
        await createDispatch({
          workspaceId: ws.id,
          issueId: issue.id,
          agentId: body.assigneeId,
          trigger: "assign",
        });
      }
      if (
        body.delegateType === "agent" &&
        body.delegateId &&
        issue &&
        (prevAssignment?.delegateType !== "agent" ||
          prevAssignment?.delegateId !== body.delegateId)
      ) {
        await createDispatch({
          workspaceId: ws.id,
          issueId: issue.id,
          agentId: body.delegateId,
          trigger: "assign",
        });
      }
      // human assignment change → inbox row (re-assigning the same person
      // doesn't re-notify)
      if (
        body.assigneeType === "human" &&
        body.assigneeId &&
        issue &&
        prevAssignment?.assigneeId !== body.assigneeId
      ) {
        await notifyUsers(ws.id, [body.assigneeId], {
          kind: "assigned",
          issueId: issue.id,
          actor,
        });
      }
      return c.json(issue);
    },
  )
  .post(
    "/workspaces/:ws/issues/:key/comments",
    zValidator("json", commentSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const issue = await findIssue(ws.id, c.req.param("key"));
      const actor = actorFromHeaders(c);
      await validateAgentActor(ws.id, actor);
      const body = c.req.valid("json");

      const [comment] = await db
        .insert(comments)
        .values({
          workspaceId: ws.id,
          issueId: issue.id,
          actorType: actor.type,
          actorId: actor.id,
          body: body.body,
        })
        .returning();

      await db.insert(events).values({
        workspaceId: ws.id,
        entityType: "issue",
        entityId: issue.id,
        action: "commented",
        actorType: actor.type,
        actorId: actor.id,
        after: { commentId: comment!.id },
      });
      await queueDeliveries({
        workspaceId: ws.id,
        entityType: "issue",
        entityId: issue.id,
        action: "commented",
        actorType: actor.type,
        actorId: actor.id,
        after: { commentId: comment!.id },
        issueKey: issue.key,
      });
      // best-effort GitHub mirror — never blocks; via=github comments
      // (inbound-synced) skip inside (#60)
      track(
        mirrorIssueComment({
          issueId: issue.id,
          body: comment!.body,
          via: comment!.via,
        }),
      );

      // @mentions split two ways: an agent name creates a dispatch; a
      // member name creates a notification. The same token can hit both —
      // dispatch and inbox are independent effects.
      const mentioned = new Set(
        [...body.body.matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)].map((m) =>
          m[1]!.toLowerCase(),
        ),
      );
      if (mentioned.size > 0) {
        const wsAgents = await db
          .select()
          .from(agents)
          .where(eq(agents.workspaceId, ws.id));
        for (const agent of wsAgents) {
          if (!mentioned.has(agent.name.toLowerCase())) continue;
          await createDispatch({
            workspaceId: ws.id,
            issueId: issue.id,
            agentId: agent.id,
            trigger: "mention",
            commentBody: body.body,
          });
        }
        const wsMembers = await db
          .select({ id: users.id, name: users.name })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.workspaceId, ws.id));
        const memberIds = wsMembers
          .filter((m) => {
            const name = m.name.toLowerCase();
            return (
              mentioned.has(name) ||
              mentioned.has(name.replace(/\s+/g, "-")) ||
              mentioned.has(name.replace(/\s+/g, "")) ||
              mentioned.has(name.split(/\s+/)[0] ?? "")
            );
          })
          .map((m) => m.id);
        if (memberIds.length > 0) {
          await notifyUsers(ws.id, memberIds, {
            kind: "mention",
            issueId: issue.id,
            actor,
          });
        }
      }

      // plan L3: when a human comments on an issue with an awaitingInput
      // agent session, resume the session with a prompt activity.
      if (actor.type === "human") {
        const waitingSessions = await db
          .select({ id: agentSessions.id })
          .from(agentSessions)
          .where(
            and(
              eq(agentSessions.workspaceId, ws.id),
              eq(agentSessions.issueId, issue.id),
              eq(agentSessions.status, "awaitingInput"),
            ),
          )
          .orderBy(desc(agentSessions.createdAt));
        for (const s of waitingSessions) {
          await postActivity(
            s.id,
            { content: { type: "prompt", body: comment!.body } },
            { actorType: "human", actorId: actor.id },
          );
        }
      }

      // slack mirror — best-effort, slack-originated bodies skip themselves
      slack.mirrorComment(issue.id, body.body).catch(() => {});

      return c.json(comment, 201);
    },
  )
  .get("/workspaces/:ws/issues/:key/comments", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const rows = await db
      .select()
      .from(comments)
      .where(eq(comments.issueId, issue.id))
      .orderBy(asc(comments.createdAt));
    return c.json({ comments: rows });
  })
  .get("/workspaces/:ws/issues/:key/events", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const rows = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.workspaceId, ws.id),
          eq(events.entityId, issue.id),
        ),
      )
      .orderBy(asc(events.createdAt));
    return c.json({ events: rows });
  })
  .post(
    "/workspaces/:ws/issues/:key/triage",
    zValidator(
      "json",
      z.object({ action: z.enum(["accept", "decline"]) }),
    ),
    async (c) => {
      const ws = await requireWorkspace(c);
      const actor = actorFromHeaders(c);
      const { action } = c.req.valid("json");
      const issue = await findIssue(ws.id, c.req.param("key"));
      if (issue.state !== "triage") {
        throw new HttpError(
          409,
          "NOT_IN_TRIAGE",
          `issue ${issue.key} is in '${issue.state}', not triage`,
        );
      }
      const updated = await transitionIssue(
        ws.id,
        issue.key,
        action === "accept" ? "backlog" : "canceled",
        actor,
      );
      return c.json(updated);
    },
  )
  .post(
    "/workspaces/:ws/issues/:key/review",
    zValidator(
      "json",
      z.object({
        action: z.enum(["approve", "send_back"]),
        feedback: z.string().max(5_000).optional(),
      }),
    ),
    async (c) => {
      const ws = await requireWorkspace(c);
      requireHumanReviewer(c);
      const actor = actorFromHeaders(c);
      const { action, feedback } = c.req.valid("json");
      const issue = await findIssue(ws.id, c.req.param("key"));
      if (issue.state !== "in_review") {
        throw new HttpError(
          409,
          "NOT_IN_REVIEW",
          `issue ${issue.key} is in '${issue.state}', not in_review`,
        );
      }

      if (action === "approve") {
        const updated = await transitionIssue(ws.id, issue.key, "done", actor);
        await db.insert(comments).values({
          workspaceId: ws.id,
          issueId: issue.id,
          actorType: actor.type,
          actorId: actor.id,
          body: "review approved ✓",
        });
        return c.json(updated);
      }

      // send back: to in_progress, feedback on the thread, and re-dispatch
      // to the agent that ran the last session
      if (!feedback?.trim()) {
        throw new HttpError(422, "FEEDBACK_REQUIRED", "send_back requires feedback");
      }
      const [last] = await db
        .select({ agentId: dispatches.agentId })
        .from(dispatches)
        .where(eq(dispatches.issueId, issue.id))
        .orderBy(desc(dispatches.createdAt))
        .limit(1);
      const updated = await transitionIssue(
        ws.id,
        issue.key,
        "in_progress",
        actor,
      );
      await db.insert(comments).values({
        workspaceId: ws.id,
        issueId: issue.id,
        actorType: actor.type,
        actorId: actor.id,
        body: `sent back for changes: ${feedback}`,
      });
      if (last) {
        await createDispatch({
          workspaceId: ws.id,
          issueId: issue.id,
          agentId: last.agentId,
          trigger: "mention",
          commentBody: `review feedback: ${feedback}`,
        });
      }
      return c.json(updated);
    },
  )
  .post(
    "/workspaces/:ws/labels",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        teamKey: z.string().optional(),
      }),
    ),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const [label] = await db
        .insert(labels)
        .values({ workspaceId: ws.id, name: body.name, color: body.color })
        .returning();
      return c.json(label, 201);
    },
  )
  .get("/workspaces/:ws/labels", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(labels)
      .where(eq(labels.workspaceId, ws.id));
    return c.json({ labels: rows });
  })
  .patch(
    "/workspaces/:ws/labels/:id",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1).max(60).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      }),
    ),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const [row] = await db
        .update(labels)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
        })
        .where(
          and(eq(labels.id, c.req.param("id")), eq(labels.workspaceId, ws.id)),
        )
        .returning();
      if (!row) throw new HttpError(404, "NOT_FOUND", "label not found");
      return c.json(row);
    },
  )
  .delete("/workspaces/:ws/labels/:id", async (c) => {
    const ws = await requireWorkspace(c);
    const [row] = await db
      .delete(labels)
      .where(
        and(eq(labels.id, c.req.param("id")), eq(labels.workspaceId, ws.id)),
      )
      .returning({ id: labels.id });
    if (!row) throw new HttpError(404, "NOT_FOUND", "label not found");
    return c.json({ ok: true });
  })
  .get("/workspaces/:ws/issues/:key/slack-link", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const [link] = await db
      .select()
      .from(slackLinks)
      .where(eq(slackLinks.issueId, issue.id));
    return c.json({ link: link ?? null });
  })
  .delete("/workspaces/:ws/issues/:key/slack-link", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    await db.delete(slackLinks).where(eq(slackLinks.issueId, issue.id));
    return c.json({ ok: true });
  })
  // ── Plan L4: Issue suggestions ─────────────────────────────────
  .get("/workspaces/:ws/issues/:key/suggestions", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const rows = await db
      .select()
      .from(issueSuggestions)
      .where(
        and(
          eq(issueSuggestions.workspaceId, ws.id),
          eq(issueSuggestions.issueId, issue.id),
        ),
      )
      .orderBy(asc(issueSuggestions.createdAt));
    return c.json({ suggestions: rows });
  })
  .post("/workspaces/:ws/issues/:key/suggestions", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const rawText = await c.req.text();
    let rawJson: unknown = {};
    if (rawText.trim()) {
      try {
        rawJson = JSON.parse(rawText);
      } catch {
        return apiError(c, 400, "INVALID_JSON", "invalid JSON body");
      }
    }
    const itemSchema = z.object({
      kind: z.enum(issueSuggestionKinds),
      suggestedValue: z.string().min(1).max(500),
      reason: z.string().max(1000).nullable().optional(),
    });
    const bodySchema = z.object({
      kind: z.enum(issueSuggestionKinds).optional(),
      suggestedValue: z.string().min(1).max(500).optional(),
      reason: z.string().max(1000).nullable().optional(),
      suggestions: z.array(itemSchema).max(20).optional(),
    });
    const parsed = bodySchema.safeParse(rawJson);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }
    const body = parsed.data;
    const candidates: Array<{
      kind: IssueSuggestionKind;
      suggestedValue: string;
      reason: string | null;
    }> = [];
    if (body.kind && body.suggestedValue) {
      candidates.push({
        kind: body.kind,
        suggestedValue: body.suggestedValue,
        reason: body.reason ?? null,
      });
    }
    if (body.suggestions) {
      for (const s of body.suggestions) {
        candidates.push({
          kind: s.kind,
          suggestedValue: s.suggestedValue,
          reason: s.reason ?? null,
        });
      }
    }

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const cand of candidates) {
      if (uuidRe.test(cand.suggestedValue)) {
        if (cand.kind === "label") {
          const [l] = await db
            .select({ id: labels.id })
            .from(labels)
            .where(
              and(
                eq(labels.id, cand.suggestedValue),
                eq(labels.workspaceId, ws.id),
              ),
            );
          if (!l) {
            throw new HttpError(
              422,
              "INVALID_SUGGESTION",
              "label not in workspace",
            );
          }
        } else if (cand.kind === "project") {
          const [p] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, cand.suggestedValue),
                eq(projects.workspaceId, ws.id),
              ),
            );
          if (!p) {
            throw new HttpError(
              422,
              "INVALID_SUGGESTION",
              "project not in workspace",
            );
          }
        } else if (cand.kind === "team") {
          const [t] = await db
            .select({ id: teams.id })
            .from(teams)
            .where(
              and(
                eq(teams.id, cand.suggestedValue),
                eq(teams.workspaceId, ws.id),
              ),
            );
          if (!t) {
            throw new HttpError(
              422,
              "INVALID_SUGGESTION",
              "team not in workspace",
            );
          }
        } else if (cand.kind === "assignee") {
          const [m] = await db
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, ws.id),
                eq(workspaceMembers.userId, cand.suggestedValue),
              ),
            );
          const [a] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(
              and(
                eq(agents.id, cand.suggestedValue),
                eq(agents.workspaceId, ws.id),
              ),
            );
          if (!m && !a) {
            throw new HttpError(
              422,
              "INVALID_SUGGESTION",
              "assignee not in workspace",
            );
          }
        } else if (cand.kind === "duplicate") {
          const [other] = await db
            .select({ id: issues.id })
            .from(issues)
            .where(
              and(
                eq(issues.id, cand.suggestedValue),
                eq(issues.workspaceId, ws.id),
              ),
            );
          if (!other) {
            throw new HttpError(
              422,
              "INVALID_SUGGESTION",
              "duplicate issue not in workspace",
            );
          }
        }
      }
    }

    if (candidates.length === 0) {
      const textBlob = `${issue.title} ${issue.description ?? ""}`.toLowerCase();
      const wsLabels = await db
        .select()
        .from(labels)
        .where(eq(labels.workspaceId, ws.id))
        .orderBy(asc(labels.createdAt));
      for (const l of wsLabels) {
        if (textBlob.includes(l.name.toLowerCase())) {
          candidates.push({
            kind: "label",
            suggestedValue: l.name,
            reason: `matches label "${l.name}"`,
          });
        }
      }
      if (candidates.length === 0 && wsLabels[0]) {
        candidates.push({
          kind: "label",
          suggestedValue: wsLabels[0].name,
          reason: "workspace label candidate",
        });
      }
      const wsProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, ws.id))
        .orderBy(asc(projects.createdAt));
      for (const p of wsProjects) {
        if (textBlob.includes(p.name.toLowerCase())) {
          candidates.push({
            kind: "project",
            suggestedValue: p.id,
            reason: `matches project "${p.name}"`,
          });
        }
      }
      if (candidates.length === 0) {
        candidates.push({
          kind: "team",
          suggestedValue: issue.teamId,
          reason: "default team routing",
        });
      }
    }

    for (const cand of candidates) {
      await db
        .insert(issueSuggestions)
        .values({
          workspaceId: ws.id,
          issueId: issue.id,
          kind: cand.kind,
          suggestedValue: cand.suggestedValue,
          reason: cand.reason,
          state: "pending",
        })
        .onConflictDoNothing();
    }

    const rows = await db
      .select()
      .from(issueSuggestions)
      .where(
        and(
          eq(issueSuggestions.workspaceId, ws.id),
          eq(issueSuggestions.issueId, issue.id),
        ),
      )
      .orderBy(asc(issueSuggestions.createdAt));
    const matched =
      (candidates[0] &&
        rows.find(
          (r) =>
            r.kind === candidates[0]!.kind &&
            r.suggestedValue === candidates[0]!.suggestedValue,
        )) ??
      rows[0];
    return c.json(
      {
        ...(matched ?? {}),
        suggestion: matched ?? null,
        suggestions: rows,
      },
      201,
    );
  })
  .patch(
    "/workspaces/:ws/issues/:key/suggestions/:sid",
    zValidator(
      "json",
      z.object({
        state: z.enum(["accepted", "dismissed"]),
        dismissedReason: z.string().max(1000).nullable().optional(),
      }),
    ),
    async (c) => {
      const ws = await requireWorkspace(c);
      const actor = actorFromHeaders(c);
      const issue = await findIssue(ws.id, c.req.param("key"));
      const sid = c.req.param("sid");
      const body = c.req.valid("json");

      const [existing] = await db
        .select()
        .from(issueSuggestions)
        .where(
          and(
            eq(issueSuggestions.id, sid),
            eq(issueSuggestions.workspaceId, ws.id),
            eq(issueSuggestions.issueId, issue.id),
          ),
        );
      if (!existing) {
        throw new HttpError(404, "NOT_FOUND", "suggestion not found");
      }

      const [updated] = await db
        .update(issueSuggestions)
        .set({
          state: body.state,
          dismissedReason:
            body.state === "dismissed" ? (body.dismissedReason ?? null) : null,
        })
        .where(eq(issueSuggestions.id, existing.id))
        .returning();

      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (body.state === "accepted") {
        if (existing.kind === "label") {
          const [label] = await db
            .select({ id: labels.id })
            .from(labels)
            .where(
              and(
                eq(labels.workspaceId, ws.id),
                uuidRe.test(existing.suggestedValue)
                  ? or(
                      eq(labels.id, existing.suggestedValue),
                      eq(labels.name, existing.suggestedValue),
                    )
                  : eq(labels.name, existing.suggestedValue),
              ),
            );
          if (label) {
            await db
              .insert(issueLabels)
              .values({ issueId: issue.id, labelId: label.id })
              .onConflictDoNothing();
          }
        } else if (existing.kind === "project") {
          const [proj] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.workspaceId, ws.id),
                uuidRe.test(existing.suggestedValue)
                  ? or(
                      eq(projects.id, existing.suggestedValue),
                      eq(projects.name, existing.suggestedValue),
                    )
                  : eq(projects.name, existing.suggestedValue),
              ),
            );
          if (proj) {
            await db
              .update(issues)
              .set({ projectId: proj.id })
              .where(eq(issues.id, issue.id));
          }
        } else if (existing.kind === "team") {
          const [team] = await db
            .select({ id: teams.id })
            .from(teams)
            .where(
              and(
                eq(teams.workspaceId, ws.id),
                uuidRe.test(existing.suggestedValue)
                  ? or(
                      eq(teams.id, existing.suggestedValue),
                      eq(teams.key, existing.suggestedValue),
                    )
                  : eq(teams.key, existing.suggestedValue),
              ),
            );
          if (team) {
            await db
              .update(issues)
              .set({ teamId: team.id })
              .where(eq(issues.id, issue.id));
          }
        } else if (
          existing.kind === "assignee" &&
          uuidRe.test(existing.suggestedValue)
        ) {
          await db
            .update(issues)
            .set({
              assigneeType: "human",
              assigneeId: existing.suggestedValue,
            })
            .where(eq(issues.id, issue.id));
        } else if (existing.kind === "duplicate") {
          await db
            .update(issues)
            .set({ state: "duplicate" })
            .where(eq(issues.id, issue.id));
        }
      }

      await db.insert(events).values({
        workspaceId: ws.id,
        entityType: "issue",
        entityId: issue.id,
        action:
          body.state === "accepted"
            ? "suggestion_accepted"
            : "suggestion_dismissed",
        actorType: actor.type,
        actorId: actor.id,
        after: {
          suggestionId: updated!.id,
          kind: updated!.kind,
          suggestedValue: updated!.suggestedValue,
          state: updated!.state,
          dismissedReason: updated!.dismissedReason,
        },
      });

      return c.json({ ...updated!, suggestion: updated! });
    },
  )
  // ── Plan L5: Issue relations ───────────────────────────────────
  .get("/workspaces/:ws/issues/:key/relations", async (c) => {
    const ws = await requireWorkspace(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const rows = await db
      .select()
      .from(issueRelations)
      .where(
        and(
          eq(issueRelations.workspaceId, ws.id),
          or(
            eq(issueRelations.sourceIssueId, issue.id),
            eq(issueRelations.targetIssueId, issue.id),
          ),
        ),
      )
      .orderBy(asc(issueRelations.createdAt));
    return c.json({ relations: rows });
  })
  .post(
    "/workspaces/:ws/issues/:key/relations",
    zValidator(
      "json",
      z
        .object({
          targetIssueId: z.uuid().optional(),
          targetIssueKey: z.string().min(1).max(32).optional(),
          targetKey: z.string().min(1).max(32).optional(),
          relationType: z.enum(issueRelationTypes),
        })
        .refine(
          (v) => Boolean(v.targetIssueId || v.targetIssueKey || v.targetKey),
          { message: "targetIssueId or targetIssueKey is required" },
        ),
    ),
    async (c) => {
      const ws = await requireWorkspace(c);
      const actor = actorFromHeaders(c);
      const issue = await findIssue(ws.id, c.req.param("key"));
      const body = c.req.valid("json");

      if (body.targetIssueId && body.targetIssueId === issue.id) {
        throw new HttpError(
          409,
          "SELF_RELATION",
          "an issue cannot relate to itself",
        );
      }
      const targetKey = body.targetIssueKey ?? body.targetKey;
      if (targetKey && targetKey === issue.key) {
        throw new HttpError(
          409,
          "SELF_RELATION",
          "an issue cannot relate to itself",
        );
      }

      let target: typeof issues.$inferSelect | undefined;
      if (body.targetIssueId) {
        const [found] = await db
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.id, body.targetIssueId),
              eq(issues.workspaceId, ws.id),
            ),
          );
        if (!found) {
          throw new HttpError(
            422,
            "INVALID_TARGET",
            "target issue not in workspace",
          );
        }
        target = found;
      } else if (targetKey) {
        target = await findIssue(ws.id, targetKey);
      }

      if (!target || target.id === issue.id) {
        throw new HttpError(
          409,
          "SELF_RELATION",
          "an issue cannot relate to itself",
        );
      }

      if (body.relationType === "blocks") {
        const blockEdges = await db
          .select({
            sourceIssueId: issueRelations.sourceIssueId,
            targetIssueId: issueRelations.targetIssueId,
          })
          .from(issueRelations)
          .where(
            and(
              eq(issueRelations.workspaceId, ws.id),
              eq(issueRelations.relationType, "blocks"),
            ),
          );
        const adj = new Map<string, string[]>();
        for (const e of blockEdges) {
          const list = adj.get(e.sourceIssueId) ?? [];
          list.push(e.targetIssueId);
          adj.set(e.sourceIssueId, list);
        }
        const visited = new Set<string>([target.id]);
        const queue: string[] = [target.id];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (cur === issue.id) {
            throw new HttpError(
              409,
              "BLOCKS_CYCLE",
              "blocks relation would create a cycle",
            );
          }
          for (const nxt of adj.get(cur) ?? []) {
            if (!visited.has(nxt)) {
              visited.add(nxt);
              queue.push(nxt);
            }
          }
        }
      }

      await db
        .insert(issueRelations)
        .values({
          workspaceId: ws.id,
          sourceIssueId: issue.id,
          targetIssueId: target.id,
          relationType: body.relationType,
        })
        .onConflictDoNothing();

      const [row] = await db
        .select()
        .from(issueRelations)
        .where(
          and(
            eq(issueRelations.workspaceId, ws.id),
            eq(issueRelations.sourceIssueId, issue.id),
            eq(issueRelations.targetIssueId, target.id),
            eq(issueRelations.relationType, body.relationType),
          ),
        );

      if (body.relationType === "duplicate" && issue.state !== "duplicate") {
        await db
          .update(issues)
          .set({ state: "duplicate" })
          .where(and(eq(issues.id, issue.id), eq(issues.workspaceId, ws.id)));
        await db.insert(events).values({
          workspaceId: ws.id,
          entityType: "issue",
          entityId: issue.id,
          action: "state_changed",
          actorType: actor.type,
          actorId: actor.id,
          before: { state: issue.state },
          after: { state: "duplicate", duplicateOf: target.key },
        });
      }

      await db.insert(events).values({
        workspaceId: ws.id,
        entityType: "issue",
        entityId: issue.id,
        action: "relation_created",
        actorType: actor.type,
        actorId: actor.id,
        after: {
          relationId: row!.id,
          targetIssueId: target.id,
          relationType: body.relationType,
        },
      });

      return c.json({ ...row!, relation: row! }, 201);
    },
  )
  .delete("/workspaces/:ws/issues/:key/relations/:rid", async (c) => {
    const ws = await requireWorkspace(c);
    const actor = actorFromHeaders(c);
    const issue = await findIssue(ws.id, c.req.param("key"));
    const rid = c.req.param("rid");
    const [deleted] = await db
      .delete(issueRelations)
      .where(
        and(
          eq(issueRelations.id, rid),
          eq(issueRelations.workspaceId, ws.id),
          or(
            eq(issueRelations.sourceIssueId, issue.id),
            eq(issueRelations.targetIssueId, issue.id),
          ),
        ),
      )
      .returning({ id: issueRelations.id });
    if (!deleted) {
      throw new HttpError(404, "NOT_FOUND", "relation not found");
    }
    await db.insert(events).values({
      workspaceId: ws.id,
      entityType: "issue",
      entityId: issue.id,
      action: "relation_deleted",
      actorType: actor.type,
      actorId: actor.id,
      after: { relationId: deleted.id },
    });
    return c.json({ ok: true });
  });

async function findIssue(workspaceId: string, key: string) {
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.key, key)));
  if (!issue) throw new HttpError(404, "NOT_FOUND", `issue ${key} not found`);
  return issue;
}

async function setIssueLabels(
  issueId: string,
  workspaceId: string,
  labelIds: string[],
) {
  const valid = await db
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(eq(labels.workspaceId, workspaceId), inArray(labels.id, labelIds)),
    );
  // ids that are unknown or belong to another workspace are dropped; if none
  // remain there is nothing to insert (drizzle throws on an empty values())
  if (valid.length === 0) return;
  await db
    .insert(issueLabels)
    .values(valid.map((l) => ({ issueId, labelId: l.id })));
  // best-effort GitHub mirror — no-ops for unlinked issues (#60)
  if (valid.length > 0) track(mirrorIssueLabels(issueId));
}

// PATCH label set — replace semantics, matching the web editor's chip model.
// Ids are pre-validated against the workspace in the PATCH handler; the swap
// is transactional so an insert failure can't strip the existing set.
async function replaceIssueLabels(
  issueId: string,
  workspaceId: string,
  labelIds: string[],
) {
  await db.transaction(async (tx) => {
    await tx.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
    if (labelIds.length > 0) {
      await tx
        .insert(issueLabels)
        .values(labelIds.map((labelId) => ({ issueId, labelId })));
    }
  });
  if (labelIds.length > 0) track(mirrorIssueLabels(issueId));
}
