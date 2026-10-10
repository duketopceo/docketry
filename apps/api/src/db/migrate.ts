import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool, schema } from "./client.js";

// pg_advisory_lock is session-scoped — the lock and migrate() must share
// one dedicated client. Locking through the pool can land on a different
// connection than the one that migrates (and pg_advisory_unlock then
// silently returns false, leaking the lock for the process lifetime).
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('docketry-migrate')::bigint)",
    );
    const migrationDb = drizzle(client, { schema });
    await migrate(migrationDb, {
      migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
    });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('docketry-migrate')::bigint)")
      .catch(() => {});
    client.release();
  }
}
