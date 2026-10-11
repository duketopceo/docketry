#!/usr/bin/env node
// Deprecated alias: `dok` was the short name before the Tallyline rename.
process.stderr.write(
  "dok is deprecated and will be removed — use `tly` (or `tallyline`) instead.\n",
);
await import("./index.js");
export {};
