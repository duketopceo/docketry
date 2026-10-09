import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt, lt, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ActorType } from "@docketry/types";
import { db } from "../db/client.js";
import { agents, events, issues, users } from "../db/schema.js";
import { apiError } from "../lib/errors.js";
import { decodeCursor, encodeCursor } from "../lib/pagination.js";
import { requireWorkspace } from "./workspaces.js";

// v0.2 realtime: poll-based SSE. `pg_notify`/Redis pub-sub is a later work
// order — 1s polling already meets the "~1s cross-client" acceptance bar and
// keeps this endpoint stateless.

const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
const BATCH_SIZE = 200;

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface FeedEvent {
  id: string; // bigserial — serialized as string so clients never truncate
  entityType: string;
  entityId: string;
  action: string;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  issueKey: string | null;
  issueTitle: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

function feedEventsQuery(
  where: SQL | undefined,
  order: "asc" | "desc",
  limit: number,
) {
  return db
    .select({
      id: events.id,
      entityType: events.entityType,
      entityId: events.entityId,
      action: events.action,
      actorType: events.actorType,
      actorId: events.actorId,
      before: events.before,
      after: events.after,
      createdAt: events.createdAt,
      issueKey: issues.key,
      issueTitle: issues.title,
      userName: users.name,
      agentName: agents.name,
    })
    .from(events)
    .leftJoin(
      issues,
      and(eq(issues.id, events.entityId), eq(events.entityType, "issue")),
    )
    .leftJoin(users, eq(users.id, events.actorId))
    .leftJoin(agents, eq(agents.id, events.actorId))
    .where(where)
    .orderBy(order === "asc" ? asc(events.id) : desc(events.id))
    .limit(limit);
}

type FeedRow = Awaited<ReturnType<typeof feedEventsQuery>>[number];

function toFeedEvent(row: FeedRow): FeedEvent {
  return {
    id: String(row.id),
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    actorName:
      row.actorType === "agent"
        ? row.agentName
        : row.actorType === "human"
          ? row.userName
          : null,
    issueKey: row.issueKey,
    issueTitle: row.issueTitle,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const eventRoutes = new Hono()
  .get(
    "/workspaces/:ws/events",
    zValidator("query", listQuerySchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const q = c.req.valid("query");

      // events.id (bigserial) is the total order — newest-first, `id` alone
      // is a sufficient cursor.
      const filters: SQL[] = [eq(events.workspaceId, ws.id)];
      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        const id = cur ? Number(cur.id) : Number.NaN;
        if (!Number.isSafeInteger(id) || id < 1) {
          return apiError(c, 400, "BAD_CURSOR", "invalid cursor");
        }
        filters.push(lt(events.id, id));
      }

      const rows = await feedEventsQuery(and(...filters), "desc", q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const last = page.at(-1);
      return c.json({
        events: page.map(toFeedEvent),
        nextCursor:
          hasMore && last
            ? encodeCursor({
                createdAt: last.createdAt.toISOString(),
                id: String(last.id),
              })
            : null,
      });
    },
  )
  .get("/workspaces/:ws/events/stream", async (c) => {
    const ws = await requireWorkspace(c);

    // Resume: EventSource sends `Last-Event-ID` on reconnect; `?after=` is the
    // equivalent knob for curl/CLI/MCP tails.
    const afterRaw = c.req.query("after") ?? c.req.header("last-event-id");
    let lastSeen = 0;
    if (afterRaw !== undefined) {
      const n = Number(afterRaw);
      if (!Number.isSafeInteger(n) || n < 0) {
        return apiError(c, 400, "BAD_CURSOR", "invalid event id");
      }
      lastSeen = n;
    }

    const reqSignal = c.req.raw.signal;
    return streamSSE(c, async (stream) => {
      // One stop signal covering request abort AND response-body cancel
      // (either fires on client disconnect, depending on runtime).
      const stopper = new AbortController();
      const stop = () => stopper.abort();
      stream.onAbort(stop);
      if (reqSignal.aborted) stopper.abort();
      else reqSignal.addEventListener("abort", stop, { once: true });
      const done = stopper.signal;

      let lastBeat = Date.now();
      while (!done.aborted) {
        try {
          const rows = await feedEventsQuery(
            and(eq(events.workspaceId, ws.id), gt(events.id, lastSeen)),
            "asc",
            BATCH_SIZE,
          );
          for (const row of rows) {
            lastSeen = row.id;
            await stream.writeSSE({
              id: String(row.id),
              data: JSON.stringify(toFeedEvent(row)),
            });
          }
        } catch {
          // transient poll failure — keep the stream alive, retry next tick
        }
        const now = Date.now();
        if (now - lastBeat >= HEARTBEAT_MS) {
          // SSE comment — keeps proxies/NATs from reaping an idle connection
          await stream.write(`: hb\n\n`);
          lastBeat = now;
        }
        await sleep(POLL_MS, done);
      }
      reqSignal.removeEventListener("abort", stop);
    });
  });
