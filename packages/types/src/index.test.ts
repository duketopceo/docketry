import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATES,
  ISSUE_KEY_PATTERN,
  ISSUE_STATES,
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
