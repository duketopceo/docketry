import { createHmac, timingSafeEqual } from "node:crypto";
import { config_ } from "../env.js";
import type { FetchLike } from "../services/llm.js";

export type { FetchLike } from "../services/llm.js";

const MAX_SKEW_S = 60 * 5;

// X-Slack-Signature: v0=<hmac-sha256("v0:ts:body")> — timing-safe verify +
// 5-minute freshness window to blunt replays.
export function verifySlackSignature(
  body: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!timestamp || !signature?.startsWith("v0=")) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_S) return false;
  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`, "utf8")
      .digest("hex");
  return (
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

// Minimal Web API client — plain fetch, no Bolt/SDK dependency.
interface SlackApiResult {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function slackApi(
  method: string,
  body: Record<string, unknown>,
  fetchImpl?: FetchLike,
): Promise<SlackApiResult> {
  const fetcher = fetchImpl ?? fetch;
  const res = await fetcher(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${config_.slackBotToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as SlackApiResult | null;
  if (!res.ok || data?.ok === false) {
    throw new Error(`slack ${method} failed: ${data?.error ?? res.status}`);
  }
  return data ?? {};
}

export function slackEnabled(): boolean {
  return (
    config_.slackBotToken.length > 0 &&
    config_.slackSigningSecret.length > 0 &&
    config_.slackWorkspaceSlug.length > 0
  );
}
