const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "evanFootballTarotRecordsV1";

/**
 * 建立對應使用者畫面的一筆雙模型能量紀錄。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 替代方案比較：直接在測試中操作完整表單可驗證建立流程，但步驟多且不易精準定位
 * 舊紀錄顯示問題；本測試固定寫入最小完整紀錄，直接鎖定摘要相容契約。
 */
function createEnergyRecord() {
  return {
    id: "energy-summary-regression-20260711",
    modelVersion: "1.6.0",
    match: {
      competition: "單張能量摘要測試盃",
      stage: "小組賽",
      kickoff: "2026-07-11T12:00:00.000Z",
      infoState: "賽前且先發未公布",
      homeTeam: "主隊",
      awayTeam: "客隊",
      mode: "dual",
      cardSource: "manual",
      odds: { home: null, draw: null, away: null },
    },
    cards: [
      { group: "direct", position: "directResult", positionTitle: "單張｜90 分鐘整體能量", name: "世界", orientation: "正位" },
      { group: "structure", position: "homeAttack", positionTitle: "攻防組｜主隊進攻", name: "戰車", orientation: "正位" },
      { group: "structure", position: "awayDefense", positionTitle: "攻防組｜客隊防守", name: "寶劍四", orientation: "逆位" },
      { group: "structure", position: "awayAttack", positionTitle: "攻防組｜客隊進攻", name: "星星", orientation: "正位" },
      { group: "structure", position: "homeDefense", positionTitle: "攻防組｜主隊防守", name: "皇帝", orientation: "正位" },
    ],
    prediction: {
      directModel: "energy-v1",
      directGoalBand: "low",
      directDrawTendency: "decisive",
      directResult: "ND",
      directConfidence: 3,
      directNotes: "低比分且非和局傾向。",
      structureHomeGoals: 1,
      structureAwayGoals: 0,
      structureConfidence: 3,
      structureNotes: "主隊攻防略優。",
      advance: "",
    },
    drawnAt: "2026-07-11T11:50:00.000Z",
    lockedAt: "2026-07-11T11:55:00.000Z",
    actual: null,
  };
}

test("單張能量非和局代碼不會顯示 undefined", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (["accounts.google.com", "script.google.com", "script.googleusercontent.com"].includes(host)) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  await page.addInitScript(({ key, record }) => {
    window.localStorage.setItem(key, JSON.stringify([record]));
  }, { key: STORAGE_KEY, record: createEnergyRecord() });

  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready)),
    { timeout: 20_000 }
  ).toBe(true);

  const records = page.locator("#football-records-body");
  await expect(records).toContainText("單張總進球 0–1 球｜非和局傾向");
  await expect(records).toContainText("攻防1：0｜主隊勝");
  await expect(records).not.toContainText("undefined");
});
