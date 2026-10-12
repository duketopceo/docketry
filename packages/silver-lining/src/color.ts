// Colour maths for the theme generator: OKLCH <-> sRGB, WCAG 2.x contrast,
// CIE76 delta-E. Pure functions, no dependencies.

export interface Oklch {
  /** perceptual lightness, 0..1 */
  l: number;
  /** chroma, roughly 0..0.4 */
  c: number;
  /** hue angle in degrees */
  h: number;
}

export type Rgb = readonly [number, number, number];

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

const toLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const fromLinear = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

/** Linear-light sRGB (unclamped) for an OKLCH colour. */
export function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -1e-5 && v <= 1 + 1e-5);

/** Reduce chroma until the colour fits in sRGB (keeps lightness and hue). */
export function gamutClamp(color: Oklch): Oklch {
  const l = clamp(color.l, 0, 1);
  const h = Number.isFinite(color.h) ? ((color.h % 360) + 360) % 360 : 0;
  let c = Math.max(0, Number.isFinite(color.c) ? color.c : 0);
  if (inGamut(oklchToLinear({ l, c, h }))) return { l, c, h };
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ l, c: mid, h }))) lo = mid;
    else hi = mid;
  }
  c = lo;
  return { l, c, h };
}

export function oklchToRgb(color: Oklch): [number, number, number] {
  const g = gamutClamp(color);
  const lin = oklchToLinear(g);
  return lin.map((v) => Math.round(clamp(fromLinear(clamp(v, 0, 1)), 0, 1) * 255)) as [
    number,
    number,
    number,
  ];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const oklchToHex = (c: Oklch): string => rgbToHex(oklchToRgb(c));

export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : (((Math.atan2(B, A) * 180) / Math.PI) % 360 + 360) % 360;
  return { l: L, c, h };
}

export const hexToOklch = (hex: string): Oklch => rgbToOklch(hexToRgb(hex));

/** WCAG relative luminance of an sRGB hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference between two hex colours. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${+alpha.toFixed(2)})`;
}
