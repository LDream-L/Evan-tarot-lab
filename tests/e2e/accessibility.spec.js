const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const BLOCKED_EXTERNAL_HOSTS = ["accounts.google.com", "script.google.com", "script.googleusercontent.com"];
const AUDIT_PAGES = [
  "/index.html",
  "/services.html",
  "/privacy.html",
  "/articles.html",
  "/lab.html",
  "/methodology.html",
  "/timeflow.html",
  "/football-lab.html",
];

/** 阻擋非必要第三方服務。時間／空間 O(1)。 */
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (BLOCKED_EXTERNAL_HOSTS.includes(host)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

/**
 * 將 axe violations 轉成可直接定位的錯誤內容。
 * 時間／空間複雜度 O(V+N)，V 為規則數、N 為失敗節點數。
 *
 * 替代方案比較：只回報 violation 數量無法定位；此格式保留規則、影響層級與 selector。
 */
function formatViolations(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/**
 * 自動掃描固定公開頁面。
 * 時間 O(P×A)，空間 O(V+N)，P 為頁數、A 為 axe 單頁掃描成本。
 *
 * 替代方案比較：人工鍵盤與螢幕閱讀器檢查仍不可取代；axe 先阻擋可自動辨識的
 * WCAG 2 A／AA 結構、名稱、對比與 ARIA 錯誤，再由鍵盤案例補足互動流程。
 */
for (const path of AUDIT_PAGES) {
  test(`${path} 通過 axe WCAG A/AA 自動掃描`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(formatViolations(results.violations)).toEqual([]);
  });
}

test("skip link 是第一個鍵盤焦點並能移到主要內容", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });

  await page.keyboard.press("Tab");
  const skipLink = page.locator(".skip-link");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page).toHaveURL(/#main-content$/);
});

test("靜態品牌在 JavaScript 執行前已存在", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".site-brand-link")).toBeVisible();
  await expect(page.locator(".site-brand-image")).toHaveCount(1);
  await expect(page.locator('.site-brand-link[aria-label="Evan Tarot 首頁"]')).toBeVisible();
  await expect(page.locator(".skip-link")).toHaveCount(1);
  await context.close();
});
