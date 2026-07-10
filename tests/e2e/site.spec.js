const { test, expect } = require("@playwright/test");

const BLOCKED_EXTERNAL_HOSTS = ["accounts.google.com", "script.google.com", "script.googleusercontent.com"];

/** 時間／空間 O(1)：固定三個 host。 */
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (BLOCKED_EXTERNAL_HOSTS.includes(host)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

const PUBLIC_PAGES = [
  { path: "/index.html", title: "Evan Tarot｜塔羅占卜、文章與實驗室", marker: "main h1" },
  { path: "/services.html", title: "Evan Tarot｜占卜項目", marker: "#booking-form" },
  { path: "/articles.html", title: "Evan Tarot｜塔羅記事 / 文章", marker: "main h1" },
  { path: "/lab.html", title: "Evan Tarot｜塔羅實驗室", marker: "#projects" },
  { path: "/timeflow.html", title: "Evan Tarot｜主題時間流", marker: "#divination-map-app" },
  { path: "/football-lab.html", title: "Evan Tarot｜世足賽事驗證｜模型 v1.6.0・介面 v1.7.6", marker: "#football-match-form" },
];

/** 頁面巡覽：時間 O(P)，額外空間 O(1)。 */
for (const pageCase of PUBLIC_PAGES) {
  test(`${pageCase.path} 可在第三方服務失效時載入`, async ({ page }) => {
    await page.goto(pageCase.path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(pageCase.title);
    await expect(page.locator(pageCase.marker).first()).toBeVisible();
    await expect(page.locator(".site-header .logo")).toBeVisible();
    await expect(page.locator(".nav")).toBeVisible();
    await expect.poll(async () => page.locator(".nav a").count()).toBeGreaterThanOrEqual(6);
  });
}

test("主導覽能標示文章與實驗室脈絡", async ({ page }) => {
  await page.goto("/articles.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText("文章");
  await page.goto("/timeflow.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText("實驗室");
  const podcast = page.locator('.nav a[data-podcast-link="true"]');
  await expect(podcast).toHaveAttribute("target", "_blank");
  await expect(podcast).toHaveAttribute("rel", /noopener/);
});

test("實驗室提供三個主要工具入口", async ({ page }) => {
  await page.goto("/lab.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('a[href="lost-item.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="football-lab.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="timeflow.html"]').first()).toBeVisible();
});

test("世足 29 個模組由單一 bundle 完整啟動且版本顯示一致", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);
  expect(await page.evaluate(() => window.FootballLabBundle.moduleCount)).toBe(29);
  expect(await page.evaluate(() => window.FootballLabBundle.modelVersion)).toBe("1.6.0");
  expect(await page.evaluate(() => window.FootballLabBundle.interfaceVersion)).toBe("1.7.6");
  expect(await page.evaluate(() => Boolean(window.FOOTBALL_LAB_DATA && window.FootballLabCore))).toBe(true);
  await expect(page.locator(".subpage-hero .hero-text h1")).toHaveText("世足賽事驗證。");
  await expect(page.locator("#football-match-form .football-version")).toHaveText("模型 v1.6.0｜介面 v1.7.6");
  await expect(page.locator('script[src*="JS/football-lab.js"]')).toHaveCount(1);
  await expect(page.locator('script[src*="football-data.js"]')).toHaveCount(0);
  await expect(page.locator('#football-layout-final-style')).toHaveCount(1);
});

test("預約表單保留原生必填驗證並切換可配合時間", async ({ page }) => {
  await page.goto("/services.html#booking", { waitUntil: "domcontentloaded" });
  const form = page.locator("#booking-form");
  await expect(form).toBeVisible();
  expect(await form.evaluate((element) => element.checkValidity())).toBe(false);
  await page.locator('input[name="name"]').fill("E2E 測試");
  await page.locator('input[name="contact"]').fill("test@example.com");
  await page.locator('select[name="topic"]').selectOption("relationship");
  await page.locator('select[name="mode"]').selectOption("voice");
  const availability = page.locator("#booking-availability-field");
  await expect(availability).toBeVisible();
  await page.locator('textarea[name="availability"]').fill("平日 19:00 後");
  expect(await form.evaluate((element) => element.checkValidity())).toBe(true);
  await page.locator('select[name="mode"]').selectOption("text");
  await expect(availability).toBeHidden();
});

test("時間流未登入時仍呈現瀏覽介面", async ({ page }) => {
  await page.goto("/timeflow.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#map-auth-hint")).toContainText("訪客");
  await expect(page.locator("#map-viewport")).toBeVisible();
  await expect(page.locator("#map-add-topic")).toBeVisible();
  await expect(page.locator("#map-export-json")).toBeVisible();
});

test("手機尺寸仍可操作主要內容與導覽", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "此案例只在手機專案執行");
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main h1")).toBeVisible();
  const servicesLink = page.locator('.nav a[href="services.html"]');
  await expect(servicesLink).toBeVisible();
  await servicesLink.click();
  await expect(page).toHaveURL(/services\.html/);
  await expect(page.locator("#booking-form")).toBeVisible();
});
