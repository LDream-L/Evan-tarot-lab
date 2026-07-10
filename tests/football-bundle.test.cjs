const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const WORKFLOW_RUNTIME = path.join(ROOT, "src", "football", "workflow-runtime.js");
const APPLICATION_RUNTIME = path.join(ROOT, "src", "football", "application-runtime.js");
const REVIEW_RUNTIME = path.join(ROOT, "src", "football", "review-runtime.js");
const RECORD_EDIT_MODEL = path.join(ROOT, "src", "football", "record-edit-model.js");
const RECORD_EDIT = path.join(ROOT, "src", "football", "record-edit.js");
const CLOUD = path.join(ROOT, "src", "football", "cloud.js");
const EVENTS = path.join(ROOT, "src", "football", "events.js");
const RENDER = path.join(ROOT, "src", "football", "render.js");
const ENERGY_ADAPTER = path.join(ROOT, "src", "football", "energy-adapter.js");
const LEGACY_RECORD_EDIT = path.join(ROOT, "JS", "football-record-edit.js");
const LEGACY_CLOUD = path.join(ROOT, "JS", "football-cloud.js");
const LEGACY_EVENTS = path.join(ROOT, "JS", "football-events.js");
const LEGACY_RENDER = path.join(ROOT, "JS", "football-render.js");
const LEGACY_ENERGY = path.join(ROOT, "JS", "football-direct-energy.js");
const LEGACY_SCORING = path.join(ROOT, "JS", "football-strict-scoring.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

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
  const recordEditModel = fs.readFileSync(RECORD_EDIT_MODEL, "utf8");
  const recordEdit = fs.readFileSync(RECORD_EDIT, "utf8");
  const cloud = fs.readFileSync(CLOUD, "utf8");
  const events = fs.readFileSync(EVENTS, "utf8");
  const executableCloud = stripComments(cloud);
  const executableEvents = stripComments(events);
  const executableRecordEditModel = stripComments(recordEditModel);
  const executableRecordEdit = stripComments(recordEdit);
  const render = fs.readFileSync(RENDER, "utf8");
  const energyAdapter = fs.readFileSync(ENERGY_ADAPTER, "utf8");

  const entrySideEffects = [...entry.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const entryNamedImports = [...entry.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];
  const workflowSideEffects = [...workflowRuntime.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const workflowNamedImports = [...workflowRuntime.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];
  const applicationNamedImports = [...applicationRuntime.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];
  const reviewSideEffects = [...reviewRuntime.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const reviewNamedImports = [...reviewRuntime.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];

  assert.equal(entrySideEffects.length, 9, "世足入口應只保留 9 個頂層相容 imports");
  assert.equal(entryNamedImports.length, 9, "世足入口應使用 9 個具名 import 宣告");
  assert.equal(workflowSideEffects.length, 4, "workflow runtime 應固定載入 4 個流程相容模組");
  assert.equal(workflowNamedImports.length, 1, "workflow runtime 只應具名匯入能量轉接層");
  assert.equal(applicationNamedImports.length, 3, "application runtime 應具名匯入 workflow、雲端與事件工廠");
  assert.equal(reviewSideEffects.length, 8, "review runtime 應固定載入 8 個紀錄 UX 相容模組");
  assert.equal(reviewNamedImports.length, 3, "review runtime 應具名匯入 application、編輯模型與控制器");

  assert.ok(entry.includes('from "./review-runtime.js";'));
  assert.equal(entry.includes('import "../../JS/football-record-edit.js";'), false);
  assert.ok(reviewRuntime.includes('import { footballRecordEditModel } from "./record-edit-model.js";'));
  assert.ok(reviewRuntime.includes('import { createFootballRecordEdit } from "./record-edit.js";'));
  assert.ok(reviewRuntime.includes("cloudProvider: () => window.FootballLabCloud"));
  assert.ok(applicationRuntime.includes('import { createFootballEvents } from "./events.js";'));
  const eventsArguments = applicationRuntime.match(/createFootballEvents\(\{([\s\S]*?)\}\);/)?.[1] || "";
  assert.ok(eventsArguments, "找不到 createFootballEvents 參數區塊");
  assert.doesNotMatch(eventsArguments, /\bcloud\s*:/, "事件控制器建立參數不得持有固定 cloud");

  assert.equal(fs.existsSync(LEGACY_RECORD_EDIT), false, "舊全域紀錄編輯模組應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_CLOUD), false, "舊全域雲端模組應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_EVENTS), false, "舊全域事件模組應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_SCORING), false, "舊全域嚴格評分補丁應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_RENDER), false, "舊全域 Render 應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_ENERGY), false, "舊單張能量混合模組應自 source 移除");

  assert.doesNotMatch(executableRecordEdit, /window\.FootballLab(?:Core|Render)/, "編輯控制器不得猜測全域核心或 Render");
  assert.match(recordEdit, /createFootballRecordEdit/, "紀錄編輯層應提供可注入工廠");
  assert.match(recordEditModel, /buildUpdatedRecord/, "紀錄編輯規則應集中於純模型");
  assert.doesNotMatch(executableRecordEditModel, /\b(?:window|document|localStorage)\b/, "純編輯模型不得依賴瀏覽器全域");
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
    "JS/football-records-ux.js",
    "JS/football-knockout-enhancements.js",
    "JS/football-direct-energy-ux.js",
    "JS/football-record-knockout-edit.js",
    "JS/football-layout-optimizer.js",
  ].forEach((suffix) => {
    assert.ok(sources.some((value) => value.endsWith(suffix)), `sourcemap 缺少 ${suffix}`);
  });

  [
    "JS/football-data.js",
    "JS/football-core.js",
    "JS/football-strict-scoring.js",
    "JS/football-render.js",
    "JS/football-direct-energy.js",
    "JS/football-events.js",
    "JS/football-cloud.js",
    "JS/football-record-edit.js",
  ].forEach((suffix) => {
    assert.equal(sources.some((value) => value.endsWith(suffix)), false, `sourcemap 不得包含 ${suffix}`);
  });
  assert.ok(Array.isArray(sourceMap.sourcesContent), "sourcemap 缺少 sourcesContent");
  assert.equal(sourceMap.sourcesContent.length, sources.length, "每個 sourcemap source 都必須包含原始內容");

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.ok(html.includes('id="football-layout-final-style"'), "正式頁面缺少最終世足樣式");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-record-edit.js"), false, "正式頁面不得載入舊紀錄編輯檔");

  console.log("football-bundle tests passed");
}

run();
