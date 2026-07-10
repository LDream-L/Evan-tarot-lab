// 世足賽事驗證｜ES Module 正式入口
//
// 主要流程複雜度：
// - 模組解析與執行：時間 O(M)、空間 O(M)，M = 29 個相依模組。
// - 啟動完整性檢查：時間 O(G)、空間 O(G)，G = 必要全域 API 數。
// - 版本文案同步：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊版：瀏覽器動態建立 29 個 script，雖可平行預載，仍需維護隱性執行順序。
// - 本版：由 ES Module import 明確記錄相依順序，建置時合併成單一 bundle。
// - 一次把所有 window API 改為具名 export：架構較純，但同時改動資料、UI、雲端與編輯層，回歸風險過高。
// - 本階段保留既有 window API，只替換載入與建置邊界；後續再分層改為具名 export。

import "../../JS/cloud-config.js";
import "../../JS/site-account.js";
import "../../JS/football-data.js";
import "../../JS/football-core.js";
import "../../JS/football-strict-scoring.js";
import "../../JS/football-render.js";
import "../../JS/football-advance-visibility.js";
import "../../JS/football-datetime-fix.js";
import "../../JS/football-knockout-flow.js";
import "../../JS/football-direct-energy.js";
import "../../JS/football-direct-energy-form.js";
import "../../JS/football-events.js";
import "../../JS/football-cloud.js";
import "../../JS/football-records-ux.js";
import "../../JS/football-hit-ux.js";
import "../../JS/football-strict-hit-ux.js";
import "../../JS/football-record-display-ux.js";
import "../../JS/football-knockout-enhancements.js";
import "../../JS/football-knockout-record-ux.js";
import "../../JS/football-team-name-ux.js";
import "../../JS/football-direct-energy-ux.js";
import "../../JS/football-record-edit.js";
import "../../JS/football-card-layout-unifier.js";
import "../../JS/football-record-card-controls.js";
import "../../JS/football-record-knockout-edit.js";
import "../../JS/football-record-knockout-input-guard.js";
import "../../JS/football-record-status-visibility-fix.js";
import "../../JS/football-performance-trends.js";
import "../../JS/football-layout-optimizer.js";

const MODULE_COUNT = 29;
const INTERFACE_VERSION = "1.7.6";
const REQUIRED_GLOBALS = Object.freeze([
  "FOOTBALL_LAB_DATA",
  "FootballLabCore",
]);

/**
 * 確認所有基礎模組已完成執行。
 * 時間／空間複雜度 O(G)，G 為固定必要 API 數。
 */
function assertRequiredGlobals() {
  const missing = REQUIRED_GLOBALS.filter((name) => !window[name]);
  if (missing.length) {
    throw new Error(`世足模組啟動不完整：${missing.join("、")}`);
  }
}

/**
 * 統一模型版本與介面版本的顯示責任。
 * 時間／空間複雜度 O(1)。
 *
 * 替代方案比較：
 * - 各相容模組自行改 document.title 與 H1：後載模組可能把介面版本覆蓋成模型版本。
 * - 本方案：所有相容模組完成後，由唯一入口寫入最終版本文案，避免版本漂移。
 */
function synchronizeVersionCopy() {
  const modelVersion = String(window.FOOTBALL_LAB_DATA.modelVersion || "").trim();
  const combinedLabel = `模型 v${modelVersion}｜介面 v${INTERFACE_VERSION}`;

  document.title = `Evan Tarot｜世足賽事驗證｜模型 v${modelVersion}・介面 v${INTERFACE_VERSION}`;

  const heroTitle = document.querySelector(".subpage-hero .hero-text h1");
  if (heroTitle) heroTitle.textContent = "世足賽事驗證。";

  const versionBadge = document.querySelector("#football-match-form .football-version");
  if (versionBadge) versionBadge.textContent = combinedLabel;
}

assertRequiredGlobals();
synchronizeVersionCopy();

window.FootballLabBundle = Object.freeze({
  ready: true,
  moduleCount: MODULE_COUNT,
  modelVersion: window.FOOTBALL_LAB_DATA.modelVersion,
  interfaceVersion: INTERFACE_VERSION,
  loadedAt: new Date().toISOString(),
});

window.dispatchEvent(
  new CustomEvent("football-lab:ready", {
    detail: window.FootballLabBundle,
  })
);
