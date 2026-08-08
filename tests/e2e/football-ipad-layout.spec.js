import { test, expect } from "@playwright/test";

const IPAD_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "pro-landscape", width: 1366, height: 1024 }),
  Object.freeze({ name: "11-landscape", width: 1194, height: 834 }),
  Object.freeze({ name: "classic-landscape", width: 1024, height: 768 }),
  Object.freeze({ name: "portrait", width: 768, height: 1024 }),
]);

/**
 * 驗證整頁沒有水平溢位。時間 O(1)，空間 O(1)。
 * 更快替代方案比較：只檢查某個 panel 寬度較快但會漏掉 header、表格或動態比較卡；
 * 直接比較 document scrollWidth 與 viewport 可一次覆蓋整頁布局。
 */
async function expectNoHorizontalOverflow(page, viewportWidth) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(metrics.innerWidth).toBe(viewportWidth);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
}

/**
 * STEP 1 必須維持兩欄語意版面。時間／空間 O(1)。
 * 更快替代方案比較：只驗證沒有 overflow 可能漏掉「仍是桌機六欄但剛好沒超寬」；
 * 同時檢查 Grid 欄數與關鍵全寬欄位，才能攔住 iPad Pro 被誤判成桌機的回歸。
 */
async function expectTabletStepOneLayout(page) {
  const layout = await page.evaluate(() => {
    const grid = document.querySelector('.football-form-grid[data-layout-form="match"]');
    const competition = document.getElementById("football-competition")?.closest("label");
    const source = document.getElementById("football-card-source")?.closest("label");
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean) : [];
    const competitionStyle = competition ? getComputedStyle(competition) : null;
    const sourceStyle = source ? getComputedStyle(source) : null;
    return {
      columnCount: columns.length,
      competitionStart: competitionStyle?.gridColumnStart || "",
      competitionEnd: competitionStyle?.gridColumnEnd || "",
      sourceStart: sourceStyle?.gridColumnStart || "",
      sourceEnd: sourceStyle?.gridColumnEnd || "",
    };
  });

  expect(layout.columnCount).toBe(2);
  expect(layout.competitionStart).toBe("1");
  expect(layout.competitionEnd).toBe("-1");
  expect(layout.sourceStart).toBe("1");
  expect(layout.sourceEnd).toBe("-1");
}

for (const viewport of IPAD_VIEWPORTS) {
  test(`football lab stays inside iPad ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.route(/googleapis|accounts\.google|script\.google|gstatic/, (route) => route.abort());
    await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.FootballLabBundle?.ready));
    await page.locator("#football-source-comparison").waitFor({ state: "visible" });

    await expect(page.locator("#football-match-form")).toBeVisible();
    await expect(page.locator("#football-records")).toBeVisible();
    await expect(page.locator("link[href*='football-ipad-layout.css']")).toHaveCount(1);
    await expectNoHorizontalOverflow(page, viewport.width);
    await expectTabletStepOneLayout(page);
  });
}
