// 世足賽事驗證｜ES Module 正式入口
//
// 主要流程複雜度：
// - 模組解析與執行：時間 O(M)、空間 O(M)，M = 29 個相依模組。
// - 啟動完整性檢查：時間 O(G)、空間 O(G)，G = 必要核心 API 數。
// - 版本文案同步：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊版：瀏覽器動態建立 29 個 script，並以 window 全域傳遞資料與核心函式。
// - 本階段：資料層與計算核心使用具名 ES imports；其餘 27 個模組仍由 side-effect imports 相容載入。
// - 一次改完全部模組：可立即消除全域，但資料、UI、編輯與雲端同步同時變更，回歸風險過高。
// - 分層轉換：先建立真正的資料／核心 exports，再依評分、呈現、編輯與雲端層逐批遷移。

import "../../JS/cloud-config.js";
import "../../JS/site-account.js";
import { footballData } from "./data.js";
import { footballCore } from "./core.js";
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
const NAMED_MODULE_COUNT = 2;
const INTERFACE_VERSION = "1.7.6";

/**
 * 確認具名 imports 與相容 window API 指向同一物件。
 * 時間／空間複雜度 O(1)。
 */
function assertCoreContracts() {
  if (!footballData || !footballCore) {
    throw new Error("世足資料層或核心模組尚未載入。");
  }
  if (window.FOOTBALL_LAB_DATA !== footballData) {
    throw new Error("世足資料相容介面與 ES Module export 不一致。");
  }
  if (window.FootballLabCore !== footballCore) {
    throw new Error("世足核心相容介面與 ES Module export 不一致。");
  }
}

/** 統一模型版本與介面版本顯示。時間／空間 O(1)。 */
function synchronizeVersionCopy() {
  const modelVersion = String(footballData.modelVersion || "").trim();
  const combinedLabel = `模型 v${modelVersion}｜介面 v${INTERFACE_VERSION}`;

  document.title = `Evan Tarot｜世足賽事驗證｜模型 v${modelVersion}・介面 v${INTERFACE_VERSION}`;

  const heroTitle = document.querySelector(".subpage-hero .hero-text h1");
  if (heroTitle) heroTitle.textContent = "世足賽事驗證。";

  const versionBadge = document.querySelector("#football-match-form .football-version");
  if (versionBadge) versionBadge.textContent = combinedLabel;
}

assertCoreContracts();
synchronizeVersionCopy();

window.FootballLabBundle = Object.freeze({
  ready: true,
  moduleCount: MODULE_COUNT,
  namedModuleCount: NAMED_MODULE_COUNT,
  modelVersion: footballData.modelVersion,
  interfaceVersion: INTERFACE_VERSION,
  loadedAt: new Date().toISOString(),
});

window.dispatchEvent(
  new CustomEvent("football-lab:ready", {
    detail: window.FootballLabBundle,
  })
);
