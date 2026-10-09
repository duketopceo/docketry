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
    apiUrl: (env.DOCKETRY_API_URL ?? "http://localhost:4000").replace(
      /\/+$/,
      "",
    ),
    token: token!,
    workspace: workspace!,
  };
}
