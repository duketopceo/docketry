// The single place production code reads wall-clock time. Everything else
// calls clock.now()/clock.ms() so tests can freeze or advance time
// (vi.setSystemTime, or setClock for tests that don't use fake timers).

let source: () => number = () => Date.now();

export const clock = {
  /** current time as epoch milliseconds */
  ms: (): number => source(),
  /** current time as a Date (a fresh instance on every call) */
  now: (): Date => new Date(source()),
};

/** test hook: replace the time source (epoch ms) */
export function setClock(fn: () => number): void {
  source = fn;
}

/** test hook: back to the real clock */
export function resetClock(): void {
  source = () => Date.now();
}
