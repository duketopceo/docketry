import { expect, test } from "@playwright/test";
import { bearer } from "../support/api";

// UX-009: create an agent, mint/revoke keys, create/revoke a PAT — entirely
// through the UI; plaintext is shown once and never retrievable afterwards.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

const AGENT = `e2e-agent-${Date.now().toString(36)}`;

async function whoami(token: string): Promise<number> {
  const ctx = await bearer(token);
  const res = await ctx.get("/v1/whoami");
  const status = res.status();
  await ctx.dispose();
  return status;
}

test("agents: create identity, issue read-only key (default), copy once, revoke", async ({
  page,
}) => {
  const csp: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) csp.push(m.text());
  });
  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "Agents and keys" })).toBeVisible();

  await page.getByLabel("Name (lowercase, digits, dashes)").fill(AGENT);
  await page.getByLabel("Harness").fill("claude-code");
  await page.getByRole("button", { name: "Create agent" }).click();
  const card = page.getByRole("region", { name: AGENT });
  await expect(card).toBeVisible();
  await expect(card.getByText("No keys issued.")).toBeVisible();

  // duplicate name is explained, not a raw error
  await page.getByLabel("Name (lowercase, digits, dashes)").fill(AGENT);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText("An agent with that name already exists")).toBeVisible();

  // read-only is the visible default: read ticked + locked, write unticked
  const read = card.getByRole("checkbox", { name: /^read/ });
  const write = card.getByRole("checkbox", { name: /^write/ });
  await expect(read).toBeChecked();
  await expect(read).toBeDisabled();
  await expect(write).not.toBeChecked();

  await card.getByLabel("Key name").fill("laptop");
  await card.getByRole("button", { name: "Issue key" }).click();
  const reveal = card.getByRole("status", { name: "API key created" });
  await expect(reveal).toBeVisible();
  const key = (await reveal.getByTestId("secret-value").innerText()).trim();
  expect(key).toMatch(/^tly_agt_[\w-]{20,}$/);

  await reveal.getByRole("button", { name: "Copy API key" }).click();
  await expect(reveal.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  // the issued key authenticates as an agent
  expect(await whoami(key)).toBe(200);
  await expect(card.getByRole("row", { name: /laptop/ }).getByText("read")).toBeVisible();

  // gone after dismiss and after reload — never retrievable
  await reveal.getByRole("button", { name: "I have saved it" }).click();
  await expect(reveal).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: AGENT })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(key);

  // a write key needs the explicit opt-in and says so
  const card2 = page.getByRole("region", { name: AGENT });
  await card2.getByLabel("Key name").fill("ci");
  await card2.getByRole("checkbox", { name: /^write/ }).check();
  await card2.getByLabel("Expires").selectOption("30");
  await card2.getByRole("button", { name: "Issue key" }).click();
  const writeKey = (
    await card2.getByTestId("secret-value").innerText()
  ).trim();
  const ciRow = card2.getByRole("row", { name: /^ci / });
  await expect(ciRow.getByText("write")).toBeVisible();
  await expect(ciRow.getByText("never")).toHaveCount(1); // last used: never (it has an expiry date)
  expect(await whoami(writeKey)).toBe(200);

  // revoke: confirm dialog, then the key stops working immediately
  await card2.getByRole("button", { name: "Revoke key ci" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke key" });
  await dialog.getByRole("button", { name: "cancel" }).click();
  expect(await whoami(writeKey)).toBe(200);
  await card2.getByRole("button", { name: "Revoke key ci" }).click();
  const revoked = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes("/keys/") && r.ok(),
  );
  await page.getByRole("dialog").getByRole("button", { name: "Revoke key" }).click();
  await revoked;
  await expect(card2.getByRole("row", { name: /^ci / })).toHaveCount(0);
  expect(await whoami(writeKey)).toBe(401);
  expect(await whoami(key)).toBe(200); // other key untouched
  expect(csp).toEqual([]);
});

