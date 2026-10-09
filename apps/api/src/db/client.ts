import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config_ } from "../env.js";
import * as schema from "./schema.js";

const pool = new pg.Pool({ connectionString: config_.databaseUrl });

export const db = drizzle(pool, { schema });
export { schema };

export async function closeDb(): Promise<void> {
  await pool.end();
}
