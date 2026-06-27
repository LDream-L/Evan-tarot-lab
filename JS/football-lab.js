// 世足賽事驗證 v1.3.0｜相容載入器
// 依序載入雲端設定、全站帳戶、固定資料、核心、嚴格比分、渲染、晉級欄位修正、日期修正、事件、雲端同步、紀錄分流與命中視覺化。時間 O(m)，空間 O(1)，m=13。
(function loadFootballLabModules() {
  "use strict";

  const version = "20260627-football-v130";
  const modules = [
    "JS/cloud-config.js",
    "JS/site-account.js",
    "JS/football-data.js",
    "JS/football-core.js",
    "JS/football-strict-scoring.js",
    "JS/football-render.js",
    "JS/football-advance-visibility.js",
    "JS/football-datetime-fix.js",
    "JS/football-events.js",
    "JS/football-cloud.js",
    "JS/football-records-ux.js",
    "JS/football-hit-ux.js",
    "JS/football-strict-hit-ux.js",
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
