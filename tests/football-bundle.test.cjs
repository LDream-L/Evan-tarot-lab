const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const WORKFLOW_RUNTIME = path.join(ROOT, "src", "football", "workflow-runtime.js");
const EVENTS = path.join(ROOT, "src", "football", "events.js");
const RENDER = path.join(ROOT, "src", "football", "render.js");
const ENERGY_ADAPTER = path.join(ROOT, "src", "football", "energy-adapter.js");
const LEGACY_EVENTS = path.join(ROOT, "JS", "football-events.js");
const LEGACY_RENDER = path.join(ROOT, "JS", "football-render.js");
const LEGACY_ENERGY = path.join(ROOT, "JS", "football-direct-energy.js");
const LEGACY_SCORING = path.join(ROOT, "JS", "football-strict-scoring.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

/**
 * 驗證世足 ES Module entry、流程執行層、事件工廠與 sourcemap。
 * 時間／空間複雜度 O(B)，B 為入口、相容模組、bundle 與 map 的總大小。
 *
 * 替代方案比較：只檢查 bundle 存在無法證明依賴是否納入；
 * 本測試同時核對入口 19 個相容 imports、7 個具名 imports、
 * workflow 內 4 個有序相容流程模組、事件依賴注入與舊全域檔移除。
 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const workflowRuntime = fs.readFileSync(WORKFLOW_RUNTIME, "utf8");
  const events = fs.readFileSync(EVENTS, "utf8");
  const render = fs.readFileSync(RENDER, "utf8");
  const energyAdapter = fs.readFileSync(ENERGY_ADAPTER, "utf8");

  const sideEffectImports = [...entry.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const namedImports = [...entry.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];
  const workflowSideEffects = [...workflowRuntime.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const workflowNamedImports = [...workflowRuntime.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];

  assert.equal(sideEffectImports.length, 19, "世足入口應保留 19 個相容 side-effect imports");
  assert.equal(namedImports.length, 7, "世足入口應使用 7 個具名 import 宣告");
  assert.equal(workflowSideEffects.length, 4, "workflow runtime 應固定載入 4 個流程相容模組");
  assert.equal(workflowNamedImports.length, 2, "workflow runtime 應具名匯入能量轉接與事件工廠");

  assert.ok(entry.includes('import { footballData } from "./data.js";'));
  assert.ok(entry.includes('import { footballCore } from "./core.js";'));
  assert.ok(entry.includes('import { footballScoring, scoredFootballCore } from "./scoring.js";'));
  assert.ok(entry.includes('import { footballRender } from "./render.js";'));
  assert.ok(entry.includes('import { footballEnergyModel } from "./energy-model.js";'));
  assert.ok(entry.includes('from "./energy-adapter.js";'));
  assert.ok(entry.includes('from "./workflow-runtime.js";'));

  assert.ok(workflowRuntime.includes('import "../../JS/football-advance-visibility.js";'));
  assert.ok(workflowRuntime.includes('import "../../JS/football-datetime-fix.js";'));
  assert.ok(workflowRuntime.includes('import "../../JS/football-knockout-flow.js";'));
  assert.ok(workflowRuntime.includes('import "../../JS/football-direct-energy-form.js";'));
  assert.ok(workflowRuntime.includes('import { createFootballEvents } from "./events.js";'));

  assert.equal(entry.includes('import "../../JS/football-events.js";'), false);
  assert.equal(entry.includes('import "../../JS/football-knockout-flow.js";'), false);
  assert.equal(fs.existsSync(LEGACY_EVENTS), false, "舊全域事件模組應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_SCORING), false, "舊全域嚴格評分補丁應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_RENDER), false, "舊全域 Render 應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_ENERGY), false, "舊單張能量混合模組應自 source 移除");

  assert.doesNotMatch(
    events,
    /window\.FootballLab(?:Core|Render)/,
    "具名事件模組不得自行猜測全域核心或 Render"
  );
  assert.match(events, /createFootballEvents/, "事件模組應提供可注入依賴的工廠");
  assert.doesNotMatch(render, /\.innerHTML\s*=/, "具名 Render 不得以 innerHTML 寫入動態資料");
  assert.match(render, /textContent\s*=/, "具名 Render 應以 textContent 寫入文字");
  assert.doesNotMatch(
    energyAdapter,
    /(?:FOOTBALL_LAB_DATA|\bdata)\.positionMap\s*=/,
    "能量轉接層不得重新指定具名資料層的 positionMap"
  );

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
    "src/football/events.js",
    "JS/football-advance-visibility.js",
    "JS/football-datetime-fix.js",
    "JS/football-knockout-flow.js",
    "JS/football-direct-energy-form.js",
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
  ].forEach((suffix) => {
    assert.equal(sources.some((value) => value.endsWith(suffix)), false, `sourcemap 不得包含 ${suffix}`);
  });
  assert.ok(Array.isArray(sourceMap.sourcesContent) && sourceMap.sourcesContent.length >= 32);

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.ok(html.includes('id="football-layout-final-style"'), "正式頁面缺少最終世足樣式");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-data.js"), false, "正式頁面不得逐一載入世足模組");

  console.log("football-bundle tests passed");
}

run();
