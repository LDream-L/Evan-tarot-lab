// 世足賽事驗證｜狀態分頁顯示修正
// injectStyle：O(1) 時間／O(1) 空間。
// 原因：卡片版面對 tr 設定 display:grid，覆蓋了 hidden 屬性的預設 display:none。
(function initFootballRecordStatusVisibilityFix() {
  "use strict";

  if (document.getElementById("football-record-status-visibility-style")) return;

  const style = document.createElement("style");
  style.id = "football-record-status-visibility-style";
  style.textContent = `
    #football-records .football-table tbody tr[hidden] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
})();