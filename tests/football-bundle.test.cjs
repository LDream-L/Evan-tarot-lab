const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const DIRECT_ENERGY = path.join(ROOT, "JS", "football-direct-energy.js");
const LEGACY_SCORING = path.join(ROOT, "JS", "football-strict-scoring.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

/**
 * 驗證世足 ES Module entry、正式 bundle、具名核心、評分層與 sourcemap。
 * 時間／空間複雜度 O(B)，B 為入口、相容模組、bundle 與 map 的總大小。
 *
 * 替代方案比較：只檢查 bundle 存在無法證明依賴是否納入；
 * 本測試同時核對 26 個相容 side-effect imports、3 個具名 imports、
 * 不可變資料契約、舊評分補丁移除與 map sources。
 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const directEnergy = fs.readFileSync(DIRECT_ENERGY, "utf8");
  const sideEffectImports = [...entry.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  const namedImports = [...entry.matchAll(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];$/gm)];

  assert.equal(sideEffectImports.length, 26, "世足入口應保留 26 個相容 side-effect imports");
  assert.equal(namedImports.length, 3, "世足資料、核心與評分必須使用 3 個具名 imports");
  assert.ok(entry.includes('import { footballData } from "./data.js";'));
  assert.ok(entry.includes('import { footballCore } from "./core.js";'));
  assert.ok(entry.includes('import { footballScoring, scoredFootballCore } from "./scoring.js";'));
  assert.equal(entry.includes('import "../../JS/football-data.js";'), false);
  assert.equal(entry.includes('import "../../JS/football-core.js";'), false);
  assert.equal(entry.includes('import "../../JS/football-strict-scoring.js";'), false);
  assert.equal(fs.existsSync(LEGACY_SCORING), false, "舊全域嚴格評分補丁應自 source 移除");

  assert.doesNotMatch(
    directEnergy,
    /(?:FOOTBALL_LAB_DATA|\bdata)\.positionMap\s*=/,
    "相容模組不得重新指定具名資料層的 positionMap"
  );

  assert.ok(fs.existsSync(RUNTIME), "dist 缺少 football-lab.js bundle");
  assert.ok(fs.existsSync(SOURCE_MAP), "dist 缺少 football-lab.js.map");

  const runtime = fs.readFileSync(RUNTIME, "utf8");
  const sourceMap = JSON.parse(fs.readFileSync(SOURCE_MAP, "utf8"));
  const sources = sourceMap.sources.map(String);
  assert.ok(runtime.includes("sourceMappingURL=football-lab.js.map"), "bundle 未連結 sourcemap");
  assert.ok(sources.some((value) => value.endsWith("src/football/entry.js")));
  assert.ok(sources.some((value) => value.endsWith("src/football/data.js")));
  assert.ok(sources.some((value) => value.endsWith("src/football/core.js")));
  assert.ok(sources.some((value) => value.endsWith("src/football/scoring.js")));
  assert.ok(sources.some((value) => value.endsWith("JS/football-layout-optimizer.js")));
  assert.equal(sources.some((value) => value.endsWith("JS/football-data.js")), false);
  assert.equal(sources.some((value) => value.endsWith("JS/football-core.js")), false);
  assert.equal(sources.some((value) => value.endsWith("JS/football-strict-scoring.js")), false);
  assert.ok(Array.isArray(sourceMap.sourcesContent) && sourceMap.sourcesContent.length >= 30);

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.ok(html.includes('id="football-layout-final-style"'), "正式頁面缺少最終世足樣式");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-data.js"), false, "正式頁面不得逐一載入世足模組");

  console.log("football-bundle tests passed");
}

run();
