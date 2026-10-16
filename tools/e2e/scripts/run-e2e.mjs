// `pnpm test` entry point for the e2e package.
//
// - If DATABASE_URL is already set (CI service container, or a throwaway
//   stack you started yourself) it is used as-is.
// - Otherwise the dedicated `tallyline-e2e` compose project (non-default
//   ports, tmpfs data) is started and pointed at. It never touches the dev
//   stack on :5432.
// The safety guard then runs; it refuses the default dev stack regardless.
import { spawnSync } from "node:child_process";
import { assertSafeTestEnv } from "../../../apps/api/test/db-guard.ts";

const here = new URL("../", import.meta.url).pathname;
const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: "inherit", cwd: here, ...opts });

const env = { ...process.env };
let startedStack = false;
if (!env.DATABASE_URL) {
  const pg = env.E2E_PG_PORT ?? "55432";
  env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${pg}/tallyline_e2e`;
  env.E2E_PG_PORT = pg;
  startedStack = true;
}

try {
  assertSafeTestEnv(env);
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}

if (startedStack) {
  const up = sh(
    "docker",
    ["compose", "-p", "tallyline-e2e", "-f", "docker-compose.e2e.yml", "up", "-d", "--wait"],
    { env },
  );
  if (up.status !== 0) process.exit(up.status ?? 1);
}

const budget = sh("node", ["scripts/bundle-budget.mjs"], { env });
if (budget.status !== 0) process.exit(budget.status ?? 1);
const pw = sh("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], { env });
process.exit(pw.status ?? 1);
