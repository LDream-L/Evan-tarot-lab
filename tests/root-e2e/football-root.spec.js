const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "evanFootballTarotRecordsV1";
const REMOVED_LEGACY_PATHS = Object.freeze([
  "/JS/football-data.js",
  "/JS/football-core.js",
  "/JS/football-strict-scoring.js",
  "/JS/football-render.js",
  "/JS/football-direct-energy.js",
  "/JS/football-events.js",
  "/JS/football-cloud.js",
  "/JS/football-record-edit.js",
  "/JS/football-record-knockout-edit.js",
  "/JS/football-record-knockout-input-guard.js",
]);

/** 固定一筆 2026/06 舊格式紀錄；建立時間／空間 O(1)。 */
function createLegacyRecord() {
  return {
    id: "legacy-root-record-20260625",
    modelVersion: "1.0.0",
    match: {
      competition: "舊版資料相容測試盃",
      stage: "小組賽",
      kickoff: "2026-06-25T12:00:00.000Z",
      infoState: "賽前且先發未公布",
      homeTeam: "舊主隊",
      awayTeam: "舊客隊",
      odds: { home: 2.1, draw: 3.2, away: 3.6 },
    },
    cards: [
      { position: "homeAttack", positionTitle: "主隊進攻", name: "戰車", orientation: "正位" },
      { position: "awayDefense", positionTitle: "客隊防守", name: "寶劍四", orientation: "逆位" },
      { position: "awayAttack", positionTitle: "客隊進攻", name: "星星", orientation: "正位" },
      { position: "homeDefense", positionTitle: "主隊防守", name: "皇帝", orientation: "正位" },
      { position: "result", positionTitle: "90 分鐘結果", name: "世界", orientation: "正位" },
    ],
    prediction: {
      homeAttackBand: "2",
      homeDefenseBand: "1",
      awayAttackBand: "1",
      awayDefenseBand: "2",
      result: "H",
      notes: "舊版五牌位原始解讀",
      homeExact: 2,
      awayExact: 1,
      advance: "",
    },
    drawnAt: "2026-06-25T11:50:00.000Z",
    lockedAt: "2026-06-25T11:55:00.000Z",
    actual: null,
  };
}

test("repository 根目錄可啟動正式世足入口並顯示舊紀錄", async ({ page }) => {
  const requestedPaths = [];
  const pageErrors = [];

  page.on("request", (request) => {
    requestedPaths.push(new URL(request.url()).pathname);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (["accounts.google.com", "script.google.com", "script.googleusercontent.com"].includes(host)) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  await page.addInitScript(({ key, record }) => {
    window.localStorage.setItem(key, JSON.stringify([record]));
  }, { key: STORAGE_KEY, record: createLegacyRecord() });

  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready)),
    { timeout: 20_000 }
  ).toBe(true);

  expect(await page.evaluate(() => window.FootballLabRootLoader?.getStatus())).toBe("ready");
  await expect(page.locator("#football-records-body tr")).toHaveCount(1);
  await expect(page.locator("#football-records-body")).toContainText("舊版資料相容測試盃");
  await expect(page.locator("#football-records-body")).toContainText("舊主隊 vs 舊客隊");
  await expect(page.locator("#football-records-body")).toContainText("戰車正位");
  await expect(page.locator("#football-empty-state")).toBeHidden();

  REMOVED_LEGACY_PATHS.forEach((path) => {
    expect(requestedPaths, `根目錄不得再請求已移除模組 ${path}`).not.toContain(path);
  });
  expect(pageErrors).toEqual([]);
});