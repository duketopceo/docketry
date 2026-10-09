import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { closeDb, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  agentKeys,
  agents,
  comments,
  cycleVelocity,
  cycles,
  events,
  githubIssueLinks,
  githubInstallations,
  githubRepos,
  githubWebhookEvents,
  issues,
  labels,
  projects,
  sessions,
  teams,
  users,
  userTokens,
  views,
  workspaces,
} from "../db/schema.js";

const SECRET = "test-webhook-secret";
const SLUG = `gh-test-${Date.now()}`;
let sessionCookie = "";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`;
}

function webhook(
  body: string,
  opts: { signature?: string; event?: string; delivery?: string } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature) headers["x-hub-signature-256"] = opts.signature;
  if (opts.event) headers["x-github-event"] = opts.event;
  if (opts.delivery) headers["x-github-delivery"] = opts.delivery;
  return app.fetch(
    new Request("http://api.test/webhooks/github", {
      method: "POST",
      headers,
      body,
    }),
  );
}

async function req(path: string, init?: RequestInit) {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
        ...(init?.headers as Record<string, string>),
      },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const installationPayload = (id: number, action = "created") =>
  JSON.stringify({
    action,
    installation: { id, account: { login: "duketopceo" } },
    repositories: [
      { id: 1001, name: "docketry", full_name: "duketopceo/docketry" },
      { id: 1002, name: "dotfiles", full_name: "duketopceo/dotfiles" },
    ],
  });

beforeAll(async () => {
  await runMigrations();
  // clean slate — single-workspace bootstrap semantics (FK-safe order)
  for (const t of [
    comments,
    events,
    issues,
    labels,
    agentKeys,
    agents,
    userTokens,
    views,
    cycleVelocity,
    cycles,
    projects,
    sessions,
    githubWebhookEvents,
    githubRepos,
    githubInstallations,
    users,
    teams,
  ] as const) {
    await db.delete(t);
  }
  await db.delete(workspaces);

  const res = await app.fetch(
    new Request("http://api.test/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: SLUG,
        workspaceName: "GH Test",
        teamKey: "GH",
        email: "gh@test.dev",
        name: "GH User",
        password: "pw-long-enough",
      }),
    }),
  );
  expect(res.status).toBe(201);
  sessionCookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

afterAll(async () => {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, SLUG));
  if (ws) {
    for (const t of [
      githubIssueLinks,
      events,
      issues,
      githubRepos,
      githubInstallations,
      sessions,
      users,
      teams,
    ] as const) {
      await db.delete(t).where(eq(t.workspaceId, ws.id));
    }
    await db.delete(workspaces).where(eq(workspaces.id, ws.id));
  }
  await closeDb();
});

describe("github webhook receiver", () => {
  it("rejects unsigned payloads", async () => {
    const res = await webhook("{}", { event: "ping", delivery: "d-1" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong signature", async () => {
    const res = await webhook("{}", {
      signature: "sha256=deadbeef",
      event: "ping",
      delivery: "d-2",
    });
    expect(res.status).toBe(401);
  });

  it("drops malformed payloads", async () => {
    const res = await webhook("not-json{{{", {
      signature: sign("not-json{{{"),
      event: "ping",
      delivery: "d-3",
    });
    expect(res.status).toBe(400);
  });

  it("requires delivery headers", async () => {
    const res = await webhook("{}", { signature: sign("{}") });
    expect(res.status).toBe(400);
  });

  it("accepts a signed delivery and logs it", async () => {
    const res = await webhook("{}", {
      signature: sign("{}"),
      event: "ping",
      delivery: "d-4",
    });
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(githubWebhookEvents)
      .where(eq(githubWebhookEvents.deliveryId, "d-4"));
    expect(rows).toHaveLength(1);
  });

  it("drops replayed deliveries", async () => {
    const body = "{}";
    const opts = { signature: sign(body), event: "ping", delivery: "d-5" };
    await webhook(body, opts);
    const replay = await webhook(body, opts);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { duplicate?: boolean }).duplicate).toBe(true);
  });
});

describe("installation binding + repo connect", () => {
  it("receives installation.created before binding", async () => {
    const body = installationPayload(777);
    const res = await webhook(body, {
      signature: sign(body),
      event: "installation",
      delivery: "d-install",
    });
    expect(res.status).toBe(200);
    // unbound installation registers nothing
    const repos = await db.select().from(githubRepos);
    expect(repos).toHaveLength(0);
  });

  it("setup callback binds installation to workspace and backfills repos", async () => {
    const { status, body } = await req(
      `/v1/workspaces/${SLUG}/github/setup?installation_id=777`,
    );
    expect(status).toBe(200);
    expect(body.installationId).toBe(777);

    const repos = await db
      .select()
      .from(githubRepos)
      .where(eq(githubRepos.fullName, "duketopceo/docketry"));
    expect(repos).toHaveLength(1);
    expect(repos[0]!.enabled).toBe(false);
  });

  it("connect/disconnect round-trips", async () => {
    const connect = await req(`/v1/workspaces/${SLUG}/github/repos/connect`, {
      method: "POST",
      body: JSON.stringify({ fullName: "duketopceo/docketry" }),
    });
    expect(connect.status).toBe(200);
    expect((connect.body as { enabled: boolean }).enabled).toBe(true);

    const list = await req(`/v1/workspaces/${SLUG}/github/repos`);
    expect((list.body as { repos: { fullName: string; enabled: boolean }[] }).repos)
      .toHaveLength(2);

    const disconnect = await req(
      `/v1/workspaces/${SLUG}/github/repos/disconnect`,
      { method: "POST", body: JSON.stringify({ fullName: "duketopceo/docketry" }) },
    );
    expect(disconnect.status).toBe(200);
    expect((disconnect.body as { enabled: boolean }).enabled).toBe(false);
  });

  it("connect works for repos not seen via installation (manual link)", async () => {
    const res = await req(`/v1/workspaces/${SLUG}/github/repos/connect`, {
      method: "POST",
      body: JSON.stringify({ fullName: "duketopceo/omarchy-plugins" }),
    });
    expect(res.status).toBe(200);
  });

  it("installation_repositories removals delete rows", async () => {
    const body = JSON.stringify({
      action: "removed",
      installation: { id: 777, account: { login: "duketopceo" } },
      repositories_removed: [
        { id: 1002, name: "dotfiles", full_name: "duketopceo/dotfiles" },
      ],
    });
    const res = await webhook(body, {
      signature: sign(body),
      event: "installation_repositories",
      delivery: "d-rem",
    });
    expect(res.status).toBe(200);
    const left = await db
      .select()
      .from(githubRepos)
      .where(eq(githubRepos.fullName, "duketopceo/dotfiles"));
    expect(left).toHaveLength(0);
  });

  it("serves manifest and install-url for onboarding", async () => {
    const manifest = await req(`/v1/workspaces/${SLUG}/github/manifest`);
    expect(manifest.status).toBe(200);
    const hook = (manifest.body as { hook_attributes: { url: string } }).hook_attributes;
    expect(hook.url).toContain("/webhooks/github");

    const install = await req(`/v1/workspaces/${SLUG}/github/install-url`);
    expect((install.body as { installUrl: string }).installUrl).toContain(
      "github.com/apps/docketry-test",
    );
  });

  it("rejects invalid fullName formats", async () => {
    const res = await req(`/v1/workspaces/${SLUG}/github/repos/connect`, {
      method: "POST",
      body: JSON.stringify({ fullName: "no-slash" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("branch/PR automation (#19)", () => {
  let deliveryCounter = 0;
  const REPO = { full_name: "duketopceo/docketry" };

  async function deliver(event: string, payload: object) {
    const body = JSON.stringify({ ...payload, repository: REPO });
    const res = await webhook(body, {
      signature: sign(body),
      event,
      delivery: `auto-${++deliveryCounter}`,
    });
    expect(res.status).toBe(200);
  }

  async function stateOf(key: string) {
    const { body } = await req(`/v1/workspaces/${SLUG}/issues/${key}`);
    return (body as { state: string }).state;
  }

  it("push to a matching branch moves issue to in_progress", async () => {
    // issue GH-1 sits in backlog — push walks backlog→todo→in_progress
    await req(`/v1/workspaces/${SLUG}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: "automation target", state: "backlog" }),
    });
    await req(`/v1/workspaces/${SLUG}/github/repos/connect`, {
      method: "POST",
      body: JSON.stringify({ fullName: "duketopceo/docketry" }),
    });

    await deliver("push", { ref: "refs/heads/GH-1-branch-fix" });
    expect(await stateOf("GH-1")).toBe("in_progress");
  });

  it("repeat push is a no-op (transition fires once)", async () => {
    await deliver("push", { ref: "refs/heads/GH-1-branch-fix" });
    expect(await stateOf("GH-1")).toBe("in_progress");
  });

  it("push to non-matching branch does nothing", async () => {
    await deliver("push", { ref: "refs/heads/random-feature" });
    expect(await stateOf("GH-1")).toBe("in_progress");
  });

  it("review_requested moves to in_review", async () => {
    await deliver("pull_request", {
      action: "review_requested",
      pull_request: {
        number: 42,
        head: { ref: "GH-1-branch-fix" },
        html_url: "https://github.com/duketopceo/docketry/pull/42",
      },
    });
    expect(await stateOf("GH-1")).toBe("in_review");
  });

  it("PR review verdict lands on the issue timeline", async () => {
    await deliver("pull_request_review", {
      action: "submitted",
      review: {
        state: "approved",
        html_url: "https://github.com/duketopceo/docketry/pull/42#r1",
        user: { login: "octocat" },
      },
      pull_request: { number: 42, head: { ref: "GH-1-branch-fix" } },
    });
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.action, "github_review"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const after = rows[0]!.after as { verdict: string; reviewer: string };
    expect(after.verdict).toBe("approved");
    expect(after.reviewer).toBe("octocat");
  });

  it("merged PR closes the issue as done with PR link", async () => {
    await deliver("pull_request", {
      action: "closed",
      pull_request: {
        number: 42,
        merged: true,
        head: { ref: "GH-1-branch-fix" },
        html_url: "https://github.com/duketopceo/docketry/pull/42",
      },
    });
    expect(await stateOf("GH-1")).toBe("done");
    const done = await db
      .select()
      .from(events)
      .where(eq(events.action, "state_changed"));
    const last = done[done.length - 1]!.after as {
      state: string;
      github?: { pr: number };
    };
    expect(last.state).toBe("done");
    expect(last.github?.pr).toBe(42);
  });

  it("disabled repos are ignored", async () => {
    await req(`/v1/workspaces/${SLUG}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: "untouched", state: "backlog" }),
    });
    await req(`/v1/workspaces/${SLUG}/github/repos/disconnect`, {
      method: "POST",
      body: JSON.stringify({ fullName: "duketopceo/docketry" }),
    });
    await deliver("push", { ref: "refs/heads/GH-2-nope" });
    expect(await stateOf("GH-2")).toBe("backlog");
  });
});

describe("github issue intake (#20)", () => {
  it("issues.opened creates a triage issue and link row", async () => {
    await req(`/v1/workspaces/${SLUG}/github/repos/connect`, {
      method: "POST",
      body: JSON.stringify({ fullName: "duketopceo/docketry", teamKey: "GH" }),
    });
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "duketopceo/docketry" },
      issue: {
        id: 9001,
        number: 55,
        title: "bug: board flickers",
        body: "steps to repro…",
        html_url: "https://github.com/duketopceo/docketry/issues/55",
        user: { login: "reporter" },
      },
    });
    const res = await webhook(body, {
      signature: sign(body),
      event: "issues",
      delivery: "intake-1",
    });
    expect(res.status).toBe(200);

    const [link] = await db
      .select()
      .from(githubIssueLinks)
      .where(eq(githubIssueLinks.ghIssueId, 9001));
    expect(link).toBeDefined();
    const [created] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, link!.issueId));
    expect(created!.state).toBe("triage");
    expect(created!.title).toBe("bug: board flickers");
    expect(created!.source).toBe("github");
    expect(created!.key).toMatch(/^GH-\d+$/);
  });

  it("a second delivery for the same GH issue does not re-intake", async () => {
    const before = await db.select().from(githubIssueLinks);
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "duketopceo/docketry" },
      issue: {
        id: 9001,
        number: 55,
        title: "bug: board flickers",
        body: "dup",
        html_url: "https://github.com/duketopceo/docketry/issues/55",
      },
    });
    await webhook(body, {
      signature: sign(body),
      event: "issues",
      delivery: "intake-2",
    });
    const after = await db.select().from(githubIssueLinks);
    expect(after).toHaveLength(before.length);
  });
});