test("tokens: explicit scopes, shown once, revoke", async ({ page }) => {
  await page.goto("/settings/tokens");
  await expect(page.getByRole("heading", { name: "Personal access tokens" })).toBeVisible();

  const read = page.getByRole("checkbox", { name: /^read/ });
  await expect(read).toBeChecked();
  await expect(read).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^write/ })).not.toBeChecked();

  const name = `e2e-pat-${Date.now().toString(36)}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create token" }).click();
  const reveal = page.getByRole("status", { name: "token created" });
  const token = (await reveal.getByTestId("secret-value").innerText()).trim();
  expect(token).toMatch(/^tly_/);
  expect(await whoami(token)).toBe(200);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("read")).toBeVisible();
  await expect(row.getByText("write")).toHaveCount(0);

  await reveal.getByRole("button", { name: "I have saved it" }).click();
  await page.reload();
  await expect(page.locator("body")).not.toContainText(token);

  await page.getByRole("button", { name: `Revoke token ${name}` }).click();
  const revoked = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes("/api/settings/tokens/") && r.ok(),
  );
  await page.getByRole("dialog").getByRole("button", { name: "Revoke token" }).click();
  await revoked;
  await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
  expect(await whoami(token)).toBe(401);
});

test("settings sub-navigation reaches every section", async ({ page }) => {
  await page.goto("/settings/members");
  const nav = page.getByRole("navigation", { name: "Settings" });
  for (const [label, url] of [
    ["Agents", /\/settings\/agents$/],
    ["Tokens", /\/settings\/tokens$/],
    ["Integrations", /\/settings\/integrations$/],
    ["Invites", /\/settings\/invites$/],
    ["Members", /\/settings\/members$/],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }
});

test("@keyboard create an agent, issue a key and dismiss a dialog without a pointer", async ({ page }) => {
  await page.goto("/settings/agents");
  const name = `kbd-agent-${Date.now().toString(36)}`;
  await page.getByLabel("Name (lowercase, digits, dashes)").focus();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter"); // submits the form
  const card = page.getByRole("region", { name });
  await expect(card).toBeVisible();

  await card.getByLabel("Key name").focus();
  await page.keyboard.type("kbd");
  await page.keyboard.press("Enter");
  await expect(card.getByTestId("secret-value")).toBeVisible();
  await card.getByRole("button", { name: "I have saved it" }).focus();
  await page.keyboard.press("Enter");

  // Esc closes the confirm dialog and focus returns to the revoke button
  const revoke = card.getByRole("button", { name: "Revoke key kbd" });
  await revoke.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Revoke key" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(revoke).toBeFocused();
});

// OAuth grants come from PR #98's routes; mocked at the browser boundary so
// this passes whether or not that API has landed.
const GRANT = {
  id: "11111111-1111-4111-8111-111111111111",
  clientName: "Claude Desktop",
  clientId: "c1",
  scopes: ["read", "write"],
  userName: "E2E Runner",
  lastUsedAt: null,
  createdAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
};

test("connected apps: listed, revoke is undoable and commits after the window", async ({ page }) => {
  await page.route("**/api/settings/oauth-grants", (r) => r.fulfill({ json: { grants: [GRANT] } }));
  let deleted = 0;
  await page.route("**/api/settings/oauth-grants/*", (r) => {
    deleted++;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/settings/agents");
  const section = page.getByRole("region", { name: "Connected apps" });
  await expect(section.getByRole("row", { name: /Claude Desktop/ })).toBeVisible();
  await expect(section.getByText("2h ago")).toBeVisible();
  await section.getByRole("button", { name: "Revoke Claude Desktop" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Revoked Claude Desktop" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(section.getByRole("row", { name: /Claude Desktop/ })).toBeVisible();
  expect(deleted).toBe(0);
  await section.getByRole("button", { name: "Revoke Claude Desktop" }).click();
  await expect.poll(() => deleted, { timeout: 15_000 }).toBe(1);
});

test("connected apps: hidden when the API has no grants endpoint", async ({ page }) => {
  await page.route("**/api/settings/oauth-grants", (r) =>
    r.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "no" } } }),
  );
  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "New agent identity" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Connected apps" })).toHaveCount(0);
});
