import { config } from "dotenv";

config({ path: new URL("../../../.env", import.meta.url) });

const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

export const config_ = {
  port: Number(env("API_PORT", "4000")),
  databaseUrl: env(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/docketry",
  ),
  redisUrl: env("REDIS_URL", "redis://localhost:6380"),
} as const;
