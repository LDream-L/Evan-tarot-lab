// 世足賽事驗證｜ES Module 正式入口
//
// 主要流程複雜度：
// - 模組解析與執行：時間 O(M)、空間 O(M)，M = 36 個相依元件。
// - 啟動完整性檢查：時間／空間 O(G)，G = 必要契約數。
// - 版本文案同步：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊 guard 同時重算階段顯示與保存欄位，和決勝編輯器重複規則。
// - 本階段只保留工作階段欄位快照，決勝路徑仍由純模型與轉接層負責。
// - 具名契約逐項回報失敗名稱，與單一巨大布林式同為 O(G)，但可直接定位回歸層。

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
import {
  footballReviewRuntime,
  footballRecordEdit,
} from "./review-runtime.js";
import {
  footballKnockoutEditRuntime,
  footballRecordKnockoutEdit,
  footballRecordKnockoutInputGuard,
} from "./knockout-edit-runtime.js";
import "../../JS/football-record-status-visibility-fix.js";
import "../../JS/football-performance-trends.js";
import "../../JS/football-layout-optimizer.js";

const MODULE_COUNT = 36;
const NAMED_MODULE_COUNT = 17;
const INTERFACE_VERSION = "1.7.6";

/** 時間／空間複雜度 O(1)。 */
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

/** 時間／空間複雜度 O(G)，G = 該群組契約數。 */
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
  review: footballReviewRuntime.core,
  final: window.FootballLabCore,
});

/** 時間／空間複雜度 O(1)。 */
const footballRenderLineage = Object.freeze({
  base: footballRender,
  energy: footballEnergyAdapter.ui,
  workflow: footballWorkflowRuntime.render,
  review: footballReviewRuntime.render,
  final: window.FootballLabRender,
});

/** 時間／空間複雜度 O(1)。 */
const footballCloudLineage = Object.freeze({
  base: footballCloud,
  review: footballReviewRuntime.cloudFinal,
  final: window.FootballLabCloud,
});

