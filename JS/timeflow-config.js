// ==============================
// timeflow-config.js
// 占卜時間流雲端端點與主軸日期點對齊
// ==============================
//
// 主要函式複雜度：
// - alignBranchesToMarkers：O(k + d)
//   k = 可見節點／連線數，d = 日期標記數
// 空間複雜度：O(k + d)
//
// 更快替代方案比較：
// - 以固定像素補償線條：雖然快，但不同節點高度與平行時間流會再次錯位。
// - 本版：以日期球中心作為唯一主軸錨點，建立查表後一次重算每條 Bézier 線。
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

(function alignTimeflowBranchesToDateMarkers() {
  "use strict";

  const STATE_KEY = "evanTarotDivinationTimeflowV4";
  let scheduled = false;
  let observer = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function getStateNodeIndex() {
    try {
      const state = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
      const nodes = [
        ...(Array.isArray(state?.readings) ? state.readings : []),
        ...(Array.isArray(state?.events) ? state.events : []),
      ];
      return new Map(nodes.map((node) => [String(node.id), node]));
    } catch (error) {
      console.warn("[timeflow-anchor] 無法讀取本機時間流資料：", error);
      return new Map();
    }
  }

  function markerKey(streamX, dateKey) {
    return `${Math.round(Number(streamX) * 1000) / 1000}\u0000${String(dateKey || "未填日期")}`;
  }

  function buildMarkerIndex(connections) {
    const circles = Array.from(connections.querySelectorAll(".map-stream-marker"));
    const labels = Array.from(connections.querySelectorAll(".map-stream-date-label"));
    const markerIndex = new Map();
    const count = Math.min(circles.length, labels.length);

    for (let index = 0; index < count; index += 1) {
      const circle = circles[index];
      const label = labels[index];
      markerIndex.set(
        markerKey(circle.getAttribute("cx"), label.textContent.trim()),
        Number(circle.getAttribute("cy"))
      );
    }

    return markerIndex;
  }

  function parsePath(path) {
    const values = String(path.getAttribute("d") || "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
    if (!values || values.length !== 8) return null;
    const numbers = values.map(Number);
    return numbers.every(Number.isFinite) ? numbers : null;
  }

  /**
   * 以日期球中心重新計算所有節點連回主軸的 Bézier 線。
   * 時間複雜度：O(k + d)
   * 空間複雜度：O(k + d)
   */
  function alignBranchesToMarkers() {
    scheduled = false;

    const connections = document.getElementById("map-connections");
    const canvas = document.getElementById("map-canvas");
    if (!connections || !canvas) return;

    const paths = Array.from(connections.querySelectorAll(".map-stream-branch"));
    const nodeElements = Array.from(canvas.querySelectorAll(".map-node[data-node-id]"));
    if (!paths.length || paths.length !== nodeElements.length) return;

    const nodeIndex = getStateNodeIndex();
    const markerIndex = buildMarkerIndex(connections);

    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const node = nodeIndex.get(String(nodeElements[index].dataset.nodeId || ""));
      const values = parsePath(path);
      if (!node || !values) continue;

      const [startX, startY, , , , , endX] = values;
      const targetY = markerIndex.get(markerKey(endX, node.date || "未填日期"));
      if (!Number.isFinite(targetY)) continue;

      const direction = endX >= startX ? 1 : -1;
      const distance = Math.abs(endX - startX);
      const curveStrength = clamp(distance * 0.42, 66, 170);
      const verticalGap = targetY - startY;
      const control1X = startX + direction * curveStrength;
      const control1Y = startY + verticalGap * 0.08;
      const control2X = endX - direction * curveStrength * 0.45;
      const control2Y = targetY - verticalGap * 0.18;

      path.setAttribute(
        "d",
        `M ${formatNumber(startX)} ${formatNumber(startY)} C ${formatNumber(control1X)} ${formatNumber(control1Y)}, ${formatNumber(control2X)} ${formatNumber(control2Y)}, ${formatNumber(endX)} ${formatNumber(targetY)}`
      );
    }
  }

  function scheduleAlignment() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(alignBranchesToMarkers);
  }

  function init() {
    const connections = document.getElementById("map-connections");
    const canvas = document.getElementById("map-canvas");
    if (!connections || !canvas) return;

    observer = new MutationObserver(scheduleAlignment);
    observer.observe(connections, { childList: true, subtree: true });
    observer.observe(canvas, { childList: true, subtree: true });
    window.addEventListener("storage", scheduleAlignment);
    scheduleAlignment();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

(function loadTimeflowAstrologyBackground() {
  "use strict";
  if (document.querySelector('script[data-timeflow-astrology="true"]')) return;
  const script = document.createElement("script");
  script.src = "JS/timeflow-astrology.js?v=20260708-astro-v1";
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
