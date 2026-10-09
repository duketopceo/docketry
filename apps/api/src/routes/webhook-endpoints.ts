import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { webhookDeliveries, webhookEndpoints } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { generateEndpointSecret } from "../services/outbound.js";
import { requireWorkspace } from "./workspaces.js";

const createSchema = z.object({
  url: z.url(),
  events: z.array(z.string().min(1).max(80)).min(1).default(["*"]),
  secret: z.string().min(16).max(128).optional(),
});

const patchSchema = z.object({
  url: z.url().optional(),
  events: z.array(z.string().min(1).max(80)).min(1).optional(),
  enabled: z.boolean().optional(),
});

function mask(row: typeof webhookEndpoints.$inferSelect) {
  const { secret, ...rest } = row;
  return { ...rest, secretLast4: secret.slice(-4) };
}

export const webhookEndpointRoutes = new Hono()
  .get("/workspaces/:ws/webhook-endpoints", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.workspaceId, ws.id));
    return c.json({ endpoints: rows.map(mask) });
  })
  .post(
    "/workspaces/:ws/webhook-endpoints",
    zValidator("json", createSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const secret = body.secret ?? generateEndpointSecret();
      const [row] = await db
        .insert(webhookEndpoints)
        .values({
          workspaceId: ws.id,
          url: body.url,
          secret,
          events: body.events,
        })
        .returning();
      // full secret shown once at creation
      return c.json({ ...row!, secret }, 201);
    },
  )
  .patch(
    "/workspaces/:ws/webhook-endpoints/:id",
    zValidator("json", patchSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const [row] = await db
        .update(webhookEndpoints)
        .set(body)
        .where(
          and(
            eq(webhookEndpoints.id, c.req.param("id")),
            eq(webhookEndpoints.workspaceId, ws.id),
          ),
        )
        .returning();
      if (!row) throw new HttpError(404, "NOT_FOUND", "endpoint not found");
      return c.json(mask(row));
    },
  )
  .delete("/workspaces/:ws/webhook-endpoints/:id", async (c) => {
    const ws = await requireWorkspace(c);
    const [row] = await db
      .delete(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, c.req.param("id")),
          eq(webhookEndpoints.workspaceId, ws.id),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "NOT_FOUND", "endpoint not found");
    return c.json({ ok: true });
  })
  .get("/workspaces/:ws/webhook-endpoints/:id/deliveries", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, c.req.param("id")),
          eq(webhookDeliveries.workspaceId, ws.id),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return c.json({ deliveries: rows });
  });
