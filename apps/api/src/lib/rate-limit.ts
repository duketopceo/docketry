import type { Context, Next } from "hono";
import { apiError } from "./errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimiter {
  (c: Context, next: Next): Promise<Response | void>;
  buckets: Map<string, Bucket>;
}

// Identity is set by requireSession upstream (session user / agent key / PAT /
// JWT). Falls back to client IP for unauthenticated requests so the limiter
// still throttles brute-force attempts against /v1/auth/*.
function identityKey(c: Context): string {
  const agent = c.get("agentAuth");
  if (agent) return `agent:${agent.keyId}`;
  const session = c.get("session");
  if (session) return `user:${session.userId}:${session.sessionId.slice(0, 12)}`;
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${fwd ?? "local"}`;
}

export function createRateLimiter(limitPerMin: number): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const windowMs = 60_000;

  const mw = async (c: Context, next: Next) => {
    if (limitPerMin <= 0) return next();
    const now = Date.now();
    const key = identityKey(c);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limitPerMin - bucket.count);
    c.header("X-RateLimit-Limit", String(limitPerMin));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limitPerMin) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      c.header("Retry-After", String(retry));
      return apiError(c, 429, "RATE_LIMITED", `retry in ${retry}s`);
    }
    // lazy sweep so the map can't grow without bound
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return next();
  };
  mw.buckets = buckets;
  return mw;
}
