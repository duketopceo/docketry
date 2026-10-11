import { defineConfig } from "vitest/config";

// cli.test.ts runs the api app in-process and wipes/migrates DATABASE_URL, so
// refuse to start against the default dev stack (see apps/api/test/db-guard.ts).
export default defineConfig({
  test: {
    globalSetup: ["../../apps/api/test/require-safe-db.ts"],
  },
});
