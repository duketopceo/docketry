import { defineConfig } from "@playwright/test";

const WEB_PORT = process.env.E2E_WEB_PORT ?? "3100";
const API_PORT = process.env.E2E_API_PORT ?? "4000";

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
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm dev",
      cwd: "../../apps/web",
      port: Number(WEB_PORT),
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
