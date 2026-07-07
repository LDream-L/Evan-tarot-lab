// 世足賽事驗證 v1.7.6｜相容載入器
// 先平行預載模組，再依既有相依順序執行；所有動態模組完成後才套用最終樣式層。
// 時間複雜度：O(m)，空間複雜度：O(m)，m = 模組數（目前 29）。
// 更快替代方案比較：
// - 原作法：29 個模組逐一下載、逐一執行，網路等待時間相加。
// - 本作法：先平行預載全部檔案，再維持原順序執行；不改依賴關係與功能行為。
(function loadFootballLabModules() {
  "use strict";

  const version = "20260707-football-v176-record-grid-d";
  const layoutStyleHref = `football-layout-optimizer.css?v=${version}`;
  const finalStyleHref = `football-layout-final.css?v=${version}`;
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

  /** 時間 O(1)，空間 O(1)。 */
  function ensureStylesheet({ id, href }) {
    if (document.getElementById(id) || document.querySelector(`link[href^="${href.split("?")[0]}"]`)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  /** 時間 O(1)，空間 O(1)。 */
  function ensureLayoutStylesheet() {
    ensureStylesheet({ id: "football-layout-optimizer-style", href: layoutStyleHref });
  }

  /** 動態模組全部注入樣式後再載入，確保最終密度規則不被蓋回。時間 O(1)，空間 O(1)。 */
  function ensureFinalStylesheet() {
    ensureStylesheet({ id: "football-layout-final-style", href: finalStyleHref });
  }

  /** 平行發出下載請求；執行順序仍由 loadNext 控制。時間 O(m)，空間 O(m)。 */
  function preloadModules() {
    const fragment = document.createDocumentFragment();
    modules.forEach((src) => {
      const href = `${src}?v=${version}`;
      if (document.querySelector(`link[rel="preload"][href="${href}"]`)) return;
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "script";
      preload.href = href;
      fragment.appendChild(preload);
    });
    document.head.appendChild(fragment);
  }

  /** 時間 O(1)，空間 O(1)。 */
  function showLoadError(path) {
    console.error(`[football-lab] 模組載入失敗：${path}`);
    const message = document.getElementById("football-match-message");
    if (!message) return;
    message.textContent = "世足驗證模組載入失敗，請重新整理頁面。";
    message.classList.remove("football-hidden");
    message.classList.add("is-error");
  }

  /** 依序執行以保留全域模組相依關係。時間 O(m)，空間 O(m)（事件回呼鏈）。 */
  function loadNext(index) {
    if (index >= modules.length) {
      ensureFinalStylesheet();
      return;
    }
    const path = modules[index];
    const script = document.createElement("script");
    script.src = `${path}?v=${version}`;
    script.async = false;
    script.onload = () => loadNext(index + 1);
    script.onerror = () => showLoadError(path);
    document.head.appendChild(script);
  }

  ensureLayoutStylesheet();
  preloadModules();
  loadNext(0);
})();
