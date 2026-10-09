import { createServer, type Server } from "node:http";
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
  workspaces,
} from "../db/schema.js";

const SLUG = `disp-test-${Date.now()}`;
let sessionCookie = "";
let issueId = "";
let agentId = "";

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

async function thread() {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.issueId, issueId));
  return rows.map((c) => c.body);
}

beforeAll(async () => {
  await runMigrations();
  for (const t of [
    comments,
    events,
    githubIssueLinks,
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
        workspaceName: "Disp Test",
        teamKey: "DS",
        email: "d@test.dev",
        name: "D User",
        password: "pw-long-enough",
      }),
    }),
  );
  expect(res.status).toBe(201);
  sessionCookie = res.headers.get("set-cookie")!.split(";")[0]!;

  const issue = await req(`/v1/workspaces/${SLUG}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: "dispatch target" }),
  });
  issueId = (issue.body as { id: string }).id;

  const agent = await req(`/v1/workspaces/${SLUG}/agents`, {
    method: "POST",
    body: JSON.stringify({ name: "local-bot", harness: "local" }),
  });
  agentId = (agent.body as { id: string }).id;
});

afterAll(async () => {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, SLUG));
  if (ws) {
    for (const t of [
      comments,
      events,
      dispatches,
      issues,
      agents,
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

describe("dispatch router (#23)", () => {
  it("agent assignment creates a dispatch record + thread ack + claim", async () => {
    const res = await req(`/v1/workspaces/${SLUG}/issues/DS-1`, {
      method: "PATCH",
      body: JSON.stringify({ assigneeType: "agent", assigneeId: agentId }),
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(dispatches);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trigger).toBe("assign");
    expect(rows[0]!.status).toBe("claimed");
    expect(rows[0]!.adapter).toBe("local");

    const bodies = await thread();
    expect(bodies.some((b) => b.includes("dispatching to @local-bot"))).toBe(true);
    expect(bodies.some((b) => b.includes("picked up"))).toBe(true);
  });

  it("@mention in a comment dispatches to the named agent", async () => {
    await req(`/v1/workspaces/${SLUG}/issues/DS-1/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "hey @local-bot can you look?" }),
    });
    const rows = await db.select().from(dispatches);
    const mention = rows.find((d) => d.trigger === "mention");
    expect(mention).toBeDefined();
    expect(mention!.status).toBe("claimed");
  });

  it("unknown harness fails with a plain-English reason — never silent", async () => {
    const alien = await req(`/v1/workspaces/${SLUG}/agents`, {
      method: "POST",
      body: JSON.stringify({ name: "alien-bot", harness: "warpdrive-9" }),
    });
    await req(`/v1/workspaces/${SLUG}/issues/DS-1`, {
      method: "PATCH",
      body: JSON.stringify({
        assigneeType: "agent",
        assigneeId: (alien.body as { id: string }).id,
      }),
    });
    const rows = await db.select().from(dispatches);
    const failed = rows.find((d) => d.status === "dispatch_failed");
    expect(failed).toBeDefined();
    expect(failed!.reason).toContain("warpdrive-9");

    const ev = await db
      .select()
      .from(events)
      .where(eq(events.action, "dispatch_failed"));
    expect(ev.length).toBeGreaterThanOrEqual(1);
    const bodies = await thread();
    expect(bodies.some((b) => b.includes("dispatch_failed"))).toBe(true);
  });

  it("webhook adapter POSTs to endpointUrl and claims on 2xx", async () => {
    const received: string[] = [];
    const server: Server = createServer((rq, rs) => {
      let data = "";
      rq.on("data", (c) => (data += c));
      rq.on("end", () => {
        received.push(data);
        rs.writeHead(200).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const hook = await req(`/v1/workspaces/${SLUG}/agents`, {
      method: "POST",
      body: JSON.stringify({
        name: "hook-bot",
        harness: "webhook",
        endpointUrl: `http://127.0.0.1:${port}/dispatch`,
      }),
    });
    await req(`/v1/workspaces/${SLUG}/issues/DS-1`, {
      method: "PATCH",
      body: JSON.stringify({
        assigneeType: "agent",
        assigneeId: (hook.body as { id: string }).id,
      }),
    });
    server.close();

    expect(received).toHaveLength(1);
    const payload = JSON.parse(received[0]!) as {
      issue: { key: string };
      trigger: string;
    };
    expect(payload.issue.key).toBe("DS-1");
    expect(payload.trigger).toBe("assign");

    const rows = await db.select().from(dispatches);
    expect(rows.at(-1)!.status).toBe("claimed");
    expect(rows.at(-1)!.adapter).toBe("webhook");
  });

  it("webhook adapter with no endpoint fails loudly", async () => {
    const bare = await req(`/v1/workspaces/${SLUG}/agents`, {
      method: "POST",
      body: JSON.stringify({ name: "bare-bot", harness: "webhook" }),
    });
    await req(`/v1/workspaces/${SLUG}/issues/DS-1`, {
      method: "PATCH",
      body: JSON.stringify({
        assigneeType: "agent",
        assigneeId: (bare.body as { id: string }).id,
      }),
    });
    const rows = await db.select().from(dispatches);
    expect(rows.at(-1)!.status).toBe("dispatch_failed");
    expect(rows.at(-1)!.reason).toContain("endpointUrl");
  });
});
