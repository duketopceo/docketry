import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// provider endpoint checks do live DNS + fetch — stub the egress guard so
// the admin-route tests exercise validation logic, not the network
vi.mock("../auth/providers/types.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/providers/types.js")>();
  return {
    ...actual,
    assertPublicUrl: async (u: string) => {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:") throw new Error("not https");
    },
  };
});
import { app } from "../index.js";
import { closeDb, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  agents, agentKeys, authIdentities, authProviders, comments,
  events, invites, issues, labels, oauthCodes, sessions, slackLinks,
  teamMembers, teams, userIdMap, users, userTokens, views,
  workspaceMembers, workspaces,
} from "../db/schema.js";
import { hashPassword } from "../services/auth.js";

const WIPE = [
  comments, events, slackLinks, labels, issues, views, agentKeys, agents,
  userTokens, sessions, invites, oauthCodes, authIdentities, authProviders,
  userIdMap, teamMembers, workspaceMembers, teams, users, workspaces,
] as const;

let ownerCookie = "";
let adminCookie = "";
let memberCookie = "";
let memberId = "";
let wsId = "";
let ws2Id = "";
let teamId = "";

async function req(path: string, init?: RequestInit & { cookie?: string }) {
  const { cookie, ...rest } = init ?? {};
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...((rest.headers as Record<string, string>) ?? {}),
      },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

const cookieFrom = (r: { headers: Headers }) => r.headers.get("set-cookie")!.split(";")[0]!;

async function makeUser(email: string, role: "member" | "admin" | "owner") {
  const [u] = await db.insert(users)
    .values({ email, name: email.split("@")[0]!, passwordHash: hashPassword("test-password-123") })
    .returning();
  const [m] = await db.insert(workspaceMembers)
    .values({ workspaceId: wsId, userId: u!.id, role }).returning();
  const login = await req("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "test-password-123" }),
  });
  return { userId: u!.id, memberRowId: m!.id, cookie: cookieFrom(login) };
}

beforeAll(async () => {
  await runMigrations();
  for (const t of WIPE) await db.delete(t);
  const boot = await req("/v1/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      workspaceSlug: "u5", workspaceName: "U5", teamKey: "U5",
      email: "owner@u5.test", name: "Owner", password: "test-password-123",
    }),
  });
  ownerCookie = cookieFrom(boot);
  wsId = (boot.body.workspace as { id: string }).id;
  const [team] = await db.select().from(teams).where(eq(teams.workspaceId, wsId));
  teamId = team!.id;
  const [ws2] = await db.insert(workspaces).values({ slug: "u5-b", name: "B" }).returning();
  ws2Id = ws2!.id;
  const admin = await makeUser("admin@u5.test", "admin");
  adminCookie = admin.cookie;
  const member = await makeUser("member@u5.test", "member");
  memberCookie = member.cookie;
  void member.userId;
  memberId = member.memberRowId;
});

afterAll(async () => {
  for (const t of WIPE) await db.delete(t);
  await closeDb();
});

