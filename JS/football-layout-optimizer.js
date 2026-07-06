// ==============================
// football-layout-optimizer.js
// 世足賽事驗證：結果獨立、攻防固定配對、表單語意分組與緊湊響應式紀錄版面
// ==============================
//
// 主要函式複雜度：
// - decorateCardGrid：O(c)，c 為單一牌組卡數，固定上限 5；額外空間 O(c)
// - decorateFormGrids：O(g)，g 為表單網格數；額外空間 O(1)
// - labelRecordRows：O(r * h)，r 為新增資料列、h 為固定欄數；額外空間 O(h)
// - applyLayout：O(g * c + r * h + k)，k 為固定 KPI 數
//
// 更快替代方案比較：
// - 暴力法：每次重繪後重建全部牌卡與表單，會重綁事件並可能遺失輸入值。
// - 本版：保留原節點、id、value 與事件，只標記角色及固定 Grid order；MutationObserver
//   先過濾無關變動，再用 requestAnimationFrame 合併同一畫面的多次渲染。
// ==============================

(function initFootballLayoutOptimizer() {
  "use strict";

  if (window.__footballLayoutOptimizerInitialized) return;
  window.__footballLayoutOptimizerInitialized = true;

  const STYLE_ID = "football-layout-optimizer-style";
  const STYLE_HREF = "football-layout-optimizer.css?v=20260706-football-layout-v2";
  const CARD_GRID_SELECTOR = [
    "#football-card-grid",
    ".football-record-card-grid",
    ".football-knockout-card-grid",
  ].join(",");
  const RELEVANT_SELECTOR = [
    CARD_GRID_SELECTOR,
    ".football-form-grid",
    "#football-records-body",
    "#football-kpis",
    ".football-trend-panel",
  ].join(",");
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
  const ROLE_CLASSES = Object.freeze(Object.values(ROLE_CLASS));
  const KPI_METRIC = Object.freeze({
    "總紀錄": "overall",
    "單張賽果": "direct",
    "單張總進球區間": "direct",
    "單張和局傾向": "direct",
    "攻防推導賽果": "structure",
    "攻防確切比分": "structure",
    "雙模型一致率": "comparison",
    "市場熱門基準": "market",
  });
  const FORM_LAYOUTS = Object.freeze([
    ["football-competition", "match"],
    ["football-direct-result", "direct"],
    ["football-direct-goal-band", "direct"],
    ["football-structure-home-goals", "structure"],
    ["football-actual-home", "evaluation"],
  ]);

  let observer = null;
  let frameId = 0;
  let cachedHeaderKey = "";
  let cachedHeaders = [];

  /** 時間 O(1)，空間 O(1)。 */
  function ensureStylesheet() {
    if (document.getElementById(STYLE_ID) || document.querySelector('link[href*="football-layout-optimizer.css"]')) return;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_HREF;
    document.head.appendChild(link);
  }

  /** 固定最多五張牌。時間 O(1)，空間 O(1)。 */
  function inferRole(card, fallbackIndex = -1) {
    if (card.dataset.layoutRole && ROLE_CLASS[card.dataset.layoutRole]) return card.dataset.layoutRole;
    const controlId = card.querySelector("select[id*='football-card-']")?.id || "";
    const title = String(card.querySelector("h4, h5")?.textContent || "").replace(/\s+/g, " ");
    const source = `${controlId} ${title}`;

    if (/directResult|90\s*分鐘|整體能量|單張結果/.test(source)) return "directResult";
    if (/homeAttack|主隊進攻/.test(source)) return "homeAttack";
    if (/awayDefense|客隊防守/.test(source)) return "awayDefense";
    if (/awayAttack|客隊進攻/.test(source)) return "awayAttack";
    if (/homeDefense|主隊防守/.test(source)) return "homeDefense";
    return ROLE_ORDER[fallbackIndex] || "";
  }

  /** 時間 O(1)，空間 O(1)。 */
  function markCard(card, role) {
    if (!role || !ROLE_CLASS[role]) return;
    card.dataset.layoutRole = role;
    ROLE_CLASSES.forEach((className) => card.classList.toggle(className, className === ROLE_CLASS[role]));
  }

  /** 時間 O(h)，h 固定最多兩個分組標題。 */
  function decorateGroupHeadings(grid) {
    grid.querySelectorAll(":scope > .football-card-group-heading").forEach((heading) => {
      const text = String(heading.textContent || "").replace(/\s+/g, " ");
      const isDirect = /A\s*｜|單張結果|整體能量/.test(text);
      const isStructure = /B\s*｜|四張攻防|攻防模型/.test(text);
      heading.classList.toggle("is-direct-group-heading", isDirect);
      heading.classList.toggle("is-structure-group-heading", isStructure);
    });
  }

  /** 時間 O(1)，空間 O(1)。 */
  function ensurePairLabel(grid, pair, text) {
    let label = grid.querySelector(`:scope > [data-layout-pair="${pair}"]`);
    if (!label) {
      label = document.createElement("div");
      label.className = "football-pair-label";
      label.dataset.layoutPair = pair;
      grid.appendChild(label);
    }
    label.textContent = text;
  }

  /** 固定最多五張牌，不重建卡片、不改 id 與 value。時間 O(c)，空間 O(c)。 */
  function decorateCardGrid(grid) {
    if (!(grid instanceof Element)) return;
    const cards = Array.from(grid.children).filter((child) => child.classList?.contains("football-card"));
    if (!cards.length) return;

    decorateGroupHeadings(grid);
    grid.classList.remove("is-direct-model-grid", "is-single-model-grid", "is-structure-pair-grid", "has-direct-model");

    const directCards = [];
    const structureCards = [];
    cards.forEach((card) => {
      const explicitRole = inferRole(card, -1);
      if (explicitRole === "directResult") directCards.push(card);
      else structureCards.push(card);
    });

    directCards.forEach((card) => markCard(card, "directResult"));
    structureCards.forEach((card, index) => markCard(card, inferRole(card, index)));

    if (directCards.length) grid.classList.add("has-direct-model");
    if (cards.length === 1) {
      grid.classList.add(directCards.length ? "is-direct-model-grid" : "is-single-model-grid");
    }

    const groupTitle = String(grid.previousElementSibling?.textContent || "");
    const isDraftBoard = grid.id === "football-card-grid";
    const isFourCardPairBoard = structureCards.length === 4 && !/舊版|PK/.test(groupTitle);
    if (isDraftBoard || isFourCardPairBoard) {
      if (structureCards.length === 4) {
        grid.classList.add("is-structure-pair-grid");
        ensurePairLabel(grid, "home", "主隊進球推導｜主攻 × 客防");
        ensurePairLabel(grid, "away", "客隊進球推導｜客攻 × 主防");
      }
    }

    grid.dataset.footballLayoutReady = "1";
  }

  /** 時間 O(g * c)，空間 O(c)。 */
  function decorateAllCardGrids() {
    document.querySelectorAll(CARD_GRID_SELECTOR).forEach(decorateCardGrid);
  }

  /** 只標記網格用途，欄位與值不移動。時間 O(g)，空間 O(1)。 */
  function decorateFormGrids() {
    document.querySelectorAll(".football-form-grid").forEach((grid) => {
      let layout = "generic";
      for (const [controlId, layoutName] of FORM_LAYOUTS) {
        if (grid.querySelector(`#${controlId}`)) {
          layout = layoutName;
          break;
        }
      }
      grid.dataset.layoutForm = layout;
    });
  }

  /** KPI 僅加分類標記，供視覺分群。時間 O(k)，空間 O(1)。 */
  function decorateKpis() {
    document.querySelectorAll("#football-kpis .football-kpi").forEach((card) => {
      const label = String(card.querySelector("small")?.textContent || "").trim();
      card.dataset.metricGroup = KPI_METRIC[label] || "other";
    });
  }

  /** 固定欄位表格標記，供手機資料列顯示。時間 O(r * h)，空間 O(h)。 */
  function labelRecordRows() {
    const table = document.querySelector("#football-records .football-table");
    if (!table) return;

    const headerKey = Array.from(table.querySelectorAll("thead th"), (cell) => (
      String(cell.textContent || "").replace(/\s+/g, " ").trim()
    )).join("\u001f");
    if (headerKey !== cachedHeaderKey) {
      cachedHeaderKey = headerKey;
      cachedHeaders = headerKey ? headerKey.split("\u001f") : [];
      table.querySelectorAll("tbody tr").forEach((row) => delete row.dataset.footballLayoutLabeled);
    }

    table.querySelectorAll("tbody tr:not([data-football-layout-labeled='1'])").forEach((row) => {
      Array.from(row.cells).forEach((cell, index) => {
        cell.dataset.label = cachedHeaders[index] || `欄位 ${index + 1}`;
      });
      row.dataset.footballLayoutLabeled = "1";
    });
  }

  function applyLayout() {
    frameId = 0;
    decorateAllCardGrids();
    decorateFormGrids();
    decorateKpis();
    labelRecordRows();
  }

  /** 時間 O(1)，空間 O(1)。 */
  function scheduleLayout() {
    if (frameId) return;
    frameId = window.requestAnimationFrame(applyLayout);
  }

  /** 過濾與排版無關的 DOM 變動，避免不必要掃描。 */
  function mutationNeedsLayout(mutation) {
    const target = mutation.target;
    if (target instanceof Element && (target.matches(RELEVANT_SELECTOR) || target.closest(RELEVANT_SELECTOR))) return true;
    return Array.from(mutation.addedNodes).some((node) => (
      node instanceof Element && (node.matches(RELEVANT_SELECTOR) || Boolean(node.querySelector(RELEVANT_SELECTOR)))
    ));
  }

  function observeRenders() {
    const root = document.getElementById("football-tool")?.parentElement || document.body;
    if (!root || observer) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some(mutationNeedsLayout)) scheduleLayout();
    });
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