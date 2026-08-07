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
  { path: "/timeflow.html", title: "Evan Tarot｜時間樹", marker: "#divination-map-app" },
  { path: "/football-lab.html", title: "Evan Tarot｜塔羅X賽事驗證｜介面 v1.8.0", marker: "#football-match-form" },
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

test("帳戶視窗不會讓管理按鈕壓窄暱稱欄位", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 760 });
  await page.goto("/article.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.EvanSiteAccount))).toBe(true);
  await expect(page.locator("#site-account-menu")).toBeAttached();

  await page.evaluate(() => {
    const menu = document.getElementById("site-account-menu");
    const panel = document.getElementById("google-user-panel");
    const actions = menu?.querySelector(".site-account-actions");
    if (!menu || !panel || !actions) throw new Error("帳戶視窗尚未建立");

    menu.hidden = false;
    menu.classList.add("is-open");
    panel.classList.remove("hidden");
    document.getElementById("google-signin-button")?.classList.add("hidden");

    ["服務管理", "文章管理"].forEach((label) => {
      const link = document.createElement("a");
      link.className = "btn primary";
      link.href = "#";
      link.textContent = label;
      actions.prepend(link);
    });
  });

  const desktopLayout = await page.evaluate(() => {
    const panel = document.getElementById("google-user-panel");
    const editor = panel.querySelector(".google-nickname-editor");
    const input = panel.querySelector("#google-nickname-input");
    const label = panel.querySelector("label");
    const actions = panel.querySelector(".site-account-actions");
    const panelRect = panel.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      panelWidth: panelRect.width,
      editorWidth: editorRect.width,
      editorBottom: editorRect.bottom,
      inputWidth: inputRect.width,
      labelHeight: labelRect.height,
      actionsTop: actionsRect.top,
    };
  });

  expect(desktopLayout.editorWidth).toBeGreaterThan(desktopLayout.panelWidth * 0.9);
  expect(desktopLayout.inputWidth).toBeGreaterThan(180);
  expect(desktopLayout.labelHeight).toBeLessThan(32);
  expect(desktopLayout.actionsTop).toBeGreaterThanOrEqual(desktopLayout.editorBottom - 1);

  await page.setViewportSize({ width: 360, height: 720 });
  const mobileButtons = await page.locator(".site-account-actions .btn").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, top: rect.top };
    })
  );
  expect(mobileButtons).toHaveLength(3);
  expect(mobileButtons.every(({ width }) => width > 250)).toBe(true);
  expect(new Set(mobileButtons.map(({ top }) => Math.round(top))).size).toBe(3);
});

