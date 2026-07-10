// 世足賽事驗證｜決勝階段編輯執行層
//
// 載入順序：review runtime → 牌面版面／紀錄控制 → 決勝純模型與轉接層。
// 輸入保留 guard 由正式入口在本層完成後載入。
//
// 主要流程複雜度：
// - 固定 2 個相容 UX 模組＋1 個具名控制器：時間／空間 O(1)。
// - 啟動契約：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 由舊 IIFE 自行抓取任意全域核心，載入順序不可見。
// - 本層固定 review 核心、Render 與基礎 editor，再注入決勝控制器。

import {
  footballReviewRuntime,
  footballRecordEdit,
} from "./review-runtime.js";
import "../../JS/football-card-layout-unifier.js";
import "../../JS/football-record-card-controls.js";
import { footballRecordKnockoutEditModel } from "./record-knockout-edit-model.js";
import { createFootballRecordKnockoutEdit } from "./record-knockout-edit.js";

const knockoutCore = footballReviewRuntime.core;
const knockoutRender = footballReviewRuntime.render;

if (
  !knockoutCore
  || !knockoutRender
  || footballReviewRuntime.editor !== footballRecordEdit
  || typeof footballRecordEdit.readValues !== "function"
  || typeof footballRecordEdit.syncUpdatedRecord !== "function"
) {
  throw new Error("世足基礎紀錄編輯器尚未完成，無法建立決勝編輯層。");
}

export const footballRecordKnockoutEdit = createFootballRecordKnockoutEdit({
  core: knockoutCore,
  ui: knockoutRender,
  baseEditor: footballRecordEdit,
  autoInit: true,
});

export const footballKnockoutEditRuntime = Object.freeze({
  stage: "knockout-record-edit-ready",
  review: footballReviewRuntime,
  core: knockoutCore,
  render: knockoutRender,
  baseEditor: footballRecordEdit,
  model: footballRecordKnockoutEditModel,
  editor: footballRecordKnockoutEdit,
});

window.FootballRecordKnockoutEditModel = footballRecordKnockoutEditModel;
window.FootballLabRecordKnockoutEdit = footballRecordKnockoutEdit;
window.FootballKnockoutEditRuntime = footballKnockoutEditRuntime;
