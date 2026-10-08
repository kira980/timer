import { test, expect } from "@playwright/test";

const trays = (page) => page.locator(".tray");
const tray = (page, i) => trays(page).nth(i);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("shows 5 trays at 05:00 by default", async ({ page }) => {
  await expect(trays(page)).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect(tray(page, i).locator(".time")).toHaveText("05:00");
    await expect(tray(page, i).locator(".start")).toHaveText("Start");
    await expect(tray(page, i).locator(".reset")).toBeVisible();
  }
});

test("start runs only that tray, pause and reset work", async ({ page }) => {
  const t = tray(page, 1);
  await t.locator(".start").click();
  await expect(t).toHaveClass(/running/);
  await expect(t.locator(".start")).toHaveText("Pause");
  await expect(t.locator(".time")).toHaveText("04:58", { timeout: 4000 });
  // others untouched
  await expect(tray(page, 0)).not.toHaveClass(/running/);
  await expect(tray(page, 0).locator(".time")).toHaveText("05:00");

  await t.locator(".start").click();
  await expect(t.locator(".start")).toHaveText("Resume");
  const paused = await t.locator(".time").textContent();
  await page.waitForTimeout(1500);
  await expect(t.locator(".time")).toHaveText(paused);

  await t.locator(".reset").click();
  await expect(t.locator(".time")).toHaveText("05:00");
  await expect(t.locator(".start")).toHaveText("Start");
});

test("multiple trays run simultaneously", async ({ page }) => {
  await tray(page, 0).locator(".start").click();
  await tray(page, 4).locator(".start").click();
  await expect(page.locator(".tray.running")).toHaveCount(2);
  await expect(page).toHaveTitle("(2) Tray Timer");
});

test("custom duration counts down to done", async ({ page }) => {
  const t = tray(page, 2);
  await t.locator(".time").click();
  await t.locator(".time input").fill("0:02");
  await t.locator(".time input").press("Enter");
  await expect(t.locator(".time")).toHaveText("00:02");
  await t.locator(".start").click();
  await expect(t).toHaveClass(/done/, { timeout: 5000 });
  await expect(t.locator(".time")).toHaveText("00:00");
  await expect(t.locator(".start")).toHaveText("Restart");
  await t.locator(".reset").click();
  await expect(t).not.toHaveClass(/done/);
  await expect(t.locator(".time")).toHaveText("00:02");
});

test("invalid duration is ignored", async ({ page }) => {
  const t = tray(page, 0);
  await t.locator(".time").click();
  await t.locator(".time input").fill("abc");
  await t.locator(".time input").press("Enter");
  await expect(t.locator(".time")).toHaveText("05:00");
});

test("add, rename and remove trays; state persists across reload", async ({ page }) => {
  await page.locator("#add").click();
  await expect(trays(page)).toHaveCount(6);
  await expect(tray(page, 5).locator(".name")).toHaveValue("Tray 6");

  await tray(page, 0).locator(".name").fill("Cookies");
  await tray(page, 0).locator(".name").press("Enter");
  await tray(page, 0).locator(".start").click();

  page.once("dialog", (d) => d.accept());
  await tray(page, 3).locator(".remove").click();
  await expect(trays(page)).toHaveCount(5);

  await page.reload();
  await expect(trays(page)).toHaveCount(5);
  await expect(tray(page, 0).locator(".name")).toHaveValue("Cookies");
  await expect(tray(page, 0)).toHaveClass(/running/);
});

test("is an installable PWA and works offline", async ({ page, context }) => {
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    return (await fetch(href)).json();
  });
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  for (const icon of manifest.icons) {
    const res = await page.request.get(icon.src);
    expect(res.ok(), icon.src).toBeTruthy();
  }

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let SW control the page
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(trays(page)).toHaveCount(5);
  await tray(page, 0).locator(".start").click();
  await expect(tray(page, 0)).toHaveClass(/running/);
  await context.setOffline(false);
});

test("no horizontal scroll and no console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.reload();
  await expect(trays(page)).toHaveCount(5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