test("一般訪客只看到公開與研究實驗層級", async ({ page }) => {
  await page.goto("/lab.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lab-public-tools")).toBeVisible();
  await expect(page.locator("#lab-research-workspace")).toBeVisible();
  await expect(page.locator("#lab-private-tools")).toBeHidden();
  await expect(page.getByText("模型 v1.6.0｜介面 v1.7.6", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="lost-item.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="football-lab.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="timeflow.html"]').first()).toBeVisible();
  await expect(page.locator('[data-admin-only-lab-item="private-practice"]')).toBeHidden();
  await expect(page.locator("#lab-project-count")).toHaveText("3");
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

test("世足 36 個元件完整啟動且決勝編輯層依賴 review 快照", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);
  expect(await page.evaluate(() => window.FootballLabBundle.moduleCount)).toBe(37);
  expect(await page.evaluate(() => window.FootballLabBundle.namedModuleCount)).toBe(16);
  expect(await page.evaluate(() => window.FootballLabBundle.modelVersion)).toBe("1.6.0");
  expect(await page.evaluate(() => window.FootballLabBundle.interfaceVersion)).toBe("1.7.6");
  expect(await page.evaluate(() => window.FootballLabBundle.scoringPolicy)).toBe("individual-goals-plus-exact-score");
  expect(await page.evaluate(() => window.FootballLabBundle.energyModelKey)).toBe("energy-v1");
  expect(await page.evaluate(() => window.FootballLabBundle.workflowStage)).toBe("knockout-ready");
  expect(await page.evaluate(() => window.FootballLabBundle.applicationStage)).toBe("cloud-and-events-ready");
  expect(await page.evaluate(() => window.FootballLabBundle.reviewStage)).toBe("record-edit-ready");
  expect(await page.evaluate(() => window.FootballLabBundle.knockoutEditStage)).toBe("knockout-record-edit-ready");
  expect(await page.evaluate(() => window.FootballLabBundle.cloudLayerCount)).toBe(2);
  expect(await page.evaluate(() => window.FootballLabBundle.cloudProtocol)).toBe("health,createRecord,updateActual");
  expect(await page.evaluate(() => window.FootballLabBundle.recordEditLayer)).toBe("esm-model-and-controller");
  expect(await page.evaluate(() => window.FootballLabBundle.knockoutEditLayer)).toBe("esm-model-and-adapter");
  expect(await page.evaluate(() => window.FootballLabBundle.coreLayerCount)).toBe(6);
  expect(await page.evaluate(() => window.FootballLabBundle.renderLayerCount)).toBe(5);

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
    && window.FootballReviewRuntime
    && window.FootballRecordEditModel
    && window.FootballLabRecordEdit
    && window.FootballKnockoutEditRuntime
    && window.FootballRecordKnockoutEditModel
    && window.FootballLabRecordKnockoutEdit
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
    const review = window.FootballReviewRuntime;
    const baseEditor = window.FootballLabRecordEdit;
    const knockout = window.FootballKnockoutEditRuntime;
    const knockoutEditor = window.FootballLabRecordKnockoutEdit;
    const baseCloud = window.FootballCloudModule;
    const finalCloud = window.FootballLabCloud;
    return Boolean(
      coreLineage.base === window.FootballStrictScoring.baseCore
      && coreLineage.scored === window.FootballStrictScoring.core
      && coreLineage.energy === window.FootballDirectEnergy.core
      && coreLineage.workflow === workflow.core
      && coreLineage.review === review.core
      && coreLineage.final === window.FootballLabCore
      && renderLineage.base === window.FootballRenderModule
      && renderLineage.energy === window.FootballDirectEnergy.ui
      && renderLineage.workflow === workflow.render
      && renderLineage.review === review.render
      && renderLineage.final === window.FootballLabRender
      && application.workflow === workflow
      && review.application === application
      && review.editor === baseEditor
      && review.model === window.FootballRecordEditModel
      && knockout.review === review
      && knockout.baseEditor === baseEditor
      && knockout.model === window.FootballRecordKnockoutEditModel
      && knockout.editor === knockoutEditor
      && knockoutEditor.core === review.core
      && knockoutEditor.ui === review.render
      && knockoutEditor.baseEditor === baseEditor
      && knockoutEditor.isBound()
      && cloudLineage.base === baseCloud
      && cloudLineage.review === review.cloudFinal
      && cloudLineage.final === finalCloud
      && baseCloud !== finalCloud
      && finalCloud.core === baseCloud.core
      && finalCloud.protocol === baseCloud.protocol
      && baseCloud.protocol.join(",") === "health,createRecord,updateActual"
      && window.FootballLabEvents.core === workflow.core
      && window.FootballLabEvents.ui === workflow.render
      && window.FootballLabEvents.isBound()
      && typeof renderLineage.final.renderDraft === "function"
      && typeof renderLineage.final.renderRecords === "function"
      && typeof renderLineage.final.renderScorecard === "function"
      && typeof renderLineage.final.openEvaluation === "function"
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
  expect(energyEvaluation.structureExactHit).toBe(true);
  expect(energyEvaluation.directGoalBandHit).toBe(true);
  expect(energyEvaluation.directDrawTendencyHit).toBe(true);

  await page.evaluate(() => {
    const home = document.getElementById("football-structure-home-goals");
    const away = document.getElementById("football-structure-away-goals");
    home.value = "2";
    away.value = "1";
    home.dispatchEvent(new Event("input", { bubbles: true }));
    away.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#football-structure-result-preview")).toHaveText("2：1｜主隊勝");
  await expect(page.locator("#football-cloud-panel")).toBeVisible();
  await expect(page.locator("#football-sync-all")).toBeDisabled();
  await expect(page.locator("#football-edit-panel")).toHaveCount(1);
  await expect(page.locator("#football-edit-extra-stage")).toHaveCount(1);
  await expect(page.locator("#football-edit-penalty-stage")).toHaveCount(1);
  await expect(page.locator("#football-direct-goal-band")).toHaveCount(1);
  await expect(page.locator("#football-direct-draw-tendency")).toHaveCount(1);
  await expect(page.locator(".subpage-hero .hero-text h1")).toHaveText("塔羅X賽事驗證。");
  await expect(page.locator("#football-match-form .football-version")).toHaveText("模型 v1.6.0｜介面 v1.8.0");
  await expect(page.locator("#football-sport-type")).toHaveValue("football");
  await expect(page.locator('#football-sport-type option[value="future"]')).toHaveAttribute("disabled", "");
  await expect(page.locator("#football-card-source")).toHaveValue("compare");
  await expect(page.locator("#football-stats-accordion")).toBeVisible();
await expect(page.locator("#football-stats-accordion")).not.toHaveAttribute("open", "");
await expect(page.locator("#football-source-comparison")).toHaveCount(1);
  expect(await page.evaluate(() => Boolean(window.FootballSourceComparisonRuntime))).toBe(true);
  await expect(page.locator('script[src*="JS/football-lab.js"]')).toHaveCount(1);
  await expect(page.locator('script[src*="football-record-knockout-edit.js"]')).toHaveCount(0);
  await expect(page.locator('#football-layout-final-style')).toHaveCount(1);
});

test("世足已鎖定紀錄可修改賽事與比分並保留牌面解讀", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);

  const recordId = await page.evaluate(() => {
    const core = window.FootballLabCore;
    const match = {
      competition: "編輯前測試盃",
      stage: "小組賽",
      kickoff: new Date(Date.now() + 86_400_000).toISOString(),
      infoState: "賽前且先發未公布",
      homeTeam: "甲隊",
      awayTeam: "乙隊",
      mode: "structure",
      cardSource: "random",
      odds: { home: 2.1, draw: 3.2, away: 3.6 },
      knownInfo: "原始資訊",
    };
    const draft = core.createDraft(match);
    const record = core.lockDraft({
      directResult: "",
      directConfidence: null,
      directNotes: "",
      structureHomeGoals: 1,
      structureAwayGoals: 1,
      structureConfidence: 3,
      structureNotes: "原始攻防解讀",
      advance: "",
    }, draft.cards);
    window.FootballLabRender.renderRecords();
    return record.id;
  });

  await expect(page.locator(`button[data-action="edit-match"][data-id="${recordId}"]`)).toBeVisible();
  await page.locator(`button[data-action="edit-match"][data-id="${recordId}"]`).click();
  await expect(page.locator("#football-edit-panel")).toBeVisible();
  await expect(page.locator("#football-edit-competition")).toHaveValue("編輯前測試盃");
  await expect(page.locator("#football-edit-structure-home-goals")).toHaveValue("1");
  await expect(page.locator("#football-edit-structure-away-goals")).toHaveValue("1");

  await page.locator("#football-edit-competition").fill("編輯後測試盃");
  await page.locator("#football-edit-structure-home-goals").fill("2");
  await page.locator("#football-edit-structure-away-goals").fill("1");
  await expect(page.locator("#football-edit-score-preview")).toHaveText("2：1｜主隊勝");
  await page.locator("#football-save-edit").click();

  await expect.poll(() => page.evaluate((id) => {
    const record = window.FootballLabCore.getRecord(id);
    return {
      competition: record?.match?.competition,
      home: record?.prediction?.structureHomeGoals,
      away: record?.prediction?.structureAwayGoals,
      notes: record?.prediction?.structureNotes,
      cards: record?.cards?.length,
    };
  }, recordId)).toEqual({
    competition: "編輯後測試盃",
    home: 2,
    away: 1,
    notes: "原始攻防解讀",
    cards: 4,
  });
});

test("世足決勝紀錄可由 90 分鐘勝負改為延長賽再進 PK", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);

  const created = await page.evaluate(() => {
    const core = window.FootballLabCore;
    document.getElementById("football-prediction-scope").value = "advance";
    document.getElementById("football-knockout-rule").value = "extra-time-then-penalties";
    const draft = core.createDraft({
      competition: "決勝編輯測試盃",
      stage: "16強",
      kickoff: new Date(Date.now() + 86_400_000).toISOString(),
      infoState: "賽前且先發未公布",
      homeTeam: "主隊",
      awayTeam: "客隊",
      mode: "structure",
      cardSource: "random",
      odds: { home: 2, draw: 3.1, away: 3.8 },
      knownInfo: "原始決勝資訊",
    });
    const record = core.lockDraft({
      directResult: "",
      directConfidence: null,
      directNotes: "",
      structureHomeGoals: 2,
      structureAwayGoals: 1,
      structureConfidence: 4,
      structureNotes: "原始四張攻防解讀",
      advance: "H",
    }, draft.cards);
    window.FootballLabRender.renderRecords();
    return {
      id: record.id,
      cards: record.cards.map((card) => `${card.name}|${card.orientation}`),
    };
  });

  await page.locator(`button[data-action="edit-match"][data-id="${created.id}"]`).click();
  await expect(page.locator("#football-edit-panel")).toBeVisible();
  await page.locator("#football-edit-structure-home-goals").fill("1");
  await page.locator("#football-edit-structure-away-goals").fill("1");
  await expect(page.locator("#football-edit-extra-stage")).toBeVisible();
  await expect(page.locator("#football-edit-extra-cards .football-edit-stage-card")).toHaveCount(4);

  await page.locator("#football-edit-stage-extra-home").fill("0");
  await page.locator("#football-edit-stage-extra-away").fill("0");
  await page.locator("#football-edit-extra-structure-notes").fill("延長賽雙方仍互相抵銷");
  await expect(page.locator("#football-edit-penalty-stage")).toBeVisible();
  await expect(page.locator("#football-edit-penalty-cards .football-edit-stage-card")).toHaveCount(5);
  await page.locator("#football-edit-penalty-winner").selectOption("H");
  await page.locator("#football-edit-penalty-notes").fill("主隊門將與射手穩定度較高");
  await page.locator("#football-save-edit").click();

  await expect.poll(() => page.evaluate((id) => {
    const record = window.FootballLabCore.getRecord(id);
    return {
      route: record?.prediction?.knockout?.route,
      resolvedBy: record?.prediction?.knockout?.resolvedBy,
      finalAdvance: record?.prediction?.knockout?.finalAdvance,
      predictionAdvance: record?.prediction?.advance,
      regulation: [
        record?.prediction?.structureHomeGoals,
        record?.prediction?.structureAwayGoals,
      ],
      extra: [
        record?.prediction?.knockout?.stages?.extraTime?.structureHomeGoals,
        record?.prediction?.knockout?.stages?.extraTime?.structureAwayGoals,
        record?.prediction?.knockout?.stages?.extraTime?.cards?.length,
      ],
      penaltyCards: record?.prediction?.knockout?.stages?.penalties?.cards?.length,
      notes: record?.prediction?.structureNotes,
      cards: record?.cards?.map((card) => `${card.name}|${card.orientation}`),
    };
  }, created.id)).toEqual({
    route: ["regulation", "extraTime", "penalties"],
    resolvedBy: "penalties",
    finalAdvance: "H",
    predictionAdvance: "H",
    regulation: [1, 1],
    extra: [0, 0, 4],
    penaltyCards: 5,
    notes: "原始四張攻防解讀",
    cards: created.cards,
  });
});

