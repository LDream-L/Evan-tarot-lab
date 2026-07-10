const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "scoring.js");

/**
 * 以 esbuild 解析具名評分模組，再於同一 Node realm 驗證 exports。
 * 時間／空間複雜度 O(B)，B 為 data、core、scoring source 總大小。
 *
 * 替代方案比較：完整頁面 E2E 可確認相容模組，但評分錯誤定位較慢；
 * 本測試直接核對 0 球、單邊命中、完整比分與基礎核心不被修改。
 */
function createRuntime() {
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  const browserWindow = {
    localStorage,
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      getRandomValues(buffer) {
        buffer[0] = 1;
        return buffer;
      },
    },
  };
  browserWindow.window = browserWindow;

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "football-scoring-esm-"));
  const bundlePath = path.join(temporaryDirectory, "scoring.bundle.cjs");
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

/** 固定案例評分：時間／空間 O(1)。 */
function run() {
  const runtime = createRuntime();
  const api = runtime.exports;

  try {
    assert.ok(api.footballScoring, "缺少 footballScoring named export");
    assert.ok(api.scoredFootballCore, "缺少 scoredFootballCore named export");
    assert.equal(api.SCORING_POLICY, "individual-goals-plus-exact-score");
    assert.strictEqual(runtime.window.FootballStrictScoring, api.footballScoring);
    assert.strictEqual(runtime.window.FootballLabCore, api.scoredFootballCore);
    assert.strictEqual(api.footballScoring.core, api.scoredFootballCore);
    assert.strictEqual(api.footballScoring.baseCore.data, api.scoredFootballCore.data);
    assert.notStrictEqual(
      api.footballScoring.baseCore.calculateEvaluation,
      api.scoredFootballCore.calculateEvaluation,
      "評分層不得直接修改基礎核心函式"
    );
    assert.equal(Object.isFrozen(api.scoredFootballCore), true);
    assert.equal(Object.isFrozen(api.footballScoring), true);

    const oneSideHit = api.scoredFootballCore.calculateEvaluation({
      match: { mode: "structure" },
      prediction: { structureHomeGoals: 0, structureAwayGoals: 1, advance: "" },
      actual: { homeGoals: 0, awayGoals: 2, advance: "" },
    });
    assert.equal(oneSideHit.scoringPolicy, api.SCORING_POLICY);
    assert.equal(oneSideHit.structureHomeGoalMatched, true, "0 球必須能獨立命中");
    assert.equal(oneSideHit.structureAwayGoalMatched, false);
    assert.equal(oneSideHit.structureHomeGoalHit, true);
    assert.equal(oneSideHit.structureAwayGoalHit, false);
    assert.equal(oneSideHit.structureExactHit, false);

    const exactZero = api.scoredFootballCore.calculateEvaluation({
      match: { mode: "structure" },
      prediction: { structureHomeGoals: 0, structureAwayGoals: 0, advance: "" },
      actual: { homeGoals: 0, awayGoals: 0, advance: "" },
    });
    assert.equal(exactZero.structureHomeGoalMatched, true);
    assert.equal(exactZero.structureAwayGoalMatched, true);
    assert.equal(exactZero.structureExactHit, true);

    const directOnly = api.scoredFootballCore.calculateEvaluation({
      match: { mode: "direct" },
      prediction: { directResult: "H", advance: "" },
      actual: { homeGoals: 1, awayGoals: 0, advance: "" },
    });
    assert.equal(directOnly.directResultHit, true);
    assert.equal(Object.hasOwn(directOnly, "scoringPolicy"), false);

    const baseEvaluation = api.footballScoring.baseCore.calculateEvaluation({
      match: { mode: "structure" },
      prediction: { structureHomeGoals: 0, structureAwayGoals: 1, advance: "" },
      actual: { homeGoals: 0, awayGoals: 2, advance: "" },
    });
    assert.equal(Object.hasOwn(baseEvaluation, "scoringPolicy"), false);
    assert.equal(Object.hasOwn(baseEvaluation, "structureHomeGoalMatched"), false);

    console.log("football-scoring ESM tests passed");
  } finally {
    fs.rmSync(runtime.temporaryDirectory, { recursive: true, force: true });
  }
}

run();
