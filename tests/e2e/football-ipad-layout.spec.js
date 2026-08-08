import { test, expect } from "@playwright/test";

const IPAD_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "landscape", width: 1024, height: 768 }),
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
  });
}
