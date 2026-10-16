import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { requireSession } from "../routes/auth.js";
import {
  clientIp,
  createAnonymousLimiter,
  createRateLimiter,
  MemoryRateStore,
  type Bucket,
  type RateStore,
} from "./rate-limit.js";

const ipApp = new Hono().get("/ip", (c) => c.text(clientIp(c)));
const ipOf = async (headers: Record<string, string>) =>
  (await ipApp.fetch(new Request("http://t/ip", { headers }))).text();

describe("clientIp (TRUSTED_PROXY=1)", () => {
  it("prefers CF-Connecting-IP over X-Forwarded-For", async () => {
    expect(
      await ipOf({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }),
    ).toBe("203.0.113.7");
  });
  it("falls back to the last X-Forwarded-For hop (the one our proxy appended)", async () => {
    expect(await ipOf({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" })).toBe("198.51.100.9");
  });
  it("ignores malformed values", async () => {
    expect(await ipOf({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "junk" })).toBe(
      "local",
    );
    expect(await ipOf({})).toBe("local");
  });
  it("ignores forwarding headers entirely when no proxy is trusted", async () => {
    vi.resetModules();
    vi.doMock("../env.js", () => ({ config_: { trustedProxy: false, rateLimitAuthPerMin: 0 } }));
    const m = await import("./rate-limit.js");
    const app = new Hono().get("/ip", (c) => c.text(m.clientIp(c)));
    const res = await app.fetch(
      new Request("http://t/ip", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
    );
    expect(await res.text()).toBe("local");
    vi.doUnmock("../env.js");
    vi.resetModules();
  });
});

describe("createRateLimiter", () => {
  it("accepts a pluggable store", async () => {
    const calls: string[] = [];
    const inner = new MemoryRateStore();
    const store: RateStore = {
      hit: (k, w, n) => (calls.push(k), inner.hit(k, w, n)),
      peek: (k, n) => inner.peek(k, n),
    };
    const app = new Hono().use("*", createRateLimiter(1, { store, prefix: "t" })).get("/", (c) => c.text("ok"));
    const headers = { "cf-connecting-ip": "203.0.113.50" };
    expect((await app.fetch(new Request("http://t/", { headers }))).status).toBe(200);
    expect((await app.fetch(new Request("http://t/", { headers }))).status).toBe(429);
    expect(calls).toEqual(["t:ip:203.0.113.50", "t:ip:203.0.113.50"]);
  });

  it("separates clients by real IP", async () => {
    const app = new Hono().use("*", createRateLimiter(1)).get("/", (c) => c.text("ok"));
    const a = { "cf-connecting-ip": "203.0.113.1" };
    const b = { "cf-connecting-ip": "203.0.113.2" };
    expect((await app.fetch(new Request("http://t/", { headers: a }))).status).toBe(200);
    expect((await app.fetch(new Request("http://t/", { headers: b }))).status).toBe(200);
    expect((await app.fetch(new Request("http://t/", { headers: a }))).status).toBe(429);
  });
});

describe("anonymous limiter", () => {
  const build = (limit: number) => {
    const bucketRef: { store?: MemoryRateStore } = {};
    const limiter = createAnonymousLimiter(limit, "tly_session", {
      skip: (p) => p === "/health",
    });
    bucketRef.store = limiter.store as MemoryRateStore;
    // same order as index.ts: anonymous limiter, then requireSession
    const app = new Hono()
      .use("*", limiter)
      .get("/health", (c) => c.text("ok"))
      .use("/v1/*", requireSession)
      .get("/v1/x", (c) => c.text("ok"));
    return { app, limiter };
  };
  const ip = { "cf-connecting-ip": "203.0.113.99" };

  it("counts unauthenticated requests that requireSession would reject, then 429s", async () => {
    const { app } = build(3);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await app.fetch(new Request("http://t/v1/x", { headers: ip }))).status);
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const last = await app.fetch(new Request("http://t/v1/x", { headers: ip }));
    expect(last.headers.get("retry-after")).toBeTruthy();
    expect(last.headers.get("x-ratelimit-limit")).toBe("3");
  });

  it("counts failed credentials (401) but not the request that merely carries one", async () => {
    const { app, limiter } = build(2);
    const bad = { ...ip, authorization: "Bearer tly_agt_not-a-real-key" };
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await app.fetch(new Request("http://t/v1/x", { headers: bad }))).status);
    }
    // two failures consume the budget; the third is refused before auth runs
    expect(codes.slice(0, 2)).toEqual([401, 401]);
    expect(codes.slice(2)).toEqual([401, 429]);
    expect((limiter.store as MemoryRateStore).buckets.size).toBe(1);
  });

  it("limits each client IP independently and exempts skipped paths", async () => {
    const { app } = build(1);
    const other = { "cf-connecting-ip": "203.0.113.100" };
    expect((await app.fetch(new Request("http://t/v1/x", { headers: ip }))).status).toBe(401);
    expect((await app.fetch(new Request("http://t/v1/x", { headers: ip }))).status).toBe(429);
    expect((await app.fetch(new Request("http://t/v1/x", { headers: other }))).status).toBe(401);
    for (let i = 0; i < 5; i++) {
      expect((await app.fetch(new Request("http://t/health", { headers: ip }))).status).toBe(200);
    }
  });

  it("is disabled at 0", async () => {
    const { app } = build(0);
    for (let i = 0; i < 5; i++) {
      expect((await app.fetch(new Request("http://t/v1/x", { headers: ip }))).status).toBe(401);
    }
  });
});

describe("MemoryRateStore", () => {
  it("opens a fresh window after expiry and peek does not count", async () => {
    const s = new MemoryRateStore();
    const b: Bucket = await s.hit("k", 1000, 0);
    expect(b.count).toBe(1);
    expect((await s.peek("k", 500))?.count).toBe(1);
    expect((await s.hit("k", 1000, 500)).count).toBe(2);
    expect(await s.peek("k", 1001)).toBeUndefined();
    expect((await s.hit("k", 1000, 1001)).count).toBe(1);
  });
});
