import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/my-issues", "/triage", "/issues"];

for (const path of PAGES) {
  test(`axe: no violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.map(
      (v) => `${v.id}: ${v.nodes.length} node(s) — ${v.help}`,
    );
    expect(violations, violations.join("\n")).toHaveLength(0);
  });
}
