const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const WORKFLOW_RUNTIME = path.join(ROOT, "src", "football", "workflow-runtime.js");
const APPLICATION_RUNTIME = path.join(ROOT, "src", "football", "application-runtime.js");
const CLOUD = path.join(ROOT, "src", "football", "cloud.js");
const EVENTS = path.join(ROOT, "src", "football", "events.js");
const RENDER = path.join(ROOT, "src", "football", "render.js");
const ENERGY_ADAPTER = path.join(ROOT, "src", "football", "energy-adapter.js");
const LEGACY_CLOUD = path.join(ROOT, "JS", "football-cloud.js");
const LEGACY_EVENTS = path.join(ROOT, "JS", "football-events.js");
const LEGACY_RENDER = path.join(ROOT, "JS", "football-render.js");
const LEGACY_ENERGY = path.join(ROOT, "JS", "football-direct-energy.js");
const LEGACY_SCORING = path.join(ROOT, "JS", "football-strict-scoring.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

/**
 * 移除區塊與整行註解後再檢查可執行內容。
 * 時間／空間複雜度 O(B)，B 為 source 長度。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 驗證世足 ES Module entry、workflow、應用執行層、雲端與 sourcemap。
 * 時間／空間複雜度 O(B)，B 為相關 source、bundle 與 map 總大小。
 *
 * 替代方案比較：只檢查 bundle 存在無法證明依賴邊界；
 * 本測試逐一核對具名來源、舊全域檔移除與未確認 action 不得進入可執行內容。
 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const workflowRuntime = fs.readFileSync(WORKFLOW_RUNTIME, "utf8");
  const applicationRuntime = fs.readFileSync(APPLICATION_RUNTIME, "utf8");
  const cloud = fs.readFileSync(CLOUD, "utf8");
  const events = fs.readFileSync(EVENTS, "utf8");
  const executableCloud = stripComments(cloud);
  const executableEvents = stripComments(events);
  const render = fs.readFileSync(RENDER, "utf8");
  const energyAdapter = fs.readFileSync(ENERGY_ADAPTER, "utf8");

  const sideEffectImports = [...entry.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const namedImports = [...entry.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];
  const workflowSideEffects = [...workflowRuntime.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const workflowNamedImports = [...workflowRuntime.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];
  const applicationNamedImports = [...applicationRuntime.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];

  assert.equal(sideEffectImports.length, 18, "世足入口應保留 18 個相容 side-effect imports");
  assert.equal(namedImports.length, 8, "世足入口應使用 8 個具名 import 宣告");
  assert.equal(workflowSideEffects.length, 4, "workflow runtime 應固定載入 4 個流程相容模組");
  assert.equal(workflowNamedImports.length, 1, "workflow runtime 只應具名匯入能量轉接層");
  assert.equal(applicationNamedImports.length, 3, "application runtime 應具名匯入 workflow、雲端與事件工廠");

  assert.ok(entry.includes('from "./application-runtime.js";'));
  assert.ok(applicationRuntime.includes('import { footballWorkflowRuntime } from "./workflow-runtime.js";'));
  assert.ok(applicationRuntime.includes('import { createFootballCloud } from "./cloud.js";'));
  assert.ok(applicationRuntime.includes('import { createFootballEvents } from "./events.js";'));
  assert.ok(applicationRuntime.includes("core: runtimeCore"));
  assert.ok(applicationRuntime.includes("window.FootballLabCloud = footballCloud"));

  assert.ok(workflowRuntime.includes('import "../../JS/football-advance-visibility.js";'));
  assert.ok(workflowRuntime.includes('import "../../JS/football-datetime-fix.js";'));
  assert.ok(workflowRuntime.includes('import "../../JS/football-knockout-flow.js";'));
  assert.ok(workflowRuntime.includes('import "../../JS/football-direct-energy-form.js";'));
  assert.equal(workflowRuntime.includes("createFootballEvents"), false);

  assert.equal(entry.includes('import "../../JS/football-cloud.js";'), false);
  assert.equal(entry.includes('import "../../JS/football-events.js";'), false);
  assert.equal(fs.existsSync(LEGACY_CLOUD), false, "舊全域雲端模組應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_EVENTS), false, "舊全域事件模組應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_SCORING), false, "舊全域嚴格評分補丁應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_RENDER), false, "舊全域 Render 應自 source 移除");
  assert.equal(fs.existsSync(LEGACY_ENERGY), false, "舊單張能量混合模組應自 source 移除");

  assert.doesNotMatch(
    executableCloud,
    /window\.FootballLab(?:Core|Render)/,
    "具名雲端模組不得於點擊時猜測全域核心或 Render"
  );
  assert.doesNotMatch(executableCloud, /listRecords/, "未確認的 listRecords 不得進入可執行雲端協定");
  assert.match(executableCloud, /\["health",\s*"createRecord",\s*"updateActual"\]/);
  assert.match(executableCloud, /const records = core\.getRecords\(\)/, "同步按鈕必須讀取注入的核心快照");
  assert.doesNotMatch(
    executableEvents,
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
    "src/football/application-runtime.js",
    "src/football/cloud.js",
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
    "JS/football-cloud.js",
  ].forEach((suffix) => {
    assert.equal(sources.some((value) => value.endsWith(suffix)), false, `sourcemap 不得包含 ${suffix}`);
  });
  assert.ok(Array.isArray(sourceMap.sourcesContent), "sourcemap 缺少 sourcesContent");
  assert.equal(
    sourceMap.sourcesContent.length,
    sources.length,
    "每個 sourcemap source 都必須包含可除錯的原始內容"
  );

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.ok(html.includes('id="football-layout-final-style"'), "正式頁面缺少最終世足樣式");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-data.js"), false, "正式頁面不得逐一載入世足模組");

  console.log("football-bundle tests passed");
}

run();
