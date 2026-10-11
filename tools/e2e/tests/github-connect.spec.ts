import { expect, test, type Page } from "@playwright/test";
import { GH_APP_SLUG } from "../support/fake-github";
import { apiSession, deliverGithubWebhook, WS } from "../support/api";

// PLAN-005 / PLAN-006 (web half). The real web + API run; only GitHub is
// faked (support/fake-github.ts via GITHUB_API_URL) and the browser's trip to
// github.com is intercepted. Installation 501 belongs to "our" App, 502 does
// too but is bound to a second workspace, anything else is a foreign id (404).

const OTHER_WS = `gh-other-${Date.now().toString(36)}`;

test.describe.configure({ mode: "serial" });

async function cleanup() {
  const api = await apiSession();
  for (const id of [501, 502]) {
    await api.delete(`/v1/workspaces/${WS}/github/installations/${id}`);
  }
  await api.dispose();
}

test.beforeAll(cleanup);
test.afterAll(async () => {
  await cleanup();
  // free 502 from the second workspace so reruns against a kept DB start clean
  const api = await apiSession();
  await api.delete(`/v1/workspaces/${OTHER_WS}/github/installations/502`);
  await api.dispose();
});

// GitHub's redirect lands on a confirm page: a GET never binds. Confirming
// POSTs through the web tier (same-origin, JSON) to the API.
async function confirmLink(page: Page, id: number | string, action = "install") {
  await page.goto(`/integrations/github/callback?installation_id=${id}&setup_action=${action}`);
  await expect(page.getByRole("heading", { name: `Link installation ${id}?` })).toBeVisible();
  await page.getByRole("button", { name: "Link installation" }).click();
}

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test("not configured: shows the operator steps and a manifest form to github.com only", async ({
  page,
}) => {
  const csp = watchCsp(page);
  await page.route("**/api/settings/github/installations", (r) =>
    r.fulfill({
      json: { configured: { app: false, slug: false }, installations: [] },
    }),
  );
  await page.route("**/api/settings/github/manifest", (r) =>
    r.fulfill({ json: { name: "tallyline", url: "http://x.test", redirect_url: "http://x.test/cb" } }),
  );
  const res = await page.goto("/settings/integrations");
  // CSP from #93 stays strict everywhere except this exact form target
  const header = res!.headers()["content-security-policy"] ?? "";
  expect(header).toContain("form-action 'self' https://github.com;");
  expect(header).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);

  await expect(page.getByRole("heading", { name: "GitHub App not configured" })).toBeVisible();
  await expect(page.getByText("GITHUB_APP_PRIVATE_KEY")).toBeVisible();
  await expect(page.getByText("/integrations/github/callback")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toHaveCount(0);

  await page.getByRole("button", { name: "Prepare GitHub App" }).click();
  const form = page.locator('form[action="https://github.com/settings/apps/new"]');
  await expect(form.locator('input[name="manifest"]')).toHaveAttribute("value", /tallyline/);
  await expect(form.getByRole("button", { name: /Create GitHub App/ })).toBeVisible();
  expect(csp).toEqual([]);
});

test("/settings/github redirects to Integrations (one GitHub surface)", async ({ page }) => {
  await page.goto("/settings/github?github=requested");
  await expect(page).toHaveURL(/\/settings\/integrations\?github=requested/);
});

test("other settings pages keep form-action 'self'", async ({ page }) => {
  const res = await page.goto("/settings/agents");
  expect(res!.headers()["content-security-policy"]).toContain("form-action 'self';");
});

test("API 503 from install-url falls back to the operator steps", async ({ page }) => {
  await page.route("**/api/settings/github/install-url", (r) =>
    r.fulfill({ status: 503, json: { error: { code: "GITHUB_NOT_CONFIGURED", message: "GITHUB_APP_SLUG not set" } } }),
  );
  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page.getByRole("heading", { name: "GitHub App not configured" })).toBeVisible();
});

