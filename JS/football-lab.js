// 世足賽事驗證 v1.2.4｜相容載入器
// 依序載入雲端設定、固定資料、核心、渲染、日期修正、事件、雲端同步與紀錄分流。時間 O(m)，空間 O(1)，m=8。
(function loadFootballLabModules() {
  "use strict";

  const version = "20260626-football-v124";
  const modules = [
    "JS/cloud-config.js",
    "JS/football-data.js",
    "JS/football-core.js",
    "JS/football-render.js",
    "JS/football-datetime-fix.js",
    "JS/football-events.js",
    "JS/football-cloud.js",
    "JS/football-records-ux.js",
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