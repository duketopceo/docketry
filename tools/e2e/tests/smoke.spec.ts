import { expect, test } from "@playwright/test";

const TITLE = `e2e smoke ${Date.now()}`;

test("create issue via quick-create → appears in list → opens detail", async ({
  page,
}) => {
  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "All Issues" })).toBeVisible();

  // wait for client hydration before pressing keys (listener attaches in useEffect)
  await page.waitForLoadState("networkidle");
  const dialogCheck = page.getByRole("dialog", { name: "Quick create issue" });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("c");
    if (await dialogCheck.isVisible().catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  const dialog = page.getByRole("dialog", { name: "Quick create issue" });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("Issue title").fill(TITLE);
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(dialog).not.toBeVisible();

  await page.goto("/triage");
  const row = page.getByRole("button", { name: new RegExp(TITLE) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/issues\/[A-Z0-9]+-\d+/);
  await expect(
    page.getByRole("heading", { name: TITLE }),
  ).toBeVisible();
});