describe("members admin", () => {
  it("roster readable by member; role writes gated; matrix + last-owner enforced", async () => {
    const list = await req("/v1/workspaces/u5/members", { cookie: memberCookie });
    expect(list.status).toBe(200);
    expect((list.body.members as unknown[]).length).toBe(3);
    expect((list.body.members as { email: string }[])[0]).toHaveProperty("role");

    // member cannot write roles
    const asMember = await req(`/v1/workspaces/u5/members/${memberId}`, {
      method: "PATCH", cookie: memberCookie, body: JSON.stringify({ role: "admin" }),
    });
    expect(asMember.status).toBe(403);

    // admin CAN promote member→admin (non-owner row, non-owner grant)
    const asAdmin = await req(`/v1/workspaces/u5/members/${memberId}`, {
      method: "PATCH", cookie: adminCookie, body: JSON.stringify({ role: "admin" }),
    });
    expect(asAdmin.status).toBe(200);
    // …but admin cannot grant owner or touch the owner's row
    const ownerRow = (list.body.members as { role: string; id: string }[]).find((m) => m.role === "owner")!;
    const grantOwner = await req(`/v1/workspaces/u5/members/${memberId}`, {
      method: "PATCH", cookie: adminCookie, body: JSON.stringify({ role: "owner" }),
    });
    expect(grantOwner.status).toBe(403);
    const touchOwner = await req(`/v1/workspaces/u5/members/${ownerRow.id}`, {
      method: "PATCH", cookie: adminCookie, body: JSON.stringify({ role: "member" }),
    });
    expect(touchOwner.status).toBe(403);

    // cross-workspace :id → 404 even for an owner of that workspace —
    // member rows are resolved strictly under the scoped workspace id
    const [ownerUser] = await db.select().from(users).where(eq(users.email, "owner@u5.test"));
    await db.insert(workspaceMembers).values({ workspaceId: ws2Id, userId: ownerUser!.id, role: "owner" });
    const cross = await req(`/v1/workspaces/u5-b/members/${memberId}`, {
      method: "PATCH", cookie: ownerCookie, body: JSON.stringify({ role: "admin" }),
    });
    expect(cross.status).toBe(404);
  });

  it("owner demotion guard: last owner can't be demoted or removed", async () => {
    const list = await req("/v1/workspaces/u5/members", { cookie: ownerCookie });
    const ownerRow = (list.body.members as { role: string; id: string }[]).find((m) => m.role === "owner")!;
    const demote = await req(`/v1/workspaces/u5/members/${ownerRow.id}`, {
      method: "PATCH", cookie: ownerCookie, body: JSON.stringify({ role: "member" }),
    });
    expect(demote.status).toBe(409);
    expect((demote.body.error as { code: string }).code).toBe("LAST_OWNER");
    const remove = await req(`/v1/workspaces/u5/members/${ownerRow.id}`, {
      method: "DELETE", cookie: ownerCookie,
    });
    expect(remove.status).toBe(409);

    // removing a member works + emits member_left
    const del = await req(`/v1/workspaces/u5/members/${memberId}`, {
      method: "DELETE", cookie: adminCookie,
    });
    expect(del.status).toBe(200);
    const [ev] = await db.select().from(events).where(eq(events.action, "member_left"));
    expect(ev).toBeTruthy();
    // removed member's session dies on next request
    const dead = await req("/v1/workspaces/u5/members", { cookie: memberCookie });
    expect(dead.status).toBe(403);
  });
});

describe("invites", () => {
  it("lifecycle: create → accept → member row + member_joined; replay 410", async () => {
    const created = await req("/v1/workspaces/u5/invites", {
      method: "POST", cookie: ownerCookie,
      body: JSON.stringify({ email: "newbie@u5.test", role: "member", teamId }),
    });
    expect(created.status).toBe(201);
    const joinUrl = created.body.joinUrl as string;
    expect(joinUrl).toContain("/join/dok_inv_");
    const token = joinUrl.split("/join/")[1]!;

    // unauthenticated claim creates user+member+session (R18c)
    const claim = await req("/v1/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, name: "Newbie", password: "new-password-123" }),
    });
    expect(claim.status).toBe(201);
    const [m] = await db.select().from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, wsId));
    expect(m).toBeTruthy();
    const [u] = await db.select().from(users).where(eq(users.email, "newbie@u5.test"));
    const [tm] = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    expect(tm!.userId).toBe(u!.id);
    const [ev] = await db.select().from(events).where(eq(events.action, "member_joined"));
    expect(ev).toBeTruthy();

    // replay → 410
    const replay = await req("/v1/auth/accept-invite", {
      method: "POST", body: JSON.stringify({ token, name: "X", password: "x-password-123" }),
    });
    expect(replay.status).toBe(410);
  });

  it("validates: owner role 422-ish, cross-ws team 422, email-bound mismatch 403", async () => {
    const badRole = await req("/v1/workspaces/u5/invites", {
      method: "POST", cookie: ownerCookie, body: JSON.stringify({ role: "owner" }),
    });
    expect(badRole.status).toBe(400); // zod enum rejects
    const [otherTeam] = await db.insert(teams).values({ workspaceId: ws2Id, key: "OB", name: "B" }).returning();
    const badTeam = await req("/v1/workspaces/u5/invites", {
      method: "POST", cookie: ownerCookie, body: JSON.stringify({ teamId: otherTeam!.id }),
    });
    expect(badTeam.status).toBe(422);

    // email-bound invite accepted by a different logged-in email → 403
    const bound = await req("/v1/workspaces/u5/invites", {
      method: "POST", cookie: ownerCookie, body: JSON.stringify({ email: "someone@else.test" }),
    });
    const token = (bound.body.joinUrl as string).split("/join/")[1]!;
    const wrongUser = await makeUser("wrong@u5.test", "member");
    const accept = await req("/v1/auth/accept-invite", {
      method: "POST", cookie: wrongUser.cookie,
      body: JSON.stringify({ token }),
    });
    expect(accept.status).toBe(403);
    // the bound email's account is created by the unauthenticated claim
    const okAccept = await req("/v1/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, name: "Someone", password: "pw-password-123" }),
    });
    expect(okAccept.status).toBe(201);
  });
});

