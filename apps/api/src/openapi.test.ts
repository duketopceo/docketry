import { describe, expect, it } from "vitest";
import { app } from "./index.js";
import { routeDiff } from "./lib/route-diff.js";
import { openApiDoc } from "./openapi.js";

describe("openapi spec", () => {
  it("documents every registered route and nothing else", () => {
    const d = routeDiff(app, openApiDoc);
    expect(d.missing, "registered but undocumented").toEqual([]);
    expect(d.extra, "documented but not registered").toEqual([]);
    expect(d.impl.length).toBeGreaterThanOrEqual(99);
  });

  it("detects a missing route (guard against a vacuous check)", () => {
    const trimmed = {
      paths: { ...openApiDoc.paths } as Record<string, Record<string, unknown>>,
    };
    delete trimmed.paths["/v1/workspaces/{ws}/github/repos"];
    expect(routeDiff(app, trimmed).missing).toContain(
      "GET /v1/workspaces/{ws}/github/repos",
    );
  });

  it("has Tallyline identity, package version and cloud + self-host servers", async () => {
    const { version } = (await import("../package.json", { with: { type: "json" } }))
      .default as { version: string };
    expect(openApiDoc.info.title).toBe("Tallyline API");
    expect(openApiDoc.info.version).toBe(version);
    const urls = openApiDoc.servers.map((s) => s.url);
    expect(urls).toContain("https://api.tallyline.app");
    expect(urls).toContain("/");
  });

  it("serves the document at /openapi.json", async () => {
    const res = await app.fetch(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { info: { title: string } };
    expect(body.info.title).toBe("Tallyline API");
  });
});
