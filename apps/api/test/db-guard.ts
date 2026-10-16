// Test-database safety guard. Every harness that touches Postgres
// (api, mcp-server, cli, e2e) calls assertSafeTestEnv() before doing anything.
//
// Why: the api falls back to the default dev stack
// (postgresql://postgres:postgres@localhost:5432/tallyline) when
// DATABASE_URL is unset, and several suites run migrations and
// wipe tables. Running tests against that stack destroys the owner's dev data.
//
// Rule: DATABASE_URL must be set explicitly and must not be the
// default dev stack, unless TALLYLINE_TEST_ALLOW_DEFAULT_DB=1 is set.

export const OVERRIDE_VAR = "TALLYLINE_TEST_ALLOW_DEFAULT_DB";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

// the docker-compose.yml dev stack
const DEFAULT_PG = { port: "5432", db: "tallyline" };

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(
      `${message}\n` +
        `Refusing to run tests against the default dev stack. Point DATABASE_URL ` +
        `at a throwaway Postgres on a non-default port ` +
        `(see CONTRIBUTING.md, "Testing against real Postgres"), or set ` +
        `${OVERRIDE_VAR}=1 if you really mean it.`,
    );
    this.name = "UnsafeTestDatabaseError";
  }
}

type Env = Record<string, string | undefined>;

function parse(name: string, raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new UnsafeTestDatabaseError(`${name} is not a valid URL.`);
  }
}

export function isDefaultDevPostgres(raw: string): boolean {
  const u = parse("DATABASE_URL", raw);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  return (
    LOCAL_HOSTS.has(u.hostname) &&
    (u.port || "5432") === DEFAULT_PG.port &&
    db === DEFAULT_PG.db
  );
}

/** Throws UnsafeTestDatabaseError unless the env points at a non-default stack. */
export function assertSafeTestEnv(env: Env = process.env): void {
  if (env[OVERRIDE_VAR] === "1") return;
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    throw new UnsafeTestDatabaseError("DATABASE_URL is not set.");
  }
  if (isDefaultDevPostgres(dbUrl)) {
    throw new UnsafeTestDatabaseError(
      "DATABASE_URL is the default dev database (localhost:5432/tallyline).",
    );
  }
}
