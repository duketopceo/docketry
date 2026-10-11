import { defineConfig } from "vitest/config";

// These suites run the api app in-process and wipe/migrate DATABASE_URL, so
// refuse to start against the default dev stack (see apps/api/test/db-guard.ts).
export default defineConfig({
  test: {
    globalSetup: ["../api/test/require-safe-db.ts"],
  },
});
