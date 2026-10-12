import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../index.js";
import { createUserToken } from "../services/tokens.js";
import { mkEndpoint, mkIssue, newSession, seedTenant, type Tenant } from "../../test/tenants.js";
import { db } from "../db/client.js";
import { githubInstallations } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Regression tests for the three gaps the permission matrix (PR #100) flagged:
// agent self-approval (PLAN-056), unrestricted webhook endpoint management, and
// the state-changing GET /github/setup. The matrix replays the same policy per
// credential; these cover paths the matrix builders do not (PATCH state bypass,
// member PATs, secret exposure, GET no longer binding).

let T: Tenant;
let memberCookie: string;
let adminCookie: string;
let memberPat: string;
let adminPat: string;
let agentWrite: string;

const call = (auth: { cookie?: string; bearer?: string }, method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://authz.test${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(auth.cookie ? { cookie: `dok_session=${auth.cookie}` } : {}),
        ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
const code = async (r: Response) => ((await r.json()) as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network disabled");
  });
  T = await seedTenant("authz", "AZA");
  memberCookie = await newSession(T, "member");
  adminCookie = await newSession(T, "admin");
  memberPat = (await createUserToken(T.people.member.id, T.ws.id, "member pat", ["read", "write"])).token;
  adminPat = (await createUserToken(T.people.admin.id, T.ws.id, "admin pat", ["read", "write"])).token;
  agentWrite = T.agentKeys.write;
});
afterAll(() => vi.unstubAllGlobals());

const ws = () => `/v1/workspaces/${T.ws.slug}`;

describe("PLAN-056: agents cannot approve or send back review items", () => {
  it("POST review approve and send_back are 403 FORBIDDEN_AGENT for an agent write key; issue stays in_review", async () => {
    const i = await mkIssue(T, { state: "in_review" });
    for (const body of [{ action: "approve" }, { action: "send_back", feedback: "nope" }]) {
      const r = await call({ bearer: agentWrite }, "POST", `${ws()}/issues/${i.key}/review`, body);
      expect(r.status).toBe(403);
      expect(await code(r)).toBe("FORBIDDEN_AGENT");
    }
    const after = await call({ cookie: adminCookie }, "GET", `${ws()}/issues/${i.key}`);
    expect(((await after.json()) as { state: string }).state).toBe("in_review");
  });

  it("PATCH state in_review -> done / in_progress is blocked for agents (no side door)", async () => {
    for (const state of ["done", "in_progress"]) {
      const i = await mkIssue(T, { state: "in_review" });
      const r = await call({ bearer: agentWrite }, "PATCH", `${ws()}/issues/${i.key}`, { state });
      expect(r.status, state).toBe(403);
      expect(await code(r)).toBe("FORBIDDEN_AGENT");
    }
  });

  it("agents can still submit work for review (in_progress -> in_review)", async () => {
    const i = await mkIssue(T, { state: "in_progress" });
    const r = await call({ bearer: agentWrite }, "PATCH", `${ws()}/issues/${i.key}`, { state: "in_review" });
    expect(r.status).toBe(200);
  });

  it("human members (session and PAT) can approve", async () => {
    const a = await mkIssue(T, { state: "in_review" });
    expect((await call({ cookie: memberCookie }, "POST", `${ws()}/issues/${a.key}/review`, { action: "approve" })).status).toBe(200);
    const b = await mkIssue(T, { state: "in_review" });
    expect((await call({ bearer: memberPat }, "POST", `${ws()}/issues/${b.key}/review`, { action: "approve" })).status).toBe(200);
  });
});

describe("webhook endpoints are owner/admin only", () => {
  const body = { url: "https://example.com/hook" };

  it("members and agent keys get 403 on create, update, delete, list, deliveries", async () => {
    const e = await mkEndpoint(T);
    for (const who of [{ cookie: memberCookie }, { bearer: memberPat }, { bearer: agentWrite }]) {
      const reqs: [string, string, unknown?][] = [
        ["POST", `${ws()}/webhook-endpoints`, body],
        ["PATCH", `${ws()}/webhook-endpoints/${e.id}`, { enabled: false }],
        ["DELETE", `${ws()}/webhook-endpoints/${e.id}`],
        ["GET", `${ws()}/webhook-endpoints`],
        ["GET", `${ws()}/webhook-endpoints/${e.id}/deliveries`],
      ];
      for (const [m, p, b] of reqs) {
        const r = await call(who, m, p, b);
        expect(r.status, `${m} ${p}`).toBe(403);
      }
    }
  });

  it("admin session and admin PAT can manage; the secret is shown once and never listed", async () => {
    const created = await call({ cookie: adminCookie }, "POST", `${ws()}/webhook-endpoints`, body);
    expect(created.status).toBe(201);
    const c = (await created.json()) as { id: string; secret: string };
    expect(c.secret.length).toBeGreaterThanOrEqual(16);
    for (const auth of [{ cookie: adminCookie }, { bearer: adminPat }]) {
      const list = await call(auth, "GET", `${ws()}/webhook-endpoints`);
      expect(list.status).toBe(200);
      const text = await list.text();
      expect(text).not.toContain(c.secret);
      expect(text).toContain("secretLast4");
    }
    expect((await call({ bearer: adminPat }, "PATCH", `${ws()}/webhook-endpoints/${c.id}`, { enabled: false })).status).toBe(200);
    expect((await call({ cookie: adminCookie }, "DELETE", `${ws()}/webhook-endpoints/${c.id}`)).status).toBe(200);
  });
});

describe("GitHub setup is POST-only and owner/admin only", () => {
  it("GET no longer binds anything", async () => {
    const r = await call({ cookie: adminCookie }, "GET", `${ws()}/github/setup?installation_id=4242`);
    expect([404, 405]).toContain(r.status);
    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, 4242));
    expect(rows).toHaveLength(0);
  });

  it("members, member PATs and agent keys are 403 on POST", async () => {
    for (const who of [{ cookie: memberCookie }, { bearer: memberPat }, { bearer: agentWrite }]) {
      const r = await call(who, "POST", `${ws()}/github/setup`, { installationId: 4242 });
      expect(r.status).toBe(403);
    }
  });

  it("admin gets past authorization (503 here: no GitHub App configured in this suite)", async () => {
    const r = await call({ cookie: adminCookie }, "POST", `${ws()}/github/setup`, { installationId: 4242 });
    expect(r.status).toBe(503);
  });

  it("rejects a malformed body with 400", async () => {
    const r = await call({ cookie: adminCookie }, "POST", `${ws()}/github/setup`, { installationId: "abc" });
    expect(r.status).toBe(400);
  });
});
