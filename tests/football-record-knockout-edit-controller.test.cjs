const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "record-knockout-edit.js");

/** 時間／空間複雜度 O(B)，B 為控制器與相依模型 source 大小。 */
function loadController() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-knockout-edit-controller-"));
  const bundle = path.join(directory, "controller.cjs");
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: bundle,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    logLevel: "silent",
  });
  delete require.cache[bundle];
  return { api: require(bundle), directory };
}

/** 時間／空間 O(1)。 */
function run() {
  const runtime = loadController();
  try {
    const records = new Map();
    const core = {
      data: { deck: ["牌1", "牌2", "牌3", "牌4", "牌5"] },
      getRecord(id) { return records.get(id) || null; },
      getMode(record) { return record.match.mode; },
      modeIncludesDirect(mode) { return mode === "direct" || mode === "dual"; },
      modeIncludesStructure(mode) { return mode === "structure" || mode === "dual"; },
      getResult(home, away) { return home > away ? "H" : home < away ? "A" : "D"; },
      validateMatch() { return ""; },
      importRecords() { return 1; },
    };
    const ui = { renderRecords() {} };
    const baseEditor = {
      readValues() { return {}; },
      syncUpdatedRecord: async () => ({ state: "not-configured" }),
      refresh() {},
    };
    const documentRef = {
      getElementById() { return null; },
      createElement() { throw new Error("autoInit=false 不應建立 DOM。"); },
      createDocumentFragment() { return {}; },
      createTextNode() { return {}; },
      head: { appendChild() {} },
    };
    const controller = runtime.api.createFootballRecordKnockoutEdit({
      core,
      ui,
      baseEditor,
      browserWindow: {
        crypto: { getRandomValues() {} },
        setTimeout(callback) { callback(); },
      },
      documentRef,
      autoInit: false,
    });

    assert.equal(Object.isFrozen(controller), true);
    assert.strictEqual(controller.core, core);
    assert.strictEqual(controller.ui, ui);
    assert.strictEqual(controller.baseEditor, baseEditor);
    assert.equal(controller.modelLayer, "record-knockout-edit");
    assert.equal(controller.isBound(), false);

    const groupRecord = {
      match: { stage: "小組賽", mode: "structure" },
      prediction: { structureHomeGoals: 1, structureAwayGoals: 0 },
    };
    assert.equal(controller.shouldHandle(groupRecord, { stage: "小組賽" }), false);
    assert.equal(controller.shouldHandle(groupRecord, { stage: "16強" }), true);

    const scopedRecord = {
      match: { stage: "小組賽", mode: "structure", predictionScope: "advance" },
      prediction: { structureHomeGoals: 1, structureAwayGoals: 0 },
    };
    assert.equal(controller.shouldHandle(scopedRecord, { stage: "小組賽" }), true);

    const existingKnockout = {
      match: { stage: "小組賽", mode: "structure" },
      prediction: {
        structureHomeGoals: 1,
        structureAwayGoals: 0,
        knockout: { route: ["regulation"] },
      },
    };
    assert.equal(controller.shouldHandle(existingKnockout, { stage: "小組賽" }), true);
    assert.equal(controller.prepareEditor(existingKnockout), false, "缺少基礎面板時不得建立半套欄位");

    console.log("football-record-knockout-edit controller tests passed");
  } finally {
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  }
}

run();
