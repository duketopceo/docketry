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
  dispatchEvents,
  dispatches,
  events,
  githubInstallations,
  githubIssueLinks,
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
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "../db/schema.js";
import { createAssist } from "./assist.js";
import { requireLLM } from "./llm.js";

const SLUG = `ast-${Date.now()}`;
let cookie = "";
let issueKey = "";

const ALL_TABLES = [
  comments,
  events,
  githubIssueLinks,
  webhookDeliveries,
  webhookEndpoints,
  dispatchEvents,
  dispatches,
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
] as const;

async function req<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie,
  };
  const res = await app.fetch(new Request(`http://t${path}`, { ...init, headers }));
  const sc = res.headers.get("set-cookie");
  if (sc?.startsWith("dok_session=")) cookie = sc.split(";")[0]!;
  return { status: res.status, body: (await res.json()) as T };
}

let wsId = "";
const enabledAssist = () =>
  createAssist({ complete: async () => "stubbed" });

beforeAll(async () => {
  await runMigrations();
  for (const t of ALL_TABLES) await db.delete(t);
  await db.delete(workspaces);

  await req("/v1/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      workspaceSlug: SLUG,
      workspaceName: "Assist",
      teamKey: "AS",
      email: "a@t.dev",
      name: "A",
      password: "pw-long-enough",
    }),
  });
  const [ws] = await db.select().from(workspaces);
  wsId = ws!.id;

  const created = await req<{ key: string }>(`/v1/workspaces/${SLUG}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: "Login drops session on Safari",
      description: "Users report being signed out after tab close",
    }),
  });
  issueKey = created.body.key;
  await req(`/v1/workspaces/${SLUG}/issues/${issueKey}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "reproduced on Safari 18" }),
  });
});

afterAll(async () => {
  for (const t of ALL_TABLES) await db.delete(t);
  await db.delete(workspaces);
  await closeDb();
});

describe("llm assist service", () => {
  it("summarizeIssue sends issue+comments to the provider", async () => {
    let seenUser = "";
    const assist = createAssist({
      complete: async (opts) => {
        seenUser = opts.user;
        return "Session cookie is session-scoped on Safari.";
      },
    });
    const summary = await assist.summarizeIssue(wsId, issueKey);
    expect(summary).toContain("Session cookie");
    expect(seenUser).toContain(issueKey);
    expect(seenUser).toContain("reproduced on Safari 18");
  });

  it("suggestTriage parses the JSON verdict", async () => {
    const assist = createAssist({
      complete: async () =>
        '{"action":"accept","reason":"actionable bug report"}',
    });
    const s = await assist.suggestTriage(wsId, issueKey);
    expect(s.action).toBe("accept");
    expect(s.reason).toContain("actionable");
  });

  it("suggestTriage rejects unparseable responses", async () => {
    const assist = createAssist({ complete: async () => "no idea" });
    await expect(assist.suggestTriage(wsId, issueKey)).rejects.toMatchObject({
      code: "LLM_BAD_RESPONSE",
    });
  });

  it("checkDuplicates maps returned keys back to real issues", async () => {
    await req(`/v1/workspaces/${SLUG}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: "Safari signs users out randomly" }),
    });
    const assist = createAssist({
      complete: async () =>
        `{"duplicates":[{"key":"${issueKey}","reason":"same Safari logout bug"}]}`,
    });
    const dups = await assist.checkDuplicates(wsId, "Logout broken in Safari");
    expect(dups.length).toBe(1);
    expect(dups[0]!.key).toBe(issueKey);
    expect(dups[0]!.title).toContain("Login drops session");
  });

  it("kill switch: requireLLM throws when no key is configured", () => {
    // test env has no DOCKETRY_LLM_API_KEY
    expect(() => requireLLM()).toThrowError(
      expect.objectContaining({ status: 503, code: "LLM_DISABLED" }),
    );
  });
});

describe("llm routes", () => {
  it("status reports disabled without config", async () => {
    const res = await req<{ enabled: boolean; model: string | null }>(
      `/v1/workspaces/${SLUG}/llm/status`,
    );
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.model).toBeNull();
  });

  it("summarize endpoint returns 503 when disabled", async () => {
    const res = await req(`/v1/workspaces/${SLUG}/issues/${issueKey}/summarize`, {
      method: "POST",
    });
    expect(res.status).toBe(503);
  });

  it("dupCheck on create returns the issue normally when disabled", async () => {
    const res = await req<{ key: string; possibleDuplicates?: unknown }>(
      `/v1/workspaces/${SLUG}/issues?dupCheck=1`,
      {
        method: "POST",
        body: JSON.stringify({ title: "Unrelated feature request" }),
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.possibleDuplicates).toBeUndefined();
  });
});
