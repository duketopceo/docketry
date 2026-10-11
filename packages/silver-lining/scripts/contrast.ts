// pnpm test:contrast - every text role x surface step, per theme, against section 3.
// Prints the table; exits 1 if any pair is outside its floor/ceiling.
import { contrastPairs, SURFACE_NAMES } from "../src/generator.ts";
import { THEME_IDS, THEME_INPUTS, buildThemes } from "../src/themes.ts";

const themes = buildThemes();
let failures = 0;
let pairs = 0;
for (const id of THEME_IDS) {
  const mode = THEME_INPUTS[id].mode;
  const all = contrastPairs(themes[id], mode);
  console.log(`\n${id} (${mode})`);
  const head = ["role (floor)", ...SURFACE_NAMES].map((s, i) => (i === 0 ? s.padEnd(24) : s.padStart(10)));
  console.log(head.join(""));
  const roles = [...new Set(all.map((p) => p.fg))];
  for (const fg of roles) {
    const row = all.filter((p) => p.fg === fg && SURFACE_NAMES.includes(p.bg as never));
    if (row.length === 0) continue;
    const label = `${fg} (${row[0]!.floor}${row[0]!.ceil ? `..${row[0]!.ceil}` : ""})`;
    console.log(
      label.padEnd(24) +
        row.map((p) => `${p.ratio.toFixed(2)}${p.ok ? " " : "!"}`.padStart(10)).join(""),
    );
  }
  const oa = all.find((p) => p.fg === "on-accent")!;
  console.log(`on-accent on accent (${oa.floor})`.padEnd(24) + `${oa.ratio.toFixed(2)}${oa.ok ? "" : "!"}`.padStart(10));
  for (const p of all) {
    pairs++;
    if (!p.ok) {
      failures++;
      console.error(`FAIL ${id}: ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)} (floor ${p.floor}${p.ceil ? `, ceiling ${p.ceil}` : ""})`);
    }
  }
}
console.log(`\n${pairs} pairs checked, ${failures} failing`);
process.exit(failures ? 1 : 0);
