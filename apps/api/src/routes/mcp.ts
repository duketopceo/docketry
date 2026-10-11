import { Hono, type Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  TallylineClient,
  createMcpServer,
  toolsByName,
} from "@tallyline/mcp-server/lib";
import { config_ } from "../env.js";
import { createRateLimiter } from "../lib/rate-limit.js";
import {
  INTERNAL_HEADER,
  accessFromToken,
  internalHeaderValue,
  isOAuthAccessToken,
  type OAuthAccess,
} from "../services/mcp-oauth.js";
import { PRM_URL } from "./mcp-oauth.js";

// Remote MCP endpoint (PLAN-010): Streamable HTTP, stateless, JSON responses.
// The tool surface is the one in apps/mcp-server (createMcpServer) — nothing
// is re-declared here. Each tool call is dispatched back into the API
// in-process with the caller's OAuth token, so the API's auth, scope,
// tenancy and state-machine rules stay the single source of truth.

type InternalFetch = (req: Request) => Response | Promise<Response>;
let internalFetch: InternalFetch | null = null;

/** index.ts wires the assembled app in (avoids a module cycle). */
export function setMcpInternalFetch(fn: InternalFetch): void {
  internalFetch = fn;
}

const MAX_BODY_BYTES = 1_000_000;

function challenge(parts: Record<string, string>): string {
  const rendered = Object.entries(parts)
    .map(([k, v]) => `${k}="${v.replace(/["\\]/g, "")}"`)
    .join(", ");
  return `Bearer ${rendered}`;
}

function unauthorized(c: Context, error?: { code: string; description: string }) {
  c.header(
    "WWW-Authenticate",
    challenge({
      ...(error ? { error: error.code, error_description: error.description } : {}),
      resource_metadata: PRM_URL,
      scope: "read write",
    }),
  );
  return c.json(
    {
      error: error?.code ?? "unauthorized",
      error_description: error?.description ?? "authorization required",
    },
    401,
  );
}

function rpcError(c: Context, status: 400 | 403 | 405 | 413 | 500, code: number, message: string) {
  return c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);
}

function originAllowed(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true; // non-browser clients send none
  const o = origin.replace(/\/+$/, "");
  return o === config_.webUrl || config_.mcpAllowedOrigins.includes(o);
}

const limiter = createRateLimiter(config_.rateLimitPerMin, { prefix: "mcp" });

/** Tool names a JSON-RPC body would invoke that mutate state. */
function mutatingCalls(payload: unknown): string[] {
  const messages = Array.isArray(payload) ? payload : [payload];
  const out: string[] = [];
  for (const m of messages) {
    const msg = m as { method?: unknown; params?: { name?: unknown } } | null;
    if (msg?.method === "tools/call" && typeof msg.params?.name === "string") {
      const def = toolsByName.get(msg.params.name);
      if (def && !def.readOnly) out.push(def.name);
    }
  }
  return out;
}

export const mcpRoutes = new Hono()
  .post(
    "/mcp",
    async (c, next) => {
      if (!originAllowed(c)) {
        return rpcError(c, 403, -32000, "Origin not allowed");
      }
      const auth = c.req.header("authorization") ?? "";
      const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (!token) return unauthorized(c);
      if (!isOAuthAccessToken(token)) {
        // only tokens minted by this server's authorization server are
        // accepted — no passthrough of foreign tokens (MCP security BCP)
        return unauthorized(c, { code: "invalid_token", description: "token was not issued for this resource" });
      }
      const access = await accessFromToken(token);
      if (!access) {
        return unauthorized(c, { code: "invalid_token", description: "token is invalid, expired or revoked" });
      }
      c.set("agentAuth", {
        agentId: access.agentId,
        agentName: access.agentName,
        workspaceId: access.workspaceId,
        keyId: access.tokenId,
        scopes: access.scopes,
      });
      c.set("session", null);
      c.set("tokenScopes", access.scopes);
      c.set("mcpAccess" as never, { access, token } as never);
      return limiter(c, next);
    },
    async (c) => {
      const { access, token } = c.get("mcpAccess" as never) as unknown as {
        access: OAuthAccess;
        token: string;
      };
      if (!internalFetch) return rpcError(c, 500, -32603, "MCP endpoint not initialised");

      const raw = await c.req.text();
      if (raw.length > MAX_BODY_BYTES) return rpcError(c, 413, -32600, "request too large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return rpcError(c, 400, -32700, "Parse error");
      }

      // step-up: a read-only grant calling a mutating tool gets the spec's
      // insufficient_scope challenge (RFC 6750 §3.1) so the client can
      // re-authorize for `write`
      const mutating = mutatingCalls(parsed);
      if (mutating.length > 0 && !access.scopes.includes("write")) {
        c.header(
          "WWW-Authenticate",
          challenge({
            error: "insufficient_scope",
            scope: "write",
            resource_metadata: PRM_URL,
            error_description: `tool '${mutating[0]}' requires the write scope`,
          }),
        );
        return rpcError(c, 403, -32000, "insufficient_scope: write scope required");
      }

      const dispatch = internalFetch;
      const client = new TallylineClient({
        apiUrl: "http://mcp.internal",
        token,
        workspace: access.workspaceSlug,
        fetchImpl: ((url: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          headers.set(INTERNAL_HEADER, internalHeaderValue);
          return Promise.resolve(dispatch(new Request(url, { ...init, headers })));
        }) as typeof fetch,
      });

      const server = createMcpServer(client);
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      await server.connect(
        transport as unknown as Parameters<typeof server.connect>[0],
      );
      // forgive clients that omit one of the Accept types the SDK insists on
      const headers = new Headers(c.req.raw.headers);
      headers.set("accept", "application/json, text/event-stream");
      headers.set("content-type", "application/json");
      const req = new Request(c.req.url, { method: "POST", headers, body: raw });
      try {
        return await transport.handleRequest(req, { parsedBody: parsed });
      } finally {
        void transport.close();
        void server.close();
      }
    },
  )
  // stateless server: no standalone SSE stream and no sessions to terminate
  .get("/mcp", (c) => {
    c.header("Allow", "POST");
    return rpcError(c, 405, -32000, "Method not allowed: this MCP endpoint is stateless, use POST");
  })
  .delete("/mcp", (c) => {
    c.header("Allow", "POST");
    return rpcError(c, 405, -32000, "Method not allowed: this MCP endpoint is stateless, use POST");
  });
