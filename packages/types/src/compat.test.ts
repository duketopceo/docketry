import { describe, expect, it } from "vitest";
import {
  hasApiTokenPrefix,
  isAgentToken,
  isPatToken,
  readEnv,
  readHeader,
} from "./compat.js";

describe("readEnv", () => {
  it("reads the set name", () => {
    expect(readEnv({ TALLYLINE_TOKEN: "t" }, "TALLYLINE_TOKEN")).toBe("t");
  });
  it("treats empty string as unset", () => {
    expect(readEnv({ TALLYLINE_TOKEN: "" }, "TALLYLINE_TOKEN")).toBeUndefined();
  });
  it("returns undefined when unset", () => {
    expect(readEnv({}, "TALLYLINE_TOKEN")).toBeUndefined();
  });
  it("ignores legacy DOCKETRY_* names entirely", () => {
    expect(readEnv({ DOCKETRY_TOKEN: "old" }, "TALLYLINE_TOKEN")).toBeUndefined();
  });
  it("passes non-TALLYLINE names through untouched", () => {
    expect(readEnv({ JWT_SECRET: "s" }, "JWT_SECRET")).toBe("s");
  });
});

describe("token prefixes", () => {
  it("accepts tly_ agent keys and PATs only", () => {
    expect(isAgentToken("tly_agt_x")).toBe(true);
    expect(isAgentToken("dok_agt_x")).toBe(false);
    expect(isAgentToken("tly_pat_x")).toBe(false);
    expect(isPatToken("tly_pat_x")).toBe(true);
    expect(isPatToken("dok_pat_x")).toBe(false);
    expect(isPatToken(undefined)).toBe(false);
  });
  it("treats only the tly_ namespace as opaque (never JWT)", () => {
    expect(hasApiTokenPrefix("tly_inv_x")).toBe(true);
    expect(hasApiTokenPrefix("dok_agt_x")).toBe(false);
    expect(hasApiTokenPrefix("eyJhbGciOi")).toBe(false);
  });
});

describe("readHeader", () => {
  it("reads x-tallyline-* header names", () => {
    expect(readHeader({ "x-tallyline-workspace": "a" }, "x-tallyline-workspace")).toBe("a");
  });
  it("ignores legacy x-docketry-* names", () => {
    expect(
      readHeader({ "x-docketry-workspace": "b" }, "x-tallyline-workspace"),
    ).toBeUndefined();
  });
});
