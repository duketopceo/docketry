import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const THEMES = ["dark", "light"] as const;

const KEY = /\b[A-Z][A-Z0-9]*-\d+\b/;

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
    test.describe(`axe ${theme} @${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      let key = "";
      test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: "tests/.auth/session.json" });
        const page = await ctx.newPage();
        key = await issueKey(page);
        await ctx.close();
      });

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

test.describe("axe logged-out", () => {
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
