// ==============================
// football-scroll-stability.js
// 世足賽果儲存：以有限次單向校正維持評估面板位置，避免 DOM 觀察器互相觸發造成整頁震盪。
// ==============================
//
// 主要函式複雜度：
// - startViewportLock：時間／空間 O(1)。
// - correctViewport：單次時間／空間 O(1)；每次送出只執行固定 8 次以下。
// - stopViewportLock：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 舊版持續 MutationObserver：紀錄區其他觀察器每次改 DOM 都會重新排程，可能形成逐幀互拉。
// - 本版固定在同步重繪與短延遲階段校正，不監看 DOM、不建立無限回饋；使用者捲動時立即取消。
// ==============================

(function initFootballScrollStability() {
  "use strict";

  if (window.__footballScrollStabilityInitialized) return;
  window.__footballScrollStabilityInitialized = true;

  const VERSION = "20260720-football-scroll-anchor-v2";
  const PANEL_ID = "football-evaluation-panel";
  const FORM_ID = "football-evaluation-form";
  const RECORDS_ID = "football-records";
  const STYLE_ID = "football-scroll-stability-style";
  const POSITION_EPSILON_PX = 0.5;
  const LOCK_LIFETIME_MS = 1_200;
  const CORRECTION_DELAYS_MS = Object.freeze([0, 16, 50, 100, 180, 320, 520, 820]);
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

  /** 固定停用本頁平滑捲動與瀏覽器自動錨定：時間／空間 O(1)。 */
  function ensureStaticScrollPolicy() {
    if (byId(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html:has(#football-tool) {
        scroll-behavior: auto !important;
      }
      body:has(#football-tool),
      body:has(#football-tool) #football-records {
        overflow-anchor: none;
      }
    `;
    document.head.appendChild(style);
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

  /** 清除固定數量計時器並結束鎖定：時間／空間 O(1)。 */
  function stopViewportLock() {
    const lock = activeLock;
    if (!lock) return;
    activeLock = null;
    lock.timerIds.forEach((timerId) => window.clearTimeout(timerId));
    if (lock.frameId) window.cancelAnimationFrame(lock.frameId);
  }

  /** 依面板 viewport top 補償一次差值：時間／空間 O(1)。 */
  function correctViewport(lock) {
    if (activeLock !== lock) return;
    const panel = lock.panel;
    if (!panel.isConnected || panel.classList.contains("football-hidden")) {
      stopViewportLock();
      return;
    }

    const delta = panel.getBoundingClientRect().top - lock.anchorTop;
    if (Math.abs(delta) <= POSITION_EPSILON_PX) return;

    const nextScrollY = Math.min(
      getMaxScrollY(),
      Math.max(0, window.scrollY + delta)
    );
    window.scrollTo(window.scrollX, nextScrollY);
  }

  /** 固定時間點校正，不監看 DOM，避免觀察器回饋迴圈：時間／空間 O(1)。 */
  function scheduleBoundedCorrections(lock) {
    lock.frameId = window.requestAnimationFrame(() => {
      lock.frameId = window.requestAnimationFrame(() => {
        lock.frameId = 0;
        correctViewport(lock);
      });
    });

    CORRECTION_DELAYS_MS.forEach((delay) => {
      const timerId = window.setTimeout(() => correctViewport(lock), delay);
      lock.timerIds.push(timerId);
    });

    lock.timerIds.push(window.setTimeout(() => {
      if (activeLock === lock) stopViewportLock();
    }, LOCK_LIFETIME_MS));
  }

  /** 儲存前記錄評估面板的位置並啟動有限次校正：時間／空間 O(1)。 */
  function startViewportLock() {
    stopViewportLock();

    const panel = byId(PANEL_ID);
    const records = byId(RECORDS_ID);
    if (!panel || !records || panel.classList.contains("football-hidden")) return;

    const lock = {
      panel,
      anchorTop: panel.getBoundingClientRect().top,
      frameId: 0,
      timerIds: [],
    };
    activeLock = lock;
    scheduleBoundedCorrections(lock);
  }

  /** 使用者主動捲動時立即取消：時間／空間 O(1)。 */
  function cancelOnUserScrollIntent(event) {
    if (!activeLock) return;
    if (event.type === "keydown" && !CANCEL_KEYS.has(event.key)) return;
    stopViewportLock();
  }

  ensureStaticScrollPolicy();

  document.addEventListener("submit", (event) => {
    if (event.target?.id === FORM_ID) startViewportLock();
  }, true);

  window.addEventListener("wheel", cancelOnUserScrollIntent, { passive: true });
  window.addEventListener("touchstart", cancelOnUserScrollIntent, { passive: true });
  window.addEventListener("keydown", cancelOnUserScrollIntent);

  window.FootballScrollStability = Object.freeze({
    version: VERSION,
    start: startViewportLock,
    stop: stopViewportLock,
    isActive: () => Boolean(activeLock),
  });
})();