import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import pg from "pg";

const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? "3100"}`;
const API = `http://localhost:${process.env.E2E_API_PORT ?? "4000"}`;
const DB =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/docketry";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@docketry.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-test-password-42";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

// Bootstrap once per deployment; if a workspace already exists, seed an
// e2e user into it directly (no invite endpoint exists yet — #12 territory).
export default async function globalSetup() {
  const ctx = await request.newContext();
  const boot = await ctx.post(`${API}/v1/auth/bootstrap`, {
    data: {
      workspaceSlug: "e2e",
      workspaceName: "E2E",
      teamKey: "E2E",
      email: EMAIL,
      name: "E2E Runner",
      password: PASSWORD,
    },
  });
  await ctx.dispose();
  if (!boot.ok() && boot.status() !== 403) {
    throw new Error(`bootstrap failed: ${boot.status()} ${await boot.text()}`);
  }

  if (boot.status() === 403) {
    const client = new pg.Client({ connectionString: DB });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM workspaces LIMIT 1",
      );
      const ws = rows[0];
      if (!ws) throw new Error("no workspace found to seed e2e user");
      await client.query(
        `INSERT INTO users (email, name, password_hash)
         SELECT $1, 'E2E Runner', $2
         WHERE NOT EXISTS (
           SELECT 1 FROM users WHERE lower(btrim(email)) = lower(btrim($1))
         )`,
        [EMAIL, hashPassword(PASSWORD)],
      );
      await client.query(
        `UPDATE users SET password_hash = $2
         WHERE lower(btrim(email)) = lower(btrim($1))`,
        [EMAIL, hashPassword(PASSWORD)],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         SELECT $1, id, 'member' FROM users
         WHERE lower(btrim(email)) = lower(btrim($2))
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [ws.id, EMAIL],
      );
    } finally {
      await client.end();
    }
  }

  const browser = await request.newContext({ baseURL: WEB });
  const web = await browser.post("/api/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!web.ok()) {
    throw new Error(`web login bridge failed: ${web.status()}`);
  }
  const dir = path.join(import.meta.dirname, "tests", ".auth");
  mkdirSync(dir, { recursive: true });
  await browser.storageState({ path: path.join(dir, "session.json") });
  await browser.dispose();
}
