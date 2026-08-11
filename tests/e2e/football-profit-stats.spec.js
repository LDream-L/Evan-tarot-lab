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

/** 固定兩筆測試紀錄：時間／空間 O(1)。 */
function recordsFixture() {
  return [
    {
      id: "profit-manual",
      modelVersion: "1.6.0",
      match: {
        competition: "測試賽事",
        kickoff: "2026-08-01T12:00:00.000Z",
        homeTeam: "主隊A",
        awayTeam: "客隊A",
        mode: "structure",
        cardSource: "manual",
        odds: { home: null, draw: null, away: null },
      },
      cards: [],
      prediction: {
        structureHomeGoals: 1,
        structureAwayGoals: 0,
        structureConfidence: 3,
        structureNotes: "測試",
        bets: [{ id: "bet-manual", marketType: "match_result", selection: "H", odds: 2, stake: 100 }],
      },
      drawnAt: "2026-08-01T10:00:00.000Z",
      lockedAt: "2026-08-01T10:01:00.000Z",
      actual: { homeGoals: 1, awayGoals: 0, recordedAt: "2026-08-01T14:00:00.000Z" },
    },
    {
      id: "profit-random",
      modelVersion: "1.6.0",
      match: {
        competition: "測試賽事",
        kickoff: "2026-08-02T12:00:00.000Z",
        homeTeam: "主隊B",
        awayTeam: "客隊B",
        mode: "structure",
        cardSource: "random",
        odds: { home: null, draw: null, away: null },
      },
      cards: [],
      prediction: {
        structureHomeGoals: 0,
        structureAwayGoals: 1,
        structureConfidence: 3,
        structureNotes: "測試",
        bets: [{ id: "bet-random", marketType: "match_result", selection: "H", odds: 2, stake: 50 }],
      },
      drawnAt: "2026-08-02T10:00:00.000Z",
      lockedAt: "2026-08-02T10:01:00.000Z",
      actual: { homeGoals: 0, awayGoals: 1, recordedAt: "2026-08-02T14:00:00.000Z" },
    },
  ];
}

/** 兩個子區塊各自收合，且期間投注損益跟隨日期視窗更新。 */
test("統計子區塊可獨立展開並顯示期間總損益", async ({ page }) => {
  const fixture = recordsFixture();
  await page.addInitScript((records) => {
    window.localStorage.setItem("evanFootballTarotRecordsV1", JSON.stringify(records));
  }, fixture);
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);

  const outer = page.locator("#football-stats-accordion");
  await outer.locator(":scope > summary").click();

  const source = page.locator("#football-source-comparison");
  const performance = page.locator("#football-performance-observer");
  await expect(source).toHaveJSProperty("open", false);
  await expect(performance).toHaveJSProperty("open", false);

  await performance.locator(":scope > summary").click();
  await expect(performance).toHaveJSProperty("open", true);
  await expect(source).toHaveJSProperty("open", false);

  const all = page.locator('[data-betting-scope="all"]');
  const manual = page.locator('[data-betting-scope="manual"]');
  const random = page.locator('[data-betting-scope="random"]');
  await expect(all).toContainText("+$50");
  await expect(all).toContainText("總成本 $150");
  await expect(all).toContainText("ROI +33.3%");
  await expect(manual).toContainText("+$100");
  await expect(random).toContainText("$-50");

  await page.locator("#football-trend-mode").selectOption("range");
  await page.locator("#football-trend-start").fill("2026-08-01");
  await page.locator("#football-trend-end").fill("2026-08-01");
  await expect(all).toContainText("+$100");
  await expect(all).toContainText("總成本 $100");
  await expect(all).toContainText("ROI +100%");
  await expect(random).toContainText("此期間尚無已結算投注");

  await source.locator(":scope > summary").click();
  await expect(source).toHaveJSProperty("open", true);
  await expect(performance).toHaveJSProperty("open", true);
});
