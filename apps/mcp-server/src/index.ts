#!/usr/bin/env node
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DocketryClient } from "./client.js";
import {
  MissingEnvError,
  PassthroughAuthError,
  configFromHeaders,
  httpAuthMode,
  loadConfig,
} from "./env.js";
import { createMcpServer } from "./server.js";
import { toolDefs } from "./tools.js";

// stdio is the default — what local MCP clients (Claude Code, Cursor,
// opencode) spawn. `--http[=PORT]` runs a stateless Streamable HTTP
// endpoint at /mcp instead, for clients that connect over the network.
function httpPort(argv: string[]): number | null {
  for (const arg of argv) {
    if (arg === "--http") return Number(process.env.MCP_HTTP_PORT ?? 3101);
    const m = /^--http=(\d+)$/.exec(arg);
    if (m) return Number(m[1]);
  }
  return null;
}

const port = httpPort(process.argv.slice(2));

if (port === null) {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof MissingEnvError) {
      process.stderr.write(`docketry-mcp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const client = new DocketryClient(config);
  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `docketry-mcp: ${toolDefs.length} tools on stdio — ${config.apiUrl} ws=${config.workspace}\n`,
  );
} else {
  let auth: ReturnType<typeof httpAuthMode>;
  try {
    auth = httpAuthMode(process.env);
  } catch (err) {
    if (err instanceof MissingEnvError) {
      process.stderr.write(`docketry-mcp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const envClient =
    auth.mode === "env" ? new DocketryClient(auth.config) : null;

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/mcp") {
      let client = envClient;
      if (!client) {
        if (auth.mode !== "passthrough") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "no credential mode configured" }));
          return;
        }
        try {
          client = new DocketryClient(configFromHeaders(req.headers, auth));
        } catch (err) {
          if (err instanceof PassthroughAuthError) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          throw err;
        }
      }
      // Stateless: no sessionIdGenerator = no session tracking — each
      // request gets a fresh server+transport and any replica can serve it.
      const transport = new StreamableHTTPServerTransport({});
      const server = createMcpServer(client);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(
        transport as unknown as Parameters<typeof server.connect>[0],
      );
      await transport.handleRequest(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "POST /mcp or GET /health" }));
  });
  http.listen(port, () => {
    const mode =
      auth.mode === "env"
        ? `env — ${auth.config.apiUrl} ws=${auth.config.workspace}`
        : `passthrough — api=${auth.apiUrl}${
            auth.allowApiUrlOverride ? " (api-url override on)" : ""
          }`;
    process.stderr.write(
      `docketry-mcp: ${toolDefs.length} tools on http://localhost:${port}/mcp — ${mode}\n`,
    );
  });
}
