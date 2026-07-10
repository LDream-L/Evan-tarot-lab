// 世足賽事驗證｜雲端與事件應用執行層
//
// 正式依賴：cloud-config／site-account → workflow runtime 核心快照
// → 具名 footballCloud → 具名事件控制器。
//
// 主要流程複雜度：
// - 模組初始化：時間／空間 O(1)。
// - 契約檢查：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 由同步按鈕或事件送出時臨時讀取 window 核心，會依賴不可見的載入順序。
// - 本層只在 workflow 完成後建立一次固定快照，後續同步與事件共用同一核心與雲端實例。

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

// 相容介面必須先存在，事件層在實際送出時才透過同一實例呼叫 API。
window.FootballLabCloud = footballCloud;
window.FootballCloudModule = footballCloud;

export const footballEvents = createFootballEvents({
  core: runtimeCore,
  ui: runtimeRender,
  cloud: footballCloud,
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
