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
      DOCKETRY_TOKEN: "dok_agt_x",
      DOCKETRY_WORKSPACE: "acme",
      DOCKETRY_API_URL: "https://api.example.com/",
    });
    expect(cfg).toEqual({
      apiUrl: "https://api.example.com",
      token: "dok_agt_x",
      workspace: "acme",
    });
  });

  it("throws MissingEnvError listing every absent required var", () => {
    expect(() => loadConfig({})).toThrowError(MissingEnvError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as MissingEnvError).missing).toEqual([
        "DOCKETRY_TOKEN",
        "DOCKETRY_WORKSPACE",
      ]);
    }
  });
});

describe("httpAuthMode", () => {
  it("returns env mode when both vars are set", () => {
    const mode = httpAuthMode({
      DOCKETRY_TOKEN: "dok_agt_x",
      DOCKETRY_WORKSPACE: "acme",
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
    expect(() => httpAuthMode({ DOCKETRY_TOKEN: "dok_agt_x" })).toThrowError(
      MissingEnvError,
    );
    expect(() => httpAuthMode({ DOCKETRY_WORKSPACE: "acme" })).toThrowError(
      MissingEnvError,
    );
  });

  it("enables the api-url override only on explicit opt-in", () => {
    const on = httpAuthMode({ DOCKETRY_ALLOW_API_URL_OVERRIDE: "1" });
    expect(on.mode === "passthrough" && on.allowApiUrlOverride).toBe(true);
    const off = httpAuthMode({ DOCKETRY_ALLOW_API_URL_OVERRIDE: "true" });
    expect(off.mode === "passthrough" && off.allowApiUrlOverride).toBe(false);
  });
});

describe("configFromHeaders", () => {
  const base = { apiUrl: "http://api:4000", allowApiUrlOverride: false };

  it("builds config from bearer + workspace headers", () => {
    const cfg = configFromHeaders(
      {
        authorization: "Bearer dok_agt_abc",
        "x-docketry-workspace": "acme",
      },
      base,
    );
    expect(cfg).toEqual({
      apiUrl: "http://api:4000",
      token: "dok_agt_abc",
      workspace: "acme",
    });
  });

  it("accepts a raw token without the Bearer prefix", () => {
    const cfg = configFromHeaders(
      {
        authorization: "dok_pat_xyz",
        "x-docketry-workspace": "acme",
      },
      base,
    );
    expect(cfg.token).toBe("dok_pat_xyz");
  });

  it("rejects missing/invalid credentials with 401-style errors", () => {
    expect(() => configFromHeaders({}, base)).toThrowError(PassthroughAuthError);
    expect(() =>
      configFromHeaders(
        { authorization: "Bearer dok_agt_abc" },
        base,
      ),
    ).toThrowError(PassthroughAuthError);
    expect(() =>
      configFromHeaders(
        {
          authorization: "Bearer dok_agt_abc",
          "x-docketry-workspace": "bad slug!",
        },
        base,
      ),
    ).toThrowError(PassthroughAuthError);
  });

  it("rejects x-docketry-api-url unless the deployment opted in", () => {
    const headers = {
      authorization: "Bearer dok_agt_abc",
      "x-docketry-workspace": "acme",
      "x-docketry-api-url": "https://other.example.com/",
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
          authorization: "Bearer dok_agt_abc",
          "x-docketry-workspace": "acme",
          "x-docketry-api-url": "file:///etc/passwd",
        },
        { apiUrl: "http://api:4000", allowApiUrlOverride: true },
      ),
    ).toThrowError(PassthroughAuthError);
  });

  it("blocks loopback/link-local/metadata literal hosts, allows LAN", () => {
    const optIn = { apiUrl: "http://api:4000", allowApiUrlOverride: true };
    const headers = (url: string) => ({
      authorization: "Bearer dok_agt_abc",
      "x-docketry-workspace": "acme",
      "x-docketry-api-url": url,
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
