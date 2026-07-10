// 世足賽事驗證｜雲端與事件應用執行層
//
// 正式依賴：cloud-config／site-account → workflow runtime 核心快照
// → 具名 footballCloud → 具名事件控制器。
//
// 主要函式複雜度：
// - 模組初始化：時間／空間 O(1)。
// - 契約檢查：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 核心與 Render 固定於 workflow 完成後，避免事件層讀到較早版本。
// - 雲端不能固定在事件建立時；事件送出會動態讀取最終 FootballLabCloud，
//   才能沿用後載的淘汰賽摘要包裝。

import { footballWorkflowRuntime } from "./workflow-runtime.js";
import { createFootballCloud } from "./cloud.js";
import { createFootballEvents } from "./events.js";

const runtimeCore = footballWorkflowRuntime.core;
const runtimeRender = footballWorkflowRuntime.render;

if (
  !runtimeCore
  || !runtimeRender
  || typeof runtimeCore.getRecords !== "function"
  || typeof runtimeRender.renderRecords !== "function"
) {
  throw new Error("世足 workflow runtime 尚未準備完成，無法建立應用執行層。");
}

export const footballCloud = createFootballCloud({
  core: runtimeCore,
  config: window.EVAN_CLOUD_CONFIG || {},
  authProvider: () => window.EvanGoogleAuth,
  accountProvider: () => window.EvanSiteAccount,
  autoInit: true,
});

window.FootballLabCloud = footballCloud;
window.FootballCloudModule = footballCloud;

export const footballEvents = createFootballEvents({
  core: runtimeCore,
  ui: runtimeRender,
  autoBind: true,
});

export const footballApplicationRuntime = Object.freeze({
  stage: "cloud-and-events-ready",
  workflow: footballWorkflowRuntime,
  core: runtimeCore,
  render: runtimeRender,
  cloud: footballCloud,
  events: footballEvents,
});

window.FootballLabEvents = footballEvents;
window.FootballApplicationRuntime = footballApplicationRuntime;
