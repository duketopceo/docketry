/**
 * Legacy-name compatibility for the docketry -> Tallyline rename.
 *
 * This is the ONLY place that knows the old names. Everything else uses the
 * new names and goes through these helpers, so the fallbacks can be deleted
 * in one sweep when the deprecation window ends.
 */

export type EnvLike = Record<string, string | undefined>;

const NEW_ENV_PREFIX = "TALLYLINE_";
const LEGACY_ENV_PREFIX = "DOCKETRY_";

/** `TALLYLINE_TOKEN` -> `DOCKETRY_TOKEN`; undefined if not a TALLYLINE_* name. */
export function legacyEnvName(name: string): string | undefined {
  return name.startsWith(NEW_ENV_PREFIX)
    ? LEGACY_ENV_PREFIX + name.slice(NEW_ENV_PREFIX.length)
    : undefined;
}

/**
 * Reads a `TALLYLINE_*` env var, falling back to the deprecated `DOCKETRY_*`
 * name when the new one is unset or empty. The new name always wins.
 */
export function readEnv(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  if (value !== undefined && value !== "") return value;
  const legacy = legacyEnvName(name);
  if (legacy === undefined) return value;
  const old = env[legacy];
  return old !== undefined && old !== "" ? old : value;
}

// --- token prefixes ----------------------------------------------------------

export const AGENT_TOKEN_PREFIX = "tly_agt_";
export const PAT_TOKEN_PREFIX = "tly_pat_";
export const WEBHOOK_SECRET_PREFIX = "tly_wh_";

/** Pre-rename prefixes: still accepted on validation, never issued. */
export const LEGACY_AGENT_TOKEN_PREFIX = "dok_agt_";
export const LEGACY_PAT_TOKEN_PREFIX = "dok_pat_";

export function isAgentToken(token: string | undefined | null): token is string {
  return (
    !!token &&
    (token.startsWith(AGENT_TOKEN_PREFIX) ||
      token.startsWith(LEGACY_AGENT_TOKEN_PREFIX))
  );
}

export function isPatToken(token: string | undefined | null): token is string {
  return (
    !!token &&
    (token.startsWith(PAT_TOKEN_PREFIX) ||
      token.startsWith(LEGACY_PAT_TOKEN_PREFIX))
  );
}

/**
 * True for any opaque Tallyline credential (new `tly_` or legacy `dok_`
 * namespace) — i.e. anything that must NOT be tried as a JWT.
 */
export function hasApiTokenPrefix(token: string | undefined | null): boolean {
  return !!token && (token.startsWith("tly_") || token.startsWith("dok_"));
}

// --- headers -----------------------------------------------------------------

export const HEADER_WORKSPACE = "x-tallyline-workspace";
export const HEADER_API_URL = "x-tallyline-api-url";
export const HEADER_SIGNATURE = "x-tallyline-signature";
export const HEADER_EVENT = "x-tallyline-event";
export const HEADER_DELIVERY = "x-tallyline-delivery";

/**
 * Reads a `x-tallyline-*` header, falling back to the legacy `x-docketry-*`
 * name. `headers` keys are expected lower-cased (Node / fetch convention).
 */
export function readHeader<T>(
  headers: Record<string, T | undefined>,
  name: string,
): T | undefined {
  const value = headers[name];
  if (value !== undefined) return value;
  return headers[name.replace(/^x-tallyline-/, "x-docketry-")];
}
