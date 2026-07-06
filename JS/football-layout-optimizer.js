// ==============================
// football-layout-optimizer.js
// 世足賽事驗證：攻防語意配對、獨立結果區與緊湊響應式紀錄版面
// ==============================
//
// 主要函式複雜度：
// - decorateCardGrid：O(c) 時間／O(1) 額外空間，c 為單一牌組卡數，固定上限 5
// - labelRecordRows：O(r * c) 時間／O(1) 額外空間，c 為固定表格欄數
// - applyLayout：O(g * c + r * c) 時間／O(1) 額外空間
//
// 更快替代方案比較：
// - 暴力法：每次重繪都搬動所有牌卡並重建整個區塊，容易破壞既有事件與表單值。
// - 本版：不搬動原牌卡、不改 id、不重建表單；只加語意 class、成對標題與資料欄標籤，
//   並用 requestAnimationFrame 合併 MutationObserver 事件，降低重複排版成本。
// ==============================

(function initFootballLayoutOptimizer() {
  "use strict";

  const STYLE_ID = "football-layout-optimizer-style";
  const STYLE_HREF = "football-layout-optimizer.css?v=20260706-football-layout-v1";
  const ROLE_ORDER = Object.freeze([
    "homeAttack",
    "awayDefense",
    "awayAttack",
    "homeDefense",
  ]);
  const ROLE_CLASS = Object.freeze({
    directResult: "is-direct-result",
    homeAttack: "is-home-attack",
    awayDefense: "is-away-defense",
    awayAttack: "is-away-attack",
    homeDefense: "is-home-defense",
  });
  let observer = null;
  let frameId = 0;

  function ensureStylesheet() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_HREF;
    document.head.appendChild(link);
  }

  function inferRole(card, fallbackIndex = -1) {
    const controlId = card.querySelector("select[id*='football-card-']")?.id || "";
    const title = String(card.querySelector("h4, h5")?.textContent || "").replace(/\s+/g, " ");

    if (/directResult|90\s*分鐘|整體能量|單張結果/.test(`${controlId} ${title}`)) return "directResult";
    if (/homeAttack|主隊進攻/.test(`${controlId} ${title}`)) return "homeAttack";
    if (/awayDefense|客隊防守/.test(`${controlId} ${title}`)) return "awayDefense";
    if (/awayAttack|客隊進攻/.test(`${controlId} ${title}`)) return "awayAttack";
    if (/homeDefense|主隊防守/.test(`${controlId} ${title}`)) return "homeDefense";
    return ROLE_ORDER[fallbackIndex] || "";
  }

  function markCard(card, role) {
    if (!role) return;
    card.dataset.layoutRole = role;
    Object.values(ROLE_CLASS).forEach((className) => card.classList.remove(className));
    card.classList.add(ROLE_CLASS[role]);
  }

  function createPairLabel(pair, text) {
    const label = document.createElement("div");
    label.className = "football-pair-label";
    label.dataset.layoutPair = pair;
    label.textContent = text;
    return label;
  }

  function insertPairLabel(grid, beforeCard, pair, text) {
    if (!beforeCard || grid.querySelector(`:scope > [data-layout-pair="${pair}"]`)) return;
    grid.insertBefore(createPairLabel(pair, text), beforeCard);
  }

  /** 固定最多五張牌，不移動既有卡片，只加語意標記。 */
  function decorateCardGrid(grid) {
    if (!(grid instanceof Element)) return;
    const cards = Array.from(grid.children).filter((child) => child.classList?.contains("football-card"));
    if (!cards.length) return;

    if (cards.length === 1) {
      const role = inferRole(cards[0], -1) || "directResult";
      markCard(cards[0], role);
      grid.classList.add(role === "directResult" ? "is-direct-model-grid" : "is-single-model-grid");
      return;
    }

    const structureCards = cards.filter((card) => inferRole(card, -1) !== "directResult");
    structureCards.forEach((card, index) => markCard(card, inferRole(card, index)));
    cards.filter((card) => inferRole(card, -1) === "directResult").forEach((card) => markCard(card, "directResult"));

    const groupTitle = String(grid.previousElementSibling?.textContent || "");
    const isDraftBoard = grid.id === "football-card-grid";
    const isFourCardPairBoard = cards.length === 4 && !/舊版|PK/.test(groupTitle);
    const supportsPairs = isDraftBoard || isFourCardPairBoard;

    if (supportsPairs && structureCards.length === 4) {
      grid.classList.add("is-structure-pair-grid");
      const homeAttack = structureCards.find((card) => card.dataset.layoutRole === "homeAttack") || structureCards[0];
      const awayAttack = structureCards.find((card) => card.dataset.layoutRole === "awayAttack") || structureCards[2];
      insertPairLabel(grid, homeAttack, "home", "主隊進球推導｜主攻 × 客防");
      insertPairLabel(grid, awayAttack, "away", "客隊進球推導｜客攻 × 主防");
    }
  }

  function decorateAllCardGrids() {
    document.querySelectorAll([
      "#football-card-grid",
      ".football-record-card-grid",
      ".football-knockout-card-grid",
    ].join(",")).forEach(decorateCardGrid);
  }

  /** 固定欄位表格標記，供手機卡片式資料列顯示。 */
  function labelRecordRows() {
    const table = document.querySelector("#football-records .football-table");
    if (!table) return;
    const headers = Array.from(table.querySelectorAll("thead th"), (cell) => (
      String(cell.textContent || "").replace(/\s+/g, " ").trim()
    ));
    table.querySelectorAll("tbody tr:not([data-football-layout-labeled='1'])").forEach((row) => {
      Array.from(row.cells).forEach((cell, index) => {
        cell.dataset.label = headers[index] || `欄位 ${index + 1}`;
      });
      row.dataset.footballLayoutLabeled = "1";
    });
  }

  function applyLayout() {
    frameId = 0;
    decorateAllCardGrids();
    labelRecordRows();
  }

  function scheduleLayout() {
    if (frameId) return;
    frameId = window.requestAnimationFrame(applyLayout);
  }

  function observeRenders() {
    const root = document.getElementById("football-tool")?.parentElement || document.body;
    if (!root || observer) return;
    observer = new MutationObserver(scheduleLayout);
    observer.observe(root, { childList: true, subtree: true });
  }

  function init() {
    ensureStylesheet();
    applyLayout();
    observeRenders();
    window.addEventListener("football-energy-render", scheduleLayout);
    document.getElementById("football-reading-form")?.addEventListener("submit", scheduleLayout);
    document.getElementById("football-evaluation-form")?.addEventListener("submit", scheduleLayout);
  }

  init();
})();
