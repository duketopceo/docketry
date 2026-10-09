import { config_ } from "../env.js";
import { HttpError } from "../lib/errors.js";

// ── LLM provider interface ────────────────────────────────────────────
// The seam every model adapter implements. OpenRouter is the first-party
// impl (OpenAI-compatible /chat/completions); other providers plug in the
// same way — no vendor SDK lock-in, plain fetch.

export interface LLMCompleteOpts {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  complete(opts: LLMCompleteOpts): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

const DEFAULT_MAX_TOKENS = 512;
const TIMEOUT_MS = 15_000;

export function llmEnabled(): boolean {
  return config_.llmApiKey.length > 0;
}

export function requireLLM(): void {
  if (!llmEnabled()) {
    throw new HttpError(
      503,
      "LLM_DISABLED",
      "LLM assist is off — set DOCKETRY_LLM_API_KEY to enable",
    );
  }
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export function createOpenRouterProvider(fetchImpl?: FetchLike): LLMProvider {
  const fetcher = fetchImpl ?? fetch;
  return {
    async complete(opts) {
      const res = await fetcher(`${config_.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config_.llmApiKey}`,
          "http-referer": config_.apiBaseUrl,
          "x-title": "docketry",
        },
        body: JSON.stringify({
          model: config_.llmModel,
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: opts.temperature ?? 0.2,
          messages: [
            ...(opts.system
              ? [{ role: "system" as const, content: opts.system }]
              : []),
            { role: "user" as const, content: opts.user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as ChatResponse | null;
      if (!res.ok) {
        throw new HttpError(
          502,
          "LLM_UPSTREAM",
          `LLM request failed (${res.status}): ${body?.error?.message ?? "unknown"}`,
        );
      }
      const text = body?.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new HttpError(502, "LLM_UPSTREAM", "LLM returned no content");
      }
      return text;
    },
  };
}
