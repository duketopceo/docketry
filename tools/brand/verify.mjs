// Asserts every brand export exists with the right pixel size, and that the
// tally mark geometry is unchanged. Run: node tools/brand/verify.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const png = (rel) => {
  const f = path.join(root, rel);
  if (!existsSync(f)) return null;
  const b = readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const expected = {
  "apps/web/app/apple-icon.png": [180, 180],
  "apps/web/app/opengraph-image.png": [1200, 630],
  "apps/web/app/twitter-image.png": [1200, 630],
  "apps/web/public/brand/icon-192.png": [192, 192],
  "apps/web/public/brand/icon-512.png": [512, 512],
};
let bad = 0;
for (const [rel, [w, h]] of Object.entries(expected)) {
  const got = png(rel);
  if (!got || got.w !== w || got.h !== h) {
    console.error(`FAIL ${rel}: expected ${w}x${h}, got ${got ? `${got.w}x${got.h}` : "missing"}`);
    bad++;
  }
}
for (const rel of ["apps/web/app/favicon.ico", "apps/web/app/icon.svg", "assets/brand/mark.svg", "assets/brand/lockup.svg"]) {
  if (!existsSync(path.join(root, rel))) {
    console.error(`FAIL ${rel}: missing`);
    bad++;
  }
}
// the four strokes + strike of the decided mark must not drift
const d = [...readFileSync(path.join(root, "assets/brand/mark.svg"), "utf8").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join("|");
const hash = createHash("sha256").update(d).digest("hex").slice(0, 12);
const MARK_HASH = process.env.MARK_HASH ?? "1dc6bd518327";
console.log(`mark path hash ${hash}`);
if (hash !== MARK_HASH) {
  console.error("FAIL mark geometry changed");
  bad++;
}
if (bad) process.exit(1);
console.log("brand verify ok");
