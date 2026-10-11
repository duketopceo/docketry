import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Per-file database isolation. Migrate ONE template database here, then
// test/setup-file.ts clones it (CREATE DATABASE ... TEMPLATE) for every test
// file, so files can run in parallel without sharing rows or racing on
// migrations/wipes. Everything created here is dropped on teardown.

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export default async function setup(): Promise<() => Promise<void>> {
  // require-safe-db.ts (the globalSetup before this one) already refused an
  // unset or default-dev DATABASE_URL; never fall back to a default here.
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DATABASE_URL is not set");
  const runId = `${process.pid}_${randomBytes(3).toString("hex")}`;
  const template = `tly_tpl_${runId}`;
  const prefix = `tly_t_${runId}_`;

  const admin = new pg.Client({ connectionString: withDb(baseUrl, "postgres") });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${template}"`);

  const pool = new pg.Pool({ connectionString: withDb(baseUrl, template) });
  await migrate(drizzle(pool), {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  await pool.end();

  process.env.TALLYLINE_TEST_DB_BASE = baseUrl;
  process.env.TALLYLINE_TEST_DB_TEMPLATE = template;
  process.env.TALLYLINE_TEST_DB_PREFIX = prefix;

  return async () => {
    const { rows } = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 OR datname = $2",
      [`${prefix}%`, template],
    );
    for (const { datname } of rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.end();
  };
}
