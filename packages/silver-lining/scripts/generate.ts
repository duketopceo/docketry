// Writes the checked-in outputs: silver-lining.css, tokens.json, src/tokens.generated.ts.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCss, buildJson, buildTs } from "../src/emit.ts";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
writeFileSync(root("silver-lining.css"), buildCss());
writeFileSync(root("tokens.json"), buildJson());
writeFileSync(root("src/tokens.generated.ts"), buildTs());
console.log("silver-lining: wrote silver-lining.css, tokens.json, src/tokens.generated.ts");
