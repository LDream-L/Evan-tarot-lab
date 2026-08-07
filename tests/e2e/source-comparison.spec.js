const { test, expect } = require("@playwright/test");

const BLOCKED_EXTERNAL_HOSTS = [
  "accounts.google.com",
  "script.google.com",
  "script.googleusercontent.com",
];

/** 固定三個外部 host：時間／空間 O(1)。 */
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (BLOCKED_EXTERNAL_HOSTS.includes(host)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

test("雙牌源統計預設收合，現行場域只做質性對照", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))
  ).toBe(true);

  const accordion = page.locator("#football-stats-accordion");
  const summary = accordion.locator("summary");
  const panel = page.locator("#football-source-comparison");

  await expect(accordion).toBeVisible();
  await expect(accordion).not.toHaveAttribute("open", "");
  await expect(accordion).toContainText("驗證統計");
  await expect(accordion).toContainText("統計數據與雙牌源比較");
  await expect(accordion).toContainText("展開數據");
  await expect(panel).not.toBeVisible();

  await summary.click();

  await expect(accordion).toHaveAttribute("open", "");
  await expect(accordion).toContainText("收合數據");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".football-source-metric small")).toContainText([
    "同場對照",
    "自己抽牌｜整體場域",
    "網站抽牌｜整體場域",
    "自己抽牌｜攻防賽果",
    "網站抽牌｜攻防賽果",
    "驗證規則",
  ]);
  await expect(panel.getByText("質性", { exact: true })).toHaveCount(2);

  const runtime = await page.evaluate(() => ({
    metricModel: window.FootballSourceComparisonRuntime?.metricModel,
    fieldModel: window.FootballFieldContextRuntime?.modelKey,
    hasCalculator: typeof window.FootballSourceComparisonRuntime?.calculateSourceComparison === "function",
    sport: document.getElementById("football-sport-type")?.value,
    source: document.getElementById("football-card-source")?.value,
    accordionOpen: document.getElementById("football-stats-accordion")?.open === true,
    kpisInsideAccordion: document.getElementById("football-kpis")?.parentElement?.id
      === "football-stats-accordion-content",
  }));

  expect(runtime).toEqual({
    metricModel: "energy-v1",
    fieldModel: "field-v2",
    hasCalculator: true,
    sport: "football",
    source: "compare",
    accordionOpen: true,
    kpisInsideAccordion: true,
  });

  await summary.click();
  await expect(accordion).not.toHaveAttribute("open", "");
  await expect(accordion).toContainText("展開數據");
  await expect(panel).not.toBeVisible();
});

test("完整模型移除單張量化欄位與單張獨立模式", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))
  ).toBe(true);

  const mode = page.locator("#football-mode");
  await expect(mode.locator('option[value="direct"]')).toHaveCount(0);
  await expect(mode.locator('option[value="dual"]')).toHaveText("完整模型：整體場域＋四張攻防");
  await expect(mode.locator('option[value="structure"]')).toHaveText("只做四張攻防");

  await expect(page.locator("#football-direct-goal-band").locator("xpath=ancestor::label[1]")).toBeHidden();
  await expect(page.locator("#football-direct-draw-tendency").locator("xpath=ancestor::label[1]")).toBeHidden();
  await expect(page.locator("#football-direct-confidence").locator("xpath=ancestor::label[1]")).toBeHidden();
  await expect(page.locator("#football-direct-reading legend")).toHaveText("A｜整體場域");
  await expect(page.locator("#football-direct-notes").locator("xpath=ancestor::label[1]")).toContainText("整體場域原始解讀");

  const locked = await page.evaluate(() => {
    const core = window.FootballLabCore;
    const draft = core.createDraft({
      competition: "場域模型測試盃",
      stage: "小組賽",
      kickoff: new Date(Date.now() + 86_400_000).toISOString(),
      infoState: "賽前且先發未公布",
      homeTeam: "甲隊",
      awayTeam: "乙隊",
      mode: "dual",
      cardSource: "random",
      odds: { home: null, draw: null, away: null },
      knownInfo: "",
    });
    const record = core.lockDraft({
      directResult: "",
      directConfidence: null,
      directNotes: "場域放大甲隊進攻與乙隊防守之間的壓力，客隊路徑較受抑制。",
      structureHomeGoals: 2,
      structureAwayGoals: 1,
      structureConfidence: 3,
      structureNotes: "主攻較能穿透客防；客攻有機會但不穩定。",
      advance: "",
    }, draft.cards);
    core.updateActual(record.id, {
      homeGoals: 2,
      awayGoals: 1,
      extraHomeGoals: null,
      extraAwayGoals: null,
      advance: "",
      notes: "",
      reviewAnalysis: "",
    });
    const saved = core.getRecord(record.id);
    const evaluation = core.calculateEvaluation(saved);
    return {
      model: saved.prediction.directModel,
      directResult: saved.prediction.directResult,
      directConfidence: saved.prediction.directConfidence,
      goalBand: saved.prediction.directGoalBand,
      drawTendency: saved.prediction.directDrawTendency,
      fieldOnly: saved.prediction.directFieldQualitativeOnly,
      directHit: evaluation.directResultHit,
      fieldQualitative: evaluation.fieldContextQualitativeOnly,
      structureHit: evaluation.structureResultHit,
      exactHit: evaluation.structureExactHit,
    };
  });

  expect(locked).toEqual({
    model: "field-v2",
    directResult: "",
    directConfidence: null,
    goalBand: "",
    drawTendency: "",
    fieldOnly: true,
    directHit: null,
    fieldQualitative: true,
    structureHit: true,
    exactHit: true,
  });
});