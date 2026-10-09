import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type EnvLike = Record<string, string | undefined>;

export interface CliConfig {
  apiUrl: string;
  token?: string;
  workspace?: string;
  agentId?: string;
  userId?: string;
}

interface FileConfig {
  apiUrl?: string;
  token?: string;
  workspace?: string;
  agentId?: string;
  userId?: string;
}

export interface ResolvedConfig {
  config: CliConfig;
  // config files that were actually read — useful for `init` and debugging
  files: string[];
}

const DEFAULT_API_URL = "http://localhost:4000";

function isFileConfig(value: unknown): value is FileConfig {
  return typeof value === "object" && value !== null;
}

async function readConfigFile(path: string): Promise<FileConfig | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isFileConfig(parsed)) return null;
    return parsed;
  } catch {
    return null; // missing file or malformed JSON — treat as absent
  }
}

// Precedence (low -> high):
//   ~/.config/docketry/config.json  <  ./.docketry/config.json  <
//   ./.docketry.json  <  env (DOCKETRY_*)  <  flags
export async function resolveConfig(opts: {
  env: EnvLike;
  cwd: string;
  flags?: { apiUrl?: string; token?: string; workspace?: string };
}): Promise<ResolvedConfig> {
  const home = opts.env.HOME ?? homedir();
  const candidates = [
    join(home, ".config", "docketry", "config.json"),
    join(opts.cwd, ".docketry", "config.json"),
    join(opts.cwd, ".docketry.json"),
  ];

  const merged: FileConfig = {};
  const files: string[] = [];
  for (const path of candidates) {
    const cfg = await readConfigFile(path);
    if (!cfg) continue;
    files.push(path);
    for (const k of [
      "apiUrl",
      "token",
      "workspace",
      "agentId",
      "userId",
    ] as const) {
      if (typeof cfg[k] === "string" && cfg[k]) merged[k] = cfg[k];
    }
  }

  const env = opts.env;
  const config: CliConfig = {
    apiUrl: merged.apiUrl ?? DEFAULT_API_URL,
    ...(merged.token !== undefined ? { token: merged.token } : {}),
    ...(merged.workspace !== undefined
      ? { workspace: merged.workspace }
      : {}),
    ...(merged.agentId !== undefined ? { agentId: merged.agentId } : {}),
    ...(merged.userId !== undefined ? { userId: merged.userId } : {}),
  };

  if (env.DOCKETRY_API_URL) config.apiUrl = env.DOCKETRY_API_URL;
  if (env.DOCKETRY_TOKEN) config.token = env.DOCKETRY_TOKEN;
  if (env.DOCKETRY_WORKSPACE) config.workspace = env.DOCKETRY_WORKSPACE;
  if (env.DOCKETRY_AGENT_ID) config.agentId = env.DOCKETRY_AGENT_ID;
  if (env.DOCKETRY_USER_ID) config.userId = env.DOCKETRY_USER_ID;

  if (opts.flags?.apiUrl) config.apiUrl = opts.flags.apiUrl;
  if (opts.flags?.token) config.token = opts.flags.token;
  if (opts.flags?.workspace) config.workspace = opts.flags.workspace;

  config.apiUrl = config.apiUrl.replace(/\/+$/, "");
  return { config, files };
}
