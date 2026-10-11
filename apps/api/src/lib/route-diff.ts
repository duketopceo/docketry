import type { Hono } from "hono";

export interface RouteDiff {
  impl: string[];
  doc: string[];
  missing: string[]; // registered but undocumented
  extra: string[]; // documented but not registered
}

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

// Compare every registered Hono route (middleware "ALL" entries excluded)
// with the operations in an OpenAPI document.
export function routeDiff(
  app: Hono,
  doc: { paths: Record<string, Record<string, unknown>> },
): RouteDiff {
  const impl = new Set<string>();
  for (const r of app.routes) {
    if (r.method === "ALL") continue;
    impl.add(`${r.method} ${toOpenApiPath(r.path)}`);
  }
  const docOps = new Set<string>();
  const verbs = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const m of Object.keys(item)) {
      if (verbs.has(m)) docOps.add(`${m.toUpperCase()} ${path}`);
    }
  }
  return {
    impl: [...impl].sort(),
    doc: [...docOps].sort(),
    missing: [...impl].filter((x) => !docOps.has(x)).sort(),
    extra: [...docOps].filter((x) => !impl.has(x)).sort(),
  };
}
