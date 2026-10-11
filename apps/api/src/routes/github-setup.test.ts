import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { githubInstallations, githubRepos, githubWebhookEvents } from "../db/schema.js";
import { api, bootstrap, deliverWebhook, mockGithub, resetGithubSync } from "../../test/github.js";
import { useFrozenClock } from "../../test/clock.js";

useFrozenClock();

const A = "setup-a";
const B = "setup-b";
let cookie = "";
let calls: ReturnType<typeof mockGithub>["calls"];

beforeAll(async () => {
  cookie = await bootstrap(A);
  const mk = await api(cookie, "/v1/workspaces", {
    method: "POST",
    body: JSON.stringify({ slug: B, name: "Second" }),
  });
  expect(mk.status).toBe(201);
  ({ calls } = mockGithub({ installations: { 501: "acme", 502: "globex" } }));
});
afterAll(() => resetGithubSync());

const setup = (ws: string, id: number | string) =>
  api(cookie, `/v1/workspaces/${ws}/github/setup?installation_id=${id}&account_login=attacker`);

describe("installation binding (PLAN-006)", () => {
  it("binds an installation the App owns, using GitHub's account login", async () => {
    // an unbound installation.created delivery arrives first
    expect(
      await deliverWebhook("installation", {
        action: "created",
        installation: { id: 501, account: { login: "acme" } },
        repositories: [{ id: 11, name: "web", full_name: "acme/web" }],
      }),
    ).toBe(200);

    const res = await setup(A, 501);
    expect(res.status).toBe(200);
    expect(res.body.installationId).toBe(501);

    const [row] = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, 501));
    expect(row!.accountLogin).toBe("acme"); // from GitHub, not ?account_login
    // verified with an App JWT, not an installation token
    const lookup = calls.find((c) => c.url.endsWith("/app/installations/501"));
    expect(lookup?.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    // backfilled the repo from the stored delivery
    const repos = await db.select().from(githubRepos).where(eq(githubRepos.fullName, "acme/web"));
    expect(repos).toHaveLength(1);
  });

  it("re-binding to the same workspace is idempotent", async () => {
    const res = await setup(A, 501);
    expect(res.status).toBe(200);
    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, 501));
    expect(rows).toHaveLength(1);
  });

  it("NEGATIVE: an installation id the App does not have returns 404 and binds nothing", async () => {
    const res = await setup(A, 999999);
    expect(res.status).toBe(404);
    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, 999999));
    expect(rows).toHaveLength(0);
  });

  it("NEGATIVE: another workspace cannot claim an installation already bound (409)", async () => {
    const res = await setup(B, 501);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSTALLATION_BOUND");
    const [row] = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, 501));
    expect(row!.workspaceId).not.toBe(undefined);
    const wsA = await api(cookie, `/v1/workspaces/${A}`);
    expect(row!.workspaceId).toBe(wsA.body.id);
  });

  it("NEGATIVE: malformed installation_id is 400", async () => {
    expect((await setup(A, "abc")).status).toBe(400);
    expect((await setup(A, 0)).status).toBe(400);
  });

  it("NEGATIVE: refuses to bind when the App credentials are not configured (503)", async () => {
    resetGithubSync();
    const res = await setup(A, 502);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GITHUB_APP_NOT_CONFIGURED");
    mockGithub({ installations: { 501: "acme", 502: "globex" } });
  });

  it("GitHub lookup failure (5xx) is 502 and binds nothing", async () => {
    const { setGithubApiFetcher } = await import("../services/github-sync.js");
    setGithubApiFetcher(async () => new Response("boom", { status: 500 }));
    const res = await setup(B, 502);
    expect(res.status).toBe(502);
    mockGithub({ installations: { 501: "acme", 502: "globex" } });
    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, 502));
    expect(rows).toHaveLength(0);
  });

  it("workspace B can bind a different, App-owned installation", async () => {
    const res = await setup(B, 502);
    expect(res.status).toBe(200);
  });

  it("keeps unrelated deliveries untouched", async () => {
    const pending = await db.select().from(githubWebhookEvents);
    expect(pending.length).toBeGreaterThan(0);
  });
});
