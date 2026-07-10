const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "record-edit.js");

/** 時間／空間複雜度 O(B)，B 為控制器及模型 source 大小。 */
function loadController() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-record-edit-controller-"));
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
async function run() {
  const runtime = loadController();
  try {
    const elements = new Map();
    const value = (id, input = "") => {
      const element = {
        id,
        value: input,
        classList: {
          contains(className) { return id === "football-edit-extra-home-wrap" && className === "football-hidden"; },
          add() {},
          remove() {},
        },
      };
      elements.set(id, element);
      return element;
    };

    value("football-edit-competition", "測試盃");
    value("football-edit-stage", "小組賽");
    value("football-edit-kickoff-date", "2026-07-12");
    value("football-edit-kickoff-time", "20:30");
    value("football-edit-info-state", "賽前且先發未公布");
    value("football-edit-home-team", "主隊");
    value("football-edit-away-team", "客隊");
    value("football-edit-home-odds", "2.10");
    value("football-edit-draw-odds", "3.20");
    value("football-edit-away-odds", "3.60");
    value("football-edit-known-info", "無重大傷停");
    value("football-edit-structure-home-goals", "2");
    value("football-edit-structure-away-goals", "1");
    value("football-edit-extra-structure-home-goals", "");
    value("football-edit-extra-structure-away-goals", "");
    value("football-edit-extra-home-wrap", "");

    const documentRef = {
      getElementById(id) { return elements.get(id) || null; },
      querySelector() { return null; },
      createElement() { throw new Error("autoInit=false 不應建立 DOM。"); },
      head: { appendChild() {} },
    };
    const core = {
      getRecord() { return null; },
      getRecords() { return []; },
      getMode() { return "structure"; },
      modeIncludesStructure() { return true; },
      getResult(home, away) { return home > away ? "H" : home < away ? "A" : "D"; },
      data: { resultLabels: { H: "主隊勝", D: "和局", A: "客隊勝" } },
      validateMatch() { return ""; },
      importRecords() { return 1; },
    };
    const ui = { renderRecords() {} };
    let currentCloud = null;
    const controller = runtime.api.createFootballRecordEdit({
      core,
      ui,
      cloudProvider: () => currentCloud,
      browserWindow: {
        requestAnimationFrame(callback) { callback(); },
        MutationObserver: class {
          observe() {}
          disconnect() {}
        },
      },
      documentRef,
      autoInit: false,
    });

    assert.equal(Object.isFrozen(controller), true);
    assert.strictEqual(controller.core, core);
    assert.strictEqual(controller.ui, ui);
    assert.equal(controller.isBound(), false);
    assert.deepEqual(controller.readValues(), {
      competition: "測試盃",
      stage: "小組賽",
      kickoffDate: "2026-07-12",
      kickoffTime: "20:30",
      infoState: "賽前且先發未公布",
      homeTeam: "主隊",
      awayTeam: "客隊",
      homeOdds: "2.10",
      drawOdds: "3.20",
      awayOdds: "3.60",
      knownInfo: "無重大傷停",
      structureHomeGoals: "2",
      structureAwayGoals: "1",
      extraStructureHomeGoals: "",
      extraStructureAwayGoals: "",
      extraFieldVisible: false,
    });

    const record = { id: "R-1", actual: { homeGoals: 2, awayGoals: 1 } };
    assert.deepEqual(await controller.syncUpdatedRecord(record), { state: "not-configured" });

    currentCloud = {
      isConfigured: () => true,
      hasToken: () => false,
    };
    assert.deepEqual(await controller.syncUpdatedRecord(record), { state: "signin-required" });

    const calls = [];
    currentCloud = {
      isConfigured: () => true,
      hasToken: () => true,
      async saveRecord(input) { calls.push(["save", input.id]); },
      async updateActual(id, actual) { calls.push(["actual", id, actual.homeGoals]); },
    };
    assert.deepEqual(await controller.syncUpdatedRecord(record), { state: "synced" });
    assert.deepEqual(calls, [["save", "R-1"], ["actual", "R-1", 2]]);

    const nextCalls = [];
    currentCloud = {
      isConfigured: () => true,
      hasToken: () => true,
      async saveRecord(input) { nextCalls.push(["wrapped-save", input.id]); },
      async updateActual(id) { nextCalls.push(["wrapped-actual", id]); },
    };
    await controller.syncUpdatedRecord(record);
    assert.deepEqual(nextCalls, [["wrapped-save", "R-1"], ["wrapped-actual", "R-1"]]);

    console.log("football-record-edit controller tests passed");
  } finally {
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
