import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocketryClient } from "./client.js";
import { executeTool, toolDefs } from "./tools.js";

export const SERVER_INFO = { name: "docketry", version: "0.0.0" } as const;

/**
 * Build an McpServer with the full docketry tool surface registered against
 * `client`. Transport-agnostic — index.ts connects stdio or HTTP.
 */
export function createMcpServer(client: DocketryClient): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const def of toolDefs) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.readOnly ? { readOnlyHint: true } : {},
      },
      (args) => executeTool(def, args, client),
    );
  }
  return server;
}
