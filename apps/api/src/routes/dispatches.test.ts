import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { closeDb, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  agentKeys,
  agents,
  comments,
  cycles,
  dispatchEvents,
  dispatches,
  events,
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

const SLUG = `disp-test-${Date.now()}`;

interface TestBody {
  error?: { code: string; message: string };
  [key: string]: unknown;
}

let cookie = "";
let agentId = "";
let agentToken = "";
let otherAgentId = "";
let otherToken = "";
let patToken = "";

async function req(
  path: string,
  init?: RequestInit,
  token?: string,
): Promise<{ status: number; body: TestBody }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  else headers.cookie = cookie;
  const res = await app.fetch(new Request(`http://test${path}`, { ...init, headers }));
  const sc = res.headers.get("set-cookie");
  if (sc?.startsWith("dok_session=")) cookie = sc.split(";")[0]!;
  return { status: res.status, body: (await res.json()) as TestBody };
}

const ALL_TABLES = [
  comments,
  events,
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
  cycles,
  projects,
  sessions,
  users,
  teams,
] as const;

beforeAll(async () => {
  await runMigrations();
  for (const t of ALL_TABLES) await db.delete(t);
  await db.delete(workspaces);

  const boot = await req("/v1/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      workspaceSlug: SLUG,
      workspaceName: "Dispatch Test",
      teamKey: "ENG",
      email: "d@t.co",
      name: "D Tester",
      password: "test-password-123",
    }),
  });
  expect(boot.status).toBe(201);

  const mk = async (name: string) => {
    const a = await req(`/v1/workspaces/${SLUG}/agents`, {
      method: "POST",
      body: JSON.stringify({ name, harness: "claude-code" }),
    });
    const k = await req(`/v1/workspaces/${SLUG}/agents/${a.body.id}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: "rw", scopes: ["read", "write"] }),
    });
    return { id: a.body.id as string, token: k.body.key as string };
  };
  ({ id: agentId, token: agentToken } = await mk("worker-1"));
  ({ id: otherAgentId, token: otherToken } = await mk("worker-2"));

  const pat = await req(`/v1/workspaces/${SLUG}/tokens`, {
    method: "POST",
    body: JSON.stringify({ name: "human", scopes: ["read", "write"] }),
  });
  patToken = pat.body.token as string;
});

afterAll(async () => {
  for (const t of ALL_TABLES) await db.delete(t);
  await db.delete(workspaces);
  await closeDb();
});

async function assignIssue(title: string, toAgentId: string): Promise<string> {
  const created = await req(`/v1/workspaces/${SLUG}/issues`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  expect(created.status).toBe(201);
  const patched = await req(
    `/v1/workspaces/${SLUG}/issues/${created.body.key}`,
    {
      method: "PATCH",
      body: JSON.stringify({ assigneeType: "agent", assigneeId: toAgentId }),
    },
  );
  expect(patched.status).toBe(200);
  return created.body.key as string;
}

describe("dispatch routes", () => {
  it("agent key lists only its own dispatches; PAT sees all", async () => {
    await assignIssue("for worker-1", agentId);
    await assignIssue("for worker-2", otherAgentId);

    const mine = await req(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      undefined,
      agentToken,
    );
    expect(mine.status).toBe(200);
    const rows = mine.body.dispatches as {
      agentId: string;
      issueKey: string;
      issueTitle: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.agentId === agentId)).toBe(true);
    expect(rows.some((d) => d.issueTitle === "for worker-1")).toBe(true);

    const all = await req(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      undefined,
      patToken,
    );
    expect(all.status).toBe(200);
    const allRows = all.body.dispatches as { agentId: string }[];
    expect(allRows.some((d) => d.agentId === otherAgentId)).toBe(true);
  });

  it("report completes the dispatch, writes event + branch comment", async () => {
    const key = await assignIssue("report me", agentId);
    const mine = await req(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      undefined,
      agentToken,
    );
    const d = (mine.body.dispatches as { id: string; issueKey: string }[]).find(
      (x) => x.issueKey === key,
    )!;
    expect(d).toBeDefined();

    const reported = await req(
      `/v1/workspaces/${SLUG}/dispatches/${d.id}/report`,
      {
        method: "POST",
        body: JSON.stringify({ outcome: "completed", branch: `${key}-report-me` }),
      },
      agentToken,
    );
    expect(reported.status).toBe(200);
    expect(reported.body.status).toBe("completed");

    const commentsRes = await req(
      `/v1/workspaces/${SLUG}/issues/${key}/comments`,
      undefined,
      agentToken,
    );
    const bodies = (commentsRes.body.comments as { body: string }[]).map(
      (c) => c.body,
    );
    expect(bodies.some((b) => b.includes(`${key}-report-me`))).toBe(true);
  });

  it("an agent cannot report another agent's dispatch", async () => {
    await assignIssue("not yours", otherAgentId);
    const theirs = await req(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      undefined,
      otherToken,
    );
    const d = (theirs.body.dispatches as { id: string }[])[0]!;
    const stolen = await req(
      `/v1/workspaces/${SLUG}/dispatches/${d.id}/report`,
      { method: "POST", body: JSON.stringify({ outcome: "completed" }) },
      agentToken,
    );
    expect(stolen.status).toBe(403);

    const missing = await req(
      `/v1/workspaces/${SLUG}/dispatches/00000000-0000-0000-0000-000000000000/report`,
      { method: "POST", body: JSON.stringify({ outcome: "failed" }) },
      agentToken,
    );
    expect(missing.status).toBe(404);
  });

  it("session events append, persist, and surface on the issue timeline", async () => {
    const key = await assignIssue("session me", agentId);
    const mine = await req(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      undefined,
      agentToken,
    );
    const d = (mine.body.dispatches as { id: string; issueKey: string }[]).find(
      (x) => x.issueKey === key,
    )!;

    const appended = await req(
      `/v1/workspaces/${SLUG}/dispatches/${d.id}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          events: [
            { kind: "reading", message: "scanning schema.ts" },
            { kind: "implementing", message: "writing migration" },
          ],
        }),
      },
      agentToken,
    );
    expect(appended.status).toBe(201);
    expect((appended.body.events as unknown[]).length).toBe(2);

    // durable + ordered
    const log = await req(
      `/v1/workspaces/${SLUG}/dispatches/${d.id}/events`,
      undefined,
      agentToken,
    );
    const rows = log.body.events as { kind: string; message: string }[];
    expect(rows.map((r) => r.kind)).toEqual(["reading", "implementing"]);

    // issue-level timeline groups them under the dispatch
    const sessions = await req(
      `/v1/workspaces/${SLUG}/issues/${key}/sessions`,
      undefined,
      patToken,
    );
    expect(sessions.status).toBe(200);
    const s = (sessions.body.sessions as { id: string; events: unknown[] }[]).find(
      (x) => x.id === d.id,
    )!;
    expect(s.events).toHaveLength(2);

    // roll-up feed event for SSE consumers
    const feed = await req(`/v1/workspaces/${SLUG}/events?limit=5`, undefined, patToken);
    const actions = (feed.body.events as { action: string }[]).map((e) => e.action);
    expect(actions).toContain("session_update");
  });

  it("an agent cannot append to another agent's session", async () => {
    const key = await assignIssue("private session", otherAgentId);
    const theirs = await req(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      undefined,
      otherToken,
    );
    const d = (theirs.body.dispatches as { id: string; issueKey: string }[]).find(
      (x) => x.issueKey === key,
    )!;
    const blocked = await req(
      `/v1/workspaces/${SLUG}/dispatches/${d.id}/events`,
      {
        method: "POST",
        body: JSON.stringify({ events: [{ kind: "note", message: "hi" }] }),
      },
      agentToken,
    );
    expect(blocked.status).toBe(403);
  });
});
