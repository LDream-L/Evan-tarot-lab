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

test("雙牌源統計預設收合，展開後顯示現行能量指標", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))
  ).toBe(true);

  const accordion = page.locator("#football-stats-accordion");
  const summary = accordion.locator("summary");
  const panel = page.locator("#football-source-comparison");

  await expect(accordion).toBeVisible();
  await expect(accordion).not.toHaveAttribute("open", "");
  await expect(accordion).toContainText("驗證統計");
  await expect(accordion).toContainText("統計數據與雙牌源比較");
  await expect(accordion).toContainText("展開數據");
  await expect(panel).not.toBeVisible();

  await summary.click();

  await expect(accordion).toHaveAttribute("open", "");
  await expect(accordion).toContainText("收合數據");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("自己抽牌｜單張能量");
  await expect(panel).toContainText("網站抽牌｜單張能量");
  await expect(panel).not.toContainText("單張賽果");

  const runtime = await page.evaluate(() => ({
    metricModel: window.FootballSourceComparisonRuntime?.metricModel,
    hasCalculator: typeof window.FootballSourceComparisonRuntime?.calculateSourceComparison === "function",
    sport: document.getElementById("football-sport-type")?.value,
    source: document.getElementById("football-card-source")?.value,
    accordionOpen: document.getElementById("football-stats-accordion")?.open === true,
    kpisInsideAccordion: document.getElementById("football-kpis")?.parentElement?.id
      === "football-stats-accordion-content",
  }));

  expect(runtime).toEqual({
    metricModel: "energy-v1",
    hasCalculator: true,
    sport: "football",
    source: "compare",
    accordionOpen: true,
    kpisInsideAccordion: true,
  });

  await summary.click();
  await expect(accordion).not.toHaveAttribute("open", "");
  await expect(accordion).toContainText("展開數據");
  await expect(panel).not.toBeVisible();
});
