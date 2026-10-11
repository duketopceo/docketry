import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { config_ } from "../env.js";
import { authLimiter, createRateLimiter } from "../lib/rate-limit.js";
import {
  ISSUER,
  OAuthError,
  RESOURCE,
  SUPPORTED_SCOPES,
  assertChallenge,
  clientRedirect,
  createAuthRequest,
  exchangeCode,
  parseScopes,
  redirectUriAllowed,
  refreshTokens,
  registerClient,
  resolveClient,
  resourceMatches,
  revokePresentedToken,
} from "../services/mcp-oauth.js";

// Public OAuth 2.1 authorization-server surface for the remote MCP endpoint:
// discovery documents, /oauth/authorize (validates, then hands the browser to
// the web consent page), /oauth/token, /oauth/register (RFC 7591) and
// /oauth/revoke (RFC 7009). The consent decision itself lives in
// mcp-oauth-admin.ts (cookie-session API behind /v1).

export const PRM_PATH = `/.well-known/oauth-protected-resource${new URL(RESOURCE).pathname.replace(/\/+$/, "")}`;
export const PRM_URL = `${ISSUER}${PRM_PATH}`;

function noStore(c: Context) {
  c.header("cache-control", "no-store");
  c.header("pragma", "no-cache");
}

function oauthJsonError(c: Context, err: OAuthError) {
  noStore(c);
  return c.json(
    { error: err.error, error_description: err.description },
    err.status,
  );
}

function protectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Tallyline",
    resource_documentation: "https://tallyline.app/docs/mcp",
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://tallyline.app/docs/mcp",
  };
}

async function formOrJson(c: Context): Promise<Record<string, string | undefined>> {
  const type = c.req.header("content-type") ?? "";
  const out: Record<string, string | undefined> = {};
  if (type.includes("application/json")) {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return out;
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function clientIdFrom(c: Context, body: Record<string, string | undefined>): string {
  if (body.client_id) return body.client_id;
  const basic = c.req.header("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
      return decoded.split(":")[0] ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export interface OAuthRouteOptions {
  /** per-IP limiter on the credential-handling endpoints (default: the #93 auth limiter) */
  limiter?: MiddlewareHandler;
  /** token endpoint limiter — Claude/ChatGPT call it from shared egress IPs, so the ceiling is the general per-identity one */
  tokenLimiter?: MiddlewareHandler;
  /** stricter limiter for open client registration */
  registerLimiter?: MiddlewareHandler;
}

export function buildMcpOAuthRoutes(opts: OAuthRouteOptions = {}) {
  const limiter: MiddlewareHandler = opts.limiter ?? authLimiter;
  const tokenLimiter: MiddlewareHandler =
    opts.tokenLimiter ??
    createRateLimiter(config_.rateLimitPerMin, { prefix: "oauth-token" });
  const registerLimiter: MiddlewareHandler =
    opts.registerLimiter ??
    createRateLimiter(Math.max(0, Math.floor(config_.rateLimitAuthPerMin / 3)), {
      prefix: "oauth-register",
    });
  const open = cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 600 });

  return new Hono()
    .use("/.well-known/*", open)
    .use("/oauth/token", open)
    .use("/oauth/register", open)
    .use("/oauth/revoke", open)
    .get("/.well-known/oauth-protected-resource", (c) => {
      c.header("cache-control", "public, max-age=300");
      return c.json(protectedResourceMetadata());
    })
    .get(PRM_PATH, (c) => {
      c.header("cache-control", "public, max-age=300");
      return c.json(protectedResourceMetadata());
    })
    .get("/.well-known/oauth-authorization-server", (c) => {
      c.header("cache-control", "public, max-age=300");
      return c.json(authorizationServerMetadata());
    })
    .get("/oauth/authorize", limiter, async (c) => {
      const q = c.req.query();
      noStore(c);
      // 1. nothing below may redirect to a URI we have not validated, so
      //    client + redirect_uri problems are reported to the user directly
      let client;
      try {
        client = await resolveClient(q.client_id ?? "");
      } catch (err) {
        if (err instanceof OAuthError) {
          return c.json(
            { error: "invalid_client", error_description: err.description },
            400,
          );
        }
        throw err;
      }
      let redirectUri = q.redirect_uri;
      if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
      if (!redirectUri || !redirectUriAllowed(client.redirectUris, redirectUri)) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "redirect_uri is missing or not registered for this client",
          },
          400,
        );
      }
      // 2. from here errors go back to the (now trusted) redirect URI
      const fail = (error: string, description: string) =>
        c.redirect(
          clientRedirect(redirectUri!, {
            error,
            error_description: description,
            state: q.state,
          }),
          302,
        );
      if (q.response_type !== "code") {
        return fail("unsupported_response_type", "response_type must be code");
      }
      try {
        assertChallenge(q.code_challenge, q.code_challenge_method);
      } catch (err) {
        if (err instanceof OAuthError) return fail(err.error, err.description);
        throw err;
      }
      if (q.resource !== undefined && !resourceMatches(q.resource)) {
        return fail("invalid_target", `resource must be ${RESOURCE}`);
      }
      let scopes;
      try {
        scopes = parseScopes(q.scope);
      } catch (err) {
        if (err instanceof OAuthError) return fail(err.error, err.description);
        throw err;
      }
      const id = await createAuthRequest({
        clientId: client.clientId,
        redirectUri,
        scopes,
        state: q.state?.slice(0, 2048),
        codeChallenge: q.code_challenge!,
        resource: RESOURCE,
      });
      return c.redirect(
        `${config_.webUrl}/oauth/consent?request=${encodeURIComponent(id)}`,
        302,
      );
    })
    .post("/oauth/token", tokenLimiter, async (c) => {
      const body = await formOrJson(c);
      try {
        const clientId = clientIdFrom(c, body);
        if (!clientId) throw new OAuthError("invalid_client", "client_id is required", 401);
        // the client must still resolve (registered, or fetchable CIMD)
        await resolveClient(clientId);
        let tokens;
        if (body.grant_type === "authorization_code") {
          tokens = await exchangeCode({
            code: body.code ?? "",
            clientId,
            redirectUri: body.redirect_uri,
            verifier: body.code_verifier,
            resource: body.resource,
          });
        } else if (body.grant_type === "refresh_token") {
          tokens = await refreshTokens({
            refreshToken: body.refresh_token ?? "",
            clientId,
            scope: body.scope,
            resource: body.resource,
          });
        } else {
          throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
        }
        noStore(c);
        return c.json(tokens);
      } catch (err) {
        if (err instanceof OAuthError) return oauthJsonError(c, err);
        throw err;
      }
    })
    .post("/oauth/register", registerLimiter, async (c) => {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      noStore(c);
      if (!body || typeof body !== "object") {
        return c.json(
          { error: "invalid_client_metadata", error_description: "JSON body required" },
          400,
        );
      }
      try {
        return c.json(await registerClient(body), 201);
      } catch (err) {
        if (err instanceof OAuthError) return oauthJsonError(c, err);
        throw err;
      }
    })
    .post("/oauth/revoke", limiter, async (c) => {
      const body = await formOrJson(c);
      noStore(c);
      if (body.token) {
        await revokePresentedToken(body.token, clientIdFrom(c, body) || undefined);
      }
      // RFC 7009: success whether or not the token was known
      return c.body(null, 200);
    });
}
