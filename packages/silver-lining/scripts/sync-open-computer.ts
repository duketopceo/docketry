// Copy the generated CSS into an open-computer checkout (its vendored copy).
// usage: node scripts/sync-open-computer.ts <dest-file>
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dest = process.argv[2];
if (!dest) {
  console.error("usage: sync-open-computer.ts <dest-file>");
  process.exit(2);
}
copyFileSync(fileURLToPath(new URL("../silver-lining.css", import.meta.url)), dest);
console.log(`copied silver-lining.css -> ${dest}`);
