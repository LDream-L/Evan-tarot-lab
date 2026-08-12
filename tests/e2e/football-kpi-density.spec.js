const { test, expect } = require("@playwright/test");

const BLOCKED_EXTERNAL_HOSTS = ["accounts.google.com", "script.google.com", "script.googleusercontent.com"];

/** 固定三個外部 host：時間／空間 O(1)。 */
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (BLOCKED_EXTERNAL_HOSTS.includes(host)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

/** 固定 KPI 數量：時間 O(k)，額外空間 O(1)。 */
test("滾動績效 KPI 依桌機與手機使用 3／1 欄寬版配置", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);
  await expect(page.locator("#football-kpi-density-style")).toHaveCount(1);
  await expect.poll(() => page.locator("#football-kpis > .football-kpi").count()).toBeGreaterThanOrEqual(7);
  await page.locator("#football-stats-accordion > summary").click();
  await page.locator("#football-performance-observer > summary").click();
  await expect(page.locator("#football-kpis .football-kpi-readable-label").first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const grid = document.getElementById("football-kpis");
    const card = grid?.querySelector(":scope > .football-kpi");
    const row = card?.querySelector(".football-kpi-clear-row");
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const cardStyle = card ? getComputedStyle(card) : null;
    const rowStyle = row ? getComputedStyle(row) : null;
    return {
      viewportWidth: window.innerWidth,
      columnCount: gridStyle?.gridTemplateColumns.split(" ").filter(Boolean).length || 0,
      cardWidth: card?.getBoundingClientRect().width || 0,
      cardDisplay: cardStyle?.display || "",
      rowColumnCount: rowStyle?.gridTemplateColumns.split(" ").filter(Boolean).length || 0,
    };
  });

  if (layout.viewportWidth > 1180) {
    expect(layout.columnCount).toBe(3);
    expect(layout.cardWidth).toBeGreaterThan(280);
  } else if (layout.viewportWidth > 680) {
    expect(layout.columnCount).toBe(2);
    expect(layout.cardWidth).toBeGreaterThan(300);
  } else {
    expect(layout.columnCount).toBe(1);
    expect(layout.cardWidth).toBeGreaterThan(layout.viewportWidth * 0.7);
  }

  expect(layout.cardDisplay).toBe("grid");
  expect(layout.rowColumnCount).toBe(layout.viewportWidth <= 430 ? 1 : 2);
});
