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
  cycles,
  events,
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
