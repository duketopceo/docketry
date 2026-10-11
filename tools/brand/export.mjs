// Regenerates raster brand exports from the hand-written SVGs in assets/brand.
// Needs `resvg` and ImageMagick (`magick`) on PATH. Run: node tools/brand/export.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const brand = path.join(root, "assets/brand");
const app = path.join(root, "apps/web/app");
const pub = path.join(root, "apps/web/public/brand");
mkdirSync(pub, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), "tly-brand-"));

const inner = (file) =>
  readFileSync(path.join(brand, file), "utf8")
    .trim()
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>.*?<\/title>/, "");

const render = (svg, out, size) => {
  const src = path.join(tmp, path.basename(out) + ".svg");
  writeFileSync(src, svg);
  const args = [src, out];
  if (size) args.unshift("-w", String(size), "-h", String(size));
  execFileSync("resvg", args);
};

// mark on a square tile (dark canvas), padded so maskable crops keep the mark
const tile = (size, pad) => {
  const s = (size - 2 * pad) / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#10141b"/><g transform="translate(${pad} ${pad}) scale(${s})">${inner("mark-dark.svg")}</g></svg>`;
};

render(tile(180, 28), path.join(app, "apple-icon.png"));
render(tile(192, 30), path.join(pub, "icon-192.png"));
render(tile(512, 80), path.join(pub, "icon-512.png"));

// favicon.ico: 16px optimized variant + 32px full mark (light variant, transparent)
const f16 = path.join(tmp, "f16.png");
const f32 = path.join(tmp, "f32.png");
render(readFileSync(path.join(brand, "mark-small.svg"), "utf8"), f16, 16);
render(readFileSync(path.join(brand, "mark.svg"), "utf8"), f32, 32);
execFileSync("magick", [f16, f32, path.join(app, "favicon.ico")]);

// Open Graph / Twitter: lockup on canvas, 1200x630
const w = 169 * 5;
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="#0a0c10"/><rect x="40" y="40" width="1120" height="550" rx="14" fill="#10141b" stroke="#39404c" stroke-width="2"/><g transform="translate(${(1200 - w) / 2} ${315 - 100}) scale(5)">${inner("lockup-dark.svg")}</g></svg>`;
render(og, path.join(app, "opengraph-image.png"));
render(og, path.join(app, "twitter-image.png"));
console.log("brand exports written");
