import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { agents, comments, dispatches, events, issues } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { queueDeliveries } from "../services/outbound.js";
import { requireWorkspace } from "./workspaces.js";

const reportSchema = z.object({
  outcome: z.enum(["completed", "failed"]),
  reason: z.string().max(500).optional(),
  branch: z
    .string()
    .max(200)
    .regex(/^[^\s~^:?*\[\]]+$/, "invalid branch name")
    .optional(),
  prUrl: z.url().optional(),
});

export const dispatchRoutes = new Hono()
  // list dispatches — agent keys only see their own
  .get("/workspaces/:ws/dispatches", async (c) => {
    const ws = await requireWorkspace(c);
    const agent = c.get("agentAuth");
    const status = c.req.query("status");
    const agentId = c.req.query("agentId") ?? agent?.agentId;

    const filters = [eq(dispatches.workspaceId, ws.id)];
    if (agentId) filters.push(eq(dispatches.agentId, agentId));
    if (status) {
      filters.push(
        eq(
          dispatches.status,
          status as "queued" | "claimed" | "dispatch_failed" | "completed" | "canceled",
        ),
      );
    }
    const rows = await db
      .select({
        id: dispatches.id,
        status: dispatches.status,
        trigger: dispatches.trigger,
        adapter: dispatches.adapter,
        reason: dispatches.reason,
        commentBody: dispatches.commentBody,
        createdAt: dispatches.createdAt,
        updatedAt: dispatches.updatedAt,
        agentId: dispatches.agentId,
        agentName: agents.name,
        issueId: issues.id,
        issueKey: issues.key,
        issueTitle: issues.title,
      })
      .from(dispatches)
      .innerJoin(agents, eq(dispatches.agentId, agents.id))
      .innerJoin(issues, eq(dispatches.issueId, issues.id))
      .where(and(...filters))
      .orderBy(desc(dispatches.createdAt))
      .limit(100);
    return c.json({ dispatches: rows });
  })
  // session lifecycle report — agent keys report only their own dispatches
  .post(
    "/workspaces/:ws/dispatches/:id/report",
    zValidator("json", reportSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const agent = c.get("agentAuth");
      const body = c.req.valid("json");

      const [dispatch] = await db
        .select()
        .from(dispatches)
        .where(
          and(
            eq(dispatches.id, c.req.param("id")),
            eq(dispatches.workspaceId, ws.id),
          ),
        )
        .limit(1);
      if (!dispatch) {
        throw new HttpError(404, "NOT_FOUND", "dispatch not found");
      }
      if (agent && agent.agentId !== dispatch.agentId) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "agent keys may only report their own dispatches",
        );
      }

      const status = body.outcome === "completed" ? "completed" : "dispatch_failed";
      await db
        .update(dispatches)
        .set({
          status,
          reason: body.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(dispatches.id, dispatch.id));

      const detail = {
        dispatchId: dispatch.id,
        ...(body.branch ? { branch: body.branch } : {}),
        ...(body.prUrl ? { pr: body.prUrl } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
      };
      const action =
        body.outcome === "completed" ? "dispatch_completed" : "dispatch_failed";
      await db.insert(events).values({
        workspaceId: ws.id,
        entityType: "issue",
        entityId: dispatch.issueId,
        action,
        actorType: agent ? "agent" : "system",
        actorId: agent?.agentId ?? null,
        after: detail,
      });
      await queueDeliveries({
        workspaceId: ws.id,
        entityType: "issue",
        entityId: dispatch.issueId,
        action,
        actorType: agent ? "agent" : "system",
        actorId: agent?.agentId ?? null,
        after: detail,
      });
      await db.insert(comments).values({
        workspaceId: ws.id,
        issueId: dispatch.issueId,
        actorType: agent ? "agent" : "system",
        actorId: agent?.agentId ?? null,
        body:
          body.outcome === "completed"
            ? `session completed${body.branch ? ` — branch \`${body.branch}\`` : ""}${body.prUrl ? ` — ${body.prUrl}` : ""}`
            : `session failed${body.reason ? `: ${body.reason}` : ""}`,
      });
      return c.json({ ok: true, status });
    },
  );
