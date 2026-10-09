import { Redis } from "ioredis";
import pg from "pg";

export interface HealthReport {
  status: "ok" | "degraded";
  postgres: boolean;
  redis: boolean;
  uptimeSeconds: number;
}

export async function checkHealth(
  databaseUrl: string,
  redisUrl: string,
): Promise<HealthReport> {
  const [postgres, redis] = await Promise.all([
    pingPostgres(databaseUrl),
    pingRedis(redisUrl),
  ]);
  return {
    status: postgres && redis ? "ok" : "degraded",
    postgres,
    redis,
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

async function pingRedis(redisUrl: string): Promise<boolean> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    return (await client.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}
