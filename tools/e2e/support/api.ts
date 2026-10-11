import { createHmac } from "node:crypto";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { GH_WEBHOOK_SECRET } from "./fake-github";

export const API = `http://localhost:${process.env.E2E_API_PORT ?? "4000"}`;
export const WS = "e2e";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@tallyline.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-test-password-42";

/** API request context holding the e2e user's real session cookie. */
export async function apiSession(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const res = await ctx.post("/v1/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  if (!res.ok()) throw new Error(`api login failed: ${res.status()}`);
  return ctx;
}

/** Credentials-only context: bearer token, no cookies. */
export async function bearer(token: string): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    // the runner's default storageState is the e2e session — a bearer probe
    // must carry the token alone (the API prefers a cookie session)
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
}

/** Signed webhook delivery to the real API route (the fake only replaces GitHub). */
export async function deliverGithubWebhook(
  ctx: APIRequestContext,
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const body = JSON.stringify(payload);
  const sig = `sha256=${createHmac("sha256", GH_WEBHOOK_SECRET).update(body, "utf8").digest("hex")}`;
  const res = await ctx.post("/webhooks/github", {
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
      "x-github-event": event,
      "x-github-delivery": `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    data: body,
  });
  return res.status();
}