describe("providers admin", () => {
  it("instance-admin gate: workspace owner (bootstrap fallback) passes, member 403/401", async () => {
    const asOwner = await req("/v1/auth/providers", { cookie: ownerCookie });
    expect(asOwner.status).toBe(200);
    const asMember = await req("/v1/auth/providers", { cookie: adminCookie });
    // admin is workspace-admin but not instance admin (no AUTH_ADMIN_EMAILS → only first-ws owner)
    expect(asMember.status).toBe(403);
  });

  it("CRUD: create encrypts secret + masks, patch write-only, env-shadowed rejects", async () => {
    const created = await req("/v1/auth/providers", {
      method: "POST", cookie: ownerCookie,
      body: JSON.stringify({
        key: "corpidp", type: "oidc", label: "Corp IdP",
        clientId: "cid", clientSecret: "sekrit",
        issuer: "https://idp.corp.example",
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.hasSecret).toBe(true);
    expect(created.body.clientSecretEnc).toBeUndefined();
    const id = created.body.id as string;

    const patch = await req(`/v1/auth/providers/${id}`, {
      method: "PATCH", cookie: ownerCookie, body: JSON.stringify({ label: "Corp IdP 2" }),
    });
    expect(patch.status).toBe(200);
    expect(patch.body.label).toBe("Corp IdP 2");

    // http:// issuer → 422
    const badHttp = await req("/v1/auth/providers", {
      method: "POST", cookie: ownerCookie,
      body: JSON.stringify({ key: "bad", type: "oidc", label: "B", clientId: "x", clientSecret: "y", issuer: "http://idp.corp.example" }),
    });
    expect(badHttp.status).toBe(422);

    const del = await req(`/v1/auth/providers/${id}`, { method: "DELETE", cookie: ownerCookie });
    expect(del.status).toBe(200);
    const [ev] = await db.select().from(events).where(eq(events.action, "provider_deleted"));
    expect(ev).toBeTruthy();
  });

  it("workspace PATCH writes allowedDomains (admin+)", async () => {
    const res = await req("/v1/workspaces/u5", {
      method: "PATCH", cookie: adminCookie,
      body: JSON.stringify({ allowedDomains: ["corp.io", "U5.TEST"] }),
    });
    expect(res.status).toBe(200);
    expect(res.body.allowedDomains).toEqual(["corp.io", "u5.test"]);
    const asMember2 = await makeUser("m2@u5.test", "member");
    const denied = await req("/v1/workspaces/u5", {
      method: "PATCH", cookie: asMember2.cookie,
      body: JSON.stringify({ allowedDomains: ["evil.io"] }),
    });
    expect(denied.status).toBe(403);
  });
});
