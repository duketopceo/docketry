import pg from "pg";

export interface HealthReport {
  status: "ok" | "degraded";
  postgres: boolean;
  uptimeSeconds: number;
}

export async function checkHealth(
  databaseUrl: string,
): Promise<HealthReport> {
  const postgres = await pingPostgres(databaseUrl);
  return {
    status: postgres ? "ok" : "degraded",
    postgres,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

async function pingPostgres(databaseUrl: string): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
