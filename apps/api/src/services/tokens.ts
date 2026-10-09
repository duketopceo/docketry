import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { sign, verify } from "hono/jwt";
import { config_ } from "../env.js";
import { db } from "../db/client.js";
import { userTokens, users, workspaces } from "../db/schema.js";

export const ACCESS_TOKEN_TTL_S = 15 * 60;
const ALG = "HS256";
const ISS = "docketry";

export interface JwtClaims {
  sub: string;
  ws: string;
  typ: "user";
  scopes: string[];
}

export async function signAccessToken(claims: {
  sub: string;
  ws: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: claims.sub,
      ws: claims.ws,
      typ: "user",
      scopes: ["read", "write"],
      iss: ISS,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_S,
    },
    config_.jwtSecret,
    ALG,
  );
}

export async function verifyAccessToken(
  token: string,
): Promise<JwtClaims | null> {
  try {
    const payload = await verify(token, config_.jwtSecret, ALG);
    if (
      payload.iss !== ISS ||
      payload.typ !== "user" ||
      typeof payload.sub !== "string" ||
      typeof payload.ws !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      ws: payload.ws,
      typ: "user",
      scopes: Array.isArray(payload.scopes)
        ? (payload.scopes as string[])
        : ["read", "write"],
    };
  } catch {
    return null;
  }
}

export interface PatAuth {
  userId: string;
  userName: string;
  workspaceId: string;
  workspaceSlug: string;
  keyId: string;
  scopes: string[];
}

export async function createUserToken(
  userId: string,
  workspaceId: string,
  name: string,
  scopes: string[],
  expiresAt?: Date,
): Promise<{ token: string; id: string }> {
  const token = `dok_pat_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(userTokens)
    .values({
      userId,
      workspaceId,
      name,
      tokenHash: hashToken(token),
      scopes,
      ...(expiresAt ? { expiresAt } : {}),
    })
    .returning();
  return { token, id: row!.id };
}

export async function userFromToken(token: string): Promise<PatAuth | null> {
  const [row] = await db
    .select({
      keyId: userTokens.id,
      userId: userTokens.userId,
      userName: users.name,
      workspaceId: userTokens.workspaceId,
      workspaceSlug: workspaces.slug,
      scopes: userTokens.scopes,
    })
    .from(userTokens)
    .innerJoin(users, eq(users.id, userTokens.userId))
    .innerJoin(workspaces, eq(workspaces.id, userTokens.workspaceId))
    .where(
      and(
        eq(userTokens.tokenHash, hashToken(token)),
        or(
          isNull(userTokens.expiresAt),
          gt(userTokens.expiresAt, new Date()),
        ),
      ),
    );
  if (!row) return null;
  void db
    .update(userTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(userTokens.id, row.keyId))
    .catch(() => undefined);
  return row;
}

export async function revokeUserToken(
  id: string,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const rows = await db
    .delete(userTokens)
    .where(
      and(
        eq(userTokens.id, id),
        eq(userTokens.userId, userId),
        eq(userTokens.workspaceId, workspaceId),
      ),
    )
    .returning({ id: userTokens.id });
  return rows.length > 0;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
