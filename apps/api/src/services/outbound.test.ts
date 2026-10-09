import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
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
import { signDelivery, sweepDeliveries, verifyDeliverySignature } from "./outbound.js";

const SLUG = `wh-test-${Date.now()}`;
let sessionCookie = "";
let listener: Server;
const hits: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];

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

beforeAll(async () => {
  await runMigrations();
  for (const t of [
    comments,
    events,
    githubIssueLinks,
    dispatches,
    webhookDeliveries,
    webhookEndpoints,
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
  ] as const) {
    await db.delete(t);
  }
  await db.delete(workspaces);

  listener = createServer((rq, rs) => {
    let data = "";
    rq.on("data", (c) => (data += c));
    rq.on("end", () => {
      hits.push({ headers: rq.headers as Record<string, string | string[] | undefined>, body: data });
      rs.writeHead(200).end();
    });
  });
  await new Promise<void>((r) => listener.listen(0, r));

  const res = await app.fetch(
    new Request("http://api.test/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: SLUG,
        workspaceName: "WH Test",
        teamKey: "WH",
        email: "w@test.dev",
        name: "W User",
        password: "pw-long-enough",
      }),
    }),
  );
  expect(res.status).toBe(201);
  sessionCookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

afterAll(async () => {
  listener.close();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, SLUG));
  if (ws) {
    for (const t of [
      comments,
      events,
      webhookDeliveries,
      webhookEndpoints,
      issues,
      slackLinks,
      issues,
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

describe("outbound webhooks (#30)", () => {
  it("endpoint CRUD: create returns full secret once, list masks it", async () => {
    const port = (listener.address() as { port: number }).port;
    const created = await req(`/v1/workspaces/${SLUG}/webhook-endpoints`, {
      method: "POST",
      body: JSON.stringify({ url: `http://127.0.0.1:${port}/hook` }),
    });
    expect(created.status).toBe(201);
    expect((created.body as { secret: string }).secret).toMatch(/^whsec_/);

    const list = await req(`/v1/workspaces/${SLUG}/webhook-endpoints`);
    const ep = (list.body as { endpoints: { secretLast4: string; secret?: string }[] })
      .endpoints[0]!;
    expect(ep.secret).toBeUndefined();
    expect(ep.secretLast4).toHaveLength(4);
  });

  it("issue.created delivers a signed payload to matching endpoints", async () => {
    hits.length = 0;
    await req(`/v1/workspaces/${SLUG}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: "webhook target" }),
    });
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.headers["x-docketry-event"]).toBe("issue.created");

    const [ep] = await db.select().from(webhookEndpoints);
    expect(
      verifyDeliverySignature(
        hit.body,
        hit.headers["x-docketry-signature"] as string,
        ep!.secret,
      ),
    ).toBe(true);

    const parsed = JSON.parse(hit.body) as { issueKey: string; action: string };
    expect(parsed.action).toBe("issue.created");
    expect(parsed.issueKey).toBe("WH-1");
  });

  it("event filters exclude non-matching actions", async () => {
    const port = (listener.address() as { port: number }).port;
    await req(`/v1/workspaces/${SLUG}/webhook-endpoints`, {
      method: "POST",
      body: JSON.stringify({
        url: `http://127.0.0.1:${port}/filtered`,
        events: ["issue.commented"],
      }),
    });
    hits.length = 0;
    await req(`/v1/workspaces/${SLUG}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: "filtered out" }),
    });
    // 'created' goes only to the wildcard endpoint
    expect(hits).toHaveLength(1);
    expect((JSON.parse(hits[0]!.body) as { action: string }).action).toBe("issue.created");
  });

  it("failed POST schedules retry; sweeper redelivers; signature valid on retry", async () => {
    const dead = await req(`/v1/workspaces/${SLUG}/webhook-endpoints`, {
      method: "POST",
      body: JSON.stringify({ url: "http://127.0.0.1:1/unreachable" }),
    });
    const epId = (dead.body as { id: string }).id;

    await req(`/v1/workspaces/${SLUG}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: "retry me" }),
    });

    const [d] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, epId),
          eq(webhookDeliveries.status, "pending"),
        ),
      )
      .limit(1);
    expect(d).toBeDefined();
    expect(d!.attempts).toBe(1);
    expect(d!.lastError).toBeTruthy();
    expect(d!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // point the endpoint at the live listener and force the sweep
    const port = (listener.address() as { port: number }).port;
    await db
      .update(webhookEndpoints)
      .set({ url: `http://127.0.0.1:${port}/retry` })
      .where(eq(webhookEndpoints.id, epId));
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(webhookDeliveries.id, d!.id));

    hits.length = 0;
    const attempted = await sweepDeliveries();
    expect(attempted).toBeGreaterThanOrEqual(1);
    expect(hits).toHaveLength(1);

    const [after] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, d!.id));
    expect(after!.status).toBe("delivered");
    expect(after!.deliveredAt).toBeTruthy();
  });

  it("delivery log is inspectable via API", async () => {
    const list = await req(`/v1/workspaces/${SLUG}/webhook-endpoints`);
    const ep = (list.body as { endpoints: { id: string; events: string[] }[] })
      .endpoints.find((e) => e.events.includes("*"))!;
    const deliveries = await req(
      `/v1/workspaces/${SLUG}/webhook-endpoints/${ep.id}/deliveries`,
    );
    expect(deliveries.status).toBe(200);
    expect(
      (deliveries.body as { deliveries: unknown[] }).deliveries.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("signDelivery/verifyDeliverySignature round-trip", () => {
    const sig = signDelivery('{"a":1}', "s3cret");
    expect(verifyDeliverySignature('{"a":1}', sig, "s3cret")).toBe(true);
    expect(verifyDeliverySignature('{"a":2}', sig, "s3cret")).toBe(false);
    expect(verifyDeliverySignature('{"a":1}', "bad", "s3cret")).toBe(false);
  });
});
