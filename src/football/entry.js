// 世足賽事驗證｜ES Module 正式入口
//
// 主要流程複雜度：
// - 模組解析與執行：時間 O(M)、空間 O(M)，M = 32 個相依元件。
// - 啟動完整性檢查：時間／空間 O(G)，G = 必要契約數。
// - 版本文案同步：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊版雲端與事件在點擊時各自猜測 window 核心、帳號與登入物件。
// - 本階段先固定 workflow 核心快照，再建立具名雲端實例與事件控制器；登入物件仍動態讀取。
// - 單一巨大布林式雖為 O(G)，但失敗時無法定位；本版保留同等成本並回報具名失敗契約。

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
import { footballWorkflowRuntime } from "./workflow-runtime.js";
import {
  footballApplicationRuntime,
  footballCloud,
  footballEvents,
} from "./application-runtime.js";
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

const MODULE_COUNT = 32;
const NAMED_MODULE_COUNT = 10;
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
 * 逐項驗證具名契約並回報失敗名稱。
 * 時間／空間複雜度 O(G)，G = 該群組契約數。
 */
function assertContractGroup(groupName, checks) {
  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  if (!failed.length) return;
  window.FootballContractDiagnostics = Object.freeze({
    group: groupName,
    failed: Object.freeze(failed.slice()),
  });
  throw new Error(`${groupName}不一致：${failed.join("、")}`);
}

/** 時間／空間複雜度 O(1)。 */
const footballCoreLineage = Object.freeze({
  base: footballCore,
  scored: scoredFootballCore,
  energy: footballEnergyAdapter.core,
  workflow: footballWorkflowRuntime.core,
  final: window.FootballLabCore,
});

/** 時間／空間複雜度 O(1)。 */
const footballRenderLineage = Object.freeze({
  base: footballRender,
  energy: footballEnergyAdapter.ui,
  workflow: footballWorkflowRuntime.render,
  final: window.FootballLabRender,
});

/**
 * 確認具名模型、workflow、雲端、事件與最終相容介面共用同一份契約。
 * 時間／空間複雜度 O(G)。
 */
