import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clamp, contrastRatio, hexToOklch } from "../src/color.ts";
import {
  DARK_INK_CEILING,
  MAX_INK_L,
  MIN_DARK_CANVAS_L,
  SURFACE_NAMES,
  contrastPairs,
  generateTheme,
} from "../src/generator.ts";
import { THEME_IDS, THEME_INPUTS, buildThemes } from "../src/themes.ts";
import type { Mode } from "../src/generator.ts";

const wild = fc.oneof(
  fc.double({ min: -2, max: 3, noNaN: false }),
  fc.constantFrom(0, 1, 0.5, Infinity, -Infinity, NaN),
);
const oklch = fc.record({
  l: fc.double({ min: 0, max: 1, noNaN: true }),
  c: fc.double({ min: 0, max: 0.4, noNaN: true }),
  h: fc.double({ min: 0, max: 360, noNaN: true }),
});
const wildOklch = fc.record({ l: wild, c: wild, h: wild });
const modes = fc.constantFrom<Mode>("dark", "light");

function inputs(mode: Mode) {
  const status = THEME_INPUTS[mode === "dark" ? "dark" : "light"].status;
  return { mode, status };
}

describe("generateTheme (property-based, section 3 floors hold for any input)", () => {
  it("every text x surface pair meets its floor and the dark ink ceiling", () => {
    fc.assert(
      fc.property(
        modes,
        fc.oneof(oklch, wildOklch),
        fc.oneof(oklch, wildOklch),
        fc.oneof(fc.integer({ min: 0, max: 100 }), wild),
        (mode, base, accent, contrast) => {
          const t = generateTheme({ ...inputs(mode), base, accent, contrast });
          const bad = contrastPairs(t, mode).filter((p) => !p.ok);
          expect(bad.map((p) => `${p.fg}/${p.bg}=${p.ratio.toFixed(2)}`)).toEqual([]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("never emits pure black canvas or pure white text; respects L bounds", () => {
    fc.assert(
      fc.property(modes, oklch, oklch, fc.integer({ min: 0, max: 100 }), (mode, base, accent, contrast) => {
        const t = generateTheme({ ...inputs(mode), base, accent, contrast });
        expect(t.canvas).not.toBe("#000000");
        for (const k of ["ink", "ink-muted", "ink-subtle", "ink-tertiary"] as const) {
          expect(t[k]).not.toBe("#ffffff");
        }
        if (mode === "dark") {
          expect(hexToOklch(t.canvas).l).toBeGreaterThanOrEqual(MIN_DARK_CANVAS_L - 0.006);
          expect(hexToOklch(t.ink).l).toBeLessThanOrEqual(MAX_INK_L + 0.003);
          for (const s of SURFACE_NAMES) expect(hexToOklch(t[s]).l).toBeLessThan(0.3);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("dark surface ladder steps stay within +0.025..+0.047 L", () => {
    fc.assert(
      fc.property(oklch, oklch, fc.integer({ min: 0, max: 100 }), (base, accent, contrast) => {
        const t = generateTheme({ ...inputs("dark"), base, accent, contrast });
        const ls = SURFACE_NAMES.map((s) => hexToOklch(t[s]).l);
        for (let i = 1; i < ls.length; i++) {
          const d = ls[i]! - ls[i - 1]!;
          expect(d).toBeGreaterThan(0.025);
          expect(d).toBeLessThan(0.047);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("text steps keep their order (ink > muted > subtle > tertiary) on the worst surface", () => {
    fc.assert(
      fc.property(modes, oklch, oklch, fc.integer({ min: 0, max: 100 }), (mode, base, accent, contrast) => {
        const t = generateTheme({ ...inputs(mode), base, accent, contrast });
        const r = (k: "ink" | "ink-muted" | "ink-subtle" | "ink-tertiary") =>
          contrastRatio(t[k], t["surface-4"]);
        expect(r("ink")).toBeGreaterThan(r("ink-muted"));
        expect(r("ink-muted")).toBeGreaterThan(r("ink-subtle"));
        expect(r("ink-subtle")).toBeGreaterThanOrEqual(r("ink-tertiary"));
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic", () => {
    const a = generateTheme(THEME_INPUTS.dark);
    expect(generateTheme(THEME_INPUTS.dark)).toEqual(a);
  });
});

describe("shipped themes", () => {
  const themes = buildThemes();
  it.each(THEME_IDS)("%s passes every pair", (id) => {
    const bad = contrastPairs(themes[id], THEME_INPUTS[id].mode).filter((p) => !p.ok);
    expect(bad).toEqual([]);
  });

  it("dark ink stays under the 16:1 ceiling on the canvas", () => {
    for (const id of ["dark", "hc-dark"] as const) {
      expect(contrastRatio(themes[id].ink, themes[id].canvas)).toBeLessThanOrEqual(DARK_INK_CEILING);
    }
  });

  it("clamp helper tolerates NaN", () => {
    expect(clamp(NaN, 1, 2)).toBe(1);
  });
});

import {
  DEFAULT_APPEARANCE,
  generateCustom,
  parseAppearance,
  serializeAppearance,
  DEFAULT_CUSTOM,
} from "../src/appearance.ts";

describe("appearance cookie", () => {
  it("defaults to dark and round-trips every choice", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE.theme).toBe("dark");
    for (const theme of ["system", "dark", "light", "hc-dark"] as const) {
      expect(parseAppearance(serializeAppearance({ theme }))).toEqual({ theme });
    }
    const a = { theme: "custom", custom: DEFAULT_CUSTOM } as const;
    expect(parseAppearance(serializeAppearance(a))).toEqual(a);
  });

  it("rejects garbage and clamps hostile custom values", () => {
    expect(parseAppearance("custom~x")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("nope")).toEqual(DEFAULT_APPEARANCE);
    const p = parseAppearance("custom~9~9~9999~9~9~9999~999");
    expect(p.theme).toBe("custom");
    if (p.theme === "custom") {
      const { mode, tokens: t } = generateCustom(p.custom);
      expect(contrastPairs(t, mode).every((x) => x.ok)).toBe(true);
    }
  });
});
