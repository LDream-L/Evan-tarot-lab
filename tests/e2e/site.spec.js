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
  { path: "/privacy.html", title: "Evan Tarot｜資料與隱私", marker: "#data-map" },
  { path: "/articles.html", title: "Evan Tarot｜塔羅記事 / 文章", marker: "main h1" },
  { path: "/lab.html", title: "Evan Tarot｜塔羅實驗室", marker: "#projects" },
  { path: "/methodology.html", title: "Evan Tarot｜驗證方法", marker: "#process" },
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

test("主導覽能標示文章、服務與實驗室脈絡", async ({ page }) => {
  await page.goto("/articles.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText("文章");

  await page.goto("/privacy.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText("占卜項目");

  await page.goto("/methodology.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText("實驗室");

  const podcast = page.locator('.nav a[data-podcast-link="true"]');
  await expect(podcast).toHaveAttribute("target", "_blank");
  await expect(podcast).toHaveAttribute("rel", /noopener/);
});

test("實驗室清楚分為公開、研究與私人層級", async ({ page }) => {
  await page.goto("/lab.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lab-public-tools")).toBeVisible();
  await expect(page.locator("#lab-research-workspace")).toBeVisible();
  await expect(page.locator("#lab-private-tools")).toBeVisible();
  await expect(page.getByText("模型 v1.6.0｜介面 v1.7.6", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="lost-item.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="football-lab.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="timeflow.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="practice.html"]').first()).toBeVisible();
});

test("驗證方法與隱私頁互相連結且保留核心界線", async ({ page }) => {
  await page.goto("/methodology.html", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("未應驗", { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[href="privacy.html"]').last()).toBeVisible();

  await page.goto("/privacy.html", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("預約表單", { exact: true })).toBeVisible();
  await expect(page.getByText("私人修煉紀錄", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="methodology.html"]').last()).toBeVisible();
});

test("世足 32 個元件完整啟動且雲端與事件使用 workflow 快照", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);
  expect(await page.evaluate(() => window.FootballLabBundle.moduleCount)).toBe(32);
  expect(await page.evaluate(() => window.FootballLabBundle.namedModuleCount)).toBe(10);
  expect(await page.evaluate(() => window.FootballLabBundle.modelVersion)).toBe("1.6.0");
  expect(await page.evaluate(() => window.FootballLabBundle.interfaceVersion)).toBe("1.7.6");
  expect(await page.evaluate(() => window.FootballLabBundle.scoringPolicy)).toBe("individual-goals-plus-exact-score");
  expect(await page.evaluate(() => window.FootballLabBundle.energyModelKey)).toBe("energy-v1");
  expect(await page.evaluate(() => window.FootballLabBundle.workflowStage)).toBe("knockout-ready");
  expect(await page.evaluate(() => window.FootballLabBundle.applicationStage)).toBe("cloud-and-events-ready");
  expect(await page.evaluate(() => window.FootballLabBundle.cloudLayer)).toBe("esm-factory");
  expect(await page.evaluate(() => window.FootballLabBundle.cloudLayerCount)).toBe(2);
  expect(await page.evaluate(() => window.FootballLabBundle.cloudProtocol)).toBe("health,createRecord,updateActual");
  expect(await page.evaluate(() => window.FootballLabBundle.eventLayer)).toBe("esm-factory");
  expect(await page.evaluate(() => window.FootballLabBundle.coreLayerCount)).toBe(5);
  expect(await page.evaluate(() => window.FootballLabBundle.renderLayer)).toBe("esm");
  expect(await page.evaluate(() => window.FootballLabBundle.renderLayerCount)).toBe(4);

  expect(await page.evaluate(() => Boolean(
    window.FOOTBALL_LAB_DATA
    && window.FootballLabCore
    && window.FootballStrictScoring
    && window.FootballRenderModule
    && window.FootballCoreLineage
    && window.FootballRenderLineage
    && window.FootballCloudLineage
    && window.FootballEnergyModel
    && window.FootballDirectEnergy
    && window.FootballWorkflowRuntime
    && window.FootballApplicationRuntime
    && window.FootballCloudModule
    && window.FootballLabCloud
    && window.FootballLabEvents
    && window.FootballLabRender
  ))).toBe(true);

  expect(await page.evaluate(() => {
    const coreLineage = window.FootballCoreLineage;
    const renderLineage = window.FootballRenderLineage;
    const cloudLineage = window.FootballCloudLineage;
    const workflow = window.FootballWorkflowRuntime;
    const application = window.FootballApplicationRuntime;
    const baseCloud = window.FootballCloudModule;
    const finalCloud = window.FootballLabCloud;
    const events = window.FootballLabEvents;
    return Boolean(
      coreLineage.base === window.FootballStrictScoring.baseCore
      && coreLineage.scored === window.FootballStrictScoring.core
      && coreLineage.energy === window.FootballDirectEnergy.core
      && coreLineage.workflow === workflow.core
      && coreLineage.final === window.FootballLabCore
      && renderLineage.base === window.FootballRenderModule
      && renderLineage.energy === window.FootballDirectEnergy.ui
      && renderLineage.workflow === workflow.render
      && renderLineage.final === window.FootballLabRender
      && renderLineage.base.core === window.FootballStrictScoring.core
      && renderLineage.base !== renderLineage.energy
      && renderLineage.energy !== renderLineage.workflow
      && application.workflow === workflow
      && application.core === workflow.core
      && application.render === workflow.render
      && application.cloud === baseCloud
      && application.events === events
      && cloudLineage.base === baseCloud
      && cloudLineage.final === finalCloud
      && baseCloud !== finalCloud
      && baseCloud.core === workflow.core
      && finalCloud.core === baseCloud.core
      && Object.isFrozen(baseCloud.protocol)
      && finalCloud.protocol === baseCloud.protocol
      && baseCloud.protocol.join(",") === "health,createRecord,updateActual"
      && finalCloud.isConfigured === baseCloud.isConfigured
      && finalCloud.hasToken === baseCloud.hasToken
      && finalCloud.getToken === baseCloud.getToken
      && finalCloud.setStatus === baseCloud.setStatus
      && finalCloud.healthCheck === baseCloud.healthCheck
      && typeof finalCloud.saveRecord === "function"
      && typeof finalCloud.updateActual === "function"
      && typeof finalCloud.syncAll === "function"
      && events.core === workflow.core
      && events.ui === workflow.render
      && events.isBound()
      && typeof renderLineage.final.renderDraft === "function"
      && typeof renderLineage.final.renderRecords === "function"
      && typeof renderLineage.final.renderScorecard === "function"
      && typeof renderLineage.final.openEvaluation === "function"
    );
  })).toBe(true);

  expect(await page.evaluate(() => {
    const baseData = window.FOOTBALL_LAB_DATA;
    const runtimeData = window.FootballLabCore.data;
    return Boolean(
      runtimeData
      && Object.isFrozen(runtimeData)
      && runtimeData.modelVersion === baseData.modelVersion
      && runtimeData.storageKey === baseData.storageKey
      && runtimeData.deck === baseData.deck
      && runtimeData.positionMap === baseData.positionMap
      && runtimeData.positionSets === baseData.positionSets
    );
  })).toBe(true);

  const energyEvaluation = await page.evaluate(() => window.FootballLabCore.calculateEvaluation({
    match: { mode: "dual" },
    prediction: {
      directModel: "energy-v1",
      directGoalBand: "medium",
      directDrawTendency: "decisive",
      structureHomeGoals: 2,
      structureAwayGoals: 1,
      advance: "",
    },
    actual: { homeGoals: 2, awayGoals: 1, advance: "" },
  }));
  expect(energyEvaluation.scoringPolicy).toBe("individual-goals-plus-exact-score");
  expect(energyEvaluation.structureHomeGoalMatched).toBe(true);
  expect(energyEvaluation.structureAwayGoalMatched).toBe(true);
  expect(energyEvaluation.structureExactHit).toBe(true);
  expect(energyEvaluation.directActualTotalGoals).toBe(3);
  expect(energyEvaluation.directActualGoalBand).toBe("medium");
  expect(energyEvaluation.directGoalBandHit).toBe(true);
  expect(energyEvaluation.directActualDrawTendency).toBe("decisive");
  expect(energyEvaluation.directDrawTendencyHit).toBe(true);
  expect(energyEvaluation.directEnergyHitCount).toBe(2);

  await page.evaluate(() => {
    const home = document.getElementById("football-structure-home-goals");
    const away = document.getElementById("football-structure-away-goals");
    home.value = "2";
    away.value = "1";
    home.dispatchEvent(new Event("input", { bubbles: true }));
    away.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#football-structure-result-preview")).toHaveText("2：1｜主隊勝");

  expect(await page.evaluate(() => window.FootballEnergyModel.getActualGoalBand(4))).toBe("high");
  expect(await page.evaluate(() => window.FootballEnergyModel.getActualDrawTendency(1, 1))).toBe("draw");

  await expect(page.locator("#football-cloud-panel")).toBeVisible();
  await expect(page.locator("#football-sync-all")).toBeDisabled();
  await expect(page.locator("#football-cloud-status")).not.toHaveText("正在檢查雲端連線……");
  await expect(page.locator("#football-direct-goal-band")).toHaveCount(1);
  await expect(page.locator("#football-direct-draw-tendency")).toHaveCount(1);
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
  await expect(page.getByRole("link", { name: "資料與隱私說明", exact: true })).toBeVisible();
});

test("時間流未登入時仍呈現瀏覽介面", async ({ page }) => {
  await page.goto("/timeflow.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#map-auth-hint")).toContainText("訪客");
  await expect(page.locator("#map-viewport")).toBeVisible();
  await expect(page.locator("#map-add-topic")).toBeVisible();
  await expect(page.locator("#map-export-json")).toBeVisible();
});

test("手機尺寸仍可操作主要內容、導覽與隱私頁", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "此案例只在手機專案執行");
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main h1")).toBeVisible();
  const servicesLink = page.locator('.nav a[href="services.html"]');
  await expect(servicesLink).toBeVisible();
  await servicesLink.click();
  await expect(page).toHaveURL(/services\.html/);
  await expect(page.locator("#booking-form")).toBeVisible();
  await page.goto("/privacy.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#data-map")).toBeVisible();
});
