export interface McpConfig {
  apiUrl: string;
  token: string;
  workspace: string;
}

export class MissingEnvError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `missing required env var(s): ${missing.join(", ")}\n` +
        "  DOCKETRY_TOKEN     — a dok_agt_* agent key (or dok_pat_* token)\n" +
        "  DOCKETRY_WORKSPACE — workspace slug, e.g. 'acme'\n" +
        "  DOCKETRY_API_URL   — optional, default http://localhost:4000",
    );
    this.name = "MissingEnvError";
  }
}

const stripSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * Reads MCP server config from the environment. Missing required vars throw
 * MissingEnvError — the entrypoint turns that into a clean stderr + exit(1)
 * rather than serving a tool surface that can only 401.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const missing: string[] = [];
  const token = env.DOCKETRY_TOKEN?.trim();
  const workspace = env.DOCKETRY_WORKSPACE?.trim();
  if (!token) missing.push("DOCKETRY_TOKEN");
  if (!workspace) missing.push("DOCKETRY_WORKSPACE");
  if (missing.length > 0) throw new MissingEnvError(missing);
  return {
    apiUrl: stripSlash(env.DOCKETRY_API_URL ?? "http://localhost:4000"),
    token: token!,
    workspace: workspace!,
  };
}

/**
 * How an --http endpoint resolves credentials. `env` = all requests share the
 * DOCKETRY_TOKEN/DOCKETRY_WORKSPACE env pair (single-tenant self-host).
 * `passthrough` = each request supplies its own via headers — the shape a
 * hosted multi-tenant endpoint (Klavis Strata externalServers, gateways)
 * needs. One var set without the other is an ambiguous deployment → throw.
 */
export type HttpAuthMode =
  | { mode: "env"; config: McpConfig }
  | { mode: "passthrough"; apiUrl: string; allowApiUrlOverride: boolean };

export function httpAuthMode(env: NodeJS.ProcessEnv): HttpAuthMode {
  const token = env.DOCKETRY_TOKEN?.trim();
  const workspace = env.DOCKETRY_WORKSPACE?.trim();
  if (token && workspace) {
    return { mode: "env", config: loadConfig(env) };
  }
  if (token || workspace) {
    throw new MissingEnvError([token ? "DOCKETRY_WORKSPACE" : "DOCKETRY_TOKEN"]);
  }
  return {
    mode: "passthrough",
    apiUrl: stripSlash(env.DOCKETRY_API_URL ?? "http://localhost:4000"),
    allowApiUrlOverride: env.DOCKETRY_ALLOW_API_URL_OVERRIDE === "1",
  };
}

const WORKSPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export class PassthroughAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassthroughAuthError";
  }
}

/**
 * Resolve a per-request config from inbound headers in passthrough mode.
 * `authorization` carries the docketry credential (dok_agt_*, dok_pat_*, or a
 * session JWT); `x-docketry-workspace` carries the slug. `x-docketry-api-url`
 * is honored only when the deployment opted in via
 * DOCKETRY_ALLOW_API_URL_OVERRIDE=1 — forwarding caller-chosen URLs server-side
 * is an SSRF surface, so it is off by default.
 */
export function configFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  base: { apiUrl: string; allowApiUrlOverride: boolean },
): McpConfig {
  const auth = first(headers["authorization"]);
  const token = auth?.replace(/^bearer\s+/i, "").trim();
  if (!token) {
    throw new PassthroughAuthError(
      "missing Authorization: Bearer <dok_agt_*> header",
    );
  }
  const workspace = first(headers["x-docketry-workspace"])?.trim();
  if (!workspace || !WORKSPACE_RE.test(workspace)) {
    throw new PassthroughAuthError(
      "missing or invalid x-docketry-workspace header",
    );
  }
  let apiUrl = base.apiUrl;
  const override = first(headers["x-docketry-api-url"])?.trim();
  if (override) {
    if (!base.allowApiUrlOverride) {
      throw new PassthroughAuthError(
        "x-docketry-api-url not accepted by this endpoint",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new PassthroughAuthError("x-docketry-api-url must be http(s)");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PassthroughAuthError("x-docketry-api-url must be http(s)");
    }
    if (isBlockedOverrideHost(parsed.hostname)) {
      throw new PassthroughAuthError(
        "x-docketry-api-url host is not permitted",
      );
    }
    apiUrl = stripSlash(override);
  }
  return { apiUrl, token, workspace };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Literal-address hosts a forwarded override must never reach — loopback,
 * link-local, and cloud-metadata targets. RFC1918 stays allowed: pointing
 * an endpoint at a LAN self-host API is a legitimate use of the opt-in.
 * This blocks literals only; DNS names resolving to these ranges are a
 * residual risk — public deployments should also constrain egress.
 */
function isBlockedOverrideHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") {
    return true;
  }
  if (h === "::1" || h.startsWith("fe80:") || h === "fd00:ec2::254") {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 127) return true; // this-net + loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
  }
  return false;
}
