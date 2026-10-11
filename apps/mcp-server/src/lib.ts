// Library entry for hosts that embed the Tallyline MCP tool surface in
// another process (the API serves /mcp this way). The stdio/HTTP CLI entry is
// index.ts; both build their server from the same createMcpServer so the tool
// definitions live in exactly one place (tools.ts).
export { TallylineClient, ApiError } from "./client.js";
export type { TallylineClientConfig, Whoami } from "./client.js";
export { SERVER_INFO, createMcpServer } from "./server.js";
export { toolDefs, toolsByName } from "./tools.js";
export type { ToolDef } from "./tools.js";
