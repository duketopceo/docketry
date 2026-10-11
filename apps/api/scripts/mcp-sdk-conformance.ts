// Drives the official @modelcontextprotocol/sdk OAuth client (discovery via
// 401 + RFC 9728, DCR, PKCE S256, resource indicator, refresh) against a
// local API with a real HTTP listener, then lists and calls tools over
// Streamable HTTP. No external network, no paid calls.
//
//   DATABASE_URL=postgresql://…throwaway… REDIS_URL=… \
//     pnpm --filter @tallyline/api exec tsx scripts/mcp-sdk-conformance.ts
//
// Refuses to run against the default dev database port (5432).
import { createServer } from "node:net";
import { serve } from "@hono/node-server";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl || new URL(dbUrl).port === "5432" || new URL(dbUrl).port === "") {
  console.error("refusing to run: set DATABASE_URL to a throwaway database on a non-default port");
  process.exit(2);
}

const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = "test"; // importing the app must not auto-start it
process.env.API_BASE_URL = base;
process.env.WEB_URL = base;
process.env.RATE_LIMIT_ANON_PER_MIN = "0";

const { app } = await import("../src/index.js");
const { db, closeDb } = await import("../src/db/client.js");
const { runMigrations } = await import("../src/db/migrate.js");
const { teams, users, workspaceMembers, workspaces } = await import("../src/db/schema.js");
const { createSession, hashPassword } = await import("../src/services/auth.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import(
  "@modelcontextprotocol/sdk/client/streamableHttp.js"
);
const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
type Provider = import("@modelcontextprotocol/sdk/client/auth.js").OAuthClientProvider;

await runMigrations();
const slug = `conf-${Date.now().toString(36)}`;
const [ws] = await db.insert(workspaces).values({ slug, name: "Conformance" }).returning();
await db.insert(teams).values({ workspaceId: ws!.id, key: "CNF", name: "Conf" });
const [user] = await db
  .insert(users)
  .values({ email: `${slug}@conf.test`, name: "Conf User", passwordHash: hashPassword("password-1234") })
  .returning();
await db.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: user!.id, role: "owner" });
const cookie = `dok_session=${await createSession(user!.id, ws!.id)}`;

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });

const checks: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// in-memory OAuthClientProvider; the "browser" step is performed below
let authUrl: URL | null = null;
let clientInfo: Awaited<ReturnType<NonNullable<Provider["clientInformation"]>>>;
let tokens: Awaited<ReturnType<Provider["tokens"]>>;
let verifier = "";
const provider: Provider = {
  get redirectUrl() {
    return "http://127.0.0.1:9/callback";
  },
  get clientMetadata() {
    return {
      client_name: "SDK conformance client",
      redirect_uris: ["http://127.0.0.1:9/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  },
  clientInformation: () => clientInfo,
  saveClientInformation: (i) => {
    clientInfo = i;
  },
  tokens: () => tokens,
  saveTokens: (t) => {
    tokens = t;
  },
  redirectToAuthorization: (u) => {
    authUrl = u;
  },
  saveCodeVerifier: (v) => {
    verifier = v;
  },
  codeVerifier: () => verifier,
};

try {
  const url = new URL(`${base}/mcp`);
  const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const client1 = new Client({ name: "conformance", version: "0" }, { capabilities: {} });
  let unauthorized = false;
  try {
    await client1.connect(first);
  } catch (err) {
    unauthorized = err instanceof UnauthorizedError;
  }
  check("unauthenticated connect triggers OAuth discovery (401 + resource_metadata)", unauthorized && !!authUrl);
  check("SDK registered a client via DCR", !!clientInfo?.client_id, clientInfo?.client_id);
  const au = authUrl as URL | null;
  check("authorization URL carries PKCE S256", au?.searchParams.get("code_challenge_method") === "S256");
  check("authorization URL carries resource = MCP URL", au?.searchParams.get("resource") === `${base}/mcp`, au?.searchParams.get("resource") ?? "");

  // the browser: /oauth/authorize -> consent page -> approve
  const hop = await fetch(au!, { redirect: "manual" });
  const consent = new URL(hop.headers.get("location")!);
  const requestId = consent.searchParams.get("request")!;
  check("authorize redirects to the web consent page", consent.pathname === "/oauth/consent" && !!requestId);
  const view = (await (await fetch(`${base}/v1/oauth/consent/${requestId}`, { headers: { cookie } })).json()) as { csrf: string };
  const decision = await fetch(`${base}/v1/oauth/consent/${requestId}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ approve: true, workspace: slug, scopes: ["read", "write"], csrf: view.csrf }),
  });
  const { redirectTo } = (await decision.json()) as { redirectTo: string };
  const cb = new URL(redirectTo);
  check("consent returns code + state + iss on the registered redirect", !!cb.searchParams.get("code") && cb.searchParams.get("iss") === base);

  await first.finishAuth(cb.searchParams.get("code")!);
  check("SDK exchanged the code (PKCE verifier + resource) for tokens", !!tokens?.access_token && !!tokens?.refresh_token);

  const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const client = new Client({ name: "conformance", version: "0" }, { capabilities: {} });
  await client.connect(transport);
  check("initialize over Streamable HTTP with the token", client.getServerVersion()?.name === "tallyline");
  const list = await client.listTools();
  check("tools/list returns the shared tool surface", list.tools.length >= 16, `${list.tools.length} tools`);
  const who = await client.callTool({ name: "whoami", arguments: {} });
  const identity = JSON.parse((who.content as Array<{ text: string }>)[0]!.text) as { type: string; workspaceSlug: string };
  check("tools/call whoami resolves the connector agent in the granted workspace", identity.type === "agent" && identity.workspaceSlug === slug);
  const created = await client.callTool({ name: "create_issue", arguments: { title: "created by SDK conformance run" } });
  check("tools/call create_issue (write scope) succeeds", !created.isError);
  await client.close();
} catch (err) {
  check("conformance run completed without an exception", false, err instanceof Error ? err.message : String(err));
} finally {
  server.close();
  await closeDb();
}

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
