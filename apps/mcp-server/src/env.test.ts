import { describe, expect, it } from "vitest";
import {
  MissingEnvError,
  PassthroughAuthError,
  configFromHeaders,
  httpAuthMode,
  loadConfig,
} from "./env.js";

describe("loadConfig", () => {
  it("builds config and strips trailing slashes", () => {
    const cfg = loadConfig({
      TALLYLINE_TOKEN: "tly_agt_x",
      TALLYLINE_WORKSPACE: "acme",
      TALLYLINE_API_URL: "https://api.example.com/",
    });
    expect(cfg).toEqual({
      apiUrl: "https://api.example.com",
      token: "tly_agt_x",
      workspace: "acme",
    });
  });

  it("throws MissingEnvError listing every absent required var", () => {
    expect(() => loadConfig({})).toThrowError(MissingEnvError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as MissingEnvError).missing).toEqual([
        "TALLYLINE_TOKEN",
        "TALLYLINE_WORKSPACE",
      ]);
    }
  });
});

describe("httpAuthMode", () => {
  it("returns env mode when both vars are set", () => {
    const mode = httpAuthMode({
      TALLYLINE_TOKEN: "tly_agt_x",
      TALLYLINE_WORKSPACE: "acme",
    });
    expect(mode.mode).toBe("env");
  });

  it("returns passthrough with default apiUrl when neither is set", () => {
    const mode = httpAuthMode({});
    expect(mode).toEqual({
      mode: "passthrough",
      apiUrl: "http://localhost:4000",
      allowApiUrlOverride: false,
    });
  });

  it("rejects a half-configured deployment", () => {
    expect(() => httpAuthMode({ TALLYLINE_TOKEN: "tly_agt_x" })).toThrowError(
      MissingEnvError,
    );
    expect(() => httpAuthMode({ TALLYLINE_WORKSPACE: "acme" })).toThrowError(
      MissingEnvError,
    );
  });

  it("enables the api-url override only on explicit opt-in", () => {
    const on = httpAuthMode({ TALLYLINE_ALLOW_API_URL_OVERRIDE: "1" });
    expect(on.mode === "passthrough" && on.allowApiUrlOverride).toBe(true);
    const off = httpAuthMode({ TALLYLINE_ALLOW_API_URL_OVERRIDE: "true" });
    expect(off.mode === "passthrough" && off.allowApiUrlOverride).toBe(false);
  });
});

describe("configFromHeaders", () => {
  const base = { apiUrl: "http://api:4000", allowApiUrlOverride: false };

  it("builds config from bearer + workspace headers", () => {
    const cfg = configFromHeaders(
      {
        authorization: "Bearer tly_agt_abc",
        "x-tallyline-workspace": "acme",
      },
      base,
    );
    expect(cfg).toEqual({
      apiUrl: "http://api:4000",
      token: "tly_agt_abc",
      workspace: "acme",
    });
  });

  it("accepts a raw token without the Bearer prefix", () => {
    const cfg = configFromHeaders(
      {
        authorization: "tly_pat_xyz",
        "x-tallyline-workspace": "acme",
      },
      base,
    );
    expect(cfg.token).toBe("tly_pat_xyz");
  });

  it("rejects missing/invalid credentials with 401-style errors", () => {
    expect(() => configFromHeaders({}, base)).toThrowError(PassthroughAuthError);
    expect(() =>
      configFromHeaders(
        { authorization: "Bearer tly_agt_abc" },
        base,
      ),
    ).toThrowError(PassthroughAuthError);
    expect(() =>
      configFromHeaders(
        {
          authorization: "Bearer tly_agt_abc",
          "x-tallyline-workspace": "bad slug!",
        },
        base,
      ),
    ).toThrowError(PassthroughAuthError);
  });

  it("rejects x-tallyline-api-url unless the deployment opted in", () => {
    const headers = {
      authorization: "Bearer tly_agt_abc",
      "x-tallyline-workspace": "acme",
      "x-tallyline-api-url": "https://other.example.com/",
    };
    expect(() => configFromHeaders(headers, base)).toThrowError(
      PassthroughAuthError,
    );
    const cfg = configFromHeaders(headers, {
      apiUrl: "http://api:4000",
      allowApiUrlOverride: true,
    });
    expect(cfg.apiUrl).toBe("https://other.example.com");
  });

  it("rejects non-http override URLs even when opted in", () => {
    expect(() =>
      configFromHeaders(
        {
          authorization: "Bearer tly_agt_abc",
          "x-tallyline-workspace": "acme",
          "x-tallyline-api-url": "file:///etc/passwd",
        },
        { apiUrl: "http://api:4000", allowApiUrlOverride: true },
      ),
    ).toThrowError(PassthroughAuthError);
  });

  it("blocks loopback/link-local/metadata literal hosts, allows LAN", () => {
    const optIn = { apiUrl: "http://api:4000", allowApiUrlOverride: true };
    const headers = (url: string) => ({
      authorization: "Bearer tly_agt_abc",
      "x-tallyline-workspace": "acme",
      "x-tallyline-api-url": url,
    });
    for (const bad of [
      "http://127.0.0.1:4000",
      "http://localhost:4000",
      "http://x.localhost:4000",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]:4000",
      "http://0.0.0.0:4000",
    ]) {
      expect(() => configFromHeaders(headers(bad), optIn)).toThrowError(
        PassthroughAuthError,
      );
    }
    // RFC1918 self-host deployments remain a legitimate override target
    const cfg = configFromHeaders(headers("http://192.168.1.50:4000"), optIn);
    expect(cfg.apiUrl).toBe("http://192.168.1.50:4000");
  });
});

describe("legacy docketry names (retired)", () => {
  it("ignores DOCKETRY_* env entirely", () => {
    expect(() =>
      loadConfig({
        DOCKETRY_TOKEN: "dok_agt_old",
        DOCKETRY_WORKSPACE: "acme",
        DOCKETRY_API_URL: "https://api.example.com/",
      }),
    ).toThrow();
  });

  it("rejects a request carrying only legacy x-docketry-* headers", () => {
    expect(() =>
      configFromHeaders(
        {
          authorization: "Bearer dok_agt_old",
          "x-docketry-workspace": "acme",
          "x-docketry-api-url": "https://api.example.com",
        },
        { apiUrl: "http://localhost:4000", allowApiUrlOverride: true },
      ),
    ).toThrow(PassthroughAuthError);
  });
});
