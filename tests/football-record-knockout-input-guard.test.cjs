const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "record-knockout-input-guard.js");

/** 時間／空間複雜度 O(B)，B 為 guard source 大小。 */
function loadGuard() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-knockout-input-guard-"));
  const bundle = path.join(directory, "guard.cjs");
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

/** 建立可替換欄位：時間／空間 O(1)。 */
function field(id, value, stage = "extra") {
  return {
    id,
    value,
    closest(selector) {
      if (selector !== "#football-edit-extra-stage, #football-edit-penalty-stage") return null;
      return stage === "extra" || stage === "penalty" ? { id: stage } : null;
    },
  };
}

/** 時間／空間 O(p)，p 為固定測試欄位數。 */
function run() {
  const runtime = loadGuard();
  try {
    let tracked = [
      field("football-edit-extra-direct-result", "D", "extra"),
      field("football-edit-stage-extra-home", "0", "extra"),
      field("football-edit-extra-structure-notes", "延長賽仍僵持", "extra"),
      field("football-edit-penalty-winner", "H", "penalty"),
    ];
    const listeners = new Map();
    let bodyClick = null;
    const timers = [];
    const frames = [];
    const records = new Map([
      ["R-1", { id: "R-1" }],
      ["R-2", { id: "R-2" }],
    ]);
    const documentRef = {
      getElementById(id) {
        if (id === "football-records-body") {
          return {
            addEventListener(type, listener) {
              if (type === "click") bodyClick = listener;
            },
          };
        }
        return tracked.find((element) => element.id === id) || null;
      },
      querySelectorAll() {
        return tracked;
      },
      addEventListener(type, listener, capture) {
        listeners.set(`${type}:${Boolean(capture)}`, listener);
      },
    };
    const browserWindow = {
      setTimeout(callback) {
        timers.push(callback);
      },
      requestAnimationFrame(callback) {
        frames.push(callback);
      },
    };
    const core = { getRecord: (id) => records.get(id) || null };
    const knockoutEditor = { prepareEditor() {} };
    const guard = runtime.api.createFootballRecordKnockoutInputGuard({
      core,
      knockoutEditor,
      browserWindow,
      documentRef,
      autoBind: false,
    });

    assert.equal(Object.isFrozen(guard), true);
    assert.strictEqual(guard.core, core);
    assert.strictEqual(guard.knockoutEditor, knockoutEditor);
    assert.equal(guard.isBound(), false);
    guard.bind();
    assert.equal(guard.isBound(), true);
    assert.equal(typeof listeners.get("input:true"), "function");
    assert.equal(typeof listeners.get("change:true"), "function");
    assert.equal(typeof bodyClick, "function");

    guard.beginSession("R-1");
    assert.equal(guard.getCurrentRecordId(), "R-1");
    assert.equal(guard.getSnapshot().size, 0, "開始新工作階段時應先清空暫存");
    timers.shift()();
    assert.equal(guard.getSnapshot().size, 4);
    frames.shift()();
    frames.shift()();

    tracked = [
      field("football-edit-extra-direct-result", "", "extra"),
      field("football-edit-stage-extra-home", "", "extra"),
      field("football-edit-extra-structure-notes", "", "extra"),
      field("football-edit-penalty-winner", "", "penalty"),
    ];
    assert.equal(guard.restore(), 4);
    assert.deepEqual(
      tracked.map((element) => element.value),
      ["D", "0", "延長賽仍僵持", "H"]
    );

    tracked[2].value = "使用者更新後的解讀";
    listeners.get("input:true")({ target: tracked[2] });
    assert.equal(guard.getSnapshot().get("football-edit-extra-structure-notes"), "使用者更新後的解讀");
    frames.shift()();
    frames.shift()();

    bodyClick({
      target: {
        closest(selector) {
          return selector === 'button[data-action="edit-match"]'
            ? { dataset: { id: "R-2" } }
            : null;
        },
      },
    });
    assert.equal(guard.getCurrentRecordId(), "R-2");
    assert.equal(guard.getSnapshot().size, 0, "切換紀錄不得沿用前一筆暫存");

    tracked = [field("football-edit-extra-direct-result", "A", "extra")];
    timers.shift()();
    assert.deepEqual([...guard.getSnapshot().entries()], [["football-edit-extra-direct-result", "A"]]);

    guard.clear();
    assert.equal(guard.getCurrentRecordId(), "");
    assert.equal(guard.getSnapshot().size, 0);
    assert.equal(guard.restore(), 0);

    console.log("football-record-knockout-input-guard tests passed");
  } finally {
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  }
}

run();
