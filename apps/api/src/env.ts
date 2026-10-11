import { readEnv } from "@tallyline/types";
import { config } from "dotenv";

config({ path: new URL("../../../.env", import.meta.url) });

const env = (key: string, fallback?: string): string => {
  const value = readEnv(process.env, key) ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

export const config_ = {
  port: Number(env("API_PORT", "4000")),
  databaseUrl: env(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/docketry",
  ),
  redisUrl: env("REDIS_URL", "redis://localhost:6380"),
  jwtSecret: env("JWT_SECRET", "docketry-dev-secret-change-me"),
  rateLimitPerMin: Number(env("RATE_LIMIT_PER_MIN", "600")),
  apiBaseUrl: env("API_BASE_URL", "http://localhost:4000"),
  githubAppSlug: env("GITHUB_APP_SLUG", ""),
  githubWebhookSecret: env("GITHUB_WEBHOOK_SECRET", ""),

  githubAppId: env("GITHUB_APP_ID", ""),
  // PEM may arrive env-encoded with literal \n separators (common for
  // GitHub App keys in .env files / secret stores)
  githubAppPrivateKey: env("GITHUB_APP_PRIVATE_KEY", "").replace(
    /\\n/g,
    "\n",
  ),

  // Slack app — empty means every slack surface is off
  slackBotToken: env("SLACK_BOT_TOKEN", ""),
  slackSigningSecret: env("SLACK_SIGNING_SECRET", ""),
  // the tallyline workspace this Slack app reports into
  slackWorkspaceSlug: env("SLACK_WORKSPACE_SLUG", ""),
  slackIntakeEmoji: env("SLACK_INTAKE_EMOJI", "ticket"),

  // oauth / web origins
  webUrl: env("WEB_URL", "http://localhost:3100").replace(/\/$/, ""),
  // honors x-forwarded-for in rate limiting + logs — only set behind a
  // real reverse proxy (spoofable otherwise)
  trustedProxy: ["1", "true", "yes"].includes(
    env("TRUSTED_PROXY", "").toLowerCase(),
  ),

  // auth feature flags
  authSecretKey: env("AUTH_SECRET_KEY", ""),
  authDisablePassword: ["1", "true", "yes"].includes(
    env("AUTH_DISABLE_PASSWORD", "").toLowerCase(),
  ),
  authAccountLinking: env("AUTH_ACCOUNT_LINKING", "auto") as
    | "auto"
    | "login"
    | "disabled",
  authAllowedEmailDomains: env("AUTH_ALLOWED_EMAIL_DOMAINS", "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  authAutoJoinSingleWorkspace: !["0", "false", "no"].includes(
    env("AUTH_AUTO_JOIN_SINGLE_WORKSPACE", "").toLowerCase(),
  ),

  // oauth providers — empty client id = provider absent
  githubClientId: env("GITHUB_CLIENT_ID", ""),
  githubClientSecret: env("GITHUB_CLIENT_SECRET", ""),
  googleClientId: env("GOOGLE_CLIENT_ID", ""),
  googleClientSecret: env("GOOGLE_CLIENT_SECRET", ""),
  oidcIssuer: env("OIDC_ISSUER", ""),
  oidcClientId: env("OIDC_CLIENT_ID", ""),
  oidcClientSecret: env("OIDC_CLIENT_SECRET", ""),
  oidcDisplayName: env("OIDC_DISPLAY_NAME", ""),
  oidcScopes: env("OIDC_SCOPES", "email profile"),

  // auth — instance admins get provider settings + always-admin rights;
  // when unset, the bootstrap owner is the fallback admin (KTD10)
  authAdminEmails: env("AUTH_ADMIN_EMAILS", "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // LLM assist — entirely opt-in; empty key means every llm surface is off
  llmApiKey: env("TALLYLINE_LLM_API_KEY", ""),
  llmBaseUrl: env("TALLYLINE_LLM_BASE_URL", "https://openrouter.ai/api/v1"),
  // cheap-by-default per the spend ceiling; override for your budget
  llmModel: env("TALLYLINE_LLM_MODEL", "google/gemini-2.5-flash-lite"),
} as const;
