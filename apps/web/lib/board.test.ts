import { describe, expect, it } from "vitest";
import { resolveCollapsed } from "./board";

describe("resolveCollapsed", () => {
  it("collapses empty columns by default", () => {
    expect(resolveCollapsed(undefined, true)).toBe(true);
  });

  it("expands non-empty columns by default", () => {
    expect(resolveCollapsed(undefined, false)).toBe(false);
  });

  it("user pins win over the auto rule", () => {
    expect(resolveCollapsed("expanded", true)).toBe(false);
    expect(resolveCollapsed("collapsed", false)).toBe(true);
  });
});
