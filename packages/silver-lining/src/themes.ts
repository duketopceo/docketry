import { type ThemeInput, type ThemeTokens, generateTheme } from "./generator.ts";

export const THEME_IDS = ["dark", "light", "hc-dark"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Shipped theme definitions. Status colours are fixed per theme (section 5). */
export const THEME_INPUTS: Record<ThemeId, ThemeInput> = {
  dark: {
    mode: "dark",
    base: { l: 0.16, c: 0.012, h: 255 },
    accent: { l: 0.68, c: 0.15, h: 245 },
    contrast: 30,
    status: { urgent: "#f06a6a", attention: "#f59e0b", healthy: "#10b981", neutral: "#9ca3af" },
  },
  light: {
    mode: "light",
    base: { l: 0.97, c: 0.005, h: 265 },
    accent: { l: 0.52, c: 0.17, h: 255 },
    contrast: 30,
    status: { urgent: "#b91c1c", attention: "#92400e", healthy: "#036149", neutral: "#4b5563" },
  },
  "hc-dark": {
    mode: "dark",
    base: { l: 0.13, c: 0.01, h: 255 },
    accent: { l: 0.76, c: 0.14, h: 240 },
    contrast: 70,
    status: { urgent: "#ff8a8a", attention: "#fbbf24", healthy: "#34d399", neutral: "#cbd5e1" },
  },
};

export const THEME_LABELS: Record<ThemeId, string> = {
  dark: "Dark",
  light: "Light",
  "hc-dark": "High contrast dark",
};

export function buildThemes(): Record<ThemeId, ThemeTokens> {
  return Object.fromEntries(
    THEME_IDS.map((id) => [id, generateTheme(THEME_INPUTS[id])]),
  ) as Record<ThemeId, ThemeTokens>;
}
