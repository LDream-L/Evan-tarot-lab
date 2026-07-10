// 世足賽事驗證｜ES Module 正式入口
//
// 主要流程複雜度：
// - 模組解析與執行：時間 O(M)、空間 O(M)，M = 29 個相依模組。
// - 啟動完整性檢查：時間 O(G)、空間 O(G)，G = 必要核心 API 數。
// - 版本文案同步：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊版：瀏覽器動態建立 29 個 script，並以 window 全域傳遞資料與核心函式。
// - 本階段：資料、基礎核心與嚴格評分層使用具名 ES imports；其餘 26 個模組仍由 side-effect imports 相容載入。
// - 一次改完全部模組：可立即消除全域，但 UI、編輯與雲端同步同時變更，回歸風險過高。
// - 分層轉換：先建立資料／核心／評分 exports，再依能量、呈現、編輯與雲端層逐批遷移。

import "../../JS/cloud-config.js";
import "../../JS/site-account.js";
import { footballData } from "./data.js";
import { footballCore } from "./core.js";
import { footballScoring, scoredFootballCore } from "./scoring.js";
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
const NAMED_MODULE_COUNT = 3;
const INTERFACE_VERSION = "1.7.6";

/**
 * 確認具名模組、評分包裝與最終相容核心共用同一份資料契約。
 * 時間／空間複雜度 O(1)。
 */
function assertCoreContracts() {
  if (!footballData || !footballCore || !footballScoring || !scoredFootballCore) {
    throw new Error("世足資料層、核心或評分模組尚未載入。");
  }
  if (window.FOOTBALL_LAB_DATA !== footballData) {
    throw new Error("世足資料相容介面與 ES Module export 不一致。");
  }
  if (footballCore.data !== footballData || scoredFootballCore.data !== footballData) {
    throw new Error("世足核心與評分層未共用同一份資料契約。");
  }
  if (footballScoring.baseCore !== footballCore || footballScoring.core !== scoredFootballCore) {
    throw new Error("世足嚴格評分層與基礎核心連結不一致。");
  }
  if (window.FootballStrictScoring !== footballScoring) {
    throw new Error("世足嚴格評分相容介面與 ES Module export 不一致。");
  }

  const runtimeCore = window.FootballLabCore;
  if (
    !runtimeCore
    || runtimeCore.data !== footballData
    || typeof runtimeCore.calculateEvaluation !== "function"
    || typeof runtimeCore.calculateStats !== "function"
  ) {
    throw new Error("世足最終相容核心缺少必要 API 或資料契約不一致。");
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
  scoringPolicy: footballScoring.policy,
  loadedAt: new Date().toISOString(),
});

window.dispatchEvent(
  new CustomEvent("football-lab:ready", {
    detail: window.FootballLabBundle,
  })
);
