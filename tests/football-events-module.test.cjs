const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "events.js");

/**
 * 以 esbuild 解析事件模組，再於同一 Node realm 注入假核心與 DOM。
 * 時間／空間複雜度 O(B)，B 為 events source 大小。
 *
 * 替代方案比較：只做整頁 E2E 難以定位欄位建構、CSV 或雲端狀態錯誤；
 * 本測試以 autoBind=false 驗證純資料，再以最小 DOM 驗證固定事件綁定。
 */
function loadModule() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "football-events-esm-"));
  const bundlePath = path.join(temporaryDirectory, "events.bundle.cjs");
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: bundlePath,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    logLevel: "silent",
  });
  delete require.cache[bundlePath];
  return { api: require(bundlePath), temporaryDirectory };
}

/** 建立固定 DOM stub：每次查找／事件綁定 O(1)。 */
function createElements(values) {
  const listeners = new Map();
  const elements = new Map();

  function createElement(id) {
    return {
      id,
      value: values[id] ?? "",
      textContent: "",
      files: [],
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      addEventListener(type, listener) {
        if (!listeners.has(id)) listeners.set(id, new Map());
        listeners.get(id).set(type, listener);
      },
      reset() {},
      scrollIntoView() {},
    };
  }

  return {
    byId(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    listeners,
  };
}

/** 固定事件資料與 CSV 案例：時間／空間 O(1)。 */
async function run() {
  const runtime = loadModule();
  const { api } = runtime;

  try {
    assert.equal(api.csvEscape('a"b'), '"a""b"');
    assert.equal(api.getMarketFavorite({ home: 1.8, draw: 3.1, away: 4.2 }), "H");
    assert.equal(api.getMarketFavorite({ home: 2.5, draw: 2.1, away: 3.4 }), "D");
    assert.equal(api.getMarketFavorite({ home: 2.5, draw: null, away: 3.4 }), "");

    const values = {
      "football-competition": "2026 FIFA 世界盃",
      "football-stage": "16強",
      "football-kickoff": "2026-07-11T20:00",
      "football-info-state": "賽前",
      "football-home-team": "主隊",
      "football-away-team": "客隊",
      "football-mode": "dual",
      "football-card-source": "manual",
      "football-home-odds": "1.8",
      "football-draw-odds": "3.1",
      "football-away-odds": "4.2",
      "football-known-info": "先發未公布",
      "football-card-direct-directResult": "太陽",
      "football-orientation-direct-directResult": "正位",
      "football-card-structure-homeAttack": "戰車",
      "football-orientation-structure-homeAttack": "逆位",
      "football-direct-result": "ND",
      "football-direct-confidence": "4",
      "football-direct-notes": "節奏偏快",
      "football-structure-home-goals": "2",
      "football-structure-away-goals": "1",
      "football-structure-confidence": "5",
      "football-structure-notes": "主隊機會較多",
      "football-advance-prediction": "H",
      "football-actual-home": "2",
      "football-actual-away": "1",
      "football-extra-home": "",
      "football-extra-away": "",
      "football-actual-advance": "H",
      "football-actual-notes": "主隊掌握機會",
      "football-review-analysis": "攻防判斷成立",
    };
    const dom = createElements(values);
    const draft = {
      match: { mode: "dual", cardSource: "manual" },
      cards: [
        {
          group: "direct",
          position: "directResult",
          positionTitle: "單張",
          positionNote: "整體能量",
        },
        {
          group: "structure",
          position: "homeAttack",
          positionTitle: "主隊進攻",
          positionNote: "創造機會",
        },
      ],
    };
    const record = {
      id: "R-1",
      modelVersion: "1.6.0",
      match: {
        mode: "dual",
        competition: "世界盃",
        stage: "16強",
        kickoff: "2026-07-11T12:00:00.000Z",
        infoState: "賽前",
        homeTeam: "主隊",
        awayTeam: "客隊",
        cardSource: "manual",
        odds: { home: 1.8, draw: 3.1, away: 4.2 },
      },
      cards: draft.cards,
      prediction: {
        directResult: "ND",
        directConfidence: 4,
        directNotes: "節奏偏快",
        structureHomeGoals: 2,
        structureAwayGoals: 1,
        structureConfidence: 5,
        structureNotes: "主隊機會較多",
        advance: "H",
      },
      lockedAt: "2026-07-10T12:00:00.000Z",
      actual: {
        homeGoals: 2,
        awayGoals: 1,
        advance: "H",
        notes: "主隊掌握機會",
        reviewAnalysis: "攻防判斷成立",
      },
    };

    const core = {
      data: { resultLabels: { H: "主隊勝", D: "和局", A: "客隊勝" } },
      toIsoFromLocal: (value) => `${value}:00.000Z`,
      getDraft: () => draft,
      modeIncludesDirect: (mode) => mode === "direct" || mode === "dual",
      modeIncludesStructure: (mode) => mode === "structure" || mode === "dual",
      getResult: (home, away) => (home > away ? "H" : home < away ? "A" : "D"),
      getMode: (item) => item.match?.mode || item.mode,
      getRecords: () => [record],
      calculateEvaluation: () => ({
        directResultHit: null,
        structureResultHit: true,
        structureExactHit: true,
        structureAbsoluteError: 0,
        modelsAgree: true,
      }),
      validateMatch: () => "",
      createDraft: () => draft,
      validateCards: () => "",
      validatePrediction: () => "",
      lockDraft: () => record,
      clearDraft() {},
      getRecord: () => record,
      deleteRecord() {},
      updateActual: () => record,
      importRecords: () => 1,
    };
    const messages = [];
    const ui = {
      byId: dom.byId,
      clearMessage() {},
      setMessage(id, text, type) {
        messages.push({ id, text, type });
      },
      renderDraft() {},
      renderRecords() {},
      openEvaluation() {},
      renderScorecard() {},
    };
    const browserWindow = {
      confirm: () => true,
      alert() {},
      URL: {
        createObjectURL: () => "blob:test",
        revokeObjectURL() {},
      },
      Blob,
    };
    const documentRef = {
      body: { appendChild() {} },
      createElement() {
        return { click() {}, remove() {} };
      },
    };

    const controller = api.createFootballEvents({
      core,
      ui,
      browserWindow,
      documentRef,
      autoBind: false,
    });
    assert.equal(Object.isFrozen(controller), true);
    assert.strictEqual(controller.core, core);
    assert.strictEqual(controller.ui, ui);
    assert.equal(controller.isBound(), false);

    assert.deepEqual(controller.buildMatch(), {
      competition: "2026 FIFA 世界盃",
      stage: "16強",
      kickoff: "2026-07-11T20:00:00.000Z",
      infoState: "賽前",
      homeTeam: "主隊",
      awayTeam: "客隊",
      mode: "dual",
      cardSource: "manual",
      odds: { home: 1.8, draw: 3.1, away: 4.2 },
      knownInfo: "先發未公布",
    });
    assert.deepEqual(controller.buildCards(), [
      {
        group: "direct",
        position: "directResult",
        positionTitle: "單張",
        positionNote: "整體能量",
        name: "太陽",
        orientation: "正位",
      },
      {
        group: "structure",
        position: "homeAttack",
        positionTitle: "主隊進攻",
        positionNote: "創造機會",
        name: "戰車",
        orientation: "逆位",
      },
    ]);
    assert.deepEqual(controller.buildPrediction("dual"), {
      directResult: "ND",
      directConfidence: 4,
      directNotes: "節奏偏快",
      structureHomeGoals: 2,
      structureAwayGoals: 1,
      structureConfidence: 5,
      structureNotes: "主隊機會較多",
      advance: "H",
    });
    assert.deepEqual(controller.buildActual(), {
      homeGoals: 2,
      awayGoals: 1,
      extraHomeGoals: null,
      extraAwayGoals: null,
      advance: "H",
      notes: "主隊掌握機會",
      reviewAnalysis: "攻防判斷成立",
    });

    const csv = controller.buildCsv();
    assert.ok(csv.startsWith("\uFEFF"));
    assert.match(csv, /"marketFavorite"/);
    assert.match(csv, /"R-1"/);
    assert.match(csv, /"H"/);
    assert.equal((csv.match(/\n/g) || []).length, 1, "一筆紀錄應只有標題列與一筆資料列");

    assert.equal(await controller.syncCreatedRecord(record), "local-only");
    browserWindow.FootballLabCloud = {
      isConfigured: () => true,
      hasToken: () => false,
      setStatus(text, type) {
        messages.push({ text, type });
      },
    };
    assert.equal(await controller.syncCreatedRecord(record), "signin-required");
    assert.equal(messages.at(-1).type, "is-warning");

    browserWindow.FootballLabCloud = {
      isConfigured: () => true,
      hasToken: () => true,
      async saveRecord(saved) {
        assert.strictEqual(saved, record);
      },
      async updateActual(id, actual) {
        assert.equal(id, "R-1");
        assert.strictEqual(actual, record.actual);
      },
      setStatus(text, type) {
        messages.push({ text, type });
      },
    };
    assert.equal(await controller.syncCreatedRecord(record), "synced");
    assert.equal(await controller.syncActual(record), "synced");

    controller.bind();
    assert.equal(controller.isBound(), true);
    assert.ok(dom.listeners.get("football-match-form")?.has("submit"));
    assert.ok(dom.listeners.get("football-reading-form")?.has("submit"));
    assert.ok(dom.listeners.get("football-evaluation-form")?.has("submit"));
    assert.ok(dom.listeners.get("football-export-csv")?.has("click"));
    assert.ok(dom.listeners.get("football-import-json")?.has("change"));

    console.log("football-events module tests passed");
  } finally {
    fs.rmSync(runtime.temporaryDirectory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
