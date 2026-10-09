import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
      GITHUB_APP_SLUG: "docketry-test",
      SLACK_BOT_TOKEN: "xoxb-test-token",
      SLACK_SIGNING_SECRET: "test-slack-secret",
      SLACK_WORKSPACE_SLUG: "slack-test",
    },
  },
});
