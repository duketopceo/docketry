import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { agentKeys, agents } from "../db/schema.js";
import { apiError, HttpError } from "../lib/errors.js";
import { createAgentKey } from "../services/agents.js";
import { requireWorkspace } from "./workspaces.js";

const AGENT_SCOPES = ["read", "write"] as const;

const agentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case identifier"),
  harness: z.string().min(1).max(80),
  capabilities: z.array(z.string().max(80)).max(20).default([]),
});

const keySchema = z.object({
  name: z.string().min(1).max(80).default("default"),
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1).default(["read"]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// Agent management requires a human session — agents cannot mint agents.
export const agentRoutes = new Hono()
  .post(
    "/workspaces/:ws/agents",
    zValidator("json", agentSchema),
    async (c) => {
      if (!c.get("session")) {
        return apiError(c, 403, "FORBIDDEN", "agent registry is human-only");
      }
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const dup = await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(eq(agents.workspaceId, ws.id), eq(agents.name, body.name)),
        );
      if (dup.length > 0) {
        throw new HttpError(409, "CONFLICT", "agent name already exists");
      }
      const [agent] = await db
        .insert(agents)
        .values({
          workspaceId: ws.id,
          name: body.name,
          harness: body.harness,
          capabilities: body.capabilities,
        })
        .returning();
      return c.json(agent, 201);
    },
  )
  .get("/workspaces/:ws/agents", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, ws.id))
      .orderBy(asc(agents.name));
    return c.json({ agents: rows });
  })
  .post(
    "/workspaces/:ws/agents/:id/keys",
    zValidator("json", keySchema),
    async (c) => {
      if (!c.get("session")) {
        return apiError(c, 403, "FORBIDDEN", "key minting is human-only");
      }
      const ws = await requireWorkspace(c);
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, c.req.param("id")));
      if (!agent || agent.workspaceId !== ws.id) {
        throw new HttpError(404, "NOT_FOUND", "agent not found");
      }
      const body = c.req.valid("json");
      const { key, id } = await createAgentKey(
        agent.id,
        ws.id,
        body.name,
        body.scopes,
        body.expiresInDays
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : undefined,
      );
      // plaintext shown once — only the hash is stored
      return c.json({ id, key, scopes: body.scopes }, 201);
    },
  )
  .get("/workspaces/:ws/agents/:id/keys", async (c) => {
    if (!c.get("session")) {
      return apiError(c, 403, "FORBIDDEN", "key listing is human-only");
    }
    const ws = await requireWorkspace(c);
    const rows = await db
      .select({
        id: agentKeys.id,
        name: agentKeys.name,
        scopes: agentKeys.scopes,
        expiresAt: agentKeys.expiresAt,
        lastUsedAt: agentKeys.lastUsedAt,
        createdAt: agentKeys.createdAt,
      })
      .from(agentKeys)
      .where(
        and(
          eq(agentKeys.agentId, c.req.param("id")),
          eq(agentKeys.workspaceId, ws.id),
        ),
      );
    return c.json({ keys: rows });
  });
