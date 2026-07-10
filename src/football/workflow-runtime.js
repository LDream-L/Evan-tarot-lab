// 世足賽事驗證｜淘汰賽後流程執行層
//
// 載入順序：能量核心／Render → 晉級顯示 → 日期修正 → 淘汰賽流程
// → 單張能量表單 → 事件控制器。後續雲端與 UX 仍由正式入口載入。
//
// 主要流程複雜度：
// - 模組初始化：時間／空間 O(W)，W 為固定 4 個相容流程模組。
// - 執行層契約檢查：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 事件層直接讀取任意時點的 window 核心，依賴隱性載入順序。
// - 本層固定淘汰賽包裝完成的時點，再把具體核心與 Render 注入事件工廠。

import { footballEnergyAdapter } from "./energy-adapter.js";
import "../../JS/football-advance-visibility.js";
import "../../JS/football-datetime-fix.js";
import "../../JS/football-knockout-flow.js";
import "../../JS/football-direct-energy-form.js";
import { createFootballEvents } from "./events.js";

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

export const footballEvents = createFootballEvents({
  core: workflowCore,
  ui: workflowRender,
  autoBind: true,
});

export const footballWorkflowRuntime = Object.freeze({
  stage: "knockout-ready",
  energyCore: footballEnergyAdapter.core,
  energyRender: footballEnergyAdapter.ui,
  core: workflowCore,
  render: workflowRender,
  events: footballEvents,
});

window.FootballWorkflowRuntime = footballWorkflowRuntime;
window.FootballLabEvents = footballEvents;
