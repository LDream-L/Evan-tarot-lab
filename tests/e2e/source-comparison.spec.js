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

test("雙牌源摘要使用現行單張能量指標", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))
  ).toBe(true);

  const panel = page.locator("#football-source-comparison");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("自己抽牌｜單張能量");
  await expect(panel).toContainText("網站抽牌｜單張能量");
  await expect(panel).not.toContainText("單張賽果");

  const runtime = await page.evaluate(() => ({
    metricModel: window.FootballSourceComparisonRuntime?.metricModel,
    hasCalculator: typeof window.FootballSourceComparisonRuntime?.calculateSourceComparison === "function",
    sport: document.getElementById("football-sport-type")?.value,
    source: document.getElementById("football-card-source")?.value,
  }));

  expect(runtime).toEqual({
    metricModel: "energy-v1",
    hasCalculator: true,
    sport: "football",
    source: "compare",
  });
});
