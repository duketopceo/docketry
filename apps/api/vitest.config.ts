import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
      GITHUB_APP_SLUG: "docketry-test",
    },
  },
});
