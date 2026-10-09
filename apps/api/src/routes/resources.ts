import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { cycles, projects, teams, views } from "../db/schema.js";
import { apiError, HttpError } from "../lib/errors.js";
import { requireWorkspace } from "./workspaces.js";

const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;

const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  status: z.enum(PROJECT_STATUSES).default("planned"),
  teamKey: z.string().min(1).max(6).optional(),
});

const projectPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

const cycleCreateSchema = z.object({
  teamKey: z.string().min(1).max(6),
  name: z.string().max(120).optional(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

const cyclePatchSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
});

const cycleQuerySchema = z.object({
  team: z.string().optional(),
  active: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .optional(),
});

const viewCreateSchema = z.object({
  name: z.string().min(1).max(120),
  filters: z.record(z.string(), z.unknown()),
  shared: z.boolean().default(false),
});

const viewPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  shared: z.boolean().optional(),
});

async function findProject(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)));
  if (!row) throw new HttpError(404, "NOT_FOUND", "project not found");
  return row;
}

async function findCycle(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.id, id), eq(cycles.workspaceId, workspaceId)));
  if (!row) throw new HttpError(404, "NOT_FOUND", "cycle not found");
  return row;
}

async function findView(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(views)
    .where(and(eq(views.id, id), eq(views.workspaceId, workspaceId)));
  if (!row) throw new HttpError(404, "NOT_FOUND", "view not found");
  return row;
}

async function teamForKey(workspaceId: string, key: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.key, key)));
  if (!team) throw new HttpError(404, "NOT_FOUND", `team ${key} not found`);
  return team;
}

export const resourceRoutes = new Hono()
  // ── Projects ─────────────────────────────────────────────
  .get("/workspaces/:ws/projects", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, ws.id))
      .orderBy(asc(projects.createdAt));
    return c.json({ projects: rows });
  })
  .post(
    "/workspaces/:ws/projects",
    zValidator("json", projectCreateSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      let teamId: string | null = null;
      if (body.teamKey) teamId = (await teamForKey(ws.id, body.teamKey)).id;
      const [project] = await db
        .insert(projects)
        .values({
          workspaceId: ws.id,
          teamId,
          name: body.name,
          status: body.status,
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
        })
        .returning();
      return c.json(project, 201);
    },
  )
  .patch(
    "/workspaces/:ws/projects/:id",
    zValidator("json", projectPatchSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const project = await findProject(ws.id, c.req.param("id"));
      const body = c.req.valid("json");
      const [updated] = await db
        .update(projects)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        })
        .where(eq(projects.id, project.id))
        .returning();
      return c.json(updated);
    },
  )
  .delete("/workspaces/:ws/projects/:id", async (c) => {
    const ws = await requireWorkspace(c);
    const project = await findProject(ws.id, c.req.param("id"));
    await db.delete(projects).where(eq(projects.id, project.id));
    return c.json({ ok: true });
  })
  // ── Cycles ───────────────────────────────────────────────
  .get(
    "/workspaces/:ws/cycles",
    zValidator("query", cycleQuerySchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const q = c.req.valid("query");
      const filters = [eq(cycles.workspaceId, ws.id)];
      if (q.team) filters.push(eq(cycles.teamId, (await teamForKey(ws.id, q.team)).id));
      if (q.active) {
        const now = new Date();
        filters.push(lte(cycles.startsAt, now), gt(cycles.endsAt, now));
      }
      const rows = await db
        .select()
        .from(cycles)
        .where(and(...filters))
        .orderBy(asc(cycles.startsAt));
      return c.json({ cycles: rows });
    },
  )
  .post(
    "/workspaces/:ws/cycles",
    zValidator("json", cycleCreateSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const team = await teamForKey(ws.id, body.teamKey);
      const [latest] = await db
        .select({ number: cycles.number })
        .from(cycles)
        .where(eq(cycles.teamId, team.id))
        .orderBy(desc(cycles.number))
        .limit(1);
      const number = (latest?.number ?? 0) + 1;
      const [cycle] = await db
        .insert(cycles)
        .values({
          workspaceId: ws.id,
          teamId: team.id,
          number,
          ...(body.name !== undefined ? { name: body.name } : {}),
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
        })
        .returning();
      return c.json(cycle, 201);
    },
  )
  .patch(
    "/workspaces/:ws/cycles/:id",
    zValidator("json", cyclePatchSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const cycle = await findCycle(ws.id, c.req.param("id"));
      const body = c.req.valid("json");
      const [updated] = await db
        .update(cycles)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.startsAt !== undefined
            ? { startsAt: new Date(body.startsAt) }
            : {}),
          ...(body.endsAt !== undefined
            ? { endsAt: new Date(body.endsAt) }
            : {}),
        })
        .where(eq(cycles.id, cycle.id))
        .returning();
      return c.json(updated);
    },
  )
  // ── Views (saved filters) ────────────────────────────────
  .get("/workspaces/:ws/views", async (c) => {
    const ws = await requireWorkspace(c);
    const session = c.get("session");
    if (!session) {
      return apiError(c, 403, "FORBIDDEN", "views require a user identity");
    }
    const rows = await db
      .select()
      .from(views)
      .where(
        and(
          eq(views.workspaceId, ws.id),
          or(eq(views.ownerId, session.userId), eq(views.shared, true)),
        ),
      )
      .orderBy(asc(views.createdAt));
    return c.json({ views: rows });
  })
  .post(
    "/workspaces/:ws/views",
    zValidator("json", viewCreateSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const session = c.get("session");
      if (!session) {
        return apiError(c, 403, "FORBIDDEN", "views require a user identity");
      }
      const body = c.req.valid("json");
      const [view] = await db
        .insert(views)
        .values({
          workspaceId: ws.id,
          ownerId: session.userId,
          name: body.name,
          filters: body.filters,
          shared: body.shared,
        })
        .returning();
      return c.json(view, 201);
    },
  )
  .patch(
    "/workspaces/:ws/views/:id",
    zValidator("json", viewPatchSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const session = c.get("session");
      const view = await findView(ws.id, c.req.param("id"));
      if (!session || view.ownerId !== session.userId) {
        return apiError(c, 403, "FORBIDDEN", "only the owner can edit a view");
      }
      const body = c.req.valid("json");
      const [updated] = await db
        .update(views)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.filters !== undefined ? { filters: body.filters } : {}),
          ...(body.shared !== undefined ? { shared: body.shared } : {}),
        })
        .where(eq(views.id, view.id))
        .returning();
      return c.json(updated);
    },
  )
  .delete("/workspaces/:ws/views/:id", async (c) => {
    const ws = await requireWorkspace(c);
    const session = c.get("session");
    const view = await findView(ws.id, c.req.param("id"));
    if (!session || view.ownerId !== session.userId) {
      return apiError(c, 403, "FORBIDDEN", "only the owner can delete a view");
    }
    await db.delete(views).where(eq(views.id, view.id));
    return c.json({ ok: true });
  });
