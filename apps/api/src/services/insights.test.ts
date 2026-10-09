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
  slackLinks,
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

const SLUG = `ins-${Date.now()}`;
let cookie = "";
let agentToken = "";

const ALL_TABLES = [
  comments,
  events,
  githubIssueLinks,
  webhookDeliveries,
  webhookEndpoints,
  dispatchEvents,
  dispatches,
  slackLinks,
  issues,
  slackLinks,
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

interface InsightsBody {
  cycleTime: { completed: number; avgDays: number; weekly: unknown[] };
  burnup: { total: number; done: number }[];
  velocity: { team: string; cycle: string }[];
  throughput: { human: number; agent: number }[];
}

async function req<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
  token?: string,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  else headers.cookie = cookie;
  const res = await app.fetch(new Request(`http://t${path}`, { ...init, headers }));
  const sc = res.headers.get("set-cookie");
  if (sc?.startsWith("dok_session=")) cookie = sc.split(";")[0]!;
  return { status: res.status, body: (await res.json()) as T };
}

async function createIssue(title: string): Promise<string> {
  const res = await req<{ key: string }>(`/v1/workspaces/${SLUG}/issues`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return res.body.key;
}

async function walkToDone(key: string, token?: string) {
  // issues create in `backlog` — walk the legal path to done
  for (const state of ["todo", "in_progress", "in_review", "done"]) {
    const res = await req(`/v1/workspaces/${SLUG}/issues/${key}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    }, token);
    expect(res.status).toBe(200);
  }
}

beforeAll(async () => {
  await runMigrations();
  for (const t of ALL_TABLES) await db.delete(t);
  await db.delete(workspaces);

  await req("/v1/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      workspaceSlug: SLUG,
      workspaceName: "Insights",
      teamKey: "IN",
      email: "i@t.dev",
      name: "I",
      password: "pw-long-enough",
    }),
  });
  const agent = await req<{ id: string }>(`/v1/workspaces/${SLUG}/agents`, {
    method: "POST",
    body: JSON.stringify({ name: "ins-agent", harness: "vitest" }),
  });
  const key = await req<{ key: string }>(`/v1/workspaces/${SLUG}/agents/${agent.body.id}/keys`, {
    method: "POST",
    body: JSON.stringify({ name: "k1", scopes: ["read", "write"] }),
  });
  agentToken = key.body.key;
});

afterAll(async () => {
  for (const t of ALL_TABLES) await db.delete(t);
  await db.delete(workspaces);
  await closeDb();
});

describe("GET /v1/:ws/insights", () => {
  it("computes cycle time, burnup, and actor throughput from events", async () => {
    const k1 = await createIssue("human work");
    const k2 = await createIssue("agent work");
    const k3 = await createIssue("still open");

    await walkToDone(k1); // human session cookie
    await walkToDone(k2, agentToken);
    await req(`/v1/workspaces/${SLUG}/issues/${k3}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "backlog" }),
    });

    const res = await req<InsightsBody>(`/v1/workspaces/${SLUG}/insights`);
    expect(res.status).toBe(200);
    const ins = res.body;

    expect(ins.cycleTime.completed).toBe(2);
    expect(ins.cycleTime.avgDays).toBeGreaterThanOrEqual(0);
    expect(ins.cycleTime.weekly.length).toBeGreaterThan(0);

    const lastBurn = ins.burnup.at(-1)!;
    expect(lastBurn.total).toBe(3);
    expect(lastBurn.done).toBe(2);

    const tp = ins.throughput.at(-1)!;
    expect(tp.human).toBe(1);
    expect(tp.agent).toBe(1);
  });

  it("includes velocity snapshots for completed cycles", async () => {
    const cycle = await req<{ id: string }>(`/v1/workspaces/${SLUG}/cycles`, {
      method: "POST",
      body: JSON.stringify({
        teamKey: "IN",
        startsAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() - 86_400_000).toISOString(),
        isActive: true,
      }),
    });
    expect(cycle.status).toBe(201);
    const done = await req(
      `/v1/workspaces/${SLUG}/cycles/${cycle.body.id}/complete`,
      { method: "POST" },
    );
    expect(done.status).toBe(200);

    const res = await req<InsightsBody>(`/v1/workspaces/${SLUG}/insights`);
    expect(res.status).toBe(200);
    expect(res.body.velocity.length).toBe(1);
    expect(res.body.velocity[0]!.team).toBe("IN");
    expect(res.body.velocity[0]!.cycle).toMatch(/^C1/);
  });

  it("rejects other workspaces' credentials", async () => {
    const res = await req("/v1/workspaces/other-ws/insights");
    expect(res.status).toBe(404);
  });
});
