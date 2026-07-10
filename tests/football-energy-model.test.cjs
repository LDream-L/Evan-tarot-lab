const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "energy-model.js");

/**
 * 以 esbuild 真實解析純模型 imports，再於同一 Node realm 驗證 exports。
 * 時間／空間複雜度 O(B)，B 為 data 與 energy-model source 總大小。
 *
 * 替代方案比較：只透過整頁 E2E 會把模型、DOM 與 Render 錯誤混在一起；
 * 本測試不建立 DOM，直接證明能量規則是純資料運算且不修改輸入物件。
 */
function createRuntime() {
  const browserWindow = {};
  browserWindow.window = browserWindow;

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "football-energy-model-"));
  const bundlePath = path.join(temporaryDirectory, "energy-model.bundle.cjs");
  const previousWindow = global.window;

  try {
    esbuild.buildSync({
      entryPoints: [ENTRY],
      outfile: bundlePath,
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: ["es2020"],
      logLevel: "silent",
    });

    global.window = browserWindow;
    delete require.cache[bundlePath];
    const exports = require(bundlePath);
    return { exports, window: browserWindow, temporaryDirectory };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

/** 固定案例模型驗證：時間／空間 O(1)。 */
function run() {
  const runtime = createRuntime();
  const api = runtime.exports;

  try {
    assert.ok(api.footballEnergyModel, "缺少 footballEnergyModel named export");
    assert.strictEqual(runtime.window.FootballEnergyModel, api.footballEnergyModel);
    assert.equal(api.ENERGY_MODEL_VERSION, "1.6.0");
    assert.equal(api.ENERGY_MODEL_KEY, "energy-v1");
    assert.equal(api.NON_DRAW_CODE, "ND");
    assert.equal(Object.isFrozen(api.footballEnergyModel), true);
    assert.equal(Object.isFrozen(api.GOAL_BANDS), true);
    assert.equal(Object.isFrozen(api.DRAW_TENDENCIES), true);

    assert.equal(api.validGoalBand("low"), true);
    assert.equal(api.validGoalBand("unknown"), false);
    assert.equal(api.validDrawTendency("draw"), true);
    assert.equal(api.validDrawTendency("H"), false);
    assert.equal(api.getActualGoalBand(0), "low");
    assert.equal(api.getActualGoalBand(1), "low");
    assert.equal(api.getActualGoalBand(2), "medium");
    assert.equal(api.getActualGoalBand(3), "medium");
    assert.equal(api.getActualGoalBand(4), "high");
    assert.equal(api.getActualGoalBand("bad"), "");
    assert.equal(api.getActualDrawTendency(1, 1), "draw");
    assert.equal(api.getActualDrawTendency(2, 1), "decisive");
    assert.equal(api.directCodeFromTendency("draw"), "D");
    assert.equal(api.directCodeFromTendency("decisive"), "ND");

    const prediction = {
      directNotes: "節奏偏快",
      directConfidence: 4,
      untouched: "keep",
    };
    const input = { goalBand: "medium", drawTendency: "decisive" };
    const predictionSnapshot = JSON.stringify(prediction);
    const inputSnapshot = JSON.stringify(input);

    assert.equal(api.validateEnergyPrediction(prediction, input, true), "");
    assert.match(
      api.validateEnergyPrediction(prediction, { ...input, goalBand: "" }, true),
      /總進球區間/
    );
    assert.match(
      api.validateEnergyPrediction(prediction, { ...input, drawTendency: "" }, true),
      /和局傾向/
    );
    assert.match(
      api.validateEnergyPrediction({ ...prediction, directNotes: "" }, input, true),
      /原始解讀/
    );
    assert.match(
      api.validateEnergyPrediction({ ...prediction, directConfidence: 6 }, input, true),
      /信心程度/
    );
    assert.equal(api.validateEnergyPrediction({}, {}, false), "");

    const preview = api.normalizeEnergyPrediction(prediction, input, {
      includesDirect: true,
      lock: false,
    });
    assert.equal(preview.directResult, "ND");
    assert.equal(Object.hasOwn(preview, "directModel"), false);

    const locked = api.normalizeEnergyPrediction(prediction, input, {
      includesDirect: true,
      lock: true,
    });
    assert.equal(locked.directModel, "energy-v1");
    assert.equal(locked.directGoalBand, "medium");
    assert.equal(locked.directDrawTendency, "decisive");
    assert.equal(locked.directResult, "ND");
    assert.equal(locked.untouched, "keep");
    assert.equal(JSON.stringify(prediction), predictionSnapshot, "不得修改原 prediction");
    assert.equal(JSON.stringify(input), inputSnapshot, "不得修改原 energy input");

    const record = {
      match: { mode: "dual" },
      prediction: {
        directModel: "energy-v1",
        directGoalBand: "medium",
        directDrawTendency: "decisive",
        structureHomeGoals: 2,
        structureAwayGoals: 1,
      },
      actual: { homeGoals: 2, awayGoals: 1 },
    };
    const baseEvaluation = Object.freeze({
      type: "dual",
      actualResult: "H",
      scoringPolicy: "individual-goals-plus-exact-score",
      structureResult: "H",
      structureResultHit: true,
      structureHomeGoalMatched: true,
      structureAwayGoalMatched: true,
      structureExactHit: true,
    });
    const result = api.applyEnergyEvaluation(
      record,
      baseEvaluation,
      (item) => item.match.mode
    );
    assert.notStrictEqual(result, baseEvaluation);
    assert.equal(result.scoringPolicy, baseEvaluation.scoringPolicy);
    assert.equal(result.structureHomeGoalMatched, true);
    assert.equal(result.directActualTotalGoals, 3);
    assert.equal(result.directActualGoalBand, "medium");
    assert.equal(result.directGoalBandHit, true);
    assert.equal(result.directActualDrawTendency, "decisive");
    assert.equal(result.directDrawTendencyHit, true);
    assert.equal(result.directEnergyHitCount, 2);
    assert.equal(result.modelsAgree, true);
    assert.equal(result.bothResultHit, true);
    assert.equal(baseEvaluation.directModel, undefined, "不得修改基礎 evaluation");

    const legacyRecord = {
      prediction: { directResult: "H" },
      actual: { homeGoals: 1, awayGoals: 0 },
    };
    assert.strictEqual(
      api.applyEnergyEvaluation(legacyRecord, baseEvaluation, () => "direct"),
      baseEvaluation,
      "舊版單張紀錄不得混入新版能量欄位"
    );

    const baseData = runtime.window.FOOTBALL_LAB_DATA;
    const energyData = api.createEnergyData(baseData);
    assert.notStrictEqual(energyData, baseData);
    assert.equal(Object.isFrozen(energyData), true);
    assert.equal(Object.isFrozen(energyData.modeLabels), true);
    assert.strictEqual(energyData.deck, baseData.deck);
    assert.strictEqual(energyData.positionMap, baseData.positionMap);
    assert.strictEqual(energyData.positionSets, baseData.positionSets);
    assert.equal(energyData.modeLabels.direct, "單張整體能量模式");

    console.log("football-energy-model tests passed");
  } finally {
    fs.rmSync(runtime.temporaryDirectory, { recursive: true, force: true });
  }
}

run();
