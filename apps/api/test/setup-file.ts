import { randomBytes } from "node:crypto";
import pg from "pg";

// Runs in each test file's worker BEFORE the file's imports: point
// DATABASE_URL at a private clone of the migrated template so src/env.ts
// and src/db/client.ts pick it up. Dropped by global-setup teardown.

const base = process.env.TALLYLINE_TEST_DB_BASE;
const template = process.env.TALLYLINE_TEST_DB_TEMPLATE;
const prefix = process.env.TALLYLINE_TEST_DB_PREFIX;

if (base && template && prefix) {
  const name = `${prefix}${randomBytes(4).toString("hex")}`;
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  // CREATE DATABASE ... TEMPLATE fails if the template is being cloned by
  // another file at the same instant — serialize with an advisory lock.
  await admin.query("SELECT pg_advisory_lock(7731)");
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  } finally {
    await admin.query("SELECT pg_advisory_unlock(7731)");
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
}
