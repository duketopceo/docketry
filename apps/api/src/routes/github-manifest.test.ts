import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { api, bootstrap, mockGithub, resetGithubSync } from "../../test/github.js";
import { NOW, useFrozenClock } from "../../test/clock.js";
import { vi } from "vitest";

useFrozenClock();

const SLUG = "manifest-ws";
let cookie = "";
let calls: ReturnType<typeof mockGithub>["calls"];

const CONVERSION = {
  id: 987,
  slug: "my-tallyline",
  name: "My Tallyline",
  client_id: "Iv1.abc",
  client_secret: "client-secret-value",
  webhook_secret: "whsec-value",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n",
  html_url: "https://github.com/apps/my-tallyline",
};

async function manifest() {
  const res = await api(cookie, `/v1/workspaces/${SLUG}/github/manifest`);
  expect(res.status).toBe(200);
  return res.body as { redirect_url: string; hook_attributes: { url: string } };
}

const callback = (path: string, accept?: string) =>
  app.fetch(
    new Request(`http://api.test${path}`, accept ? { headers: { accept } } : {}),
  );

beforeAll(async () => {
  cookie = await bootstrap(SLUG);
  ({ calls } = mockGithub({ manifestCodes: { goodcode: CONVERSION } }));
});
afterAll(() => resetGithubSync());

describe("GitHub App manifest flow (PLAN-005)", () => {
  it("manifest redirect_url is an absolute URL on a route that exists", async () => {
    const m = await manifest();
    const url = new URL(m.redirect_url);
    expect(url.pathname.startsWith("/github/manifest/callback/")).toBe(true);
    // the route resolves: bad code with a valid state reaches the handler (400 INVALID_CODE),
    // not the router's 404
    const res = await callback(`${url.pathname}?code=nope`, "application/json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_CODE");
  });

  it("webhook url and hook events still point at /webhooks/github", async () => {
    const m = await manifest();
    expect(m.hook_attributes.url).toMatch(/\/webhooks\/github$/);
  });

  it("converts the code and shows credentials once (HTML, no-store)", async () => {
    const m = await manifest();
    const path = `${new URL(m.redirect_url).pathname}?code=goodcode`;
    const res = await callback(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("whsec-value");
    expect(html).toContain("BEGIN RSA PRIVATE KEY");
    expect(html).toContain("GITHUB_APP_ID=987");
    expect(calls.at(-1)!.url).toContain("/app-manifests/goodcode/conversions");
    expect(calls.at(-1)!.method).toBe("POST");
  });

  it("returns JSON when asked", async () => {
    const m = await manifest();
    const res = await callback(
      `${new URL(m.redirect_url).pathname}?code=goodcode`,
      "application/json",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; pem: string; webhookSecret: string };
    expect(body.id).toBe(987);
    expect(body.webhookSecret).toBe("whsec-value");
  });

  it("stores nothing secret in the database", async () => {
    const { db } = await import("../db/client.js");
    const { sql } = await import("drizzle-orm");
    const m = await manifest();
    await callback(`${new URL(m.redirect_url).pathname}?code=goodcode`);
    const hits = await db.execute(
      sql`select count(*)::int as n from github_webhook_events where payload::text like '%whsec-value%'`,
    );
    expect(hits.rows[0]!.n).toBe(0);
    for (const table of ["github_installations", "github_repos", "workspaces"]) {
      const r = await db.execute(
        sql.raw(`select count(*)::int as n from ${table} t where t::text like '%whsec-value%' or t::text like '%BEGIN RSA%'`),
      );
      expect(r.rows[0]!.n).toBe(0);
    }
  });

  it("rejects a tampered state without calling GitHub", async () => {
    const m = await manifest();
    const before = calls.length;
    const bad = new URL(m.redirect_url).pathname.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
    const res = await callback(`${bad}?code=goodcode`, "application/json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
    expect(calls.length).toBe(before);
  });

  it("rejects an expired state (10 minute lifetime)", async () => {
    const m = await manifest();
    const path = new URL(m.redirect_url).pathname;
    vi.setSystemTime(NOW + 11 * 60_000);
    try {
      const res = await callback(`${path}?code=goodcode`, "application/json");
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
    } finally {
      vi.setSystemTime(NOW);
    }
  });

  it("requires ?code", async () => {
    const m = await manifest();
    const res = await callback(new URL(m.redirect_url).pathname, "application/json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MALFORMED_CALLBACK");
  });

  it("escapes HTML in GitHub-supplied fields", async () => {
    mockGithub({
      manifestCodes: { xss: { ...CONVERSION, name: "<script>alert(1)</script>" } },
    });
    const m = await manifest();
    const res = await callback(`${new URL(m.redirect_url).pathname}?code=xss`);
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
