// 世足賽事驗證｜repository 根目錄安全載入器
//
// GitHub Pages 正式流程會以 esbuild bundle 覆蓋 dist/JS/football-lab.js；
// 本檔只負責 repository 根目錄、舊 Pages 發布來源或部署切換期間的相容啟動。
//
// 主要流程複雜度：
// - 載入器本身：時間／空間 O(1)。
// - ES Module 相依圖載入：時間／空間 O(M)，M 為正式入口的相依元件數。
//
// 更快替代方案比較：
// - 舊版逐一請求 29 個 script，且其中多個檔案已移除，第一個 404 就會留下半初始化頁面。
// - 本版只匯入一個正式 entry，由瀏覽器依 ES Module 相依圖載入；錯誤集中回報並可重試。
(function bootstrapFootballLabRootEntry() {
  "use strict";

  const ROOT_LOADER_VERSION = "20260711-football-root-esm-v1";
  const LOAD_TIMEOUT_MS = 15_000;
  const currentScriptUrl = document.currentScript?.src || document.baseURI;
  const entryBaseUrl = new URL("../src/football/entry.js", currentScriptUrl);
  const finalStyleUrl = new URL("../football-layout-final.css", currentScriptUrl);

  let loadPromise = null;
  let attempt = 0;
  let status = "idle";

  /** 最終密度樣式只加入一次。時間／空間 O(1)。 */
  function ensureFinalStylesheet() {
    if (
      document.getElementById("football-layout-final-style")
      || document.querySelector('link[href*="football-layout-final.css"]')
    ) {
      return;
    }

    const link = document.createElement("link");
    link.id = "football-layout-final-style";
    link.rel = "stylesheet";
    link.href = `${finalStyleUrl.href}?v=${ROOT_LOADER_VERSION}`;
    document.head.appendChild(link);
  }

  /** 顯示可操作的失敗狀態，不讓靜態頁看起來像沒有資料。時間／空間 O(1)。 */
  function showLoadError(error) {
    status = "error";
    console.error("[football-lab] 正式模組載入失敗：", error);

    const message = document.getElementById("football-match-message");
    if (!message) return;
    message.textContent = "世足驗證模組載入失敗。請重新整理；若仍無法顯示，請清除本頁快取後再試。";
    message.classList.remove("football-hidden", "is-success");
    message.classList.add("is-error");
  }

  /** 建立單次逾時 Promise。時間／空間 O(1)。 */
  function createTimeoutPromise() {
    return new Promise((_, reject) => {
      window.setTimeout(
        () => reject(new Error(`世足模組載入超過 ${LOAD_TIMEOUT_MS / 1000} 秒。`)),
        LOAD_TIMEOUT_MS
      );
    });
  }

  /**
   * 載入正式 ES Module 入口；同時呼叫共用同一 Promise，失敗後可重試。
   * 載入時間／空間 O(M)，M 為正式相依元件數；額外 loader 空間 O(1)。
   */
  function load() {
    if (window.FootballLabBundle?.ready) {
      status = "ready";
      return Promise.resolve(window.FootballLabBundle);
    }
    if (loadPromise) return loadPromise;

    ensureFinalStylesheet();
    attempt += 1;
    status = "loading";

    const entryUrl = new URL(entryBaseUrl.href);
    entryUrl.searchParams.set("v", ROOT_LOADER_VERSION);
    entryUrl.searchParams.set("attempt", String(attempt));

    loadPromise = Promise.race([
      import(entryUrl.href),
      createTimeoutPromise(),
    ])
      .then(() => {
        if (!window.FootballLabBundle?.ready) {
          throw new Error("正式入口已完成，但 FootballLabBundle 尚未就緒。");
        }
        status = "ready";
        return window.FootballLabBundle;
      })
      .catch((error) => {
        loadPromise = null;
        showLoadError(error);
        throw error;
      });

    return loadPromise;
  }

  /** 清除本次失敗狀態後重試。時間／空間 O(1)。 */
  function retry() {
    loadPromise = null;
    return load();
  }

  window.FootballLabRootLoader = Object.freeze({
    version: ROOT_LOADER_VERSION,
    load,
    retry,
    getStatus: () => status,
    getAttemptCount: () => attempt,
  });

  load().catch(() => {
    // showLoadError 已提供畫面與 console 診斷，避免產生未處理 rejection。
  });
})();