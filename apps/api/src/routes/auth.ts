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
import { agentFromKey, type AgentAuth } from "../services/agents.js";
import {
  ACCESS_TOKEN_TTL_S,
  signAccessToken,
  userFromToken,
  verifyAccessToken,
} from "../services/tokens.js";

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
    // Bearer credentials resolve their own identity — CLI/MCP clients need
    // this to learn which agent/user a token belongs to.
    const bearer = c.req.header("authorization");
    const bearerToken = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
    if (bearerToken?.startsWith("dok_agt_")) {
      const agent = await agentFromKey(bearerToken);
      if (!agent) return apiError(c, 401, "UNAUTHENTICATED", "bad key");
      return c.json({
        type: "agent",
        agentId: agent.agentId,
        name: agent.agentName,
        workspaceId: agent.workspaceId,
        scopes: agent.scopes,
      });
    }
    if (bearerToken?.startsWith("dok_pat_")) {
      const pat = await userFromToken(bearerToken);
      if (!pat) return apiError(c, 401, "UNAUTHENTICATED", "bad token");
      return c.json({
        type: "user",
        userId: pat.userId,
        name: pat.userName,
        workspaceId: pat.workspaceId,
        workspaceSlug: pat.workspaceSlug,
        scopes: pat.scopes,
      });
    }
    if (bearerToken && !bearerToken.startsWith("dok_")) {
      const claims = await verifyAccessToken(bearerToken);
      if (!claims) return apiError(c, 401, "UNAUTHENTICATED", "bad jwt");
      return c.json({
        type: "user",
        userId: claims.sub,
        workspaceId: claims.ws,
        scopes: claims.scopes,
      });
    }
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return apiError(c, 401, "UNAUTHENTICATED", "no session");
    const session = await sessionFromToken(token);
    if (!session) return apiError(c, 401, "UNAUTHENTICATED", "session expired");
    return c.json(session);
  })
  // Exchange a session cookie for a short-lived access JWT — the
  // programmatic-auth path for human users (agents mint dok_agt_ keys instead).
  .post("/token", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return apiError(c, 401, "UNAUTHENTICATED", "no session");
    const session = await sessionFromToken(token);
    if (!session) return apiError(c, 401, "UNAUTHENTICATED", "session expired");
    const accessToken = await signAccessToken({
      sub: session.userId,
      ws: session.workspaceId,
    });
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
    });
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
    // scopes carried by the presented credential (agent key, PAT, JWT);
    // null for cookie sessions, which always act with full user rights
    tokenScopes: string[] | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Cookie sessions mint credentials; delegated credentials (PATs, JWTs) and
// agent keys cannot mint or enumerate further credentials.
export function isCookieSession(c: Context): boolean {
  const session = c.get("session");
  return (
    session !== null &&
    session !== undefined &&
    !session.sessionId.startsWith("pat:") &&
    !session.sessionId.startsWith("jwt:")
  );
}

function scopeGuard(c: Context, scopes: string[]) {
  const needed = SAFE_METHODS.has(c.req.method) ? "read" : "write";
  if (!scopes.includes(needed)) {
    return apiError(
      c,
      403,
      "FORBIDDEN_SCOPE",
      `token lacks '${needed}' scope`,
    );
  }
  return null;
}

export async function requireSession(c: Context, next: Next) {
  if (c.req.path.startsWith("/v1/auth/")) return next();
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = await sessionFromToken(token);
    if (session) {
      c.set("session", session);
      c.set("agentAuth", null);
      c.set("tokenScopes", null);
      await next();
      return;
    }
  }
  const bearer = c.req.header("authorization");
  const bearerToken = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  if (bearerToken?.startsWith("dok_agt_")) {
    const agent = await agentFromKey(bearerToken);
    if (agent) {
      const denied = scopeGuard(c, agent.scopes);
      if (denied) return denied;
      c.set("session", null);
      c.set("agentAuth", agent);
      c.set("tokenScopes", agent.scopes);
      await next();
      return;
    }
  }
  if (bearerToken?.startsWith("dok_pat_")) {
    const pat = await userFromToken(bearerToken);
    if (pat) {
      const denied = scopeGuard(c, pat.scopes);
      if (denied) return denied;
      c.set("tokenScopes", pat.scopes);
      c.set("session", {
        sessionId: `pat:${pat.keyId}`,
        userId: pat.userId,
        workspaceId: pat.workspaceId,
        workspaceSlug: pat.workspaceSlug,
        name: pat.userName,
      });
      c.set("agentAuth", null);
      await next();
      return;
    }
  }
  if (bearerToken && !bearerToken.startsWith("dok_")) {
    const claims = await verifyAccessToken(bearerToken);
    if (claims) {
      const denied = scopeGuard(c, claims.scopes);
      if (denied) return denied;
      c.set("tokenScopes", claims.scopes);
      c.set("session", {
        sessionId: `jwt:${claims.sub}`,
        userId: claims.sub,
        workspaceId: claims.ws,
        workspaceSlug: "",
        name: "",
      });
      c.set("agentAuth", null);
      await next();
      return;
    }
  }
  // x-actor-* headers alone are NOT credentials — they only shape attribution
  // on an otherwise-authenticated request.
  return apiError(
    c,
    401,
    "UNAUTHENTICATED",
    "sign in or present agent credentials",
  );
}
