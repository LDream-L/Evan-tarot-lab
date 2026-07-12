const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const FINAL_STYLE_TAG =
  '  <link id="football-layout-final-style" rel="stylesheet" href="football-layout-final.css?v=20260710-football-esm-entry-v1" />';
const KPI_DENSITY_STYLE_TAG =
  '  <link id="football-kpi-density-style" rel="stylesheet" href="football-kpi-density.css?v=20260712-football-kpi-density-v1" />';

/**
 * 將最終密度樣式固定寫入正式 HTML，取代舊載入器完成後才動態插入。
 * 時間／空間複雜度 O(H)，H 為 HTML 長度。
 *
 * 替代方案比較：等 29 個 script 都完成後才插入 CSS 會造成樣式跳動；
 * 建置期靜態寫入能讓瀏覽器一開始就依正確順序下載樣式。
 */
function transformFootballHtml(source) {
  const missingTags = [];
  if (!source.includes('id="football-layout-final-style"')) missingTags.push(FINAL_STYLE_TAG);
  if (!source.includes('id="football-kpi-density-style"')) missingTags.push(KPI_DENSITY_STYLE_TAG);
  if (!missingTags.length) return source;

  const optimizerPattern = /(\s*<link id="football-layout-optimizer-style"[^>]*>)/;
  if (!optimizerPattern.test(source)) {
    throw new Error("[football-build] 找不到 football-layout-optimizer-style");
  }

  return source.replace(optimizerPattern, `$1\n${missingTags.join("\n")}`);
}

/**
 * 將 29 個 side-effect ES imports 建置成單一 IIFE bundle 與 linked sourcemap。
 * 時間／空間複雜度 O(B)，B 為入口與所有相依模組的總大小。
 *
 * 替代方案比較：
 * - 舊載入器：29 個請求與隱性順序，任何一個失敗都可能留下半初始化頁面。
 * - 單純字串串接：可減少請求，但沒有模組解析、依賴圖與準確 sourcemap。
 * - 本方案：ES Module entry 顯性宣告相依，由 esbuild 產生單一正式 bundle。
 */
function buildFootballRuntime({ root, dist }) {
  const entryPath = path.join(root, "src", "football", "entry.js");
  const outputPath = path.join(dist, "JS", "football-lab.js");

  if (!fs.existsSync(entryPath)) {
    throw new Error("[football-build] 缺少 src/football/entry.js");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  esbuild.buildSync({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    format: "iife",
    minify: true,
    sourcemap: "linked",
    sourcesContent: true,
    legalComments: "inline",
    charset: "utf8",
    target: ["es2020"],
    logLevel: "silent",
  });
}

module.exports = Object.freeze({
  buildFootballRuntime,
  transformFootballHtml,
});
