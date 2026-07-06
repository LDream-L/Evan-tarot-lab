// 世足賽事驗證 v1.7.5｜相容載入器
// 依序載入雲端設定、帳戶、資料、核心、比分規則、渲染、淘汰賽流程、單張能量、事件、雲端同步、紀錄介面、統一卡片、單一編輯、紀錄版面、後續牌組輸入保留、狀態分頁修正、滾動績效觀察與語意排版。時間 O(m)，空間 O(1)，m=29。
(function loadFootballLabModules() {
  "use strict";

  const version = "20260706-football-v175-layout-density-a";
  const modules = [
    "JS/cloud-config.js",
    "JS/site-account.js",
    "JS/football-data.js",
    "JS/football-core.js",
    "JS/football-strict-scoring.js",
    "JS/football-render.js",
    "JS/football-advance-visibility.js",
    "JS/football-datetime-fix.js",
    "JS/football-knockout-flow.js",
    "JS/football-direct-energy.js",
    "JS/football-direct-energy-form.js",
    "JS/football-events.js",
    "JS/football-cloud.js",
    "JS/football-records-ux.js",
    "JS/football-hit-ux.js",
    "JS/football-strict-hit-ux.js",
    "JS/football-record-display-ux.js",
    "JS/football-knockout-enhancements.js",
    "JS/football-knockout-record-ux.js",
    "JS/football-team-name-ux.js",
    "JS/football-direct-energy-ux.js",
    "JS/football-record-edit.js",
    "JS/football-card-layout-unifier.js",
    "JS/football-record-card-controls.js",
    "JS/football-record-knockout-edit.js",
    "JS/football-record-knockout-input-guard.js",
    "JS/football-record-status-visibility-fix.js",
    "JS/football-performance-trends.js",
    "JS/football-layout-optimizer.js",
  ];

  function loadNext(index) {
    if (index >= modules.length) return;
    const script = document.createElement("script");
    script.src = `${modules[index]}?v=${version}`;
    script.async = false;
    script.onload = () => loadNext(index + 1);
    script.onerror = () => {
      console.error(`[football-lab] 模組載入失敗：${modules[index]}`);
      const message = document.getElementById("football-match-message");
      if (message) {
        message.textContent = "世足驗證模組載入失敗，請重新整理頁面。";
        message.classList.remove("football-hidden");
        message.classList.add("is-error");
      }
    };
    document.head.appendChild(script);
  }

  loadNext(0);
})();
