import { z } from "zod";
import {
  ISSUE_SOURCES,
  ISSUE_STATES,
  PRIORITIES,
  type IssueState,
  type Priority,
} from "@docketry/types";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, DocketryClient } from "./client.js";

// ── API row shapes (only the fields tools read) ──────────────────────

interface IssueRow {
  id: string;
  key: string;
  number: number;
  title: string;
  description: string | null;
  state: IssueState;
  priority: Priority;
  estimate: number | null;
  dueDate: string | null;
  assigneeType: "human" | "agent" | null;
  assigneeId: string | null;
  creatorType: string;
  creatorId: string | null;
  projectId: string | null;
  cycleId: string | null;
  parentId: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  children?: { id: string; key: string; title: string }[];
  labels?: { id: string; name: string; color: string }[];
}

interface CommentRow {
  id: string;
  actorType: string;
  actorId: string | null;
  body: string;
  createdAt: string;
}

interface AgentRow {
  id: string;
  name: string;
  harness: string;
  capabilities: string[];
}

interface TeamRow {
  id: string;
  key: string;
  name: string;
  nextIssueNumber: number;
}

interface LabelRow {
  id: string;
  name: string;
  color: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  teamId: string | null;
}

interface CycleRow {
  id: string;
  name: string | null;
  number: number;
  teamId: string;
  startsAt: string;
  endsAt: string;
}

interface FeedEvent {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  issueKey: string | null;
  issueTitle: string | null;
  after: unknown;
  createdAt: string;
}

// ── Slim views — tool outputs stay agent-token-friendly ──────────────

function slimIssue(i: IssueRow) {
  return {
    key: i.key,
    title: i.title,
    state: i.state,
    priority: i.priority,
    assigneeType: i.assigneeType,
    assigneeId: i.assigneeId,
    dueDate: i.dueDate,
    updatedAt: i.updatedAt,
  };
}

function fullIssue(i: IssueRow) {
  return {
    ...slimIssue(i),
    number: i.number,
    description: i.description,
    estimate: i.estimate,
    creatorType: i.creatorType,
    source: i.source,
    projectId: i.projectId,
    cycleId: i.cycleId,
    parentId: i.parentId,
    labels: (i.labels ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })),
    children: (i.children ?? []).map((ch) => ({ key: ch.key, title: ch.title })),
    createdAt: i.createdAt,
  };
}

function slimComment(c: CommentRow) {
  return {
    id: c.id,
    actorType: c.actorType,
    actorId: c.actorId,
    body: c.body,
    createdAt: c.createdAt,
  };
}

// ── Errors ───────────────────────────────────────────────────────────

/** A client-side tool failure that maps onto the API's error envelope. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

function errorResult(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error: { code, message } }) },
    ],
  };
}

function okResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

// ── Tool definition plumbing ─────────────────────────────────────────

type ZodShape = Record<string, z.ZodType>;

type ArgsOf<S extends ZodShape> = { [K in keyof S]: z.infer<S[K]> };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodShape;
  readOnly?: boolean;
  /** Validates raw args against inputSchema, then invokes the handler. */
  call: (
    rawArgs: unknown,
    client: DocketryClient,
  ) => Promise<Record<string, unknown>>;
}

function defineTool<S extends ZodShape>(def: {
  name: string;
  description: string;
  inputSchema: S;
  readOnly?: boolean;
  handler: (args: ArgsOf<S>, client: DocketryClient) => Promise<Record<string, unknown>>;
}): ToolDef {
  const schema = z.object(def.inputSchema);
  return {
    ...def,
    call: (rawArgs, client) =>
      def.handler(schema.parse(rawArgs) as ArgsOf<S>, client),
  };
}

/**
 * Runs one tool handler: parses args against the input schema (same as the
 * SDK does at the protocol layer), maps API/local errors onto the
 * `{error:{code,message}}` envelope. Never throws — a tool error is a
 * result, not a server crash.
 */
