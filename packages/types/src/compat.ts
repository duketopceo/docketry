/**
 * Shared naming for Tallyline wire identifiers — env vars, token prefixes,
 * and HTTP headers. Single source of truth so API, MCP, CLI, and
 * integrations never hardcode the same string twice.
 *
 * (The old `docketry`/`dok_`/`x-docketry-*`/`DOCKETRY_*` names were retired
 * in the rename; nothing here accepts them anymore.)
 */

export type EnvLike = Record<string, string | undefined>;

/**
 * Reads a `TALLYLINE_*` (or other) env var, treating empty strings as unset.
 */
export function readEnv(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value !== "" ? value : undefined;
}

// --- token prefixes ----------------------------------------------------------

export const AGENT_TOKEN_PREFIX = "tly_agt_";
export const PAT_TOKEN_PREFIX = "tly_pat_";
export const WEBHOOK_SECRET_PREFIX = "tly_wh_";

export function isAgentToken(token: string | undefined | null): token is string {
  return !!token && token.startsWith(AGENT_TOKEN_PREFIX);
}

export function isPatToken(token: string | undefined | null): token is string {
  return !!token && token.startsWith(PAT_TOKEN_PREFIX);
}

/**
 * True for any opaque Tallyline credential (`tly_` namespace) — i.e.
 * anything that must NOT be tried as a JWT.
 */
export function hasApiTokenPrefix(token: string | undefined | null): boolean {
  return !!token && token.startsWith("tly_");
}

// --- headers -----------------------------------------------------------------

export const HEADER_WORKSPACE = "x-tallyline-workspace";
export const HEADER_API_URL = "x-tallyline-api-url";
export const HEADER_SIGNATURE = "x-tallyline-signature";
export const HEADER_EVENT = "x-tallyline-event";
export const HEADER_DELIVERY = "x-tallyline-delivery";

/**
 * Reads an `x-tallyline-*` header. `headers` keys are expected lower-cased
 * (Node / fetch convention).
 */
export function readHeader<T>(
  headers: Record<string, T | undefined>,
  name: string,
): T | undefined {
  return headers[name];
}