test("connect → github.com install → callback binds, repos backfill, unlink", async ({ page }) => {
  const csp = watchCsp(page);
  const api = await apiSession();
  // GitHub delivers installation.created before the user returns to Tallyline
  expect(
    await deliverGithubWebhook(api, "installation", {
      action: "created",
      installation: { id: 501, account: { login: "e2e-org" } },
      repositories: [{ id: 9001, name: "web", full_name: "e2e-org/web" }],
    }),
  ).toBe(200);

  await page.goto("/settings/integrations");
  await expect(page.getByText("No GitHub account is linked to this workspace.")).toBeVisible();

  // Connect GitHub sends the browser to the App's install page (intercepted)
  await page.route(`https://github.com/apps/${GH_APP_SLUG}/installations/new`, (r) =>
    r.fulfill({ contentType: "text/html", body: "<title>fake github install</title>" }),
  );
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page).toHaveURL(`https://github.com/apps/${GH_APP_SLUG}/installations/new`);

  // GitHub redirects to the Setup URL: a confirm page, nothing bound on GET
  await page.goto("/integrations/github/callback?installation_id=501&setup_action=install");
  await expect(page.getByRole("heading", { name: "Link installation 501?" })).toBeVisible();
  const before = await api.get(`/v1/workspaces/${WS}/github/installations`);
  expect((await before.json()).installations).toEqual([]);
  await page.getByRole("button", { name: "Link installation" }).click();
  await expect(page).toHaveURL(/\/settings\/integrations\?github=connected/);
  await expect(page.getByText("GitHub installation linked")).toBeVisible();
  const installs = page.getByRole("list", { name: "Linked installations" });
  await expect(installs.getByText("e2e-org")).toBeVisible();
  await expect(installs.getByText(/installation 501/)).toBeVisible();

  // repo captured in the delivery appears in Integrations' catalog, off until connected
  const row = page.getByRole("row", { name: /e2e-org\/web/ });
  await expect(row.getByText("off")).toBeVisible();
  await row.getByRole("button", { name: "connect" }).click();
  await expect(row.getByText("on", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "disconnect" }).click();
  await expect(row.getByText("off")).toBeVisible();

  // idempotent: returning again does not duplicate
  await confirmLink(page, 501, "update");
  await expect(page).toHaveURL(/github=connected/);
  await expect(installs.getByRole("listitem")).toHaveCount(1);

  // unlink is reversible: Undo toast, not a confirm dialog (silver-lining 7)
  await page.getByRole("button", { name: "Unlink e2e-org" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unlinked e2e-org" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(installs.getByText("e2e-org")).toBeVisible();
  const committed = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes("/github/installations/") && r.ok(),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Unlink e2e-org" }).click();
  await expect(page.getByText("No GitHub account is linked to this workspace.")).toBeVisible();
  await committed; // committed after the 8s undo window
  await page.reload();
  // server agrees
  const after = await api.get(`/v1/workspaces/${WS}/github/installations`);
  expect((await after.json()).installations).toEqual([]);
  await api.dispose();
  expect(csp).toEqual([]);
});

test("foreign installation id → 404 copy, nothing linked", async ({ page }) => {
  await confirmLink(page, 999999);
  await expect(page).toHaveURL(/github=error&code=404/);
  await expect(
    page.getByText("That installation does not belong to this GitHub App"),
  ).toBeVisible();
  await expect(page.getByText("No GitHub account is linked to this workspace.")).toBeVisible();
});

test("installation bound to another workspace → 409 copy", async ({ page }) => {
  const api = await apiSession();
  const mk = await api.post("/v1/workspaces", {
    data: { slug: OTHER_WS, name: "Other workspace" },
  });
  expect(mk.status()).toBe(201);
  const bound = await api.post(`/v1/workspaces/${OTHER_WS}/github/setup`, {
    data: { installationId: 502 },
  });
  expect(bound.status()).toBe(200);

  await confirmLink(page, 502);
  await expect(page).toHaveURL(/github=error&code=409/);
  await expect(
    page.getByText("That GitHub installation is linked to another workspace"),
  ).toBeVisible();
  await expect(page.getByText(/Unlink it from the other workspace/)).toBeVisible();
  const mine = await api.get(`/v1/workspaces/${WS}/github/installations`);
  expect((await mine.json()).installations).toEqual([]);
  await api.dispose();
});

test("org-member install request and malformed callback", async ({ page }) => {
  await page.goto("/integrations/github/callback?setup_action=request");
  await expect(page).toHaveURL(/github=requested/);
  await expect(page.getByText("Install request sent")).toBeVisible();

  await page.goto("/integrations/github/callback?installation_id=abc");
  await expect(page).toHaveURL(/github=error&code=400/);
  await expect(page.getByText("GitHub did not send an installation")).toBeVisible();
});

test("setup POST refuses cross-site requests (CSRF)", async ({ page, request }) => {
  await page.goto("/settings/integrations");
  const base = new URL(page.url()).origin;
  const evil = await request.post(`${base}/api/settings/github/setup`, {
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    data: { installationId: 501 },
  });
  expect(evil.status()).toBe(403);
  const noOrigin = await request.post(`${base}/api/settings/github/setup`, {
    headers: { "content-type": "text/plain" },
    data: JSON.stringify({ installationId: 501 }),
  });
  expect(noOrigin.status()).toBe(403);
});

test("callback without a session goes to login", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/integrations/github/callback?installation_id=501");
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});
