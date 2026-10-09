import { expect, test } from "@playwright/test";

interface Vitals {
  lcp: number;
  cls: number;
  inp: number;
}

declare global {
  interface Window {
    __vitals: Vitals;
  }
}

// UX_FIRST budget: LCP <1.5s, INP <200ms, CLS <0.05, initial JS <200kb gz.
// Vitals are measured via PerformanceObserver; the JS budget lives in
// scripts/bundle-budget.mjs against the production build (dev bundles are
// unminified and would measure meaningless).
test("perf budget on /issues", async ({ page }) => {
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0, inp: 0 };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__vitals.lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const shift = e as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) window.__vitals.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__vitals.inp = Math.max(window.__vitals.inp, e.duration);
      }
    }).observe({ type: "event", buffered: true });
  });

  await page.goto("/issues", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  // provoke an interaction so INP has a measurement
  await page.keyboard.press("j");
  await page.waitForTimeout(200);

  const vitals = await page.evaluate(() => window.__vitals);

  console.log(
    `measured: lcp=${vitals.lcp.toFixed(0)}ms cls=${vitals.cls.toFixed(3)} ` +
      `inp=${vitals.inp.toFixed(0)}ms`,
  );
  expect(vitals.lcp).toBeLessThan(1500);
  expect(vitals.cls).toBeLessThan(0.05);
  expect(vitals.inp).toBeLessThan(200);
});