/** 時間／空間複雜度 O(G)。 */
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
    ["footballReviewRuntime", Boolean(footballReviewRuntime)],
    ["footballRecordEdit", Boolean(footballRecordEdit)],
    ["footballKnockoutEditRuntime", Boolean(footballKnockoutEditRuntime)],
    ["footballRecordKnockoutEdit", Boolean(footballRecordKnockoutEdit)],
    ["footballRecordKnockoutInputGuard", Boolean(footballRecordKnockoutInputGuard)],
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
    ["cloud-module-global", window.FootballCloudModule === footballCloud],
    ["cloud-core", footballCloud.core === footballWorkflowRuntime.core],
    ["cloud-protocol-frozen", Object.isFrozen(footballCloud.protocol)],
    ["cloud-protocol", footballCloud.protocol.join(",") === "health,createRecord,updateActual"],
    ["events-global", window.FootballLabEvents === footballEvents],
    ["events-core", footballEvents.core === footballWorkflowRuntime.core],
    ["events-render", footballEvents.ui === footballWorkflowRuntime.render],
    ["events-bound", footballEvents.isBound()],
  ]);

  assertContractGroup("世足紀錄編輯執行層契約", [
    ["review-global", window.FootballReviewRuntime === footballReviewRuntime],
    ["review-stage", footballReviewRuntime.stage === "record-edit-ready"],
    ["review-application", footballReviewRuntime.application === footballApplicationRuntime],
    ["review-core", footballReviewRuntime.core === footballRecordEdit.core],
    ["review-render", footballReviewRuntime.render === footballRecordEdit.ui],
    ["review-cloud-base", footballReviewRuntime.cloudBase === footballCloud],
    ["review-cloud-final", footballReviewRuntime.cloudFinal === window.FootballLabCloud],
    ["review-model-global", window.FootballRecordEditModel === footballReviewRuntime.model],
    ["review-editor-global", window.FootballLabRecordEdit === footballRecordEdit],
    ["review-editor-link", footballReviewRuntime.editor === footballRecordEdit],
    ["review-editor-bound", footballRecordEdit.isBound()],
  ]);

  assertContractGroup("世足決勝編輯執行層契約", [
    ["knockout-runtime-global", window.FootballKnockoutEditRuntime === footballKnockoutEditRuntime],
    ["knockout-runtime-stage", footballKnockoutEditRuntime.stage === "knockout-record-edit-ready"],
    ["knockout-guard-stage", footballKnockoutEditRuntime.guardStage === "knockout-input-preservation-ready"],
    ["knockout-runtime-review", footballKnockoutEditRuntime.review === footballReviewRuntime],
    ["knockout-runtime-core", footballKnockoutEditRuntime.core === footballReviewRuntime.core],
    ["knockout-runtime-render", footballKnockoutEditRuntime.render === footballReviewRuntime.render],
    ["knockout-runtime-base-editor", footballKnockoutEditRuntime.baseEditor === footballRecordEdit],
    ["knockout-model-global", window.FootballRecordKnockoutEditModel === footballKnockoutEditRuntime.model],
    ["knockout-editor-global", window.FootballLabRecordKnockoutEdit === footballRecordKnockoutEdit],
    ["knockout-editor-link", footballKnockoutEditRuntime.editor === footballRecordKnockoutEdit],
    ["knockout-editor-core", footballRecordKnockoutEdit.core === footballReviewRuntime.core],
    ["knockout-editor-render", footballRecordKnockoutEdit.ui === footballReviewRuntime.render],
    ["knockout-editor-base", footballRecordKnockoutEdit.baseEditor === footballRecordEdit],
    ["knockout-editor-bound", footballRecordKnockoutEdit.isBound()],
    ["knockout-guard-global", window.FootballLabRecordKnockoutInputGuard === footballRecordKnockoutInputGuard],
    ["knockout-guard-link", footballKnockoutEditRuntime.inputGuard === footballRecordKnockoutInputGuard],
    ["knockout-guard-core", footballRecordKnockoutInputGuard.core === footballReviewRuntime.core],
    ["knockout-guard-editor", footballRecordKnockoutInputGuard.knockoutEditor === footballRecordKnockoutEdit],
    ["knockout-guard-bound", footballRecordKnockoutInputGuard.isBound()],
  ]);

  const finalCloud = footballCloudLineage.final;
  assertContractGroup("世足雲端包裝血統契約", [
    ["cloud-lineage-base", footballCloudLineage.base === footballCloud],
    ["cloud-lineage-review", footballCloudLineage.review === footballReviewRuntime.cloudFinal],
    ["cloud-lineage-final", finalCloud === window.FootballLabCloud],
    ["cloud-wrapper-present", Boolean(finalCloud)],
    ["cloud-wrapper-separated", finalCloud !== footballCloud],
    ["cloud-wrapper-core", finalCloud?.core === footballCloud.core],
    ["cloud-wrapper-protocol", finalCloud?.protocol === footballCloud.protocol],
    ["cloud-wrapper-config", finalCloud?.isConfigured === footballCloud.isConfigured],
    ["cloud-wrapper-token", finalCloud?.hasToken === footballCloud.hasToken],
    ["cloud-wrapper-get-token", finalCloud?.getToken === footballCloud.getToken],
    ["cloud-wrapper-status", finalCloud?.setStatus === footballCloud.setStatus],
    ["cloud-wrapper-health", finalCloud?.healthCheck === footballCloud.healthCheck],
    ["cloud-wrapper-save", typeof finalCloud?.saveRecord === "function"],
    ["cloud-wrapper-update", typeof finalCloud?.updateActual === "function"],
    ["cloud-wrapper-sync", typeof finalCloud?.syncAll === "function"],
  ]);

  const runtimeCore = footballCoreLineage.final;
  const runtimeRender = footballRenderLineage.final;
  assertContractGroup("世足最終核心與 Render 契約", [
    ["lineage-base-core", footballCoreLineage.base === footballCore],
    ["lineage-scored-core", footballCoreLineage.scored === scoredFootballCore],
    ["lineage-energy-core", footballCoreLineage.energy === footballEnergyAdapter.core],
    ["lineage-workflow-core", footballCoreLineage.workflow === footballWorkflowRuntime.core],
    ["lineage-review-core", footballCoreLineage.review === footballReviewRuntime.core],
    ["lineage-final-core", runtimeCore === window.FootballLabCore],
    ["lineage-base-render", footballRenderLineage.base === footballRender],
    ["lineage-energy-render", footballRenderLineage.energy === footballEnergyAdapter.ui],
    ["lineage-workflow-render", footballRenderLineage.workflow === footballWorkflowRuntime.render],
    ["lineage-review-render", footballRenderLineage.review === footballReviewRuntime.render],
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
window.FootballCloudLineage = footballCloudLineage;

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
  reviewStage: footballReviewRuntime.stage,
  knockoutEditStage: footballKnockoutEditRuntime.stage,
  knockoutInputGuardStage: footballKnockoutEditRuntime.guardStage,
  cloudLayer: "esm-factory",
  cloudLayerCount: 2,
  cloudProtocol: footballCloud.protocol.join(","),
  eventLayer: "esm-factory",
  recordEditLayer: "esm-model-and-controller",
  knockoutEditLayer: "esm-model-and-adapter",
  knockoutInputGuardLayer: "esm-controller",
  coreLayerCount: 6,
  renderLayer: "esm",
  renderLayerCount: 5,
  loadedAt: new Date().toISOString(),
});

window.dispatchEvent(
  new CustomEvent("football-lab:ready", {
    detail: window.FootballLabBundle,
  })
);
