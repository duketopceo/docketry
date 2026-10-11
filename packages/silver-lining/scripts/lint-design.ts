// pnpm lint:design - token-only styling gate (docs/design/silver-lining.md section 13).
//   1. stylelint over apps/web CSS (raw colours, off-scale font-size)
//   2. ESLint rules silver-lining/no-raw-color + no-offscale-font over apps/web component code
// ESLint violations are counted per file against apps/web/lint-design-allowlist.json.
// The allowlist is a ratchet: a file may never exceed its count, and when a file
// drops below it the allowlist must be lowered in the same change.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const here = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const repoRoot = resolve(here("."), "../..");
const allowlistPath = resolve(repoRoot, "apps/web/lint-design-allowlist.json");
const update = process.argv.includes("--update-allowlist");

interface Entry {
  count: number;
  tracking: string;
}
interface Allowlist {
  _comment?: string;
  files: Record<string, Entry>;
}

let failed = false;

// 1. stylelint
const style = spawnSync("pnpm", ["exec", "stylelint", "apps/web/**/*.css", "--allow-empty-input"], {
  cwd: repoRoot,
  stdio: "inherit",
});
console.log(`stylelint exit code: ${style.status}`);
if (style.status !== 0) failed = true;

// 2. ESLint design rules
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: here("eslint/design.config.mjs"),
  ignore: false,
});
const results = await eslint.lintFiles([
  "apps/web/app/**/*.{ts,tsx}",
  "apps/web/components/**/*.{ts,tsx}",
  "apps/web/lib/**/*.{ts,tsx}",
]);
const counts = new Map<string, number>();
const lines: string[] = [];
for (const r of results) {
  const rel = relative(repoRoot, r.filePath);
  if (/\.test\.tsx?$/.test(rel)) continue;
  for (const m of r.messages) {
    if (m.fatal) {
      console.error(`${rel}:${m.line} parse error: ${m.message}`);
      failed = true;
      continue;
    }
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
    lines.push(`${rel}:${m.line}:${m.column}  ${m.message}`);
  }
}

const allow: Allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const total = [...counts.values()].reduce((a, b) => a + b, 0);
const allowedTotal = Object.values(allow.files).reduce((a, e) => a + e.count, 0);

if (update) {
  const next: Allowlist = { ...(allow._comment ? { _comment: allow._comment } : {}), files: {} };
  for (const [f, n] of [...counts].sort()) {
    next.files[f] = { count: n, tracking: allow.files[f]?.tracking ?? "TODO: add tracking issue" };
  }
  writeFileSync(allowlistPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`allowlist rewritten: ${total} violations in ${counts.size} files`);
  process.exit(0);
}

console.log(`\nlint:design violations (${total} total, allowlisted ${allowedTotal}):`);
const byFile = new Map<string, string[]>();
for (const l of lines) {
  const f = l.split(":")[0]!;
  byFile.set(f, [...(byFile.get(f) ?? []), l]);
}
for (const [f, ls] of byFile) {
  const a = allow.files[f]?.count ?? 0;
  console.log(`  ${f}: ${ls.length} (allowed ${a})`);
}
if (process.env.LINT_DESIGN_VERBOSE) for (const l of lines) console.log(`    ${l}`);

for (const [f, n] of counts) {
  const a = allow.files[f]?.count ?? 0;
  if (n > a) {
    failed = true;
    console.error(`FAIL ${f}: ${n} violations, allowlist permits ${a}. Use tokens, do not raise the allowlist.`);
    for (const l of byFile.get(f) ?? []) console.error(`    ${l}`);
  }
}
for (const [f, e] of Object.entries(allow.files)) {
  const n = counts.get(f) ?? 0;
  if (n < e.count) {
    failed = true;
    console.error(
      `FAIL ${f}: now ${n} violations but allowlist says ${e.count}. Lower it (pnpm lint:design --update-allowlist); the count may only go down.`,
    );
  }
}
console.log(`lint:design ${failed ? "FAILED" : "ok"}: ${total} allowlisted violations remaining`);
process.exit(failed ? 1 : 0);
