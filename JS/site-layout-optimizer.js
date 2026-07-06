// ==============================
// site-layout-optimizer.js
// 全站閱讀密度、動態表格標籤與響應式版面增強
// ==============================
//
// 主要函式複雜度：
// - ensureStylesheet：O(1) 時間／O(1) 空間
// - labelTable：O(r * c) 時間／O(c) 額外空間，r 為新增或尚未標記列數、c 為欄位數
// - collectDirtyTables：O(n) 時間／O(t) 空間，n 為本次新增節點數、t 為受影響表格數
// - flushDirtyTables：O(sum(r * c)) 時間／O(c + t) 空間，只處理本次受影響表格
//
// 更快替代方案比較：
// - 暴力法：每次 DOM 變動都重新掃描整頁所有表格，重繪頻繁時會重複做 O(R * C) 工作。
// - 本版：以 Set 收集受影響表格並用 requestAnimationFrame 合併更新；已標記資料列不重做，
//   因此成本只跟新增或被替換的列數有關。
// ==============================

(function initSiteLayoutOptimizer() {
  "use strict";

  const STYLE_ID = "site-layout-optimizer-style";
  const STYLE_HREF = "site-layout-optimizer.css?v=20260706-layout-density-v1";
  const HEADER_CACHE = new WeakMap();
  const dirtyTables = new Set();
  let frameId = 0;
  let observer = null;

  function ensureStylesheet() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_HREF;
    document.head.appendChild(link);
  }

  function getHeaders(table) {
    const cached = HEADER_CACHE.get(table);
    if (cached) return cached;

    const headers = Array.from(table.querySelectorAll("thead th"), (cell) => (
      String(cell.textContent || "").replace(/\s+/g, " ").trim()
    ));
    HEADER_CACHE.set(table, headers);
    return headers;
  }

  /** 只處理尚未標記的列；時間 O(r*c)，空間 O(c)。 */
  function labelTable(table) {
    if (!(table instanceof HTMLTableElement)) return;
    const headers = getHeaders(table);
    if (!headers.length) return;

    if (!table.classList.contains("football-table") && headers.length <= 8) {
      table.dataset.layoutResponsive = "true";
    }

    table.querySelectorAll("tbody tr:not([data-layout-labeled='1'])").forEach((row) => {
      Array.from(row.cells).forEach((cell, index) => {
        cell.dataset.label = headers[index] || `欄位 ${index + 1}`;
      });
      row.dataset.layoutLabeled = "1";
    });
  }

  function addTable(table) {
    if (table instanceof HTMLTableElement) dirtyTables.add(table);
  }

  /** 收集新增節點內真正受影響的表格，避免全頁重掃。 */
  function collectDirtyTables(node) {
    if (!(node instanceof Element)) return;
    addTable(node.closest("table"));
    if (node.matches("table")) addTable(node);
    node.querySelectorAll?.("table").forEach(addTable);
  }

  function flushDirtyTables() {
    frameId = 0;
    const tables = Array.from(dirtyTables);
    dirtyTables.clear();
    tables.forEach(labelTable);
  }

  function scheduleFlush() {
    if (frameId) return;
    frameId = window.requestAnimationFrame(flushDirtyTables);
  }

  function observeDynamicContent() {
    if (!document.body || observer) return;
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        collectDirtyTables(mutation.target);
        mutation.addedNodes.forEach(collectDirtyTables);
      });
      if (dirtyTables.size) scheduleFlush();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    document.documentElement.classList.add("layout-density-balanced");
    ensureStylesheet();
    document.querySelectorAll("table").forEach(addTable);
    flushDirtyTables();
    observeDynamicContent();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