export async function executeTool(
  def: ToolDef,
  args: unknown,
  client: DocketryClient,
): Promise<CallToolResult> {
  try {
    return okResult(await def.call(args, client));
  } catch (err) {
    if (err instanceof ApiError) {
      return errorResult(err.code, err.message);
    }
    if (err instanceof ToolError) {
      return errorResult(err.code, err.message);
    }
    if (err instanceof z.ZodError) {
      return errorResult("BAD_INPUT", z.prettifyError(err));
    }
    return errorResult(
      "INTERNAL",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Tools ────────────────────────────────────────────────────────────

const uuid = z.uuid();

const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export const toolDefs: ToolDef[] = [
  defineTool({
    name: "whoami",
    description:
      "Resolve the configured credential to an identity — type (agent|human), id, name, scopes. Agents use this to find their assignee id.",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, client) => ({ ...(await client.whoami()) }),
  }),

  defineTool({
    name: "list_issues",
    description:
      "List issues in the workspace. Filters: state/priority (arrays), team key, assignee id, cycle id, label id, source, title search. Cursor-paginated.",
    inputSchema: {
      state: z.array(z.enum(ISSUE_STATES)).optional(),
      priority: z.array(z.enum(PRIORITIES)).optional(),
      team: z.string().optional(),
      assignee: uuid.optional(),
      cycle: uuid.optional(),
      label: uuid.optional(),
      source: z.enum(ISSUE_SOURCES).optional(),
      search: z.string().max(200).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    readOnly: true,
    handler: async (args, client) => {
      const res = await client.apiGet<{
        issues: IssueRow[];
        nextCursor: string | null;
      }>("/issues", {
        state: args.state?.join(","),
        priority: args.priority?.join(","),
        team: args.team,
        assignee: args.assignee,
        cycle: args.cycle,
        label: args.label,
        source: args.source,
        search: args.search,
        cursor: args.cursor,
        limit: args.limit,
      });
      return {
        issues: res.issues.map(slimIssue),
        nextCursor: res.nextCursor,
      };
    },
  }),

  defineTool({
    name: "ready",
    description:
      "List issues ready to work — state 'todo', ordered by priority (urgent first, then oldest). `mine` restricts to issues assigned to you.",
    inputSchema: {
      mine: z.boolean().optional(),
      team: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    readOnly: true,
    handler: async (args, client) => {
      const assignee = args.mine ? (await client.whoami()).id : undefined;
      const res = await client.apiGet<{
        issues: IssueRow[];
        nextCursor: string | null;
      }>("/issues", {
        state: "todo",
        team: args.team,
        assignee,
        limit: 200,
      });
      const ordered = res.issues
        .slice()
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            Date.parse(a.createdAt) - Date.parse(b.createdAt),
        )
        .slice(0, args.limit ?? 20);
      return { issues: ordered.map(slimIssue) };
    },
  }),

  defineTool({
    name: "get_issue",
    description:
      "Fetch one issue by key (e.g. ENG-1) — full view including labels and child keys. Set includeComments to append the comment thread.",
    inputSchema: {
      key: z.string(),
      includeComments: z.boolean().optional(),
    },
    readOnly: true,
    handler: async (args, client) => {
      const issue = await client.apiGet<IssueRow>(
        `/issues/${encodeURIComponent(args.key)}`,
      );
      const out: Record<string, unknown> = fullIssue(issue);
      if (args.includeComments) {
        const res = await client.apiGet<{ comments: CommentRow[] }>(
          `/issues/${encodeURIComponent(args.key)}/comments`,
        );
        out.comments = res.comments.map(slimComment);
      }
      return out;
    },
  }),

  defineTool({
    name: "create_issue",
    description:
      "Create an issue. State may be 'triage' or 'backlog' (default backlog). teamKey picks the team (defaults to the workspace's first). To assign, pass assigneeType AND assigneeId together.",
    inputSchema: {
      title: z.string().min(1).max(500),
      description: z.string().max(50_000).optional(),
      state: z.enum(["triage", "backlog"]).optional(),
      priority: z.enum(PRIORITIES).optional(),
      teamKey: z.string().min(1).max(6).optional(),
      assigneeType: z.enum(["human", "agent"]).optional(),
      assigneeId: uuid.optional(),
      labelIds: z.array(uuid).max(10).optional(),
      projectId: uuid.optional(),
      cycleId: uuid.optional(),
      parentId: uuid.optional(),
    },
    handler: async (args, client) => {
      if (args.assigneeId !== undefined && args.assigneeType === undefined) {
        throw new ToolError(
          "BAD_INPUT",
          "assigneeType is required when assigneeId is set",
        );
      }
      const issue = await client.apiPost<IssueRow>("/issues", {
        title: args.title,
        description: args.description,
        state: args.state,
        priority: args.priority,
        teamKey: args.teamKey,
        assigneeType: args.assigneeType,
        assigneeId: args.assigneeId,
        labelIds: args.labelIds,
        projectId: args.projectId,
        cycleId: args.cycleId,
        parentId: args.parentId,
        // agent-authored issues are marked with provenance source 'api'
        source: "api",
      });
      return slimIssue(issue);
    },
  }),

  defineTool({
    name: "update_issue",
    description:
      "Patch an issue by key — title, description, state (state machine enforced), priority, estimate, dueDate, assignee, cycle, project, parent. Pass null to clear nullable fields.",
    inputSchema: {
      key: z.string(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(50_000).nullable().optional(),
      state: z.enum(ISSUE_STATES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      estimate: z.number().int().nonnegative().nullable().optional(),
      dueDate: z.iso.datetime().nullable().optional(),
      assigneeType: z.enum(["human", "agent"]).nullable().optional(),
      assigneeId: uuid.nullable().optional(),
      cycleId: uuid.nullable().optional(),
      projectId: uuid.nullable().optional(),
      parentId: uuid.nullable().optional(),
    },
    handler: async (args, client) => {
      const { key, ...fields } = args;
      if (args.assigneeId && args.assigneeType === undefined) {
        throw new ToolError(
          "BAD_INPUT",
          "assigneeType is required when assigning (assigneeId set)",
        );
      }
      const issue = await client.apiPatch<IssueRow>(
        `/issues/${encodeURIComponent(key)}`,
        fields,
      );
      return slimIssue(issue);
    },
  }),

  defineTool({
    name: "triage_issue",
    description:
      "Accept (→ backlog) or decline (→ canceled) an issue sitting in 'triage'. Only valid while the issue is in triage.",
    inputSchema: {
      key: z.string(),
      action: z.enum(["accept", "decline"]),
    },
    handler: async (args, client) => {
      const issue = await client.apiPost<IssueRow>(
        `/issues/${encodeURIComponent(args.key)}/triage`,
        { action: args.action },
      );
      return slimIssue(issue);
    },
  }),

  defineTool({
    name: "comment",
    description:
      "Add a comment to an issue by key. Authored as the credential's identity — agent keys post as the agent.",
    inputSchema: {
      key: z.string(),
      body: z.string().min(1).max(50_000),
    },
    handler: async (args, client) => {
      const comment = await client.apiPost<CommentRow>(
        `/issues/${encodeURIComponent(args.key)}/comments`,
        { body: args.body },
      );
      return { issueKey: args.key, ...slimComment(comment) };
    },
  }),

  defineTool({
    name: "claim",
    description:
      "Claim an issue for yourself — assigns it to the credential's identity and moves it to 'in_progress' (hops via 'todo' from 'backlog'). Issues in 'triage' must be accepted via triage_issue first; terminal issues cannot be claimed.",
    inputSchema: { key: z.string() },
    handler: async (args, client) => {
      const key = encodeURIComponent(args.key);
      const [issue, me] = await Promise.all([
        client.apiGet<IssueRow>(`/issues/${key}`),
        client.whoami(),
      ]);

      const hops: Partial<Record<IssueState, IssueState[]>> = {
        backlog: ["todo", "in_progress"],
        todo: ["in_progress"],
        in_progress: [],
        in_review: ["in_progress"],
      };
      const path = hops[issue.state];
      if (path === undefined) {
        throw new ToolError(
          "INVALID_STATE",
          issue.state === "triage"
            ? `${issue.key} is in triage — accept it with triage_issue before claiming`
            : `cannot claim ${issue.key} from state '${issue.state}'`,
        );
      }

      const assignee = { assigneeType: me.type, assigneeId: me.id };
      let updated: IssueRow;
      if (path.length === 0) {
        updated = await client.apiPatch<IssueRow>(`/issues/${key}`, assignee);
      } else {
        updated = await client.apiPatch<IssueRow>(`/issues/${key}`, {
          ...assignee,
          state: path[0]!,
        });
        for (const state of path.slice(1)) {
          updated = await client.apiPatch<IssueRow>(`/issues/${key}`, {
            state,
          });
        }
      }
      return { ...slimIssue(updated), claimedBy: me.name };
    },
  }),

  defineTool({
    name: "list_agents",
    description: "List registered agent identities in the workspace.",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, client) => {
      const res = await client.apiGet<{ agents: AgentRow[] }>("/agents");
      return {
        agents: res.agents.map((a) => ({
          id: a.id,
          name: a.name,
          harness: a.harness,
          capabilities: a.capabilities,
        })),
      };
    },
  }),

  defineTool({
    name: "list_teams",
    description: "List teams in the workspace (key, name).",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, client) => {
      const res = await client.apiGet<{ teams: TeamRow[] }>("/teams");
      return {
        teams: res.teams.map((t) => ({
          id: t.id,
          key: t.key,
          name: t.name,
        })),
      };
    },
  }),

  defineTool({
    name: "list_labels",
    description: "List issue labels in the workspace (id, name, color).",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, client) => {
      const res = await client.apiGet<{ labels: LabelRow[] }>("/labels");
      return {
        labels: res.labels.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
        })),
      };
    },
  }),

  defineTool({
    name: "list_projects",
    description: "List projects in the workspace (id, name, status).",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, client) => {
      const res = await client.apiGet<{ projects: ProjectRow[] }>("/projects");
      return {
        projects: res.projects.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          teamId: p.teamId,
        })),
      };
    },
  }),

  defineTool({
    name: "list_cycles",
    description:
      "List cycles in the workspace. Filter by team key, or `active` for the cycle containing now.",
    inputSchema: {
      team: z.string().optional(),
      active: z.boolean().optional(),
    },
    readOnly: true,
    handler: async (args, client) => {
      const res = await client.apiGet<{ cycles: CycleRow[] }>("/cycles", {
        team: args.team,
        active: args.active,
      });
      return {
        cycles: res.cycles.map((c) => ({
          id: c.id,
          name: c.name,
          number: c.number,
          teamId: c.teamId,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
        })),
      };
    },
  }),

  defineTool({
    name: "list_events",
    description:
      "Workspace activity feed — newest first, cursor-paginated. Each event carries action, actor name, and the issue key/title it touched.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    readOnly: true,
    handler: async (args, client) => {
      const res = await client.apiGet<{
        events: FeedEvent[];
        nextCursor: string | null;
      }>("/events", { limit: args.limit, cursor: args.cursor });
      return {
        events: res.events.map((e) => ({
          id: e.id,
          action: e.action,
          actorType: e.actorType,
          actorName: e.actorName,
          issueKey: e.issueKey,
          issueTitle: e.issueTitle,
          after: e.after,
          createdAt: e.createdAt,
        })),
        nextCursor: res.nextCursor,
      };
    },
  }),
];

export const toolsByName = new Map(toolDefs.map((d) => [d.name, d]));

/** Invoke a tool by name — used by tests and the in-process path. */
export function runTool(
  name: string,
  args: Record<string, unknown>,
  client: DocketryClient,
): Promise<CallToolResult> {
  const def = toolsByName.get(name);
  if (!def) return Promise.resolve(errorResult("UNKNOWN_TOOL", `unknown tool '${name}'`));
  return executeTool(def, args, client);
}
