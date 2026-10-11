import { describe, expect, it } from "vitest";
import {
  hasApiTokenPrefix,
  isAgentToken,
  isPatToken,
  legacyEnvName,
  readEnv,
  readHeader,
} from "./compat.js";

describe("readEnv (TALLYLINE_* with DOCKETRY_* fallback)", () => {
  it("prefers the new name", () => {
    expect(
      readEnv({ TALLYLINE_TOKEN: "new", DOCKETRY_TOKEN: "old" }, "TALLYLINE_TOKEN"),
    ).toBe("new");
  });
  it("falls back to the legacy name when the new one is unset or empty", () => {
    expect(readEnv({ DOCKETRY_TOKEN: "old" }, "TALLYLINE_TOKEN")).toBe("old");
    expect(
      readEnv({ TALLYLINE_TOKEN: "", DOCKETRY_TOKEN: "old" }, "TALLYLINE_TOKEN"),
    ).toBe("old");
  });
  it("returns undefined when neither is set", () => {
    expect(readEnv({}, "TALLYLINE_TOKEN")).toBeUndefined();
  });
  it("passes non-TALLYLINE names through untouched", () => {
    expect(readEnv({ JWT_SECRET: "s" }, "JWT_SECRET")).toBe("s");
    expect(legacyEnvName("JWT_SECRET")).toBeUndefined();
    expect(legacyEnvName("TALLYLINE_LLM_MODEL")).toBe("DOCKETRY_LLM_MODEL");
  });
});

describe("token prefixes", () => {
  it("accepts new and legacy agent keys / PATs", () => {
    expect(isAgentToken("tly_agt_x")).toBe(true);
    expect(isAgentToken("dok_agt_x")).toBe(true);
    expect(isAgentToken("tly_pat_x")).toBe(false);
    expect(isPatToken("tly_pat_x")).toBe(true);
    expect(isPatToken("dok_pat_x")).toBe(true);
    expect(isPatToken(undefined)).toBe(false);
  });
  it("treats both namespaces as opaque (never JWT)", () => {
    expect(hasApiTokenPrefix("tly_inv_x")).toBe(true);
    expect(hasApiTokenPrefix("dok_agt_x")).toBe(true);
    expect(hasApiTokenPrefix("eyJhbGciOi")).toBe(false);
  });
});

describe("readHeader", () => {
  it("reads new header names, falling back to legacy x-docketry-*", () => {
    expect(readHeader({ "x-tallyline-workspace": "a" }, "x-tallyline-workspace")).toBe("a");
    expect(readHeader({ "x-docketry-workspace": "b" }, "x-tallyline-workspace")).toBe("b");
    expect(
      readHeader(
        { "x-tallyline-workspace": "a", "x-docketry-workspace": "b" },
        "x-tallyline-workspace",
      ),
    ).toBe("a");
  });
});
