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

/**
 * 固定建立兩筆同場紀錄；牌數上限 4，時間／空間 O(1)。
 * 驗證客觀賽果同步，但兩個 reviewAnalysis 必須保持不同。
 */
test("同場雙牌源共用賽果但分開保存賽後回顧", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);

  await page.evaluate(() => {
    const core = window.FootballLabCore;
    const groupId = "e2e-source-review-separation";
    const common = {
      sportType: "football",
      sportLabel: "足球",
      sourceExperiment: "manual-vs-random",
      comparisonGroupId: groupId,
      competition: "E2E 雙牌源回顧",
      stage: "其他",
      kickoff: "2026-08-01T11:35:00.000Z",
      infoState: "pre-match",
      homeTeam: "主隊測試",
      awayTeam: "客隊測試",
      mode: "structure",
      odds: { home: null, draw: null, away: null },
      knownInfo: "",
    };
    const prediction = {
      directResult: "",
      directConfidence: null,
      directNotes: "",
      structureHomeGoals: 1,
      structureAwayGoals: 0,
      structureConfidence: 3,
      structureNotes: "E2E",
      advance: "",
    };

    let draft = core.createDraft({ ...common, cardSource: "manual", comparisonSequence: 1 });
    const manualCards = draft.cards.map((card, index) => ({
      ...card,
      name: core.data.deck[index],
      orientation: index % 2 ? "逆位" : "正位",
    }));
    core.lockDraft(prediction, manualCards);

    draft = core.createDraft({ ...common, cardSource: "random", comparisonSequence: 2 });
    core.lockDraft(prediction, draft.cards);
    window.FootballLabRender.renderRecords();
  });

  const manualRow = page.locator("#football-records-body tr").filter({ hasText: "手動實體抽牌" }).first();
  await expect(manualRow).toHaveCount(1);
  await manualRow.locator('button[data-action="evaluate"]').click();

  await expect(page.locator("#football-review-analysis-primary-field")).toContainText("自己抽牌");
  await expect(page.locator("#football-review-analysis-sibling-field")).toBeVisible();
  await expect(page.locator("#football-review-analysis-sibling-field")).toContainText("網站隨機抽牌");
  await expect(page.locator("#football-source-review-note")).toContainText("兩份牌面回顧分開保存");

  await page.locator("#football-actual-home").fill("2");
  await page.locator("#football-actual-away").fill("1");
  await page.locator("#football-review-analysis").fill("自己抽牌：牌面回顧 A");
  await page.locator("#football-review-analysis-sibling").fill("網站抽牌：牌面回顧 B");
  await page.locator("#football-evaluation-form button[type='submit']").click();

  const saved = await page.evaluate(() => {
    const records = window.FootballLabCore.getRecords().filter(
      (record) => record.match?.comparisonGroupId === "e2e-source-review-separation"
    );
    return Object.fromEntries(records.map((record) => [record.match.cardSource, {
      homeGoals: record.actual?.homeGoals,
      awayGoals: record.actual?.awayGoals,
      reviewAnalysis: record.actual?.reviewAnalysis,
    }]));
  });

  expect(saved.manual).toEqual({
    homeGoals: 2,
    awayGoals: 1,
    reviewAnalysis: "自己抽牌：牌面回顧 A",
  });
  expect(saved.random).toEqual({
    homeGoals: 2,
    awayGoals: 1,
    reviewAnalysis: "網站抽牌：牌面回顧 B",
  });
});
