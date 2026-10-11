import { afterAll, beforeAll, vi } from "vitest";

// Fixed "now" for time-dependent tests. Pass offsets relative to NOW instead
// of reading the real clock (grep goal G10/PLAN-030).
export const NOW = Date.parse("2026-10-11T12:00:00.000Z");
export const DAY = 86_400_000;

/** freeze Date (only Date — timers stay real so I/O and AbortSignal work) */
export function useFrozenClock(): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}

export const isoAt = (offsetMs: number): string =>
  new Date(NOW + offsetMs).toISOString();
