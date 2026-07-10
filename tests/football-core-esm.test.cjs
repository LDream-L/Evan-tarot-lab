const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "core.js");

/**
 * 以 esbuild 真實解析 ES imports，再載入同 realm 的暫存 CommonJS。
 * 時間／空間複雜度 O(B)，B 為 data 與 core source 總大小。
 *
 * 替代方案比較：
 * - 完整瀏覽器 E2E：能驗證整頁，但核心函式錯誤定位較慢。
 * - VM IIFE：可隔離環境，但跨 realm 的 Array／Object 原型會干擾 strict equality。
 * - 本方案：保留真實 ES Module bundling，同時讓 exports 與 assertions 位於同一 Node realm。
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

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "football-core-esm-"));
  const bundlePath = path.join(temporaryDirectory, "core.bundle.cjs");
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
    return { exports, window: browserWindow, storage, temporaryDirectory };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

/**
 * 核心契約驗證：固定案例，時間／空間 O(1)。
 */
function run() {
  const runtime = createRuntime();
  const api = runtime.exports;

  try {
    assert.ok(api.footballData, "缺少 footballData named export");
    assert.ok(api.footballCore, "缺少 footballCore named export");
    assert.strictEqual(runtime.window.FOOTBALL_LAB_DATA, api.footballData);
    assert.strictEqual(runtime.window.FootballLabCore, api.footballCore);

    assert.equal(api.footballData.modelVersion, "1.6.0");
    assert.equal(api.footballData.deck.length, 78);
    assert.equal(api.footballData.positionMap.directResult.key, "directResult");
    assert.equal(Object.isFrozen(api.footballData), true);
    assert.equal(Object.isFrozen(api.footballCore), true);

    assert.equal(api.getResult(2, 1), "H");
    assert.equal(api.getResult(1, 2), "A");
    assert.equal(api.getResult(1, 1), "D");
    assert.equal(api.modeIncludesDirect("dual"), true);
    assert.equal(api.modeIncludesStructure("direct"), false);
    assert.deepEqual(
      api.getExpectedPositions("dual").map((item) => item.key),
      ["directResult", "homeAttack", "awayDefense", "awayAttack", "homeDefense"]
    );

    const validMatch = {
      competition: "測試賽事",
      kickoff: "2026-07-10T20:00",
      homeTeam: "主隊",
      awayTeam: "客隊",
      mode: "direct",
      cardSource: "manual",
      odds: { home: null, draw: null, away: null },
    };
    assert.equal(api.validateMatch(validMatch), "");
    assert.match(api.validateMatch({ ...validMatch, awayTeam: "主隊" }), /不能是同一支隊伍/);

    const directEvaluation = api.calculateEvaluation({
      match: { mode: "direct" },
      prediction: { directResult: "H", advance: "" },
      actual: { homeGoals: 2, awayGoals: 1, advance: "" },
    });
    assert.equal(directEvaluation.directResultHit, true);
    assert.equal(directEvaluation.actualResult, "H");

    const structureEvaluation = api.calculateEvaluation({
      match: { mode: "structure" },
      prediction: { structureHomeGoals: 2, structureAwayGoals: 1, advance: "" },
      actual: { homeGoals: 2, awayGoals: 1, advance: "" },
    });
    assert.equal(structureEvaluation.structureResultHit, true);
    assert.equal(structureEvaluation.structureExactHit, true);
    assert.equal(structureEvaluation.structureAbsoluteError, 0);

    assert.deepEqual(api.getRecords(), []);
    assert.equal(api.calculateStats().total, 0);
    assert.equal(runtime.storage.has(api.footballData.storageKey), false);

    console.log("football-core ESM tests passed");
  } finally {
    fs.rmSync(runtime.temporaryDirectory, { recursive: true, force: true });
  }
}

run();
