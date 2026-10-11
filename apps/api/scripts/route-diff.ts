// Fails (exit 1) when a registered route is undocumented or a documented
// operation has no route. Run: pnpm --filter @tallyline/api exec tsx scripts/route-diff.ts
process.env.NODE_ENV ??= "test"; // importing the app must not start the server

const { app } = await import("../src/index.js");
const { openApiDoc } = await import("../src/openapi.js");
const { routeDiff } = await import("../src/lib/route-diff.js");

const d = routeDiff(app, openApiDoc);
console.log(
  `impl ${d.impl.length} doc ${d.doc.length} missing ${d.missing.length} extra ${d.extra.length}`,
);
for (const m of d.missing) console.log(`  missing from spec: ${m}`);
for (const e of d.extra) console.log(`  documented, no route: ${e}`);
process.exit(d.missing.length + d.extra.length === 0 ? 0 : 1);
