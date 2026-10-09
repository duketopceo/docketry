import { getCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { teams, users, workspaces } from "../db/schema.js";
import { apiError } from "../lib/errors.js";
import {
  createSession,
  destroySession,
  hashPassword,
  SESSION_COOKIE,
  sessionFromToken,
  verifyPassword,
} from "../services/auth.js";
import { actorFromHeaders } from "../lib/actor.js";
import { agentFromKey, type AgentAuth } from "../services/agents.js";
import type { Actor } from "../services/issues.js";

const bootstrapSchema = z.object({
  workspaceSlug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/),
  workspaceName: z.string().min(1).max(120),
  teamKey: z
    .string()
    .min(1)
    .max(6)
    .regex(/^[A-Z][A-Z0-9]*$/)
    .default("DOK"),
  email: z.email(),
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(256),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});

export const authRoutes = new Hono()
  .post(
    "/bootstrap",
    zValidator("json", bootstrapSchema),
    async (c) => {
      const existing = await db.select({ id: workspaces.id }).from(workspaces);
      if (existing.length > 0) {
        return apiError(
          c,
          403,
          "BOOTSTRAP_CLOSED",
          "workspace already exists — use login or an invite",
        );
      }
      const body = c.req.valid("json");

      const [ws] = await db
        .insert(workspaces)
        .values({ slug: body.workspaceSlug, name: body.workspaceName })
        .returning();
      await db.insert(teams).values({
        workspaceId: ws!.id,
        key: body.teamKey,
        name: "Docketry",
      });
      const [user] = await db
        .insert(users)
        .values({
          workspaceId: ws!.id,
          email: body.email,
          name: body.name,
          passwordHash: hashPassword(body.password),
        })
        .returning();

      const token = await createSession(user!.id, ws!.id);
      setSessionCookie(c, token);
      return c.json(
        {
          workspace: { id: ws!.id, slug: ws!.slug, name: ws!.name },
          user: { id: user!.id, email: user!.email, name: user!.name },
        },
        201,
      );
    },
  )
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const body = c.req.valid("json");
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email));
    if (
      !user ||
      !user.passwordHash ||
      !verifyPassword(body.password, user.passwordHash)
    ) {
      return apiError(c, 401, "BAD_CREDENTIALS", "invalid email or password");
    }
    const token = await createSession(user.id, user.workspaceId);
    setSessionCookie(c, token);
    return c.json({
      user: { id: user.id, email: user.email, name: user.name },
      workspaceId: user.workspaceId,
    });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await destroySession(token);
    setCookie(c, SESSION_COOKIE, "", { maxAge: 0, path: "/" });
    return c.json({ ok: true });
  })
  .get("/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return apiError(c, 401, "UNAUTHENTICATED", "no session");
    const session = await sessionFromToken(token);
    if (!session) return apiError(c, 401, "UNAUTHENTICATED", "session expired");
    return c.json(session);
  });

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
}

export interface Session {
  sessionId: string;
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
  name: string;
}

declare module "hono" {
  interface ContextVariableMap {
    session: Session | null;
    agentAuth: AgentAuth | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireSession(c: Context, next: Next) {
  if (c.req.path.startsWith("/v1/auth/")) return next();
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = await sessionFromToken(token);
    if (session) {
      c.set("session", session);
      c.set("agentAuth", null);
      await next();
      return;
    }
  }
  const bearer = c.req.header("authorization");
  if (bearer?.startsWith("Bearer dok_agt_")) {
    const agent = await agentFromKey(bearer.slice(7));
    if (agent) {
      const needed = SAFE_METHODS.has(c.req.method) ? "read" : "write";
      if (!agent.scopes.includes(needed)) {
        return apiError(
          c,
          403,
          "FORBIDDEN_SCOPE",
          `key lacks '${needed}' scope`,
        );
      }
      c.set("session", null);
      c.set("agentAuth", agent);
      await next();
      return;
    }
  }
  const actor = actorFromHeaders(c) as Actor;
  if (actor.type === "agent" && actor.id) {
    c.set("session", null);
    c.set("agentAuth", null);
    await next();
    return;
  }
  return apiError(c, 401, "UNAUTHENTICATED", "sign in or present agent credentials");
}
