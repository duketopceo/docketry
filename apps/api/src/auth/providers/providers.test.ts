import { config_ } from "../../env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../index.js";
import { closeDb, db } from "../../db/client.js";
import { runMigrations } from "../../db/migrate.js";
import {
  authIdentities,
  events,
  oauthCodes,
  sessions,
  users,
  workspaceMembers,
  workspaces,
  teams,
} from "../../db/schema.js";
import { decryptSecret, encryptSecret } from "../secrets.js";
import { safeReturnTo } from "../oauth-state.js";
import { __setProvidersForTests } from "./registry.js";
import type { OAuthProvider } from "./types.js";

const WIPE = [
  events, sessions, oauthCodes, authIdentities, workspaceMembers, teams, users, workspaces,
] as const;

// stub provider — deterministic identity, real route round-trip
const stubIdentity = {
  subject: "stub-1",
  email: "neo@corp.io",
  emailVerified: true,
  name: "Neo",
  avatarUrl: null,
  hd: "corp.io",
};
const stub: OAuthProvider = {
  key: "stub",
  type: "github",
  label: "Stub",
  public: { clientId: "x", scopes: [], issuer: null, source: "env" },
  authorizeUrl: ({ state }) => `https://stub.example/authorize?state=${state}`,
  exchange: async () => stubIdentity,
};

beforeAll(async () => {
  (config_ as { authAutoJoinSingleWorkspace: boolean }).authAutoJoinSingleWorkspace = true; // default off
  await runMigrations();
  for (const t of WIPE) await db.delete(t);
  // one workspace exists so the JIT sole-workspace auto-join rung can land
  const [ws] = await db.insert(workspaces).values({ slug: "ws1", name: "WS1" }).returning();
  await db.insert(teams).values({ workspaceId: ws!.id, key: "W1", name: "T" });
  __setProvidersForTests([stub]);
});

afterAll(async () => {
  __setProvidersForTests(null);
  for (const t of WIPE) await db.delete(t);
  await closeDb();
});

async function req(path: string, init?: RequestInit & { cookie?: string }) {
  const { cookie, ...rest } = init ?? {};
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...((rest.headers as Record<string, string>) ?? {}),
      },
    }),
  );
  return res;
}

describe("secrets", () => {
  it("AES-256-GCM round-trips and rejects a wrong key", () => {
    const blob = encryptSecret("super-secret", "k1");
    expect(decryptSecret(blob, "k1")).toBe("super-secret");
    expect(() => decryptSecret(blob, "k2")).toThrow();
  });
});

describe("state helpers", () => {
  it("return_to validation keeps only same-origin-relative paths", () => {
    expect(safeReturnTo("/board")).toBe("/board");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});

describe("methods + oauth round trip", () => {
  it("GET /v1/auth/methods lists providers without secrets", async () => {
    const res = await req("/v1/auth/methods");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { password: boolean; providers: { key: string }[] };
    expect(body.password).toBe(true);
    expect(body.providers).toContainEqual({ key: "stub", type: "github", label: "Stub" });
  });

  it("start 302s to the authorize URL and sets hardened cookies", async () => {
    const res = await req("/v1/auth/oauth/stub/start?return_to=https://evil.example&invite=tly_inv_abc&login_nonce=nnn", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("https://stub.example/authorize?state=");
    const cookies = res.headers.getSetCookie().join("; ");
    expect(cookies).toContain("tly_oauth_state=");
    expect(cookies).toContain("tly_oauth_nonce=");
    expect(cookies).toContain("tly_oauth_verifier=");
    expect(cookies).toContain("HttpOnly");
    // invite token never reaches the authorize URL
    expect(res.headers.get("location")).not.toContain("tly_inv");
  });

  it("full round trip: start → callback → code → exchange → session", async () => {
    const start = await req("/v1/auth/oauth/stub/start?return_to=/board&login_nonce=n1", { redirect: "manual" });
    const stateUrl = new URL(start.headers.get("location")!);
    const state = stateUrl.searchParams.get("state")!;
    const cookie = start.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");

    const cb = await req(`/v1/auth/oauth/stub/callback?code=idc&state=${state}`, { cookie, redirect: "manual" });
    expect(cb.status).toBe(302);
    const loc = new URL(cb.headers.get("location")!);
    expect(loc.pathname).toBe("/api/auth/callback");
    const code = loc.searchParams.get("code")!;
    expect(code).toBeTruthy();

    // exchange with wrong nonce → 403 (login-CSRF binding)
    const bad = await req("/v1/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ code, login_nonce: "wrong" }),
    });
    expect(bad.status).toBe(403);

    const ex = await req("/v1/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ code, login_nonce: "n1" }),
    });
    expect(ex.status).toBe(200);
    const body = (await ex.json()) as { purpose: string; workspaceSlug: string };
    expect(body.purpose).toBe("login");
    expect(ex.headers.get("set-cookie")).toContain("tly_session=");
    // the sole-workspace auto-join rung created ws+user+member
    const [u] = await db.select().from(users).where(eq(users.email, "neo@corp.io"));
    expect(u).toBeTruthy();

    // replay → 410
    const replay = await req("/v1/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ code, login_nonce: "n1" }),
    });
    expect(replay.status).toBe(410);
  });

  it("tampered state 302s to the web error path, never JSON", async () => {
    const cb = await req("/v1/auth/oauth/stub/callback?code=x&state=forged", { redirect: "manual" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("/login?error=");
    const denied = await req("/v1/auth/oauth/stub/callback?error=access_denied&state=x", { redirect: "manual" });
    expect(denied.headers.get("location")).toContain("error=denied");
  });
});
