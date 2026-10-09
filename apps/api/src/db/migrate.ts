import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.js";

export async function runMigrations(): Promise<void> {
  await migrate(db, {
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  });
}
