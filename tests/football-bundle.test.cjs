const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const KNOCKOUT_RUNTIME = path.join(ROOT, "src", "football", "knockout-edit-runtime.js");
const GUARD = path.join(ROOT, "src", "football", "record-knockout-input-guard.js");
const LEGACY_GUARD = path.join(ROOT, "JS", "football-record-knockout-input-guard.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;
const FOOTBALL_SCRIPT_VERSION = "20260810-auth-expiry-reload-v1";

/** 時間／空間複雜度 O(B)，B 為受檢 source、HTML 與 sourcemap 大小。 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const knockoutRuntime = fs.readFileSync(KNOCKOUT_RUNTIME, "utf8");
  const guard = fs.readFileSync(GUARD, "utf8");

  assert.equal(fs.existsSync(LEGACY_GUARD), false, "舊全域 guard 應已移除");
  assert.ok(entry.includes("footballRecordKnockoutInputGuard"), "入口缺少具名 guard 契約");
  assert.equal(entry.includes("football-record-knockout-input-guard.js"), false, "入口仍載入舊 guard");
  assert.ok(knockoutRuntime.includes('from "./record-knockout-input-guard.js";'), "決勝 runtime 未匯入新 guard");
  assert.ok(knockoutRuntime.includes("inputGuard: footballRecordKnockoutInputGuard"), "決勝 runtime 未公開 guard");
  assert.match(guard, /new Map\(/, "guard 應以 Map 保存欄位值");
  assert.match(guard, /requestAnimationFrame/, "guard 應等待 DOM 更新後回填");

  assert.ok(fs.existsSync(RUNTIME), "dist 缺少 football-lab.js");
  assert.ok(fs.existsSync(SOURCE_MAP), "dist 缺少 football-lab.js.map");
  const runtime = fs.readFileSync(RUNTIME, "utf8");
  const sourceMap = JSON.parse(fs.readFileSync(SOURCE_MAP, "utf8"));
  const sources = sourceMap.sources.map(String);

  assert.ok(runtime.includes("sourceMappingURL=football-lab.js.map"), "bundle 未連結 sourcemap");
  assert.ok(
    sources.some((value) => value.endsWith("src/football/record-knockout-input-guard.js")),
    "sourcemap 缺少新 guard source"
  );
  assert.equal(
    sources.some((value) => value.endsWith("JS/football-record-knockout-input-guard.js")),
    false,
    "sourcemap 不得包含舊 guard"
  );
  assert.ok(Array.isArray(sourceMap.sourcesContent), "sourcemap 缺少 sourcesContent");
  assert.equal(sourceMap.sourcesContent.length, sources.length, "每個 source 都必須保留原始內容");

  const sourceHtml = fs.readFileSync(path.join(ROOT, "football-lab.html"), "utf8");
  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  const versionedEntry = `JS/football-lab.js?v=${FOOTBALL_SCRIPT_VERSION}`;
  assert.ok(sourceHtml.includes(versionedEntry), "repository 根目錄未更新世足入口快取版本");
  assert.ok(html.includes(versionedEntry), "正式頁面未保留世足入口快取版本");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-record-knockout-input-guard.js"), false, "正式頁面不得載入舊 guard");

  console.log("football-bundle tests passed");
}

run();
