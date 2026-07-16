// ==============================
// football-scroll-stability.js
// 世足賽果儲存：鎖定評估面板的視窗位置，避免紀錄重繪與雲端訊息造成整頁跳動。
// ==============================
//
// 主要函式複雜度：
// - startViewportLock：時間／空間 O(1)。
// - correctViewport：單次時間／空間 O(1)；每次 DOM 變動最多校正固定 4 個畫面幀。
// - stopViewportLock：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 暴力法：延遲後重設固定 scrollY，會忽略面板實際位移，也會干擾使用者主動捲動。
// - 本版：記錄評估面板的 viewport top，僅在儲存期間且 DOM 確實改變時補償差值；
//   使用者一旦滾輪、觸控或按鍵操作，立即解除鎖定。
// ==============================

(function initFootballScrollStability() {
  "use strict";

  if (window.__footballScrollStabilityInitialized) return;
  window.__footballScrollStabilityInitialized = true;

  const VERSION = "20260716-football-scroll-anchor-v1";
  const PANEL_ID = "football-evaluation-panel";
  const FORM_ID = "football-evaluation-form";
  const RECORDS_ID = "football-records";
  const LOCK_TIMEOUT_MS = 8_000;
  const FRAME_PASSES_PER_CHANGE = 4;
  const POSITION_EPSILON_PX = 0.5;
  const CANCEL_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
  ]);

  let activeLock = null;

  /** 元素查找：時間／空間 O(1)。 */
  function byId(id) {
    return document.getElementById(id);
  }

  /** 取得頁面可捲動上限：時間／空間 O(1)。 */
  function getMaxScrollY() {
    const root = document.documentElement;
    const body = document.body;
    const scrollHeight = Math.max(
      root?.scrollHeight || 0,
      body?.scrollHeight || 0,
      root?.offsetHeight || 0,
      body?.offsetHeight || 0
    );
    return Math.max(0, scrollHeight - window.innerHeight);
  }

  /** 還原暫時停用的平滑捲動與瀏覽器 scroll anchoring：時間／空間 O(1)。 */
  function restoreInlineStyles(lock) {
    lock.styleSnapshots.forEach(({ element, scrollBehavior, overflowAnchor }) => {
      if (!element?.style) return;
      element.style.scrollBehavior = scrollBehavior;
      element.style.overflowAnchor = overflowAnchor;
    });
  }

  /** 結束目前鎖定：時間／空間 O(1)。 */
  function stopViewportLock() {
    const lock = activeLock;
    if (!lock) return;

    activeLock = null;
    if (lock.frameId) window.cancelAnimationFrame(lock.frameId);
    if (lock.timeoutId) window.clearTimeout(lock.timeoutId);
    lock.observer?.disconnect();
    restoreInlineStyles(lock);
  }

  /**
   * 依評估面板的 viewport top 補償 scrollY；單次時間／空間 O(1)。
   * 固定畫面幀數用來吸收同一輪 MutationObserver／requestAnimationFrame 的連續重繪。
   */
  function correctViewport() {
    const lock = activeLock;
    if (!lock) return;

    lock.frameId = 0;
    const panel = lock.panel;
    if (!panel.isConnected || panel.classList.contains("football-hidden")) {
      stopViewportLock();
      return;
    }

    const currentTop = panel.getBoundingClientRect().top;
    const delta = currentTop - lock.anchorTop;
    if (Math.abs(delta) > POSITION_EPSILON_PX) {
      const nextScrollY = Math.min(
        getMaxScrollY(),
        Math.max(0, window.scrollY + delta)
      );
      window.scrollTo({
        left: window.scrollX,
        top: nextScrollY,
        behavior: "auto",
      });
    }

    lock.framesLeft -= 1;
    if (lock.framesLeft > 0 && activeLock === lock) {
      lock.frameId = window.requestAnimationFrame(correctViewport);
    }
  }

  /** 每次相關 DOM 改變合併成固定 4 幀校正：時間／空間 O(1)。 */
  function scheduleCorrection() {
    const lock = activeLock;
    if (!lock) return;
    lock.framesLeft = Math.max(lock.framesLeft, FRAME_PASSES_PER_CHANGE);
    if (!lock.frameId) lock.frameId = window.requestAnimationFrame(correctViewport);
  }

  /** 暫時停用 CSS smooth scroll 與原生 scroll anchoring：時間／空間 O(1)。 */
  function suppressAutomaticScroll(lock) {
    const elements = [
      document.documentElement,
      document.body,
      byId(RECORDS_ID),
      lock.panel,
    ].filter(Boolean);

    lock.styleSnapshots = elements.map((element) => ({
      element,
      scrollBehavior: element.style.scrollBehavior,
      overflowAnchor: element.style.overflowAnchor,
    }));

    elements.forEach((element) => {
      element.style.scrollBehavior = "auto";
      element.style.overflowAnchor = "none";
    });
  }

  /**
   * 儲存賽果前鎖定評估面板位置：時間／空間 O(1)。
   * MutationObserver 只監看該頁紀錄區，避免掃描整個網站。
   */
  function startViewportLock() {
    stopViewportLock();

    const panel = byId(PANEL_ID);
    const records = byId(RECORDS_ID);
    if (!panel || !records || panel.classList.contains("football-hidden")) return;

    const lock = {
      panel,
      anchorTop: panel.getBoundingClientRect().top,
      framesLeft: 0,
      frameId: 0,
      timeoutId: 0,
      observer: null,
      styleSnapshots: [],
    };

    activeLock = lock;
    suppressAutomaticScroll(lock);

    lock.observer = new MutationObserver(scheduleCorrection);
    lock.observer.observe(records, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "style"],
    });

    lock.timeoutId = window.setTimeout(stopViewportLock, LOCK_TIMEOUT_MS);
    scheduleCorrection();
  }

  /** 使用者主動操作捲動時立刻解除，避免與人工瀏覽搶控制權：時間／空間 O(1)。 */
  function cancelOnUserScrollIntent(event) {
    if (!activeLock) return;
    if (event.type === "keydown" && !CANCEL_KEYS.has(event.key)) return;
    stopViewportLock();
  }

  document.addEventListener("submit", (event) => {
    if (event.target?.id === FORM_ID) startViewportLock();
  }, true);

  window.addEventListener("wheel", cancelOnUserScrollIntent, { passive: true });
  window.addEventListener("touchstart", cancelOnUserScrollIntent, { passive: true });
  window.addEventListener("pointerdown", cancelOnUserScrollIntent, { passive: true });
  window.addEventListener("keydown", cancelOnUserScrollIntent);

  window.FootballScrollStability = Object.freeze({
    version: VERSION,
    start: startViewportLock,
    stop: stopViewportLock,
    isActive: () => Boolean(activeLock),
  });
})();
