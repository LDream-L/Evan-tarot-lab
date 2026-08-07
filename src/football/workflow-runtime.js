// 世足賽事驗證｜淘汰賽後流程執行層
//
// 載入順序：能量核心／Render → 晉級顯示 → 日期修正 → 淘汰賽流程
// → 舊能量表單相容 → 整體場域語意 → 雙牌源賽後回顧分流 → 雙牌源同場比較
// → 雙牌源統計 → 運彩單注與比分結算。雲端與事件由 application-runtime.js 在本層完成後建立。
//
// 主要流程複雜度：
// - 模組初始化：時間／空間 O(W)，W 為固定工作流程模組數。
// - 執行層契約檢查：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 事件與雲端直接讀取任意時點的 window 核心，會依賴隱性載入順序。
// - 本層固定場域、淘汰賽、雙牌源回顧分流、雙牌源比較、統計與運彩包裝完成的核心／Render，後續模組只接收這份快照。

import { footballEnergyAdapter } from "./energy-adapter.js";
import "../../JS/football-advance-visibility.js";
import "../../JS/football-datetime-fix.js";
import "../../JS/football-knockout-flow.js";
import "../../JS/football-direct-energy-form.js";
import { footballFieldContextRuntime } from "./field-context-runtime.js?v=20260807-field-context-v2";
import "./source-review-adapter.js?v=20260803-source-review-v1";
import "./source-comparison-runtime.js?v=20260801-source-comparison-v1";
import "./source-comparison-metrics.js?v=20260801-source-energy-metrics-v1";
import { footballBettingRuntime } from "./betting-runtime.js?v=20260806-football-betting-v1";

const workflowCore = window.FootballLabCore;
const workflowRender = window.FootballLabRender;

if (
  !workflowCore
  || !workflowRender
  || workflowCore === footballEnergyAdapter.core
  || footballFieldContextRuntime.core === footballEnergyAdapter.core
  || footballBettingRuntime.core !== workflowCore
  || footballBettingRuntime.render !== workflowRender
  || typeof workflowCore.calculateEvaluation !== "function"
  || typeof workflowCore.updateActual !== "function"
  || typeof workflowCore.settleBet !== "function"
  || typeof workflowCore.summarizeBets !== "function"
  || typeof workflowRender.renderDraft !== "function"
  || typeof workflowRender.renderRecords !== "function"
  || typeof workflowRender.openEvaluation !== "function"
) {
  throw new Error("世足場域／淘汰賽／雙牌源／運彩流程尚未正確包裝核心與 Render。");
}

export const footballWorkflowRuntime = Object.freeze({
  stage: "knockout-ready",
  energyCore: footballEnergyAdapter.core,
  energyRender: footballEnergyAdapter.ui,
  fieldContext: footballFieldContextRuntime,
  core: workflowCore,
  render: workflowRender,
});

window.FootballWorkflowRuntime = footballWorkflowRuntime;