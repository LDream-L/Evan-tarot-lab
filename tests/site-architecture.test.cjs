const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/** 讀取 UTF-8 文字。時間／空間 O(n)，n = 檔案長度。 */
function read(relativePath, base = ROOT) {
  return fs.readFileSync(path.join(base, relativePath), "utf8");
}

/**
 * 驗證模組拆分、結構化 HTML 建置與可讀 CSS source。
 * 時間 O(F + H + C)，空間 O(H + C)，F = 固定檔案數、H = 建置器長度、C = CSS 長度。
 *
 * 更快替代方案比較：人工檢查檔案是否被重新合併或 source 是否退化成單行容易漏掉；
 * 本測試直接鎖定檔案責任、建置輸出與 source／dist 關係。
 */
function run() {
  const moduleFiles = [
    "JS/core/script-loader.js",
    "JS/core/dialog.js",
    "JS/security/link-sanitizer.js",
    "JS/articles/article-fallback.js",
    "JS/timeflow/import-export.js",
    "JS/bootstrap/optional-modules.js",
  ];

  moduleFiles.forEach((relativePath) => {
    assert.ok(fs.existsSync(path.join(ROOT, relativePath)), `缺少模組 source：${relativePath}`);
    assert.ok(fs.existsSync(path.join(DIST, relativePath)), `正式 dist 缺少模組：${relativePath}`);
  });

  const hardening = read("JS/site-hardening.js");
  assert.ok(hardening.split("\n").length < 180, "site-hardening.js 應維持精簡啟動器");
  assert.doesNotMatch(hardening, /function\s+createDialog\s*\(/, "對話框實作不應回到啟動器");
  assert.doesNotMatch(hardening, /function\s+sanitizeLinks\s*\(/, "連結清理實作不應回到啟動器");
  assert.doesNotMatch(hardening, /function\s+installTimeflowJsonImport\s*\(/, "時間流匯入不應回到啟動器");
  assert.doesNotMatch(hardening, /updateOutdatedCopy/, "不應再於執行期修補舊文案");
  assert.match(hardening, /window\.EvanDialog\?\.isEnhanced === true/, "必須區分原生備援與完整對話框");

  const buildScript = read("scripts/build-site.cjs");
  assert.doesNotMatch(buildScript, /const\s+NAV_PATTERN/, "主導覽不應再依賴跨區塊 regex 常數");
  assert.doesNotMatch(buildScript, /const\s+LOGO_PATTERN/, "Logo 不應再依賴跨區塊 regex 常數");
  assert.match(buildScript, /function\s+findElementRange\s*\(/, "缺少結構化元素範圍定位器");
  assert.match(buildScript, /function\s+buildTimeflowStyles\s*\(/, "缺少時間流 CSS 建置流程");

  const readableCss = read("src/styles/timeflow.css");
  const builtCss = read("timeflow.css", DIST);
  assert.ok(readableCss.split("\n").length > 300, "時間流 CSS source 不應是單行壓縮碼");
  assert.ok(readableCss.includes("@media (max-width:760px)"), "可讀 source 應保留行動版規則");
  assert.ok(builtCss.length < readableCss.length, "正式 timeflow.css 應由 source 壓縮產生");
  assert.ok(builtCss.split("\n").length <= 3, "正式 timeflow.css 應維持壓縮輸出");

  const practice = read("practice.html", DIST);
  assert.ok(
    practice.includes("記住接收網址（私人金鑰只保留在目前瀏覽器工作階段）"),
    "私人修煉說明應在建置期輸出正式文案"
  );
  assert.equal(practice.includes(">\n               記住這台裝置"), false, "正式頁不應殘留舊文案");

  console.log("site-architecture tests passed");
}

run();
