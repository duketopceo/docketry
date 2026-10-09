import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { teams, workspaces } from "../db/schema.js";
import { apiError, HttpError } from "../lib/errors.js";

const createWorkspaceSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
});

const createTeamSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(6)
    .regex(/^[A-Z][A-Z0-9]*$/),
  name: z.string().min(1).max(120),
  rolloverBehavior: z.enum(["next_cycle", "backlog"]).default("next_cycle"),
});

const patchTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rolloverBehavior: z.enum(["next_cycle", "backlog"]).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: "patch body must set at least one field",
});

export const workspaceRoutes = new Hono()
  .post("/workspaces", zValidator("json", createWorkspaceSchema), async (c) => {
    const body = c.req.valid("json");
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, body.slug));
    if (existing.length > 0) {
      return apiError(c, 409, "CONFLICT", `workspace '${body.slug}' exists`);
    }
    const [ws] = await db.insert(workspaces).values(body).returning();
    return c.json(ws, 201);
  })
  .get("/workspaces/:ws", async (c) => {
    const ws = await requireWorkspace(c);
    return c.json(ws);
  })
  .post(
    "/workspaces/:ws/teams",
    zValidator("json", createTeamSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const [existing] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.workspaceId, ws.id), eq(teams.key, body.key)));
      if (existing) {
        return apiError(c, 409, "CONFLICT", `team key '${body.key}' exists`);
      }
      const [team] = await db
        .insert(teams)
        .values({
          workspaceId: ws.id,
          key: body.key,
          name: body.name,
          rolloverBehavior: body.rolloverBehavior,
        })
        .returning();
      return c.json(team, 201);
    },
  )
  .get("/workspaces/:ws/teams", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(teams)
      .where(eq(teams.workspaceId, ws.id));
    return c.json({ teams: rows });
  })
  .patch(
    "/workspaces/:ws/teams/:id",
    zValidator("json", patchTeamSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const [team] = await db
        .update(teams)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.rolloverBehavior !== undefined
            ? { rolloverBehavior: body.rolloverBehavior }
            : {}),
        })
        .where(
          and(
            eq(teams.id, c.req.param("id")),
            eq(teams.workspaceId, ws.id),
          ),
        )
        .returning();
      if (!team) return apiError(c, 404, "NOT_FOUND", "team not found");
      return c.json(team);
    },
  );

export async function findWorkspace(slug: string) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug));
  return ws ?? null;
}

export async function requireWorkspace(c: Context) {
  const ws = await findWorkspace(c.req.param("ws") ?? "");
  if (!ws) throw new HttpError(404, "NOT_FOUND", "workspace not found");
  // Credentials are workspace-bound: a key/token/session minted in one
  // workspace cannot act in another.
  const session = c.get("session");
  const agent = c.get("agentAuth");
  const bound = session?.workspaceId ?? agent?.workspaceId ?? null;
  if (bound && bound !== ws.id) {
    throw new HttpError(403, "FORBIDDEN_WORKSPACE", "credential not scoped to this workspace");
  }
  return ws;
}
