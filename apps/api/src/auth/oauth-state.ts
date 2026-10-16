import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { requestIsHttps } from "../lib/https.js";

// Pre-auth leg state: state (CSRF) + nonce (id_token binding) + PKCE
// verifier ride in three hardened HttpOnly cookies. The state cookie's
// value carries the flow context (return_to, invite hash, login nonce) —
// invite tokens are hashed, never the raw bearer, and never reach the
// provider authorize URL (R21).
export const STATE_COOKIE = "tly_oauth_state";
export const NONCE_COOKIE = "tly_oauth_nonce";
export const VERIFIER_COOKIE = "tly_oauth_verifier";

export interface StatePayload {
  state: string;
  returnTo: string;
  inviteHash: string | null;
  loginNonce: string | null;
}

// secure follows the request scheme — plain-http self-host deploys must
// not emit Secure cookies or the browser drops them (lib/https.ts)
const cookieOpts = (c: Context) => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: requestIsHttps(c),
  maxAge: 600,
  path: "/",
});

export function hashOpaque(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// same-origin-relative paths only; anything else degrades to "/" (flow
// continues — the error channel is reserved for provider/state failures)
export function safeReturnTo(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function issueOAuthState(
  c: Context,
  opts: {
    returnTo?: string | undefined;
    inviteToken?: string | undefined;
    loginNonce?: string | undefined;
  },
): { state: string; nonce: string; codeVerifier: string; codeChallenge: string } {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const payload: StatePayload = {
    state,
    returnTo: safeReturnTo(opts.returnTo),
    inviteHash: opts.inviteToken ? hashOpaque(opts.inviteToken) : null,
    loginNonce: opts.loginNonce ?? null,
  };
  setCookie(c, STATE_COOKIE, Buffer.from(JSON.stringify(payload)).toString("base64url"), cookieOpts(c));
  setCookie(c, NONCE_COOKIE, nonce, cookieOpts(c));
  setCookie(c, VERIFIER_COOKIE, codeVerifier, cookieOpts(c));
  return { state, nonce, codeVerifier, codeChallenge };
}

export function clearOAuthState(c: Context) {
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE]) {
    deleteCookie(c, name, { path: "/" });
  }
}

// reads + validates the state cookie against the provider-returned ?state
export function readOAuthState(c: Context): {
  payload: StatePayload | null;
  nonce: string | null;
  codeVerifier: string | null;
} {
  const raw = getCookie(c, STATE_COOKIE);
  const nonce = getCookie(c, NONCE_COOKIE) ?? null;
  const codeVerifier = getCookie(c, VERIFIER_COOKIE) ?? null;
  if (!raw) return { payload: null, nonce, codeVerifier };
  try {
    const payload = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as StatePayload;
    return { payload, nonce, codeVerifier };
  } catch {
    return { payload: null, nonce, codeVerifier };
  }
}
