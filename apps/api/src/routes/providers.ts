import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type Context, type Next } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { assertPublicUrl } from "../auth/providers/types.js";
import { encryptSecret } from "../auth/secrets.js";
import { db } from "../db/client.js";
import { authProviders, events, workspaces } from "../db/schema.js";
import { config_ } from "../env.js";
import { apiError } from "../lib/errors.js";
import { SESSION_COOKIE, sessionFromToken } from "../services/auth.js";
import { isInstanceAdmin } from "../services/members.js";

// Provider administration is instance scope (KTD10), not workspace admin —
// cookie session + AUTH_ADMIN_EMAILS (or bootstrap-owner fallback).
async function requireInstanceAdmin(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await sessionFromToken(token) : null;
  if (!session) {
    return apiError(c, 401, "UNAUTHENTICATED", "provider admin requires a human session");
  }
  if (!(await isInstanceAdmin({ id: session.userId, email: session.email }))) {
    return apiError(c, 403, "FORBIDDEN_INSTANCE_ADMIN", "provider admin requires an instance admin");
  }
  c.set("instanceAdminUserId", session.userId);
  return next();
}

function envProviderRows() {
  const rows: { key: string; type: string; label: string; source: "env" }[] = [];
  if (config_.githubClientId) rows.push({ key: "github", type: "github", label: "GitHub", source: "env" });
  if (config_.googleClientId) rows.push({ key: "google", type: "google", label: "Google", source: "env" });
  if (config_.oidcIssuer && config_.oidcClientId)
    rows.push({ key: "oidc", type: "oidc", label: config_.oidcDisplayName || "SSO", source: "env" });
  return rows;
}
const envKeys = () => new Set(envProviderRows().map((r) => r.key));

const createSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  type: z.enum(["github", "google", "oidc"]),
  label: z.string().min(1).max(80),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  issuer: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  endpoints: z.record(z.string(), z.string()).optional(),
});

const patchSchema = createSchema.partial().omit({ key: true, type: true });

// every configured endpoint (issuer + manual overrides) must be https and
// public — SSRF surface for later discovery/test calls
async function checkEndpoints(urls: (string | undefined)[]) {
  for (const u of urls) {
    if (!u) continue;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:") throw new Error("http");
      await assertPublicUrl(u);
    } catch {
      throw Object.assign(new Error(`endpoint must be a public https URL: ${u}`), { status: 422 });
    }
  }
}

function mask(row: typeof authProviders.$inferSelect) {
  const { clientSecretEnc: _s, ...rest } = row;
  return { ...rest, hasSecret: !!row.clientSecretEnc, source: "db" as const };
}

async function emit(actorId: string, action: string, entityId: string) {
  // provider events are instance-scope; emit under the first workspace so
  // they land on an existing feed rather than inventing a null-ws row
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  if (!ws) return;
  await db.insert(events).values({
    workspaceId: ws.id, actorType: "human", actorId,
    action, entityType: "provider", entityId,
  });
}

export const providerRoutes = new Hono()
  .use("/providers/*", requireInstanceAdmin)
  .use("/providers", requireInstanceAdmin)
  .get("/providers", async (c) => {
    const env = envProviderRows();
    const rows = await db.select().from(authProviders);
    const envKeyList = env.map((r) => r.key);
    return c.json({
      providers: [
        ...env,
        ...rows.map((r) => ({
          ...mask(r),
          envShadowed: envKeyList.includes(r.key),
        })),
      ],
    });
  })
  .post("/providers", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    if (body.type === "oidc" && !body.issuer) {
      return apiError(c, 422, "ISSUER_REQUIRED", "oidc providers need an issuer");
    }
    if (envKeys().has(body.key)) {
      return apiError(c, 409, "ENV_SHADOWED", `key '${body.key}' is defined by environment`);
    }
    try {
      await checkEndpoints([body.issuer, ...Object.values(body.endpoints ?? {})]);
    } catch (e) {
      return apiError(c, 422, "BAD_ENDPOINT", e instanceof Error ? e.message : "bad endpoint");
    }
    const [row] = await db
      .insert(authProviders)
      .values({
        key: body.key,
        type: body.type,
        label: body.label,
        clientId: body.clientId,
        clientSecretEnc: encryptSecret(body.clientSecret, config_.authSecretKey),
        issuer: body.issuer ?? null,
        scopes: body.scopes,
        endpoints: body.endpoints ?? null,
      })
      .returning();
    await emit(c.get("instanceAdminUserId"), "provider_created", row!.id);
    return c.json(mask(row!), 201);
  })
  .patch("/providers/:id", zValidator("json", patchSchema), async (c) => {
    const [row] = await db.select().from(authProviders).where(eq(authProviders.id, c.req.param("id")));
    if (!row) return apiError(c, 404, "NOT_FOUND", "provider not found");
    if (envKeys().has(row.key)) {
      return apiError(c, 409, "ENV_SHADOWED", `key '${row.key}' is defined by environment`);
    }
    const body = c.req.valid("json");
    try {
      await checkEndpoints([body.issuer, ...Object.values(body.endpoints ?? {})]);
    } catch (e) {
      return apiError(c, 422, "BAD_ENDPOINT", e instanceof Error ? e.message : "bad endpoint");
    }
    const [updated] = await db
      .update(authProviders)
      .set({
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.clientSecret !== undefined
          ? { clientSecretEnc: encryptSecret(body.clientSecret, config_.authSecretKey) }
          : {}),
        ...(body.issuer !== undefined ? { issuer: body.issuer } : {}),
        ...(body.scopes !== undefined ? { scopes: body.scopes } : {}),
        ...(body.endpoints !== undefined ? { endpoints: body.endpoints } : {}),
      })
      .where(eq(authProviders.id, row.id))
      .returning();
    await emit(c.get("instanceAdminUserId"), "provider_updated", row.id);
    return c.json(mask(updated!));
  })
  .delete("/providers/:id", async (c) => {
    const [row] = await db.select().from(authProviders).where(eq(authProviders.id, c.req.param("id")));
    if (!row) return apiError(c, 404, "NOT_FOUND", "provider not found");
    if (envKeys().has(row.key)) {
      return apiError(c, 409, "ENV_SHADOWED", `key '${row.key}' is defined by environment`);
    }
    await db.delete(authProviders).where(eq(authProviders.id, row.id));
    await emit(c.get("instanceAdminUserId"), "provider_deleted", row.id);
    return c.json({ ok: true });
  })
  // connectivity probe — egress-constrained (https + public only), no
  // secret material in the error path
  .post("/providers/:id/test", async (c) => {
    const [row] = await db.select().from(authProviders).where(eq(authProviders.id, c.req.param("id")));
    if (!row) return apiError(c, 404, "NOT_FOUND", "provider not found");
    const target =
      row.type === "github"
        ? "https://github.com/login/oauth/authorize"
        : `${(row.issuer ?? "").replace(/\/$/, "")}/.well-known/openid-configuration`;
    try {
      await assertPublicUrl(target);
      const res = await fetch(target, {
        signal: AbortSignal.timeout(8_000),
        redirect: "error", // every redirect hop must be re-validated — refuse instead
      });
      const body = await res.text();
      if (body.length > 64_000) throw new Error("oversized response");
      return c.json({ ok: res.ok || res.status === 400, status: res.status });
    } catch (e) {
      return apiError(c, 422, "PROBE_FAILED", `endpoint unreachable or not permitted: ${e instanceof Error ? e.message : "error"}`);
    }
  });