function assertCoreContracts() {
  assertContractGroup("世足模組載入契約", [
    ["footballData", Boolean(footballData)],
    ["footballCore", Boolean(footballCore)],
    ["footballScoring", Boolean(footballScoring)],
    ["scoredFootballCore", Boolean(scoredFootballCore)],
    ["footballRender", Boolean(footballRender)],
    ["footballEnergyModel", Boolean(footballEnergyModel)],
    ["footballEnergyAdapter", Boolean(footballEnergyAdapter)],
    ["energyFootballCore", Boolean(energyFootballCore)],
    ["footballWorkflowRuntime", Boolean(footballWorkflowRuntime)],
    ["footballApplicationRuntime", Boolean(footballApplicationRuntime)],
    ["footballCloud", Boolean(footballCloud)],
    ["footballEvents", Boolean(footballEvents)],
  ]);

  assertContractGroup("世足資料與評分契約", [
    ["data-global-export", window.FOOTBALL_LAB_DATA === footballData],
    ["base-core-data", footballCore.data === footballData],
    ["scored-core-data", scoredFootballCore.data === footballData],
    ["scoring-base-core", footballScoring.baseCore === footballCore],
    ["scoring-core", footballScoring.core === scoredFootballCore],
    ["scoring-global-export", window.FootballStrictScoring === footballScoring],
  ]);

  assertContractGroup("世足基礎 Render 契約", [
    ["render-core", footballRender.core === scoredFootballCore],
    ["renderDraft", typeof footballRender.renderDraft === "function"],
    ["renderRecords", typeof footballRender.renderRecords === "function"],
    ["openEvaluation", typeof footballRender.openEvaluation === "function"],
  ]);

  assertContractGroup("世足能量層契約", [
    ["energy-model-global", window.FootballEnergyModel === footballEnergyModel],
    ["energy-adapter-global", window.FootballDirectEnergy === footballEnergyAdapter],
    ["energy-model-link", footballEnergyAdapter.model === footballEnergyModel],
    ["energy-core-link", footballEnergyAdapter.core === energyFootballCore],
    ["energy-data-contract", sharesCoreDataContract(energyFootballCore.data)],
  ]);

  assertContractGroup("世足 workflow runtime 契約", [
    ["workflow-global", window.FootballWorkflowRuntime === footballWorkflowRuntime],
    ["workflow-stage", footballWorkflowRuntime.stage === "knockout-ready"],
    ["workflow-energy-core", footballWorkflowRuntime.energyCore === footballEnergyAdapter.core],
    ["workflow-energy-render", footballWorkflowRuntime.energyRender === footballEnergyAdapter.ui],
  ]);

  assertContractGroup("世足應用執行層契約", [
    ["application-global", window.FootballApplicationRuntime === footballApplicationRuntime],
    ["application-stage", footballApplicationRuntime.stage === "cloud-and-events-ready"],
    ["application-workflow", footballApplicationRuntime.workflow === footballWorkflowRuntime],
    ["application-core", footballApplicationRuntime.core === footballWorkflowRuntime.core],
    ["application-render", footballApplicationRuntime.render === footballWorkflowRuntime.render],
    ["application-cloud", footballApplicationRuntime.cloud === footballCloud],
    ["application-events", footballApplicationRuntime.events === footballEvents],
    ["cloud-global", window.FootballLabCloud === footballCloud],
    ["cloud-module-global", window.FootballCloudModule === footballCloud],
    ["cloud-core", footballCloud.core === footballWorkflowRuntime.core],
    ["cloud-protocol-frozen", Object.isFrozen(footballCloud.protocol)],
    ["cloud-protocol", footballCloud.protocol.join(",") === "health,createRecord,updateActual"],
    ["events-global", window.FootballLabEvents === footballEvents],
    ["events-core", footballEvents.core === footballWorkflowRuntime.core],
    ["events-render", footballEvents.ui === footballWorkflowRuntime.render],
    ["events-bound", footballEvents.isBound()],
  ]);

  const runtimeCore = footballCoreLineage.final;
  const runtimeRender = footballRenderLineage.final;
  assertContractGroup("世足最終核心與 Render 契約", [
    ["lineage-base-core", footballCoreLineage.base === footballCore],
    ["lineage-scored-core", footballCoreLineage.scored === scoredFootballCore],
    ["lineage-energy-core", footballCoreLineage.energy === footballEnergyAdapter.core],
    ["lineage-workflow-core", footballCoreLineage.workflow === footballWorkflowRuntime.core],
    ["lineage-final-core", runtimeCore === window.FootballLabCore],
    ["lineage-base-render", footballRenderLineage.base === footballRender],
    ["lineage-energy-render", footballRenderLineage.energy === footballEnergyAdapter.ui],
    ["lineage-workflow-render", footballRenderLineage.workflow === footballWorkflowRuntime.render],
    ["lineage-final-render", runtimeRender === window.FootballLabRender],
    ["render-base-energy-separated", footballRenderLineage.base !== footballRenderLineage.energy],
    ["render-energy-workflow-separated", footballRenderLineage.energy !== footballRenderLineage.workflow],
    ["runtime-core-present", Boolean(runtimeCore)],
    ["runtime-data-contract", sharesCoreDataContract(runtimeCore?.data)],
    ["runtime-evaluation", typeof runtimeCore?.calculateEvaluation === "function"],
    ["runtime-stats", typeof runtimeCore?.calculateStats === "function"],
    ["runtime-render-present", Boolean(runtimeRender)],
    ["runtime-render-draft", typeof runtimeRender?.renderDraft === "function"],
    ["runtime-render-records", typeof runtimeRender?.renderRecords === "function"],
    ["runtime-render-scorecard", typeof runtimeRender?.renderScorecard === "function"],
    ["runtime-render-evaluation", typeof runtimeRender?.openEvaluation === "function"],
  ]);
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

window.FootballRenderModule = footballRender;
window.FootballCoreLineage = footballCoreLineage;
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
  workflowStage: footballWorkflowRuntime.stage,
  applicationStage: footballApplicationRuntime.stage,
  cloudLayer: "esm-factory",
  cloudProtocol: footballCloud.protocol.join(","),
  eventLayer: "esm-factory",
  coreLayerCount: 5,
  renderLayer: "esm",
  renderLayerCount: 4,
  loadedAt: new Date().toISOString(),
});

window.dispatchEvent(
  new CustomEvent("football-lab:ready", {
    detail: window.FootballLabBundle,
  })
);
