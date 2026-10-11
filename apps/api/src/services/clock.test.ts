import { afterEach, describe, expect, it, vi } from "vitest";
import { NOW, useFrozenClock } from "../../test/clock.js";
import { clock, resetClock, setClock } from "./clock.js";
import { settleBackground, track } from "./background.js";

describe("clock seam", () => {
  afterEach(() => resetClock());

  it("setClock overrides the time source and resetClock restores it", () => {
    setClock(() => 42_000);
    expect(clock.ms()).toBe(42_000);
    expect(clock.now().toISOString()).toBe("1970-01-01T00:00:42.000Z");
    resetClock();
    expect(Math.abs(clock.ms() - Date.now())).toBeLessThan(1000);
  });

  it("returns a fresh Date each call", () => {
    setClock(() => 1);
    expect(clock.now()).not.toBe(clock.now());
  });

  describe("under vi.setSystemTime", () => {
    useFrozenClock();
    it("follows the frozen system time", () => {
      expect(clock.ms()).toBe(NOW);
      vi.setSystemTime(NOW + 5_000);
      expect(clock.ms()).toBe(NOW + 5_000);
      vi.setSystemTime(NOW);
    });
  });
});

describe("background tracker", () => {
  it("settleBackground waits for tracked work, including work queued meanwhile", async () => {
    const done: string[] = [];
    track(
      new Promise<void>((r) => setTimeout(r, 20)).then(() => {
        done.push("a");
        track(Promise.resolve().then(() => done.push("b")));
      }),
    );
    await settleBackground();
    expect(done).toEqual(["a", "b"]);
  });

  it("swallows (and logs) failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    track(Promise.reject(new Error("boom")));
    await settleBackground();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
