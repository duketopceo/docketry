import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { githubInstallations, githubRepos, issues, workspaces } from "../db/schema.js";
import { api, bootstrap, deliverWebhook, mockGithub, resetGithubSync } from "../../test/github.js";
import { settleBackground } from "../services/background.js";
import { useFrozenClock } from "../../test/clock.js";

useFrozenClock();

const A = "ten-a";
const B = "ten-b";
const REPO = { id: 7001, full_name: "shared/repo" };
let cookie = "";
const ws: Record<string, string> = {};

const issuesIn = async (slug: string) =>
  db.select().from(issues).where(eq(issues.workspaceId, ws[slug]!));

const opened = (installationId: number | undefined, n: number, title: string) => ({
  action: "opened",
  ...(installationId ? { installation: { id: installationId } } : {}),
  repository: REPO,
  issue: {
    id: 9000 + n,
    number: n,
    title,
    body: "b",
    html_url: `https://github.com/shared/repo/issues/${n}`,
    user: { login: "reporter" },
  },
});

beforeAll(async () => {
  cookie = await bootstrap(A);
  const mk = await api(cookie, "/v1/workspaces", {
    method: "POST",
    body: JSON.stringify({ slug: B, name: "Second" }),
  });
  expect(mk.status).toBe(201);
  // second workspace needs a team for intake
  for (const slug of [A, B]) {
    const [w] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
    ws[slug] = w!.id;
  }
  const team = await api(cookie, `/v1/workspaces/${B}/teams`, {
    method: "POST",
    body: JSON.stringify({ key: "BB", name: "B team" }),
  });
  expect([200, 201]).toContain(team.status);

  mockGithub({ installations: { 601: "org-a", 602: "org-b" } });
  expect((await api(cookie, `/v1/workspaces/${A}/github/setup?installation_id=601`)).status).toBe(200);
  expect((await api(cookie, `/v1/workspaces/${B}/github/setup?installation_id=602`)).status).toBe(200);
  // both workspaces connect the SAME repo name, each via its own installation
  for (const [slug, inst] of [[A, 601], [B, 602]] as const) {
    await db.insert(githubRepos).values({
      workspaceId: ws[slug]!,
      installationId: inst,
      repoId: REPO.id,
      fullName: REPO.full_name,
      enabled: true,
    }).onConflictDoNothing();
  }
});
afterAll(() => resetGithubSync());

describe("github repo lookup is scoped per workspace/installation (PLAN-007)", () => {
  it("each workspace receives its own sync for the same repo", async () => {
    expect(await deliverWebhook("issues", opened(601, 1, "for A"))).toBe(200);
    expect(await deliverWebhook("issues", opened(602, 2, "for B"))).toBe(200);
    await settleBackground();
    const a = await issuesIn(A);
    const b = await issuesIn(B);
    expect(a.map((i) => i.title)).toEqual(["for A"]);
    expect(b.map((i) => i.title)).toEqual(["for B"]);
  });

  it("a delivery for an unbound installation is dropped and logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = [(await issuesIn(A)).length, (await issuesIn(B)).length];
    expect(await deliverWebhook("issues", opened(31337, 3, "stranger"))).toBe(200);
    expect([(await issuesIn(A)).length, (await issuesIn(B)).length]).toEqual(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("installation 31337 is not bound"));
    warn.mockRestore();
  });

  it("a disabled repo in the owning workspace is not synced, and never falls through to another tenant", async () => {
    await db
      .update(githubRepos)
      .set({ enabled: false })
      .where(and(eq(githubRepos.workspaceId, ws[A]!), eq(githubRepos.fullName, REPO.full_name)));
    const before = [(await issuesIn(A)).length, (await issuesIn(B)).length];
    expect(await deliverWebhook("issues", opened(601, 4, "A disabled"))).toBe(200);
    expect([(await issuesIn(A)).length, (await issuesIn(B)).length]).toEqual(before);
    await db
      .update(githubRepos)
      .set({ enabled: true })
      .where(and(eq(githubRepos.workspaceId, ws[A]!), eq(githubRepos.fullName, REPO.full_name)));
  });

  it("without an installation on the payload, an ambiguous repo name is dropped, not guessed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = [(await issuesIn(A)).length, (await issuesIn(B)).length];
    expect(await deliverWebhook("issues", opened(undefined, 5, "ambiguous"))).toBe(200);
    expect([(await issuesIn(A)).length, (await issuesIn(B)).length]).toEqual(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no installation"));
    warn.mockRestore();
  });

  it("without an installation, a repo enabled in exactly one workspace still routes there", async () => {
    await db
      .update(githubRepos)
      .set({ enabled: false })
      .where(and(eq(githubRepos.workspaceId, ws[B]!), eq(githubRepos.fullName, REPO.full_name)));
    expect(await deliverWebhook("issues", opened(undefined, 6, "legacy"))).toBe(200);
    const a = await issuesIn(A);
    expect(a.map((i) => i.title)).toContain("legacy");
    expect((await issuesIn(B)).map((i) => i.title)).not.toContain("legacy");
  });

  it("installations stay bound one-to-one", async () => {
    const rows = await db.select().from(githubInstallations);
    expect(rows.map((r) => [r.installationId, r.workspaceId]).sort()).toEqual(
      [[601, ws[A]], [602, ws[B]]].sort(),
    );
  });
});
