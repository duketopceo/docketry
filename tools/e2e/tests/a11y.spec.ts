import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, WS } from "../support/api";

// PLAN-044: every app screen, WCAG 2.0/2.1/2.2 A + AA tags, both themes,
// desktop and phone widths. Zero violations gates the run.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const APP_PAGES = [
  "/my-issues",
  "/board",
  "/triage",
  "/review",
  "/cycle",
  "/issues",
  "/issues/:key",
  "/insights",
  "/roadmap",
  "/activity",
  "/settings",
  "/settings/members",
  "/settings/invites",
  "/settings/providers",
  "/settings/agents",
  "/settings/tokens",
  "/settings/integrations",
];

// Non-default states of the new settings screens (PLAN-005/006, UX-009):
// the GitHub App not configured, a linked installation with callback errors,
// a freshly revealed secret, and an open confirm dialog.
const STATES: { name: string; run: (page: Page) => Promise<void> }[] = [
  {
    name: "github not configured",
    run: async (page) => {
      await page.route("**/api/settings/github/installations", (r) =>
        r.fulfill({ json: { configured: { app: false, slug: false }, installations: [] } }),
      );
      await page.route("**/api/settings/github/manifest", (r) =>
        r.fulfill({ json: { name: "tallyline", url: "http://x.test" } }),
      );
      await page.goto("/settings/integrations");
      await page.getByRole("button", { name: "Prepare GitHub App" }).click();
      await expect(page.getByRole("button", { name: /Create GitHub App/ })).toBeVisible();
    },
  },
  {
    name: "github linked + 409 notice + unlink toast",
    run: async (page) => {
      await page.route("**/api/settings/github/installations", (r) =>
        r.fulfill({
          json: {
            configured: { app: true, slug: true },
            installations: [
              { installationId: 7, accountLogin: "acme", createdAt: "2026-10-01T00:00:00Z" },
            ],
          },
        }),
      );
      await page.goto("/settings/integrations?github=error&code=409");
      await expect(page.getByRole("list", { name: "Linked installations" })).toBeVisible();
      await page.getByRole("button", { name: "Unlink acme" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Unlinked acme" })).toBeVisible();
    },
  },
  {
    name: "github connected + 404 notice, empty",
    run: async (page) => {
      await page.goto("/settings/integrations?github=error&code=404");
      await expect(page.getByText("No GitHub account is linked")).toBeVisible();
    },
  },
  {
    name: "agent key revealed + revoke dialog",
    run: async (page) => {
      await page.goto("/settings/agents");
      const card = page.getByRole("region", { name: A11Y_AGENT });
      await expect(card).toBeVisible();
      await card.getByLabel("Key name").fill("a11y");
      await card.getByRole("checkbox", { name: /^write/ }).check();
      await card.getByRole("button", { name: "Issue key" }).click();
      await expect(card.getByTestId("secret-value")).toBeVisible();
      await card.getByRole("button", { name: /Revoke key/ }).first().click();
      await expect(page.getByRole("dialog", { name: "Revoke key" })).toBeVisible();
    },
  },
  {
    name: "github link confirm page",
    run: async (page) => {
      await page.goto("/integrations/github/callback?installation_id=501&setup_action=install");
      await expect(page.getByRole("button", { name: "Link installation" })).toBeVisible();
    },
  },
  {
    name: "connected apps",
    run: async (page) => {
      await page.route("**/api/settings/oauth-grants", (r) =>
        r.fulfill({
          json: {
            grants: [
              {
                id: "g1",
                clientName: "Claude Desktop",
                clientId: "c1",
                scopes: ["read", "write"],
                userName: "E2E Runner",
                lastUsedAt: null,
                createdAt: "2026-10-10T00:00:00Z",
              },
            ],
          },
        }),
      );
      await page.goto("/settings/agents");
      await expect(page.getByRole("region", { name: "Connected apps" })).toBeVisible();
    },
  },
  {
    name: "token revealed",
    run: async (page) => {
      await page.goto("/settings/tokens");
      await page.getByLabel("Name", { exact: true }).fill("a11y token");
      await page.getByRole("button", { name: "Create token" }).click();
      await expect(page.getByTestId("secret-value")).toBeVisible();
    },
  },
];
const A11Y_AGENT = `a11y-agent-${Date.now().toString(36)}`;

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const THEMES = ["dark", "light"] as const;

// No \b anchors: the page header, list rows and key/title are adjacent flex
// items, so text can read "cycleE2E-1a11y fixture issue" with no separators.
const KEY = /[A-Z][A-Z0-9]*-\d+/;

async function issueKey(page: Page): Promise<string> {
  await page.goto("/issues");
  await page.waitForSelector("[data-qc-ready]", { timeout: 15_000 });
  let match = (await page.locator("main").innerText()).match(KEY);
  if (!match) {
    await page.keyboard.press("c");
    const dialog = page.getByRole("dialog", { name: "Quick create issue" });
    await dialog.getByPlaceholder("Issue title").fill("a11y fixture issue");
    await dialog.getByRole("button", { name: "Create issue" }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto("/issues");
    await expect(page.locator("main")).toContainText(KEY);
    match = (await page.locator("main").innerText()).match(KEY);
  }
  return match![0];
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((t) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
  }, theme);
  // colour transitions (<=150ms) must finish before axe samples contrast
  await page.waitForTimeout(400);
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}\n    ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join("\n    ")}`,
  );
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`@a11y axe ${theme} @${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      let key = "";
      test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: "tests/.auth/session.json" });
        const page = await ctx.newPage();
        key = await issueKey(page);
        await ctx.close();
        // fixture agent for the "agent key revealed" state (idempotent per name)
        const api = await apiSession();
        await api.post(`/v1/workspaces/${WS}/agents`, {
          data: { name: `${A11Y_AGENT}`, harness: "test" },
        });
        await api.dispose();
      });

      for (const state of STATES) {
        test(`state: ${state.name}`, async ({ page }) => {
          await state.run(page);
          await page.waitForLoadState("networkidle");
          await setTheme(page, theme);
          const violations = await scan(page);
          expect(violations, violations.join("\n")).toHaveLength(0);
        });
      }

      for (const path of APP_PAGES) {
        test(`${path}`, async ({ page }) => {
          await page.goto(path.replace(":key", key));
          await page.waitForLoadState("networkidle");
          await setTheme(page, theme);
          const violations = await scan(page);
          expect(violations, violations.join("\n")).toHaveLength(0);
        });
      }
    });
  }
}

test.describe("@a11y axe logged-out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const [theme, path] of THEMES.flatMap((t) => ["/", "/login"].map((p) => [t, p] as const))) {
    test(`${path} ${theme}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await setTheme(page, theme);
      const violations = await scan(page);
      expect(violations, violations.join("\n")).toHaveLength(0);
    });
  }
});
