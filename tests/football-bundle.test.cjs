const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const WORKFLOW_RUNTIME = path.join(ROOT, "src", "football", "workflow-runtime.js");
const APPLICATION_RUNTIME = path.join(ROOT, "src", "football", "application-runtime.js");
const REVIEW_RUNTIME = path.join(ROOT, "src", "football", "review-runtime.js");
const KNOCKOUT_EDIT_RUNTIME = path.join(ROOT, "src", "football", "knockout-edit-runtime.js");
const RECORD_EDIT_MODEL = path.join(ROOT, "src", "football", "record-edit-model.js");
const RECORD_EDIT = path.join(ROOT, "src", "football", "record-edit.js");
const KNOCKOUT_EDIT_MODEL = path.join(ROOT, "src", "football", "record-knockout-edit-model.js");
const KNOCKOUT_EDIT = path.join(ROOT, "src", "football", "record-knockout-edit.js");
const KNOCKOUT_INPUT_GUARD = path.join(ROOT, "src", "football", "record-knockout-input-guard.js");
const CLOUD = path.join(ROOT, "src", "football", "cloud.js");
const EVENTS = path.join(ROOT, "src", "football", "events.js");
const RENDER = path.join(ROOT, "src", "football", "render.js");
const ENERGY_ADAPTER = path.join(ROOT, "src", "football", "energy-adapter.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

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

/** 時間／空間複雜度 O(B)，B 為相關 source、bundle 與 map 總大小。 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const workflowRuntime = fs.readFileSync(WORKFLOW_RUNTIME, "utf8");
  const applicationRuntime = fs.readFileSync(APPLICATION_RUNTIME, "utf8");
  const reviewRuntime = fs.readFileSync(REVIEW_RUNTIME, "utf8");
  const knockoutEditRuntime = fs.readFileSync(KNOCKOUT_EDIT_RUNTIME, "utf8");
  const recordEditModel = fs.readFileSync(RECORD_EDIT_MODEL, "utf8");
  const recordEdit = fs.readFileSync(RECORD_EDIT, "utf8");
  const knockoutEditModel = fs.readFileSync(KNOCKOUT_EDIT_MODEL, "utf8");
  const knockoutEdit = fs.readFileSync(KNOCKOUT_EDIT, "utf8");
  const knockoutInputGuard = fs.readFileSync(KNOCKOUT_INPUT_GUARD, "utf8");
  const cloud = fs.readFileSync(CLOUD, "utf8");
  const events = fs.readFileSync(EVENTS, "utf8");
  const render = fs.readFileSync(RENDER, "utf8");
  const energyAdapter = fs.readFileSync(ENERGY_ADAPTER, "utf8");

  const executableCloud = stripComments(cloud);
  const executableEvents = stripComments(events);
  const executableRecordEditModel = stripComments(recordEditModel);
  const executableRecordEdit = stripComments(recordEdit);
  const executableKnockoutEditModel = stripComments(knockoutEditModel);
  const executableKnockoutEdit = stripComments(knockoutEdit);
  const executableKnockoutInputGuard = stripComments(knockoutInputGuard);

  const sideEffects = (source) => [...source.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const namedImports = (source) => [...source.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];

  assert.equal(sideEffects(entry).length, 5, "世足入口應只保留 5 個頂層相容 imports");
  assert.equal(namedImports(entry).length, 10, "世足入口應使用 10 個具名 import 宣告");
  assert.equal(sideEffects(workflowRuntime).length, 4, "workflow runtime 應固定載入 4 個流程相容模組");
  assert.equal(namedImports(workflowRuntime).length, 1, "workflow runtime 只應具名匯入能量轉接層");
  assert.equal(namedImports(applicationRuntime).length, 3, "application runtime 應具名匯入 workflow、雲端與事件工廠");
  assert.equal(sideEffects(reviewRuntime).length, 8, "review runtime 應固定載入 8 個紀錄 UX 相容模組");
  assert.equal(namedImports(reviewRuntime).length, 3, "review runtime 應具名匯入 application、編輯模型與控制器");
  assert.equal(sideEffects(knockoutEditRuntime).length, 2, "決勝 runtime 應固定載入 2 個牌面／控制相容模組");
  assert.equal(namedImports(knockoutEditRuntime).length, 4, "決勝 runtime 應具名匯入 review、純模型、轉接層與 guard");

  assert.ok(entry.includes('from "./knockout-edit-runtime.js";'));
  assert.equal(entry.includes('import "../../JS/football-record-knockout-input-guard.js";'), false);
  assert.ok(entry.includes("footballRecordKnockoutInputGuard"));
  assert.ok(knockoutEditRuntime.includes('from "./record-knockout-input-guard.js";'));
  assert.ok(knockoutEditRuntime.includes("inputGuard: footballRecordKnockoutInputGuard"));
  assert.ok(reviewRuntime.includes("cloudProvider: () => window.FootballLabCloud"));
  assert.ok(applicationRuntime.includes('import { createFootballEvents } from "./events.js";'));
  const eventsArguments = applicationRuntime.match(/createFootballEvents\(\{([\s\S]*?)\}\);/)?.[1] || "";
  assert.ok(eventsArguments, "找不到 createFootballEvents 參數區塊");
  assert.doesNotMatch(eventsArguments, /\bcloud\s*:/, "事件控制器建立參數不得持有固定 cloud");

  REMOVED_GLOBAL_FILES.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), false, `舊全域檔仍存在：${relativePath}`);
  });

  assert.doesNotMatch(executableRecordEdit, /window\.FootballLab(?:Core|Render)/, "基礎編輯控制器不得猜測全域核心或 Render");
  assert.doesNotMatch(executableKnockoutEdit, /window\.FootballLab(?:Core|Render)/, "決勝編輯轉接層不得猜測全域核心或 Render");
  assert.doesNotMatch(executableKnockoutInputGuard, /window\.FootballLab(?:Core|Render)/, "guard 不得猜測全域核心或 Render");
  assert.doesNotMatch(executableKnockoutInputGuard, /resultsFor|hasDraw|consensusWinner/, "guard 不得重複推導決勝規則");
  assert.match(executableKnockoutInputGuard, /new Map\(/, "guard 應以 Map 保存欄位值");
  assert.match(executableKnockoutInputGuard, /requestAnimationFrame/, "guard 應等待轉接層完成 DOM 更新");
  assert.match(knockoutEdit, /createFootballRecordKnockoutEdit/, "決勝編輯層應提供可注入工廠");
  assert.match(knockoutEditModel, /buildKnockoutRecord/, "決勝路徑規則應集中於純模型");
  assert.doesNotMatch(executableRecordEditModel, /\b(?:window|document|localStorage)\b/, "基礎純模型不得依賴瀏覽器全域");
  assert.doesNotMatch(executableKnockoutEditModel, /\b(?:window|document|localStorage)\b/, "決勝純模型不得依賴瀏覽器全域");
  assert.match(executableKnockoutEditModel, /new Set\(/, "階段重複牌應使用 Set 查表");
  assert.doesNotMatch(executableCloud, /listRecords/, "未確認的 listRecords 不得進入可執行雲端協定");
  assert.match(executableCloud, /\["health",\s*"createRecord",\s*"updateActual"\]/);
  assert.doesNotMatch(executableEvents, /window\.FootballLab(?:Core|Render)/, "事件模組不得猜測全域核心或 Render");
  assert.doesNotMatch(render, /\.innerHTML\s*=/, "具名 Render 不得以 innerHTML 寫入動態資料");
  assert.match(render, /textContent\s*=/, "具名 Render 應以 textContent 寫入文字");
  assert.doesNotMatch(energyAdapter, /(?:FOOTBALL_LAB_DATA|\bdata)\.positionMap\s*=/, "能量轉接層不得分叉 positionMap");

  assert.ok(fs.existsSync(RUNTIME), "dist 缺少 football-lab.js bundle");
  assert.ok(fs.existsSync(SOURCE_MAP), "dist 缺少 football-lab.js.map");
  const runtime = fs.readFileSync(RUNTIME, "utf8");
  const sourceMap = JSON.parse(fs.readFileSync(SOURCE_MAP, "utf8"));
  const sources = sourceMap.sources.map(String);
  assert.ok(runtime.includes("sourceMappingURL=football-lab.js.map"), "bundle 未連結 sourcemap");

  [
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
    "JS/football-records-ux.js",
    "JS/football-knockout-enhancements.js",
    "JS/football-direct-energy-ux.js",
    "JS/football-layout-optimizer.js",
  ].forEach((suffix) => {
    assert.ok(sources.some((value) => value.endsWith(suffix)), `sourcemap 缺少 ${suffix}`);
  });

  REMOVED_GLOBAL_FILES.forEach((suffix) => {
    assert.equal(sources.some((value) => value.endsWith(suffix)), false, `sourcemap 不得包含 ${suffix}`);
  });
  assert.ok(Array.isArray(sourceMap.sourcesContent), "sourcemap 缺少 sourcesContent");
  assert.equal(sourceMap.sourcesContent.length, sources.length, "每個 sourcemap source 都必須包含原始內容");

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.ok(html.includes('id="football-layout-final-style"'), "正式頁面缺少最終世足樣式");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-record-knockout-edit.js"), false, "正式頁面不得載入舊決勝編輯檔");
  assert.equal(html.includes("JS/football-record-knockout-input-guard.js"), false, "正式頁面不得載入舊 guard");

  console.log("football-bundle tests passed");
}

run();
