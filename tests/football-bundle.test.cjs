const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ENTRY = path.join(ROOT, "src", "football", "entry.js");
const RUNTIME = path.join(DIST, "JS", "football-lab.js");
const SOURCE_MAP = `${RUNTIME}.map`;

/**
 * 驗證世足 ES Module entry、正式 bundle 與 sourcemap。
 * 時間／空間複雜度 O(B)，B 為入口、bundle 與 map 的總大小。
 *
 * 替代方案比較：只檢查 bundle 存在無法證明 29 個相依是否納入；
 * 本測試同時核對 import 數、代表性 sources、linked map 與正式 CSS。
 */
function run() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const imports = [...entry.matchAll(/^import\s+["'][^"']+["'];$/gm)];
  assert.equal(imports.length, 29, "世足入口必須顯性匯入 29 個模組");

  assert.ok(fs.existsSync(RUNTIME), "dist 缺少 football-lab.js bundle");
  assert.ok(fs.existsSync(SOURCE_MAP), "dist 缺少 football-lab.js.map");

  const runtime = fs.readFileSync(RUNTIME, "utf8");
  const sourceMap = JSON.parse(fs.readFileSync(SOURCE_MAP, "utf8"));
  assert.ok(runtime.includes("sourceMappingURL=football-lab.js.map"), "bundle 未連結 sourcemap");
  assert.ok(sourceMap.sources.some((value) => String(value).endsWith("src/football/entry.js")));
  assert.ok(sourceMap.sources.some((value) => String(value).endsWith("JS/football-data.js")));
  assert.ok(sourceMap.sources.some((value) => String(value).endsWith("JS/football-core.js")));
  assert.ok(sourceMap.sources.some((value) => String(value).endsWith("JS/football-layout-optimizer.js")));
  assert.ok(Array.isArray(sourceMap.sourcesContent) && sourceMap.sourcesContent.length >= 30);

  const html = fs.readFileSync(path.join(DIST, "football-lab.html"), "utf8");
  assert.ok(html.includes('id="football-layout-final-style"'), "正式頁面缺少最終世足樣式");
  assert.equal((html.match(/JS\/football-lab\.js/g) || []).length, 1, "正式頁面應只載入一個世足入口");
  assert.equal(html.includes("JS/football-data.js"), false, "正式頁面不得逐一載入世足模組");

  console.log("football-bundle tests passed");
}

run();
