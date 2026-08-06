const { test, expect } = require("@playwright/test");

const BLOCKED_EXTERNAL_HOSTS = [
  "accounts.google.com",
  "script.google.com",
  "script.googleusercontent.com",
];

/** 固定三個外部 host：時間／空間 O(1)。 */
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (BLOCKED_EXTERNAL_HOSTS.includes(host)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

test("已鎖定紀錄編輯器移除舊賠率欄位並提供可修改運彩區", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))
  ).toBe(true);

  await expect(page.locator("#football-edit-home-odds")).toHaveCount(0);
  await expect(page.locator("#football-edit-draw-odds")).toHaveCount(0);
  await expect(page.locator("#football-edit-away-odds")).toHaveCount(0);

  const fieldset = page.locator("#football-edit-betting-fieldset");
  await expect(fieldset).toHaveCount(1);
  await expect(fieldset.locator("legend")).toHaveText("運彩投注（選填）");
  await expect(fieldset.locator("#football-edit-betting-category")).toHaveCount(1);
  await expect(fieldset.locator("#football-edit-betting-market")).toHaveCount(1);
  await expect(fieldset.locator("#football-edit-betting-odds")).toHaveCount(1);
  await expect(fieldset.locator("#football-edit-betting-stake")).toHaveCount(1);
  await expect(fieldset.locator("#football-edit-betting-upsert")).toHaveText("＋ 新增投注");

  const runtime = await page.evaluate(() => ({
    exists: Boolean(window.FootballLabRecordBettingEdit),
    bound: window.FootballLabRecordBettingEdit?.isBound?.() === true,
    stage: window.FootballKnockoutEditRuntime?.bettingEditStage,
    editorLinked: window.FootballKnockoutEditRuntime?.bettingEditor
      === window.FootballLabRecordBettingEdit,
  }));

  expect(runtime).toEqual({
    exists: true,
    bound: true,
    stage: "record-betting-edit-ready",
    editorLinked: true,
  });
});
