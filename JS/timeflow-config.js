// ==============================
// timeflow-config.js
// 時間樹雲端端點與選用占星背景載入器
// ==============================
//
// 主要函式複雜度：
// - 雲端設定與模組載入：時間／空間 O(1)
//
// 更快替代方案比較：
// - 舊版另裝 MutationObserver 校正已淘汰的多軸 DOM，會在每次重畫多做 O(N) 查詢。
// - v6 排版直接產生單一主幹座標，不再需要載入後二次修線。
// ==============================

(function configureTimeflowCloud() {
  "use strict";

  const timeflowApiUrl = String.fromCharCode(
    104,116,116,112,115,58,47,47,115,99,114,105,112,116,46,103,111,111,103,108,101,46,99,111,109,47,109,97,99,114,111,115,47,115,47,65,75,102,121,99,98,120,88,101,97,74,51,67,83,65,113,97,83,68,74,114,99,113,82,97,89,54,115,108,56,74,52,56,109,76,48,108,72,105,84,117,69,84,84,116,112,114,112,116,65,66,108,84,72,83,55,55,65,106,49,86,48,68,67,122,121,97,75,76,104,85,47,101,120,101,99
  );

  window.EVAN_CLOUD_CONFIG = Object.freeze({
    ...(window.EVAN_CLOUD_CONFIG || {}),
    timeflowApiUrl,
  });
})();

(function loadTimeflowAstrologyBackground() {
  "use strict";
  if (document.querySelector('script[data-timeflow-astrology="true"]')) return;
  const script = document.createElement("script");
  script.src = "JS/timeflow-astrology.js?v=20260714-single-trunk-v2";
  script.async = true;
  script.dataset.timeflowAstrology = "true";

  /**
   * 原 UI 內部部分操作會直接重畫畫布；以單一觀察器在占星層被清除時恢復。
   * 每次 DOM 變更檢查時間 O(1)、空間 O(1)；只有確認占星層遺失才重新 render。
   * 更快替代方案：逐一改寫所有 UI 事件，但耦合較高且後續新增事件容易漏接。
   */
  function installAstrologyRenderRecovery() {
    const TF = window.EvanTimeflowV5;
    if (!TF?.astrology?.installed || !TF?.ui?.render || !TF?.app?.refs?.canvas) {
      window.setTimeout(installAstrologyRenderRecovery, 80);
      return;
    }
    if (TF.astrology.recoveryObserver) return;

    const canvas = TF.app.refs.canvas;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const astro = TF.astrology;
        if (!astro?.prefs?.visible || astro.lastVisibleCount <= 0) return;
        if (canvas.querySelector(".map-astro-lane-label")) return;
        TF.ui.render(false);
      });
    });
    observer.observe(canvas, { childList: true, subtree: true });
    TF.astrology.recoveryObserver = observer;
  }

  /**
   * 能量解讀延後至占星主模組載入後再加入。
   * 時間／空間複雜度 O(1)；比在 HTML 維護額外載入順序更不易產生相依錯誤。
   */
  function loadAstrologyEnergy() {
    if (document.querySelector('script[data-timeflow-astrology-energy="true"]')) return;
    const energy = document.createElement("script");
    energy.src = "JS/timeflow-astrology-energy.js?v=20260710-energy-v1";
    energy.async = true;
    energy.dataset.timeflowAstrologyEnergy = "true";
    document.head.appendChild(energy);
  }

  script.addEventListener("load", () => {
    installAstrologyRenderRecovery();
    loadAstrologyEnergy();
  }, { once: true });
  document.head.appendChild(script);
})();
