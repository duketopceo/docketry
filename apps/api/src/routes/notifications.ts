import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { issues, notifications } from "../db/schema.js";
import { HttpError, apiError } from "../lib/errors.js";
import { decodeCursor, encodeCursor } from "../lib/pagination.js";
import { requireWorkspace } from "./workspaces.js";

// Notifications are a human surface — agent credentials never read them.
function requireHuman(c: {
  get: (k: string) => unknown;
}): { userId: string } {
  const session = c.get("session") as { userId: string } | undefined;
  if (!session) {
    throw new HttpError(
      403,
      "FORBIDDEN_AGENT",
      "notifications are for human members",
    );
  }
  return session;
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const notificationRoutes = new Hono()
  .get(
    "/workspaces/:ws/notifications",
    zValidator("query", listQuery),
    async (c) => {
      const ws = await requireWorkspace(c);
      const me = requireHuman(c);
      const q = c.req.valid("query");
      const cur = q.cursor ? decodeCursor(q.cursor) : null;
      const rows = await db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          issueId: notifications.issueId,
          issueKey: issues.key,
          issueTitle: issues.title,
          actorType: notifications.actorType,
          actorId: notifications.actorId,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .leftJoin(issues, eq(issues.id, notifications.issueId))
        .where(
          and(
            eq(notifications.workspaceId, ws.id),
            eq(notifications.userId, me.userId),
            cur
              ? or(
                  lt(notifications.createdAt, new Date(cur.createdAt)),
                  and(
                    eq(notifications.createdAt, new Date(cur.createdAt)),
                    lt(notifications.id, Number(cur.id)),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return c.json({
        notifications: page,
        nextCursor:
          rows.length > q.limit && last
            ? encodeCursor({
                createdAt: last.createdAt.toISOString(),
                id: String(last.id),
              })
            : null,
      });
    },
  )
  .get("/workspaces/:ws/notifications/unread-count", async (c) => {
    const ws = await requireWorkspace(c);
    const me = requireHuman(c);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, ws.id),
          eq(notifications.userId, me.userId),
          isNull(notifications.readAt),
        ),
      );
    return c.json({ count: row?.count ?? 0 });
  })
  .post("/workspaces/:ws/notifications/:id/read", async (c) => {
    const ws = await requireWorkspace(c);
    const me = requireHuman(c);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return apiError(c, 404, "NOT_FOUND", "notification not found");
    }
    const [row] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.workspaceId, ws.id),
          eq(notifications.userId, me.userId),
        ),
      )
      .returning({ id: notifications.id });
    if (!row) return apiError(c, 404, "NOT_FOUND", "notification not found");
    return c.json({ ok: true });
  })
  .post("/workspaces/:ws/notifications/read-all", async (c) => {
    const ws = await requireWorkspace(c);
    const me = requireHuman(c);
    const rows = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.workspaceId, ws.id),
          eq(notifications.userId, me.userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return c.json({ ok: true, count: rows.length });
  });
