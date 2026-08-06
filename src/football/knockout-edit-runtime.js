// 世足賽事驗證｜決勝階段編輯執行層
//
// 載入順序：review runtime → 牌面版面／紀錄控制 → 決勝純模型與轉接層
// → 輸入保留控制器 → 已鎖定紀錄運彩編輯器。正式入口只讀取完成後的具名 runtime。
//
// 主要流程複雜度：
// - 固定 2 個相容 UX 模組＋3 個具名控制器：時間／空間 O(1)。
// - 啟動契約：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 由舊 IIFE 自行抓取任意全域核心並重複推導顯示，載入順序不可見。
// - 本層固定 review 核心、Render、基礎 editor、決勝 editor 與運彩 editor，再注入單純的輸入保留控制器。

import {
  footballReviewRuntime,
  footballRecordEdit,
} from "./review-runtime.js";
import "../../JS/football-card-layout-unifier.js";
import "../../JS/football-record-card-controls.js";
import { footballRecordKnockoutEditModel } from "./record-knockout-edit-model.js";
import { createFootballRecordKnockoutEdit } from "./record-knockout-edit.js";
import { createFootballRecordKnockoutInputGuard } from "./record-knockout-input-guard.js";
import { createFootballRecordBettingEdit } from "./record-betting-edit.js";

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

export const footballRecordKnockoutInputGuard = createFootballRecordKnockoutInputGuard({
  core: knockoutCore,
  knockoutEditor: footballRecordKnockoutEdit,
  autoBind: true,
});

export const footballRecordBettingEdit = createFootballRecordBettingEdit({
  core: knockoutCore,
  ui: knockoutRender,
  baseEditor: footballRecordEdit,
  knockoutEditor: footballRecordKnockoutEdit,
  autoInit: true,
});

export const footballKnockoutEditRuntime = Object.freeze({
  stage: "knockout-record-edit-ready",
  guardStage: "knockout-input-preservation-ready",
  bettingEditStage: "record-betting-edit-ready",
  review: footballReviewRuntime,
  core: knockoutCore,
  render: knockoutRender,
  baseEditor: footballRecordEdit,
  model: footballRecordKnockoutEditModel,
  editor: footballRecordKnockoutEdit,
  inputGuard: footballRecordKnockoutInputGuard,
  bettingEditor: footballRecordBettingEdit,
});

window.FootballRecordKnockoutEditModel = footballRecordKnockoutEditModel;
window.FootballLabRecordKnockoutEdit = footballRecordKnockoutEdit;
window.FootballLabRecordKnockoutInputGuard = footballRecordKnockoutInputGuard;
window.FootballLabRecordBettingEdit = footballRecordBettingEdit;
window.FootballKnockoutEditRuntime = footballKnockoutEditRuntime;
