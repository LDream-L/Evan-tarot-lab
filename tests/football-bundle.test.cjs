const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const KNOCKOUT_RUNTIME = path.join(ROOT, "src", "football", "knockout-edit-runtime.js");
const GUARD = path.join(ROOT, "src", "football", "record-knockout-input-guard.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

const REQUIRED_SOURCES = [
  "src/football/entry.js",
  "src/football/data.js",
  "src/football/core.js",
  "src/football/scoring.js",
  "src/football/render.js",
  "src/football/energy-model.js",
  "src/football/energy-adapter.js",
  "src/football/workflow-runtime.js",
  "src/football/application-runtime.js",
  "src/football/cloud.js",
  "src/football/events.js",
  "src/football/review-runtime.js",
  "src/football/record-edit-model.js",
  "src/football/record-edit.js",
  "src/football/knockout-edit-runtime.js",
  "src/football/record-knockout-edit-model.js",
  "src/football/record-knockout-edit.js",
  "src/football/record-knockout-input-guard.js",
];

const REMOVED_GLOBAL_FILES = [
  "JS/football-data.js",
  "JS/football-core.js",
  "JS/football-strict-scoring.js",
  "JS/football-render.js",
  "JS/football-direct-energy.js",
  "JS/football-events.js",
  "JS/football-cloud.js",
  "JS/football-record-edit.js",
  "JS/football-record-knockout-edit.js",
  "JS/football-record-knockout-input-guard.js",
];

/** 時間／空間複雜度 O(B)，B 為 source 長度。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** 時間／空間複雜度 O(B + S)，S 為 sourcemap source 數。 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const knockoutRuntime = fs.readFileSync(KNOCKOUT_RUNTIME, "utf8");
  const guard = fs.readFileSync(GUARD, "utf8");
  const executableGuard = stripComments(guard);

  assert.ok(entry.includes('from "./knockout-edit-runtime.js";'), "入口未載入決勝 runtime");
  assert.ok(entry.includes("footballRecordKnockoutInputGuard"), "入口未檢查具名 guard");
  assert.equal(entry.includes('import "../../JS/football-record-knockout-input-guard.js";'), false, "入口仍載入舊 guard");

  assert.ok(knockoutRuntime.includes('from "./record-knockout-input-guard.js";'), "決勝 runtime 未具名匯入 guard");
  assert.ok(knockoutRuntime.includes("inputGuard: footballRecordKnockoutInputGuard"), "決勝 runtime 未公開 guard");
  assert.ok(knockoutRuntime.includes('guardStage: "knockout-input-preservation-ready"'), "決勝 runtime 缺少 guard stage");

  assert.doesNotMatch(executableGuard, /window\.FootballLab(?:Core|Render)/, "guard 不得猜測全域核心或 Render");
  assert.doesNotMatch(executableGuard, /resultsFor|hasDraw|consensusWinner/, "guard 不得重複推導決勝規則");
  assert.match(executableGuard, /new Map\(/, "guard 應使用 Map 保存欄位");
  assert.match(executableGuard, /requestAnimationFrame/, "guard 應等待 DOM 更新後回填");

  REMOVED_GLOBAL_FILES.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), false, `舊全域檔仍存在：${relativePath}`);
  });

  assert.ok(fs.existsSync(RUNTIME), "dist 缺少 football-lab.js");
  assert.ok(fs.existsSync(SOURCE_MAP), "dist 缺少 football-lab.js.map");
  const runtime = fs.readFileSync(RUNTIME, "utf8");
  const sourceMap = JSON.parse(fs.readFileSync(SOURCE_MAP, "utf8"));
  const sources = sourceMap.sources.map(String);

  assert.ok(runtime.includes("sourceMappingURL=football-lab.js.map"), "bundle 未連結 sourcemap");
  REQUIRED_SOURCES.forEach((suffix) => {
    assert.ok(sources.some((value) => value.endsWith(suffix)), `sourcemap 缺少 ${suffix}`);
  });
  REMOVED_GLOBAL_FILES.forEach((suffix) => {
    assert.equal(sources.some((value) => value.endsWith(suffix)), false, `sourcemap 不得包含 ${suffix}`);
  });
  assert.ok(Array.isArray(sourceMap.sourcesContent), "sourcemap 缺少 sourcesContent");
  assert.equal(sourceMap.sourcesContent.length, sources.length, "每個 source 都必須保留原始內容");

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-record-knockout-input-guard.js"), false, "正式頁面不得載入舊 guard");

  console.log("football-bundle tests passed");
}

run();
