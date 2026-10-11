import { assertSafeTestEnv } from "./db-guard.js";

// vitest globalSetup: runs once per run, before any DB connection is made.
export default function requireSafeDb(): void {
  assertSafeTestEnv();
}
