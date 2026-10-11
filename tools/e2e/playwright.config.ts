import { defineConfig } from "@playwright/test";
import { assertSafeTestEnv } from "../../apps/api/test/db-guard.js";
import {
  FAKE_GH_PORT,
  GH_APP_PRIVATE_KEY,
  GH_APP_SLUG,
  GH_WEBHOOK_SECRET,
} from "./support/fake-github";

// Never boot the api/web servers (which migrate and write DATABASE_URL)
// against the default dev stack.
assertSafeTestEnv();

// Non-default ports: a dev api/web on :4000/:3100 must never be adopted.
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3110";
const API_PORT = process.env.E2E_API_PORT ?? "4100";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    storageState: "tests/.auth/session.json",
  },
  webServer: [
    {
      command: "pnpm dev",
      cwd: "../../apps/api",
      port: Number(API_PORT),
      // GitHub App configured against the local fake (support/fake-github.ts)
      env: {
        API_PORT,
        API_BASE_URL: `http://localhost:${API_PORT}`,
        WEB_URL: `http://localhost:${WEB_PORT}`,
        GITHUB_APP_ID: "424242",
        GITHUB_APP_SLUG: GH_APP_SLUG,
        GITHUB_WEBHOOK_SECRET: GH_WEBHOOK_SECRET,
        GITHUB_APP_PRIVATE_KEY: GH_APP_PRIVATE_KEY,
        GITHUB_API_URL: `http://127.0.0.1:${FAKE_GH_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // E2E_WEB_COMMAND: e.g. a prebuilt `next start` where dev HMR is unreliable
      command: process.env.E2E_WEB_COMMAND ?? `pnpm exec next dev -p ${WEB_PORT}`,
      cwd: "../../apps/web",
      port: Number(WEB_PORT),
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
        API_INTERNAL_URL: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