test("預約表單保留原生必填驗證並切換可配合時間", async ({ page }) => {
  await page.goto("/services.html#booking", { waitUntil: "domcontentloaded" });
  const form = page.locator("#booking-form");
  await expect(form).toBeVisible();
  expect(await form.evaluate((element) => element.checkValidity())).toBe(false);
  await page.locator('input[name="name"]').fill("E2E 測試");
  await page.locator('input[name="contact"]').fill("test@example.com");
  await page.locator('select[name="topic"]').selectOption("other");
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
  await expect(page.locator("#map-add-event")).toBeVisible();
  await expect(page.locator("#map-add-event")).toBeDisabled();
});

test("時間樹只保留一條主幹，聚焦分支不改變資料親緣", async ({ page }) => {
  const fixture = {
    version: 6,
    topics: [
      { id: "topic-public", title: "公開研究", color: "#b794ff" },
      { id: "topic-private", title: "秘密主題", color: "#ffd27a" },
    ],
    timelines: [
      { id: "branch-root", topicId: "topic-public", title: "公開研究", parentNodeId: "", visibility: "public", collapsed: false, createdAt: "2026-01-01" },
      { id: "branch-child", topicId: "topic-public", title: "平行假設", parentNodeId: "node-root", visibility: "public", collapsed: false, createdAt: "2026-01-02" },
      { id: "branch-private", topicId: "topic-private", title: "不公開研究", parentNodeId: "", visibility: "private", collapsed: false, createdAt: "2026-01-03" },
    ],
    nodes: [
      { id: "node-root", timelineId: "branch-root", type: "event", title: "分枝起點", precision: "day", dateValue: "2026-03-19", status: "pending", category: "research", tags: [] },
      { id: "node-child", timelineId: "branch-child", type: "event", title: "平行事件", precision: "day", dateValue: "2026-04-02", status: "pending", category: "research", tags: [] },
      { id: "node-private", timelineId: "branch-private", type: "event", title: "私密事件", precision: "day", dateValue: "2026-04-09", status: "pending", category: "research", tags: [] },
    ],
    links: [],
    ui: {
      zoom: 1,
      panX: 0,
      panY: 0,
      selectedId: "",
      activeTopicId: "topic-public",
      activeTimelineId: "branch-root",
      viewMode: "all",
      showPrivate: true,
      filterStatus: "all",
      filterCategory: "all",
      search: "",
    },
  };
  await page.addInitScript((state) => {
    window.localStorage.setItem("evanTarotDivinationTimeflowV4", JSON.stringify(state));
  }, fixture);
  await page.goto("/timeflow.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".map-global-trunk")).toHaveCount(1);
  await expect(page.locator(".map-unknown-zone")).toHaveCount(0);
  await expect(page.locator("#map-active-timeline-field")).toBeHidden();
  await expect(page.locator("#map-active-timeline")).toBeDisabled();
  await expect(page.locator("#map-active-topic")).toHaveValue("all");
  await expect(page.locator(".map-branch-axis")).toHaveCount(2);
  await expect(page.locator('[data-branch-id="branch-private"]')).toHaveCount(0);
  await expect(page.locator("#map-breadcrumb")).toContainText("全域時空主幹");
  await expect(page.locator("#map-astro-controls")).toHaveCount(1);
  await expect(page.locator("#map-astro-visible")).not.toBeChecked();
  await expect(page.locator(".map-astro-axis")).toHaveCount(0);
  await page.locator("#map-astro-controls summary").click();
  await page.locator("#map-astro-visible").check();
  await expect(page.locator(".map-astro-lane-label")).toBeVisible();
  await expect(page.locator(".map-global-trunk")).toHaveCount(1);
  await expect(page.locator(".map-astro-axis")).toHaveCount(0);
  await page.locator("#map-astro-visible").uncheck();

  await page.evaluate(() => {
    const TF = window.EvanTimeflowV5;
    TF.ctx.state.ui.viewMode = "single";
    TF.ctx.state.ui.activeTimelineId = "branch-private";
    TF.ctx.state.ui.selectedId = "node-private";
    TF.ui.render(false);
  });
  await expect(page.locator("#map-detail-form")).toBeHidden();
  await expect(page.locator("#map-breadcrumb")).not.toContainText("不公開研究");
  expect(await page.locator("#map-field-timeline option").allTextContents()).not.toContain("不公開研究");
  expect(await page.locator("#map-active-topic option").allTextContents()).not.toContain("秘密主題");

  await page.locator("#map-view-mode").selectOption("all");
  await page.locator("#map-view-mode").selectOption("single");
  await expect(page.locator("#map-active-timeline-field")).toBeVisible();
  await expect(page.locator("#map-active-timeline")).toBeEnabled();
  await expect(page.locator(".map-global-trunk.map-visual-trunk")).toHaveCount(1);
  await expect(page.locator(".map-branch-axis")).toHaveCount(1);
  await expect(page.locator("#map-breadcrumb")).toContainText("公開研究");
  expect(await page.evaluate(() => window.EvanTimeflowV5.ctx.timelineIndex.get("branch-child").parentNodeId)).toBe("node-root");

  const physicalWidths = await page.evaluate(() => {
    window.EvanTimeflowV5.ctx.state.ui.zoom = 1;
    window.EvanTimeflowV5.ui.render(false);
    const normal = document.querySelector('[data-node-id="node-root"]').getBoundingClientRect().width;
    window.EvanTimeflowV5.ctx.state.ui.zoom = .35;
    window.EvanTimeflowV5.ui.render(false);
    const zoomedOut = document.querySelector('[data-node-id="node-root"]').getBoundingClientRect().width;
    return { normal, zoomedOut, minimumZoom: window.EvanTimeflowV5.ctx.state.ui.zoom };
  });
  expect(Math.abs(physicalWidths.normal - physicalWidths.zoomedOut)).toBeLessThan(2);
  expect(physicalWidths.minimumZoom).toBe(.6);
  await expect(page.locator("#map-zoom-level")).toHaveText("60%");
  await expect(page.locator("#map-zoom-out")).toBeDisabled();
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
