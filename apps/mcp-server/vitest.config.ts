import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// These suites run the api app in-process and wipe/migrate DATABASE_URL, so
// refuse to start against the default dev stack (see apps/api/test/db-guard.ts).
// tools.test.ts boots the API in-process, and the API imports this package's
// library entry by name; resolve it to source so tests never depend on (or go
// stale against) a previous build.
export default defineConfig({
  resolve: {
    alias: {
      "@tallyline/mcp-server/lib": fileURLToPath(new URL("./src/lib.ts", import.meta.url)),
    },
  },
  test: {
    globalSetup: ["../api/test/require-safe-db.ts"],
  },
});
