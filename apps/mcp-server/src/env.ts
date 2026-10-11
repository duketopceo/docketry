import { readEnv, readHeader } from "@tallyline/types";

export interface McpConfig {
  apiUrl: string;
  token: string;
  workspace: string;
}

export class MissingEnvError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `missing required env var(s): ${missing.join(", ")}\n` +
        "  TALLYLINE_TOKEN     — a tly_agt_* agent key (or tly_pat_* token)\n" +
        "  TALLYLINE_WORKSPACE — workspace slug, e.g. 'acme'\n" +
        "  TALLYLINE_API_URL   — optional, default http://localhost:4000",
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
  const token = readEnv(env, "TALLYLINE_TOKEN")?.trim();
  const workspace = readEnv(env, "TALLYLINE_WORKSPACE")?.trim();
  if (!token) missing.push("TALLYLINE_TOKEN");
  if (!workspace) missing.push("TALLYLINE_WORKSPACE");
  if (missing.length > 0) throw new MissingEnvError(missing);
  return {
    apiUrl: stripSlash(readEnv(env, "TALLYLINE_API_URL") ?? "http://localhost:4000"),
    token: token!,
    workspace: workspace!,
  };
}

/**
 * How an --http endpoint resolves credentials. `env` = all requests share the
 * TALLYLINE_TOKEN/TALLYLINE_WORKSPACE env pair (single-tenant self-host).
 * `passthrough` = each request supplies its own via headers — the shape a
 * hosted multi-tenant endpoint (Klavis Strata externalServers, gateways)
 * needs. One var set without the other is an ambiguous deployment → throw.
 */
export type HttpAuthMode =
  | { mode: "env"; config: McpConfig }
  | { mode: "passthrough"; apiUrl: string; allowApiUrlOverride: boolean };

export function httpAuthMode(env: NodeJS.ProcessEnv): HttpAuthMode {
  const token = readEnv(env, "TALLYLINE_TOKEN")?.trim();
  const workspace = readEnv(env, "TALLYLINE_WORKSPACE")?.trim();
  if (token && workspace) {
    return { mode: "env", config: loadConfig(env) };
  }
  if (token || workspace) {
    throw new MissingEnvError([token ? "TALLYLINE_WORKSPACE" : "TALLYLINE_TOKEN"]);
  }
  return {
    mode: "passthrough",
    apiUrl: stripSlash(readEnv(env, "TALLYLINE_API_URL") ?? "http://localhost:4000"),
    allowApiUrlOverride: readEnv(env, "TALLYLINE_ALLOW_API_URL_OVERRIDE") === "1",
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
 * `authorization` carries the tallyline credential (tly_agt_*, tly_pat_*, or a
 * session JWT); `x-tallyline-workspace` carries the slug. `x-tallyline-api-url`
 * is honored only when the deployment opted in via
 * TALLYLINE_ALLOW_API_URL_OVERRIDE=1 — forwarding caller-chosen URLs server-side
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
      "missing Authorization: Bearer <tly_agt_*> header",
    );
  }
  const workspace = first(readHeader(headers, "x-tallyline-workspace"))?.trim();
  if (!workspace || !WORKSPACE_RE.test(workspace)) {
    throw new PassthroughAuthError(
      "missing or invalid x-tallyline-workspace header",
    );
  }
  let apiUrl = base.apiUrl;
  const override = first(readHeader(headers, "x-tallyline-api-url"))?.trim();
  if (override) {
    if (!base.allowApiUrlOverride) {
      throw new PassthroughAuthError(
        "x-tallyline-api-url not accepted by this endpoint",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new PassthroughAuthError("x-tallyline-api-url must be http(s)");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PassthroughAuthError("x-tallyline-api-url must be http(s)");
    }
    if (isBlockedOverrideHost(parsed.hostname)) {
      throw new PassthroughAuthError(
        "x-tallyline-api-url host is not permitted",
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
