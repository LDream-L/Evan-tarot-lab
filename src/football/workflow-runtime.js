// 世足賽事驗證｜淘汰賽後流程執行層
//
// 載入順序：能量核心／Render → 晉級顯示 → 日期修正 → 淘汰賽流程
// → 單張能量表單 → 雙牌源同場比較。雲端與事件由 application-runtime.js
// 在本層完成後建立。
//
// 主要流程複雜度：
// - 模組初始化：時間／空間 O(W)，W 為固定 5 個相容流程模組。
// - 執行層契約檢查：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 事件與雲端直接讀取任意時點的 window 核心，會依賴隱性載入順序。
// - 本層固定淘汰賽與雙牌源包裝完成的核心／Render，後續模組只接收這份快照。

import { footballEnergyAdapter } from "./energy-adapter.js";
import "../../JS/football-advance-visibility.js";
import "../../JS/football-datetime-fix.js";
import "../../JS/football-knockout-flow.js";
import "../../JS/football-direct-energy-form.js";
import "./source-comparison-runtime.js?v=20260801-source-comparison-v1";

const workflowCore = window.FootballLabCore;
const workflowRender = window.FootballLabRender;

if (
  !workflowCore
  || !workflowRender
  || workflowCore === footballEnergyAdapter.core
  || typeof workflowCore.calculateEvaluation !== "function"
  || typeof workflowCore.updateActual !== "function"
  || typeof workflowRender.renderDraft !== "function"
  || typeof workflowRender.renderRecords !== "function"
  || typeof workflowRender.openEvaluation !== "function"
) {
  throw new Error("世足淘汰賽流程尚未正確包裝核心與 Render。");
}

export const footballWorkflowRuntime = Object.freeze({
  stage: "knockout-ready",
  energyCore: footballEnergyAdapter.core,
  energyRender: footballEnergyAdapter.ui,
  core: workflowCore,
  render: workflowRender,
});

window.FootballWorkflowRuntime = footballWorkflowRuntime;
