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
 * 驗證單一牌源下注由賽前鎖定一路保存到 90 分鐘比分結算。
 * 固定單場／單注案例，時間／空間 O(1)。
 *
 * 更快替代方案比較：只測純函式無法發現 UI 欄位、牌源掛載與 STEP 3 重畫斷鏈；
 * 本測試只建立必要的一場一注，保留端到端覆蓋但避免大量資料造成慢測。
 */
test("運彩投注綁定牌源並以 90 分鐘比分計算不含本金的損益", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);

  await page.evaluate(() => {
    const core = window.FootballLabCore;
    const draft = core.createDraft({
      sportType: "football",
      sportLabel: "足球",
      competition: "E2E 運彩",
      stage: "其他",
      kickoff: "2026-08-06T10:00:00.000Z",
      infoState: "pre-match",
      homeTeam: "測試主隊",
      awayTeam: "測試客隊",
      cardSource: "manual",
      mode: "structure",
      odds: { home: null, draw: null, away: null },
      knownInfo: "",
    });
    window.FootballLabRender.renderDraft(draft);
  });

  await expect(page.locator("#football-betting-editor")).toBeVisible();
  await expect(page.locator("#football-betting-source-badge")).toHaveText("自己抽牌");

  await page.locator("#football-betting-category").selectOption("score");
  await page.locator("#football-betting-market").selectOption("exact_score");
  await page.locator("#football-betting-home-goals").fill("0");
  await page.locator("#football-betting-away-goals").fill("1");
  await page.locator("#football-betting-odds").fill("6.5");
  await page.locator("#football-betting-stake").fill("200");
  await expect(page.locator("#football-betting-potential")).toContainText("+$1,100");
  await page.locator("#football-betting-add").click();
  await expect(page.locator("#football-betting-list")).toContainText("正確比數");
  await expect(page.locator("#football-betting-list")).toContainText("成本 $200");

  const recordId = await page.evaluate(() => {
    const core = window.FootballLabCore;
    const draft = core.getDraft();
    const cards = draft.cards.map((card, index) => ({
      ...card,
      name: card.name || core.data.deck[index],
      orientation: card.orientation || "正位",
    }));
    const record = core.lockDraft({
      directResult: "",
      directConfidence: null,
      directNotes: "",
      structureHomeGoals: 0,
      structureAwayGoals: 1,
      structureConfidence: 4,
      structureNotes: "E2E 運彩",
      advance: "",
    }, cards);
    window.FootballLabRender.renderRecords();
    return record.id;
  });

  const savedBet = await page.evaluate((id) => {
    const record = window.FootballLabCore.getRecord(id);
    return {
      source: record.match.cardSource,
      count: record.prediction.bets?.length || 0,
      marketType: record.prediction.bets?.[0]?.marketType,
      stake: record.prediction.bets?.[0]?.stake,
      odds: record.prediction.bets?.[0]?.odds,
      lockedAt: record.prediction.bets?.[0]?.lockedAt || "",
    };
  }, recordId);

  expect(savedBet.source).toBe("manual");
  expect(savedBet.count).toBe(1);
  expect(savedBet.marketType).toBe("exact_score");
  expect(savedBet.stake).toBe(200);
  expect(savedBet.odds).toBe(6.5);
  expect(savedBet.lockedAt).toBeTruthy();

  await page.evaluate((id) => {
    const record = window.FootballLabCore.getRecord(id);
    window.FootballLabRender.openEvaluation(record);
  }, recordId);

  const settlement = page.locator("#football-betting-evaluation");
  await expect(settlement).toBeVisible();
  await expect(settlement).toContainText("等待比分");
  await expect(settlement).toContainText("總潛在收益");

  await page.locator("#football-actual-home").fill("0");
  await page.locator("#football-actual-away").fill("1");
  await expect(settlement).toContainText("命中");
  await expect(settlement).toContainText("實際損益 +$1,100");
  await expect(settlement).toContainText("總損益");
  await expect(settlement).toContainText("+$1,100");
  await expect(settlement).not.toContainText("$1,300");
});
