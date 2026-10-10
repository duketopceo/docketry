import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "./client.js";
import { runMigrations } from "./migrate.js";
import {
  teams,
  users,
  workspaceMembers,
  workspaces,
} from "./schema.js";

// post-0019 schema invariants — the migration's behavioral contract,
// asserted on a freshly migrated DB (merge itself is covered by the
// populated-DB rehearsal in U1's verification)
describe("identity schema (post-0019)", () => {
  beforeAll(async () => {
    await runMigrations();
    for (const t of [workspaceMembers, users, teams] as const)
      await db.delete(t);
    await db.delete(workspaces);
  });
  afterAll(async () => {
    for (const t of [workspaceMembers, users, teams] as const)
      await db.delete(t);
    await db.delete(workspaces);
    await closeDb();
  });

  it("users has no workspace_id and email uniqueness is normalized", async () => {
    const cols = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'users'`,
    );
    expect(cols.rows.map((r) => r.column_name)).not.toContain("workspace_id");

    const idx = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes
          WHERE tablename = 'users' AND indexname = 'users_email_unique'`,
    );
    expect(idx.rows[0]!.indexdef).toContain("lower(btrim(email))");
  });

  it("workspaces gains allowed_domains", async () => {
    const cols = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'workspaces' AND column_name = 'allowed_domains'`,
    );
    expect(cols.rows).toHaveLength(1);
  });

  it("bootstrap inserts an owner member row; second bootstrap is closed", async () => {
    const { authRoutes } = await import("../routes/auth.js");
    const res = await authRoutes.fetch(
      new Request("http://api.test/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceSlug: "schema-it",
          workspaceName: "Schema IT",
          teamKey: "SI",
          email: "Owner@Test.Co",
          name: "Owner",
          password: "test-password-123",
        }),
      }),
    );
    expect(res.status).toBe(201);

    // write-time normalization: stored lowercase+trimmed (R4/R15a)
    const [u] = await db.select().from(users).where(eq(users.email, "owner@test.co"));
    expect(u).toBeTruthy();

    const [m] = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, u!.id));
    expect(m!.role).toBe("owner");

    const again = await authRoutes.fetch(
      new Request("http://api.test/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceSlug: "second",
          workspaceName: "Second",
          teamKey: "S2",
          email: "b@b.co",
          name: "B",
          password: "test-password-123",
        }),
      }),
    );
    expect(again.status).toBe(403);
  });

  it("login resolves membership and rejects unknown/zero-state creds", async () => {
    const { authRoutes } = await import("../routes/auth.js");
    const ok = await authRoutes.fetch(
      new Request("http://api.test/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "OWNER@test.co", password: "test-password-123" }),
      }),
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { workspaceId: string };
    expect(body.workspaceId).toBeTruthy();

    const bad = await authRoutes.fetch(
      new Request("http://api.test/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@x.co", password: "nope123456" }),
      }),
    );
    expect(bad.status).toBe(401);
  });
});
