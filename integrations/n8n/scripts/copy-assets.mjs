// Copy non-compiled node assets (codex .node.json files, .svg icons) into
// dist/ so the `n8n` section of package.json resolves against real files.
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(root, "dist");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(node\.json|svg|png)$/.test(entry)) yield full;
  }
}

for (const src of walk(join(root, "nodes"))) {
  const dest = join(DIST, relative(root, src));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
