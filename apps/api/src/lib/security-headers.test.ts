import { afterEach, describe, expect, it } from "vitest";
import { app } from "../index.js";

const prevEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = prevEnv;
});

describe("API security headers", () => {
  it("sets nosniff, framing, referrer and CSP on every response, including 401/404", async () => {
    for (const path of ["/openapi.json", "/v1/me", "/nope"]) {
      const res = await app.fetch(new Request(`http://api.test${path}`));
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(res.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-powered-by"), path).toBeNull();
    }
  });

  it("omits HSTS over plain http", async () => {
    const res = await app.fetch(new Request("http://api.test/openapi.json"));
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("sends HSTS when the request arrived over https in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await app.fetch(new Request("https://api.test/openapi.json"));
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });
});
