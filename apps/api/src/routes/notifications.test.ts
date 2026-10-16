import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { closeDb, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  agentKeys,
  agents,
  authIdentities,
  authProviders,
  comments,
  cycleVelocity,
  cycles,
  dispatches,
  events,
  githubIssueLinks,
  githubInstallations,
  githubRepos,
  githubWebhookEvents,
  invites,
  issues,
  labels,
  notifications,
  oauthCodes,
  projectMilestones,
  projects,
  sessions,
  slackLinks,
  teamMembers,
  teams,
  userIdMap,
  userTokens,
  users,
  views,
  webhookDeliveries,
  webhookEndpoints,
  workspaceMembers,
  workspaces,
} from "../db/schema.js";

const SLUG = "notif-test";
let ownerCookie = "";
let memberCookie = "";
let aliceId = "";
let issueKey = "";
let issueId = "";
let agentKey = "";

async function req(path: string, init?: RequestInit) {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const as = (cookie: string) => ({ headers: { cookie } });

async function inbox(cookie: string) {
  const res = await req(`/v1/workspaces/${SLUG}/notifications`, as(cookie));
  expect(res.status).toBe(200);
  return res.body.notifications as Array<Record<string, unknown>>;
}

async function unread(cookie: string) {
  const res = await req(
    `/v1/workspaces/${SLUG}/notifications/unread-count`,
    as(cookie),
  );
  expect(res.status).toBe(200);
  return res.body.count as number;
}

beforeAll(async () => {
  await runMigrations();
  for (const t of [
    notifications,
    comments,
    events,
    githubIssueLinks,
    webhookDeliveries,
    webhookEndpoints,
    dispatches,
    issues,
    slackLinks,
    labels,
    agentKeys,
    agents,
    userTokens,
    views,
    cycleVelocity,
    cycles,
    projectMilestones,
    projects,
    authIdentities,
    authProviders,
    invites,
    oauthCodes,
    teamMembers,
    userIdMap,
    workspaceMembers,
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

  // owner + workspace + team
  const boot = await app.fetch(
    new Request("http://api.test/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: SLUG,
        workspaceName: "Notif Test",
        teamKey: "NT",
        email: "owner@nt.dev",
        name: "owner",
        password: "pw-long-enough",
      }),
    }),
  );
  expect(boot.status).toBe(201);
  ownerCookie = boot.headers.get("set-cookie")!.split(";")[0]!;

  // second member via invite-accept
  const invite = await req(
    `/v1/workspaces/${SLUG}/invites`,
    {
      method: "POST",
      body: JSON.stringify({ email: "alice@nt.dev", role: "member" }),
      ...as(ownerCookie),
    },
  );
  expect(invite.status).toBe(201);
  const token = (invite.body.joinUrl as string).split("/join/")[1]!;
  const claim = await app.fetch(
    new Request("http://api.test/v1/auth/accept-invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        name: "alice",
        password: "pw-long-enough",
      }),
    }),
  );
  expect(claim.status).toBe(201);
  memberCookie = claim.headers.get("set-cookie")!.split(";")[0]!;

  const [alice] = await db
    .select()
    .from(users)
    .where(eq(users.email, "alice@nt.dev"));
  aliceId = alice!.id;

  // an agent credential for the 403 case
  const agent = await req(`/v1/workspaces/${SLUG}/agents`, {
    method: "POST",
    body: JSON.stringify({ name: "notif-bot", harness: "local" }),
    ...as(ownerCookie),
  });
  const key = await req(
    `/v1/workspaces/${SLUG}/agents/${(agent.body as { id: string }).id}/keys`,
    { method: "POST", body: JSON.stringify({ name: "k", scopes: ["read", "write"] }), ...as(ownerCookie) },
  );
  agentKey = (key.body as { key: string }).key;

  const issue = await req(`/v1/workspaces/${SLUG}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: "notif target" }),
    ...as(ownerCookie),
  });
  issueKey = (issue.body as { key: string }).key;
  issueId = (issue.body as { id: string }).id;
});

afterAll(async () => {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, SLUG));
  if (ws) {
    await db.delete(invites).where(eq(invites.workspaceId, ws.id));
    await db
      .delete(teamMembers)
      .where(
        sql`${teamMembers.teamId} in (select ${teams.id} from ${teams} where ${teams.workspaceId} = ${ws.id})`,
      );
    await db
      .delete(users)
      .where(
        sql`${users.id} in (select ${workspaceMembers.userId} from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${ws.id})`,
      );
    for (const t of [
      notifications,
      comments,
      events,
      webhookDeliveries,
      webhookEndpoints,
      dispatches,
      issues,
      labels,
      agentKeys,
      agents,
      oauthCodes,
      workspaceMembers,
      sessions,
      teams,
    ] as const) {
      await db.delete(t).where(eq(t.workspaceId, ws.id));
    }
    await db.delete(workspaces).where(eq(workspaces.id, ws.id));
  }
  await closeDb();
});

describe("notifications", () => {
  it("assigning a human notifies that human only", async () => {
    const res = await req(`/v1/workspaces/${SLUG}/issues/${issueKey}`, {
      method: "PATCH",
      body: JSON.stringify({ assigneeType: "human", assigneeId: aliceId }),
      ...as(ownerCookie),
    });
    expect(res.status).toBe(200);

    const aliceInbox = await inbox(memberCookie);
    expect(aliceInbox).toHaveLength(1);
    expect(aliceInbox[0]!.kind).toBe("assigned");
    expect(aliceInbox[0]!.issueKey).toBe(issueKey);
    expect(aliceInbox[0]!.readAt).toBeNull();
    expect(await unread(memberCookie)).toBe(1);

    // owner got nothing — no cross-talk
    expect(await inbox(ownerCookie)).toHaveLength(0);
  });

  it("re-assigning the same human does not re-notify", async () => {
    await req(`/v1/workspaces/${SLUG}/issues/${issueKey}`, {
      method: "PATCH",
      body: JSON.stringify({ assigneeType: "human", assigneeId: aliceId }),
      ...as(ownerCookie),
    });
    expect(await unread(memberCookie)).toBe(1);
  });

  it("@mention of a member notifies the member", async () => {
    const res = await req(
      `/v1/workspaces/${SLUG}/issues/${issueKey}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: "hey @alice take a look" }),
        ...as(ownerCookie),
      },
    );
    expect(res.status).toBe(201);
    const aliceInbox = await inbox(memberCookie);
    expect(aliceInbox.some((n) => n.kind === "mention")).toBe(true);
    expect(await unread(memberCookie)).toBe(2);
  });

  it("self-mention does not notify the author", async () => {
    await req(`/v1/workspaces/${SLUG}/issues/${issueKey}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "note to self @owner" }),
      ...as(ownerCookie),
    });
    expect(await unread(ownerCookie)).toBe(0);
  });

  it("agent keys get 403 on every notification route", async () => {
    const auth = { headers: { authorization: `Bearer ${agentKey}` } };
    for (const [path, init] of [
      [`/v1/workspaces/${SLUG}/notifications`, {}],
      [`/v1/workspaces/${SLUG}/notifications/unread-count`, {}],
      [`/v1/workspaces/${SLUG}/notifications/1/read`, { method: "POST" }],
      [`/v1/workspaces/${SLUG}/notifications/read-all`, { method: "POST" }],
    ] as const) {
      const res = await req(path, { ...init, ...auth });
      expect(res.status).toBe(403);
    }
  });

  it("transition to in_review notifies staff (not the actor)", async () => {
    // promote alice — review fan-out goes to owner+admin members
    await db
      .update(workspaceMembers)
      .set({ role: "admin" })
      .where(eq(workspaceMembers.userId, aliceId));
    for (const state of ["todo", "in_progress", "in_review"] as const) {
      const res = await req(`/v1/workspaces/${SLUG}/issues/${issueKey}`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
        ...as(ownerCookie),
      });
      expect(res.status).toBe(200);
    }
    const aliceInbox = await inbox(memberCookie);
    expect(
      aliceInbox.filter((n) => n.kind === "review_pending"),
    ).toHaveLength(1);
    // the actor never self-notifies, even as staff
    const ownerInbox = await inbox(ownerCookie);
    expect(
      ownerInbox.filter((n) => n.kind === "review_pending"),
    ).toHaveLength(0);
  });

  it("mark-read + read-all + unread-count", async () => {
    // alice carries assigned + mention + review_pending = 3 unread
    expect(await unread(memberCookie)).toBe(3);
    const aliceInbox = await inbox(memberCookie);
    const first = aliceInbox[0]!;
    const read = await req(
      `/v1/workspaces/${SLUG}/notifications/${first.id}/read`,
      { method: "POST", ...as(memberCookie) },
    );
    expect(read.status).toBe(200);
    expect(await unread(memberCookie)).toBe(2);

    // owner cannot read alice's row — 404, not a leak
    const foreign = await req(
      `/v1/workspaces/${SLUG}/notifications/${first.id}/read`,
      { method: "POST", ...as(ownerCookie) },
    );
    expect(foreign.status).toBe(404);

    const all = await req(
      `/v1/workspaces/${SLUG}/notifications/read-all`,
      { method: "POST", ...as(memberCookie) },
    );
    expect(all.status).toBe(200);
    expect(await unread(memberCookie)).toBe(0);
  });

  it("dispatch_failed notifies the issue's human assignee", async () => {
    // unknown harness → createDispatch fails loudly via fail()
    const bad = await req(`/v1/workspaces/${SLUG}/agents`, {
      method: "POST",
      body: JSON.stringify({ name: "ghost-bot", harness: "no-such-harness" }),
      ...as(ownerCookie),
    });
    await req(`/v1/workspaces/${SLUG}/issues/${issueKey}`, {
      method: "PATCH",
      body: JSON.stringify({
        assigneeType: "agent",
        assigneeId: (bad.body as { id: string }).id,
      }),
      ...as(ownerCookie),
    });
    // assignee is now the agent → fan-out falls to the human creator (owner)
    const ownerInbox = await inbox(ownerCookie);
    expect(ownerInbox.some((n) => n.kind === "dispatch_failed")).toBe(true);
    const [d] = await db
      .select()
      .from(dispatches)
      .where(eq(dispatches.agentId, (bad.body as { id: string }).id))
      .orderBy(desc(dispatches.createdAt))
      .limit(1);
    expect(d!.status).toBe("dispatch_failed");
    void issueId;
  });
});
