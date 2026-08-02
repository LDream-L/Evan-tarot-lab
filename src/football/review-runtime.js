// 世足賽事驗證｜紀錄 UX 與編輯執行層
//
// 載入順序：application runtime → 紀錄／雙牌源回顧／命中／顯示 UX → 淘汰賽雲端摘要
// → 單張能量 UX → 具名紀錄編輯控制器。
//
// 主要流程複雜度：
// - 固定 9 個相容 UX 模組＋1 個具名編輯器：時間／空間 O(U)，U 為固定元件數。
// - 啟動契約：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 編輯器在點擊時猜測任意全域核心與 Render，依賴不可見載入順序。
// - 本執行層在必要 UX 完成後固定核心／Render快照；雲端則保留 provider，以取得最終摘要包裝。

import { footballApplicationRuntime } from "./application-runtime.js";
import "../../JS/football-records-ux.js";
import "../../JS/football-source-review-ux.js?v=20260803-source-review-v1";
import "../../JS/football-hit-ux.js";
import "../../JS/football-strict-hit-ux.js";
import "../../JS/football-record-display-ux.js";
import "../../JS/football-knockout-enhancements.js";
import "../../JS/football-knockout-record-ux.js";
import "../../JS/football-team-name-ux.js";
import "../../JS/football-direct-energy-ux.js";
import { footballRecordEditModel } from "./record-edit-model.js";
import { createFootballRecordEdit } from "./record-edit.js";

const reviewCore = window.FootballLabCore;
const reviewRender = window.FootballLabRender;

if (
  !reviewCore
  || !reviewRender
  || typeof reviewCore.getRecords !== "function"
  || typeof reviewRender.renderRecords !== "function"
) {
  throw new Error("世足紀錄 UX 尚未完成，無法建立編輯執行層。");
}

export const footballRecordEdit = createFootballRecordEdit({
  core: reviewCore,
  ui: reviewRender,
  cloudProvider: () => window.FootballLabCloud,
  autoInit: true,
});

export const footballReviewRuntime = Object.freeze({
  stage: "record-edit-ready",
  application: footballApplicationRuntime,
  core: reviewCore,
  render: reviewRender,
  cloudBase: footballApplicationRuntime.cloud,
  cloudFinal: window.FootballLabCloud,
  model: footballRecordEditModel,
  editor: footballRecordEdit,
});

window.FootballRecordEditModel = footballRecordEditModel;
window.FootballLabRecordEdit = footballRecordEdit;
window.FootballReviewRuntime = footballReviewRuntime;
