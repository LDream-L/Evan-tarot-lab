// 世足賽事驗證｜ES Module 正式入口
//
// 主要流程複雜度：
// - 模組解析與執行：時間 O(M)、空間 O(M)，M = 30 個相依元件。
// - 啟動完整性檢查：時間 O(G)、空間 O(G)，G = 必要核心 API 數。
// - 版本文案同步：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊版：瀏覽器動態建立多個 script，並以 window 全域傳遞資料、核心與 Render。
// - 本階段：資料、核心、評分、基礎 Render、能量純模型與能量轉接層使用具名 ES imports；其餘 24 個模組相容載入。
// - 一次改完全部模組：可立即消除全域，但事件、編輯與雲端同步同時變更，回歸風險過高。
// - 分層轉換：先固定模型、運算與呈現邊界，再依事件、編輯及雲端層逐批遷移。

import "../../JS/cloud-config.js";
import "../../JS/site-account.js";
import { footballData } from "./data.js";
import { footballCore } from "./core.js";
import { footballScoring, scoredFootballCore } from "./scoring.js";
import { footballRender } from "./render.js";
import { footballEnergyModel } from "./energy-model.js";
import {
  footballEnergyAdapter,
  energyFootballCore,
} from "./energy-adapter.js";
import "../../JS/football-advance-visibility.js";
import "../../JS/football-datetime-fix.js";
import "../../JS/football-knockout-flow.js";
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

const MODULE_COUNT = 30;
const NAMED_MODULE_COUNT = 6;
const INTERFACE_VERSION = "1.7.6";

/**
 * 後續層可建立新的不可變文案外殼，但不得分叉核心牌組、牌位與儲存契約。
 * 時間／空間複雜度 O(1)。
 */
function sharesCoreDataContract(runtimeData) {
  return Boolean(
    runtimeData
    && Object.isFrozen(runtimeData)
    && runtimeData.modelVersion === footballData.modelVersion
    && runtimeData.storageKey === footballData.storageKey
    && runtimeData.deck === footballData.deck
    && runtimeData.positionMap === footballData.positionMap
    && runtimeData.positionSets === footballData.positionSets
  );
}

/**
 * 固定記錄基礎 Render、能量 Render 與所有相容 UX 完成後的最終 Render。
 * 時間／空間複雜度 O(1)。
 */
const footballRenderLineage = Object.freeze({
  base: footballRender,
  energy: footballEnergyAdapter.ui,
  final: window.FootballLabRender,
});

/**
 * 確認具名模型、Render、轉接層與最終相容核心共用同一份契約。
 * 時間／空間複雜度 O(1)。
 */
function assertCoreContracts() {
  if (
    !footballData
    || !footballCore
    || !footballScoring
    || !scoredFootballCore
    || !footballRender
    || !footballEnergyModel
    || !footballEnergyAdapter
    || !energyFootballCore
  ) {
    throw new Error("世足資料、核心、評分、Render 或能量模組尚未載入。");
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
  if (
    footballRender.core !== scoredFootballCore
    || typeof footballRender.renderDraft !== "function"
    || typeof footballRender.renderRecords !== "function"
    || typeof footballRender.openEvaluation !== "function"
  ) {
    throw new Error("世足基礎 Render 與具名評分核心連結不一致。");
  }
  if (
    window.FootballEnergyModel !== footballEnergyModel
    || window.FootballDirectEnergy !== footballEnergyAdapter
    || footballEnergyAdapter.model !== footballEnergyModel
    || footballEnergyAdapter.core !== energyFootballCore
    || !sharesCoreDataContract(energyFootballCore.data)
  ) {
    throw new Error("世足單張能量模型、轉接層或核心資料契約不一致。");
  }

  const runtimeCore = window.FootballLabCore;
  const runtimeRender = footballRenderLineage.final;
  if (
    footballRenderLineage.base !== footballRender
    || footballRenderLineage.energy !== footballEnergyAdapter.ui
    || runtimeRender !== window.FootballLabRender
    || footballRenderLineage.base === footballRenderLineage.energy
    || !runtimeCore
    || !sharesCoreDataContract(runtimeCore.data)
    || typeof runtimeCore.calculateEvaluation !== "function"
    || typeof runtimeCore.calculateStats !== "function"
    || !runtimeRender
    || typeof runtimeRender.renderDraft !== "function"
    || typeof runtimeRender.renderRecords !== "function"
    || typeof runtimeRender.renderScorecard !== "function"
    || typeof runtimeRender.openEvaluation !== "function"
  ) {
    throw new Error("世足最終相容核心、Render 血統或必要 API 不一致。");
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

// 僅供相容層、除錯與瀏覽器測試確認 Render 三層關係。
window.FootballRenderModule = footballRender;
window.FootballRenderLineage = footballRenderLineage;

assertCoreContracts();
synchronizeVersionCopy();

window.FootballLabBundle = Object.freeze({
  ready: true,
  moduleCount: MODULE_COUNT,
  namedModuleCount: NAMED_MODULE_COUNT,
  modelVersion: footballData.modelVersion,
  interfaceVersion: INTERFACE_VERSION,
  scoringPolicy: footballScoring.policy,
  energyModelKey: footballEnergyModel.modelKey,
  renderLayer: "esm",
  renderLayerCount: 3,
  loadedAt: new Date().toISOString(),
});

window.dispatchEvent(
  new CustomEvent("football-lab:ready", {
    detail: window.FootballLabBundle,
  })
);
