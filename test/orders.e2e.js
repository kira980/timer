import { test, expect } from "@playwright/test";

const tray = (page, i) => page.locator(".tray").nth(i);
const part = (page, i, p) => tray(page, i).locator(`.part[data-part="${p}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#mode-orders").click();
});

test("toggle switches between Timer and Orders, keeping state", async ({ page }) => {
  await expect(page.locator(".tray.order")).toHaveCount(5);
  await expect(page.locator("#mode-orders")).toHaveAttribute("aria-pressed", "true");
  await expect(part(page, 0, "bake").locator(".count")).toHaveText("20:00");
  await expect(part(page, 0, "pickup").locator(".count")).toHaveText("30:00");

  await page.locator("#mode-timer").click();
  await expect(page.locator(".tray.order")).toHaveCount(0);
  await expect(tray(page, 0).locator(".time")).toHaveText("05:00");
  await tray(page, 0).locator(".start").click();

  await page.locator("#mode-orders").click();
  await expect(tray(page, 0).locator(".start")).toHaveText("Start"); // modes independent
  await page.reload();
  await expect(page.locator(".tray.order")).toHaveCount(5); // mode remembered
  await page.locator("#mode-timer").click();
  await expect(tray(page, 0)).toHaveClass(/running/); // timer kept running
});

test("start runs bake and pickup; reset restores", async ({ page }) => {
  await tray(page, 1).locator(".start").click();
  await expect(part(page, 1, "bake")).toHaveClass(/running/);
  await expect(part(page, 1, "pickup")).toHaveClass(/running/);
  await expect(part(page, 1, "bake").locator(".at")).toContainText("at ");
  await expect(part(page, 1, "bake").locator(".count")).toHaveText("19:58", { timeout: 4000 });
  await expect(part(page, 0, "bake")).not.toHaveClass(/running/);

  await tray(page, 1).locator(".start").click();
  await expect(tray(page, 1).locator(".start")).toHaveText("Resume");
  await tray(page, 1).locator(".reset").click();
  await expect(part(page, 1, "bake").locator(".count")).toHaveText("20:00");
  await expect(tray(page, 1).locator(".start")).toHaveText("Start");
});

test("edit bake duration manually; bake finishes before pickup", async ({ page }) => {
  await part(page, 2, "bake").click();
  const dlg = page.locator("#edit-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("h2")).toHaveText("Tray 3 · Bake");
  await dlg.locator('input[name="duration"]').fill("abc");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.locator("#edit-error")).toBeVisible();
  await dlg.locator('input[name="duration"]').fill("0:02");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(part(page, 2, "bake").locator(".count")).toHaveText("00:02");
  await expect(part(page, 2, "pickup").locator(".count")).toHaveText("30:00"); // only bake changed
  await expect(part(page, 3, "bake").locator(".count")).toHaveText("20:00"); // only this tray

  await tray(page, 2).locator(".start").click();
  await expect(part(page, 2, "bake")).toHaveClass(/done/, { timeout: 5000 });
  await expect(part(page, 2, "bake").locator(".at")).toHaveText("Done");
  await expect(part(page, 2, "pickup")).toHaveClass(/running/);
  await expect(tray(page, 2)).toHaveClass(/done/);
});

test("set pickup as a clock time counts down to it", async ({ page }) => {
  const target = await page.evaluate(() => {
    const d = new Date(Date.now() + 45 * 60_000 + 30_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  await part(page, 0, "pickup").click();
  const dlg = page.locator("#edit-dialog");
  await dlg.getByText("At time").click();
  await dlg.locator('input[name="clock"]').fill(target);
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(part(page, 0, "pickup")).toHaveClass(/running/);
  await expect(part(page, 0, "pickup").locator(".count")).toHaveText(/^(44|45):\d\d$/);
  await expect(part(page, 0, "bake")).not.toHaveClass(/running/);
});

test("cancel leaves the time unchanged", async ({ page }) => {
  await part(page, 0, "bake").click();
  const dlg = page.locator("#edit-dialog");
  await dlg.locator('input[name="duration"]').fill("7");
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toBeHidden();
  await expect(part(page, 0, "bake").locator(".count")).toHaveText("20:00");
});

test("settings: apply uniform times to all trays", async ({ page }) => {
  // make tray 1 different first
  await part(page, 0, "bake").click();
  await page.locator('#edit-dialog input[name="duration"]').fill("3");
  await page.locator("#edit-dialog").getByRole("button", { name: "Save" }).click();
  await tray(page, 4).locator(".start").click();

  await page.locator("#settings-btn").click();
  const dlg = page.locator("#settings-dialog");
  await dlg.locator('input[name="bakeMs"]').fill("15");
  await dlg.locator('input[name="pickupMs"]').fill("25");
  await dlg.locator('input[name="timerMs"]').fill("2:30");
  page.once("dialog", (d) => d.accept()); // "some trays are running" confirm
  await dlg.getByRole("button", { name: "Apply to all trays" }).click();
  await expect(dlg).toBeHidden();

  for (let i = 0; i < 5; i++) {
    await expect(part(page, i, "bake").locator(".count")).toHaveText("15:00");
    await expect(part(page, i, "pickup").locator(".count")).toHaveText("25:00");
  }
  await expect(page.locator(".tray.running")).toHaveCount(0);

  // new trays use the saved defaults, and settings persist
  await page.locator("#add").click();
  await expect(part(page, 5, "bake").locator(".count")).toHaveText("15:00");
  await page.locator("#mode-timer").click();
  await expect(tray(page, 0).locator(".time")).toHaveText("02:30");
  await page.reload();
  await page.locator("#settings-btn").click();
  await expect(page.locator('#settings-dialog input[name="bakeMs"]')).toHaveValue("15:00");
});

test("settings: invalid value is rejected", async ({ page }) => {
  await page.locator("#settings-btn").click();
  const dlg = page.locator("#settings-dialog");
  await dlg.locator('input[name="bakeMs"]').fill("x");
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dlg.locator("#settings-error")).toBeVisible();
  await expect(dlg).toBeVisible();
});

test("orders mode has no horizontal scroll", async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
