import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATES,
  canTransition,
  ISSUE_KEY_PATTERN,
  ISSUE_STATES,
  legalTransitions,
  TERMINAL_STATES,
} from "./index.js";

describe("issue states", () => {
  it("every state is active or terminal exactly once", () => {
    for (const state of ISSUE_STATES) {
      const buckets = [
        (ACTIVE_STATES as readonly string[]).includes(state),
        (TERMINAL_STATES as readonly string[]).includes(state),
      ];
      expect(buckets.filter(Boolean)).toHaveLength(1);
    }
  });

  it("lifecycle order is monotonic for active states", () => {
    const order = ISSUE_STATES.indexOf.bind(ISSUE_STATES);
    for (let i = 1; i < ACTIVE_STATES.length; i++) {
      expect(order(ACTIVE_STATES[i]!)).toBeGreaterThan(
        order(ACTIVE_STATES[i - 1]!),
      );
    }
  });
});

describe("state machine", () => {
  it.each([
    ["triage", "backlog"],
    ["backlog", "todo"],
    ["todo", "in_progress"],
    ["in_progress", "in_review"],
    ["in_review", "done"],
    ["in_review", "in_progress"],
    ["in_progress", "backlog"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["triage", "done"],
    ["backlog", "in_progress"],
    ["done", "todo"],
    ["canceled", "backlog"],
    ["in_review", "todo"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("duplicate is reachable from every active state", () => {
    for (const state of ACTIVE_STATES) {
      expect(legalTransitions(state)).toContain("duplicate");
    }
  });
});

describe("issue keys", () => {
  it.each(["DOK-1", "ENG-42", "A-7"])("accepts %s", (key) => {
    expect(ISSUE_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(["dok-1", "DOK-", "-1", "DOK-0x", "123-45"])(
    "rejects %s",
    (key) => {
      expect(ISSUE_KEY_PATTERN.test(key)).toBe(false);
    },
  );
});
