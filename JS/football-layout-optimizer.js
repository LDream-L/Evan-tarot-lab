// ==============================
// football-layout-optimizer.js
// 世足賽事驗證：結果獨立、攻防固定配對、表單語意分組、績效資訊明確化與緊湊響應式版面
// ==============================
//
// 主要函式複雜度：
// - decorateCardGrid：O(c)，c 為單一牌組卡數，固定上限 5；額外空間 O(c)
// - decorateFormGrids：O(g)，g 為表單網格數；額外空間 O(1)
// - clarifyKpis：O(k)，k 為固定 KPI 卡數；額外空間 O(k)
// - labelRecordRows：O(r * h)，r 為新增資料列、h 為固定欄數；額外空間 O(h)
// - applyLayout：O(g * c + r * h + k)
//
// 更快替代方案比較：
// - 暴力法：每次重繪後重建全部牌卡、表單與績效卡，會重綁事件並可能遺失輸入值。
// - 本版：保留原節點、id、value 與事件，只標記角色、補上衍生說明及固定 Grid order；
//   MutationObserver 先過濾無關變動，再用 requestAnimationFrame 合併同一畫面的多次渲染。
// ==============================

(function initFootballLayoutOptimizer() {
  "use strict";

  if (window.__footballLayoutOptimizerInitialized) return;
  window.__footballLayoutOptimizerInitialized = true;

  const STYLE_ID = "football-layout-optimizer-style";
  const CLARITY_STYLE_ID = "football-performance-clarity-style";
  const STYLE_HREF = "football-layout-optimizer.css?v=20260706-football-layout-v2";
  const MIN_TREND_SAMPLE = 10;
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
    "舊版單張賽果": "direct",
    "單張總進球區間": "direct",
    "單張和局傾向": "direct",
    "攻防推導賽果": "structure",
    "攻防推論賽果": "structure",
    "攻防確切比分": "structure",
    "雙模型一致率": "comparison",
    "雙模型和局判斷一致率": "comparison",
    "雙模型同判斷一致率": "comparison",
    "市場熱門基準": "market",
    "最終晉級": "advance",
    "最終合盤": "advance",
  });
  const KPI_INFO = Object.freeze({
    "總紀錄": Object.freeze({
      title: "觀察樣本",
      badge: "樣本",
      definition: "目前篩選區間內的總紀錄數，以及其中已填入實際結果、可供核對的場數。",
    }),
    "單張賽果": Object.freeze({
      title: "舊版單張｜賽果命中率",
      badge: "命中率",
      definition: "舊版單張模型的主勝、和局或客勝是否與實際賽果相同。",
      noData: "本期沒有可核對的舊版單張賽果紀錄。",
    }),
    "舊版單張賽果": Object.freeze({
      title: "舊版單張｜賽果命中率",
      badge: "命中率",
      definition: "舊版單張模型的主勝、和局或客勝是否與實際賽果相同。",
      noData: "本期沒有可核對的舊版單張賽果紀錄。",
    }),
    "單張總進球區間": Object.freeze({
      title: "單張｜總進球區間命中率",
      badge: "命中率",
      definition: "單張能量模型預測的總進球區間，是否涵蓋實際總進球數。",
    }),
    "單張和局傾向": Object.freeze({
      title: "單張｜和局傾向命中率",
      badge: "命中率",
      definition: "單張能量模型判斷和局／非和局的方向，是否符合 90 分鐘實際結果。",
    }),
    "攻防推導賽果": Object.freeze({
      title: "攻防｜勝和負方向命中率",
      badge: "命中率",
      definition: "由主客隊預測進球數推導出的勝、和、負方向，是否符合實際賽果。",
    }),
    "攻防推論賽果": Object.freeze({
      title: "攻防｜勝和負方向命中率",
      badge: "命中率",
      definition: "由主客隊預測進球數推導出的勝、和、負方向，是否符合實際賽果。",
    }),
    "攻防確切比分": Object.freeze({
      title: "攻防｜正確比分命中率",
      badge: "命中率",
      definition: "主隊與客隊的預測進球數都完全相同才算命中；平均總誤差越低越好。",
    }),
    "雙模型一致率": Object.freeze({
      title: "雙模型一致率（非命中率）",
      badge: "診斷指標",
      definition: "只表示單張模型與攻防模型是否給出相同方向；兩者一致不代表預測正確。",
    }),
    "雙模型和局判斷一致率": Object.freeze({
      title: "雙模型一致率（非命中率）",
      badge: "診斷指標",
      definition: "只表示單張模型與攻防模型是否給出相同方向；兩者一致不代表預測正確。",
    }),
    "雙模型同判斷一致率": Object.freeze({
      title: "雙模型一致率（非命中率）",
      badge: "診斷指標",
      definition: "只表示單張模型與攻防模型是否給出相同方向；兩者一致不代表預測正確。",
    }),
    "市場熱門基準": Object.freeze({
      title: "市場熱門選項命中率",
      badge: "外部基準",
      definition: "以主勝、和局、客勝中最低賠率的選項作為市場熱門方向，再與實際賽果核對。",
      noData: "本期沒有同時具備主勝、和局、客勝賠率的已核對紀錄。",
    }),
    "最終晉級": Object.freeze({
      title: "淘汰賽｜晉級方命中率",
      badge: "命中率",
      definition: "只計入可核對最終晉級隊伍的淘汰賽紀錄。",
      noData: "本期沒有可核對晉級隊伍的淘汰賽紀錄。",
    }),
    "最終合盤": Object.freeze({
      title: "淘汰賽｜晉級方命中率",
      badge: "命中率",
      definition: "只計入可核對最終晉級隊伍的淘汰賽紀錄。",
      noData: "本期沒有可核對晉級隊伍的淘汰賽紀錄。",
    }),
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
    if (!document.getElementById(STYLE_ID) && !document.querySelector('link[href*="football-layout-optimizer.css"]')) {
      const link = document.createElement("link");
      link.id = STYLE_ID;
      link.rel = "stylesheet";
      link.href = STYLE_HREF;
      document.head.appendChild(link);
    }
    if (document.getElementById(CLARITY_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CLARITY_STYLE_ID;
    style.textContent = `
      .football-kpi > small[data-original-kpi-label],
      .football-kpi > span[data-original-kpi-detail],
      .football-kpi > .football-trend-card-meta[data-original-trend-meta],
      #football-trend-summary[data-original-trend-summary] { display: none !important; }
      .football-kpi-readable-label { color: rgba(238, 232, 255, 0.82); font-size: 0.78rem; font-weight: 800; line-height: 1.42; }
      .football-kpi-badge { display: inline-flex; width: fit-content; margin-top: 0.34rem; padding: 0.16rem 0.42rem; border: 1px solid rgba(187, 154, 255, 0.28); border-radius: 999px; color: #d8c8ff; background: rgba(142, 105, 229, 0.09); font-size: 0.66rem; font-weight: 800; }
      .football-kpi-definition { margin: 0.48rem 0 0; color: rgba(230, 226, 247, 0.68); font-size: 0.7rem; line-height: 1.48; }
      .football-kpi-clarity { display: grid; gap: 0.38rem; margin-top: 0.62rem; padding-top: 0.58rem; border-top: 1px solid rgba(176, 145, 255, 0.16); }
      .football-kpi-clear-row { display: grid; grid-template-columns: minmax(4.2rem, auto) minmax(0, 1fr); gap: 0.42rem; align-items: start; font-size: 0.72rem; line-height: 1.45; }
      .football-kpi-clear-row > span { color: rgba(226, 219, 250, 0.62); font-size: inherit; }
      .football-kpi-clear-row > strong { margin: 0; color: #f1edff; font-size: inherit; line-height: inherit; overflow-wrap: anywhere; }
      .football-kpi-clear-row.is-warning > strong { color: #ffe0a6; }
      .football-kpi-clear-row.is-good > strong { color: #baffd4; }
      .football-kpi-clear-row.is-bad > strong { color: #ffc0ca; }
      .football-kpi-legend { display: flex; flex-wrap: wrap; gap: 0.42rem 0.8rem; margin: 0.72rem 0 0.25rem; padding: 0.66rem 0.72rem; border: 1px solid rgba(176, 145, 255, 0.18); border-radius: 11px; background: rgba(255, 255, 255, 0.022); color: rgba(232, 227, 250, 0.76); font-size: 0.72rem; line-height: 1.48; }
      .football-kpi-legend strong { color: #f1edff; }
      .football-trend-summary-clear { display: flex; flex-wrap: wrap; gap: 0.42rem; margin: 0; padding: 0.68rem 0.76rem; border-left: 3px solid rgba(190, 154, 255, 0.72); border-radius: 8px; background: rgba(255, 255, 255, 0.025); }
      .football-trend-summary-chip { padding: 0.22rem 0.5rem; border-radius: 999px; background: rgba(141, 102, 229, 0.1); color: rgba(239, 234, 255, 0.84); font-size: 0.72rem; line-height: 1.4; }
      @media (max-width: 620px) {
        .football-kpi-clear-row { grid-template-columns: 1fr; gap: 0.12rem; }
      }
    `;
    document.head.appendChild(style);
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

  function directOriginalDetail(card) {
    return Array.from(card.children).find((child) => (
      child.tagName === "SPAN" && !child.classList.contains("football-trend-detail")
    )) || null;
  }

  function parseFraction(text) {
    const match = String(text || "").match(/(\d+)\s*[／/]\s*(\d+)/);
    return match ? { hits: Number(match[1]), total: Number(match[2]) } : null;
  }

  function parsePercent(text) {
    const match = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) : null;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
  }

  function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  }

  function trendLines(card) {
    return Array.from(card.querySelectorAll(":scope > .football-trend-card-meta > .football-trend-detail")).map((line) => ({
      deltaText: String(line.querySelector(".football-trend-delta")?.textContent || "").trim(),
      stateText: String(line.querySelector(".football-trend-state")?.textContent || "").trim(),
      className: line.className,
    }));
  }

  function parsePercentComparison(lines) {
    for (const line of lines) {
      const value = line.deltaText.match(/([+-]?\d+(?:\.\d+)?)\s*個百分點/);
      if (!value) continue;
      const title = line.deltaText.match(/(?:確切比分)?較(.+?)\s+[+-]?\d+(?:\.\d+)?\s*個百分點/);
      return {
        delta: Number(value[1]),
        deltaText: `${Number(value[1]) >= 0 ? "+" : ""}${formatNumber(Number(value[1]), 1)} 個百分點`,
        baselineTitle: title?.[1]?.trim() || "比較區間",
        stateText: line.stateText,
        className: line.className,
      };
    }
    return null;
  }

  function parseErrorComparison(lines) {
    for (const line of lines) {
      const value = line.deltaText.match(/([+-]?\d+(?:\.\d+)?)\s*球/);
      if (!value || !/誤差較/.test(line.deltaText)) continue;
      const title = line.deltaText.match(/誤差較(.+?)\s+[+-]?\d+(?:\.\d+)?\s*球/);
      return {
        delta: Number(value[1]),
        deltaText: `${Number(value[1]) >= 0 ? "+" : ""}${formatNumber(Number(value[1]), 2)} 球`,
        baselineTitle: title?.[1]?.trim() || "比較區間",
        stateText: line.stateText,
        className: line.className,
      };
    }
    return null;
  }

  function clearRow(label, value, tone = "") {
    const row = document.createElement("div");
    row.className = `football-kpi-clear-row${tone ? ` is-${tone}` : ""}`;
    const key = document.createElement("span");
    key.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    row.append(key, content);
    return row;
  }

  function stateTone(className) {
    if (/is-up/.test(className)) return "good";
    if (/is-down/.test(className)) return "bad";
    if (/is-unknown/.test(className)) return "warning";
    return "";
  }

  function noDataMessage(info) {
    return info?.noData || "本期沒有符合此指標條件的已核對紀錄。";
  }

  function explainRateState(stateText, currentTotal, info) {
    if (!currentTotal) return noDataMessage(info);
    if (/比較資料不足/.test(stateText)) return "無法比較：比較區間沒有可計算資料。";
    if (/樣本不足/.test(stateText)) {
      if (currentTotal < MIN_TREND_SAMPLE) {
        return `暫不判斷：本期只有 ${currentTotal} 場，未達每側至少 ${MIN_TREND_SAMPLE} 場的門檻。`;
      }
      return `暫不判斷：比較期未達 ${MIN_TREND_SAMPLE} 場；本期已達門檻。`;
    }
    if (info?.badge === "診斷指標") {
      return `${stateText || "僅供觀察"}；一致程度變化不等於預測準確度變化。`;
    }
    return stateText || "未啟用比較。";
  }

  function ensureReadableHeader(card, originalLabel, info) {
    const original = card.querySelector(":scope > small");
    if (original) {
      original.dataset.originalKpiLabel = originalLabel;
      original.setAttribute("aria-hidden", "true");
    }

    let readable = card.querySelector(":scope > .football-kpi-readable-label");
    if (!readable) {
      readable = document.createElement("div");
      readable.className = "football-kpi-readable-label";
      card.insertBefore(readable, card.firstChild);
    }
    if (readable.textContent !== info.title) readable.textContent = info.title;

    let badge = card.querySelector(":scope > .football-kpi-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "football-kpi-badge";
      readable.insertAdjacentElement("afterend", badge);
    }
    if (badge.textContent !== info.badge) badge.textContent = info.badge;

    let definition = card.querySelector(":scope > .football-kpi-definition");
    if (!definition) {
      definition = document.createElement("p");
      definition.className = "football-kpi-definition";
      badge.insertAdjacentElement("afterend", definition);
    }
    if (definition.textContent !== info.definition) definition.textContent = info.definition;
  }

  function structureSampleContext(cards) {
    for (const card of cards) {
      const label = String(card.querySelector(":scope > small")?.textContent || "").trim();
      if (label !== "攻防推導賽果" && label !== "攻防推論賽果") continue;
      const fraction = parseFraction(directOriginalDetail(card)?.textContent);
      if (fraction) return fraction;
    }
    return null;
  }

  function renderTotalClarity(card, strongText, detailText) {
    const metaText = String(card.querySelector(":scope > .football-trend-card-meta")?.textContent || "").trim();
    const verified = String(detailText).match(/(\d+)\s*場已核對/)?.[1] || "0";
    return [
      clearRow("觀察區間", metaText || "全期間"),
      clearRow("總紀錄", `${strongText || "0"} 筆`),
      clearRow("已核對", `${verified} 場`),
    ];
  }

  function renderRateClarity(card, info, currentRate, fraction, comparison) {
    const rows = [];
    const currentText = fraction?.total
      ? `${formatPercent(currentRate)}（${fraction.hits}／${fraction.total} 場）`
      : "無可計算資料";
    rows.push(clearRow("本期", currentText));

    if (comparison && Number.isFinite(currentRate)) {
      const baselineRate = currentRate - comparison.delta;
      rows.push(clearRow(comparison.baselineTitle, `約 ${formatPercent(baselineRate)}（依顯示差異回推）`));
      rows.push(clearRow("差異", comparison.deltaText));
      rows.push(clearRow(
        "判讀",
        explainRateState(comparison.stateText, fraction?.total || 0, info),
        stateTone(comparison.className)
      ));
    } else if (fraction?.total) {
      rows.push(clearRow("比較", "目前未啟用比較，或比較期沒有可計算資料。"));
    } else {
      rows.push(clearRow("資料狀態", noDataMessage(info), "warning"));
    }
    return rows;
  }

  function renderExactScoreClarity(card, info, currentRate, fraction, detailText, lines) {
    const rows = [];
    const percentComparison = parsePercentComparison(lines);
    const errorComparison = parseErrorComparison(lines);
    const currentMean = Number(String(detailText).match(/平均總誤差\s*([0-9.]+)\s*球/)?.[1]);

    rows.push(clearRow(
      "正確比分",
      fraction?.total ? `${formatPercent(currentRate)}（${fraction.hits}／${fraction.total} 場）` : "無可計算資料"
    ));
    if (Number.isFinite(currentMean)) rows.push(clearRow("平均總誤差", `${formatNumber(currentMean, 2)} 球（越低越好）`));

    if (percentComparison && Number.isFinite(currentRate)) {
      rows.push(clearRow(
        `${percentComparison.baselineTitle}比分率`,
        `約 ${formatPercent(currentRate - percentComparison.delta)}（依顯示差異回推）`
      ));
      rows.push(clearRow("比分率差異", percentComparison.deltaText));
      rows.push(clearRow(
        "比分率判讀",
        explainRateState(percentComparison.stateText, fraction?.total || 0, info),
        stateTone(percentComparison.className)
      ));
    }

    if (errorComparison && Number.isFinite(currentMean)) {
      rows.push(clearRow(
        `${errorComparison.baselineTitle}平均誤差`,
        `約 ${formatNumber(currentMean - errorComparison.delta, 2)} 球（依顯示差異回推）`
      ));
      rows.push(clearRow("誤差差異", `${errorComparison.deltaText}（負值代表改善）`));
      rows.push(clearRow("誤差判讀", errorComparison.stateText, stateTone(errorComparison.className)));
    }

    if (!fraction?.total) rows.push(clearRow("資料狀態", noDataMessage(info), "warning"));
    return rows;
  }

  function updateClarity(card, rows) {
    let clarity = card.querySelector(":scope > .football-kpi-clarity");
    if (!clarity) {
      clarity = document.createElement("div");
      clarity.className = "football-kpi-clarity";
      card.appendChild(clarity);
    }
    const signature = rows.map((row) => row.textContent).join("\u001f");
    if (clarity.dataset.signature === signature) return;
    clarity.dataset.signature = signature;
    clarity.replaceChildren(...rows);
  }

  function clarifyCard(card, context) {
    const original = card.querySelector(":scope > small");
    const originalLabel = String(original?.textContent || "").trim();
    const info = KPI_INFO[originalLabel];
    card.dataset.metricGroup = KPI_METRIC[originalLabel] || "other";
    if (!info) return;

    ensureReadableHeader(card, originalLabel, info);
    const strong = card.querySelector(":scope > strong");
    const detail = directOriginalDetail(card);
    const meta = card.querySelector(":scope > .football-trend-card-meta");
    if (detail) {
      detail.dataset.originalKpiDetail = "1";
      detail.setAttribute("aria-hidden", "true");
    }
    if (meta) {
      meta.dataset.originalTrendMeta = "1";
      meta.setAttribute("aria-hidden", "true");
    }

    const strongText = String(strong?.textContent || "").trim();
    const detailText = String(detail?.textContent || "").trim();
    if (originalLabel === "總紀錄") {
      updateClarity(card, renderTotalClarity(card, strongText, detailText));
      return;
    }

    const currentRate = parsePercent(strongText);
    let fraction = parseFraction(detailText);
    if (originalLabel === "攻防確切比分" && !fraction && context.structureFraction?.total && Number.isFinite(currentRate)) {
      fraction = {
        total: context.structureFraction.total,
        hits: Math.round((currentRate / 100) * context.structureFraction.total),
      };
    }
    const lines = trendLines(card);
    const rows = originalLabel === "攻防確切比分"
      ? renderExactScoreClarity(card, info, currentRate, fraction, detailText, lines)
      : renderRateClarity(card, info, currentRate, fraction, parsePercentComparison(lines));
    updateClarity(card, rows);
  }

  function ensureKpiLegend(grid) {
    let legend = document.getElementById("football-kpi-legend");
    if (legend) return;
    legend = document.createElement("div");
    legend.id = "football-kpi-legend";
    legend.className = "football-kpi-legend";
    legend.append(
      Object.assign(document.createElement("span"), { textContent: "命中率＝預測是否符合實際結果" }),
      Object.assign(document.createElement("span"), { textContent: "診斷指標＝模型行為，不等於預測正確" }),
      Object.assign(document.createElement("span"), { textContent: "外部基準＝市場最低賠率選項" })
    );
    grid.insertAdjacentElement("beforebegin", legend);
  }

  function clarifyTrendSummary() {
    const summary = document.getElementById("football-trend-summary");
    if (!summary) return;
    summary.dataset.originalTrendSummary = "1";
    summary.setAttribute("aria-hidden", "true");
    const source = String(summary.textContent || "").replace(/\s+/g, " ").trim();
    const current = source.match(/目前顯示：(.+?)；已核對/)?.[1] || "目前區間";
    const completed = source.match(/已核對\s*(\d+)\s*場/)?.[1] || "0";
    const baseline = source.match(/比較基準：(.+?)(?:。|；|$)/)?.[1] || "未啟用比較";
    const values = [
      `觀察區間：${current}`,
      `本期已核對：${completed} 場`,
      `比較區間：${baseline}`,
      `趨勢門檻：本期與比較期各至少 ${MIN_TREND_SAMPLE} 場`,
      "95% 區間未分離時，只標示觀察方向，不宣告已確認",
    ];
    let clear = document.getElementById("football-trend-summary-clear");
    if (!clear) {
      clear = document.createElement("div");
      clear.id = "football-trend-summary-clear";
      clear.className = "football-trend-summary-clear";
      summary.insertAdjacentElement("afterend", clear);
    }
    const signature = values.join("\u001f");
    if (clear.dataset.signature === signature) return;
    clear.dataset.signature = signature;
    clear.replaceChildren(...values.map((value) => {
      const chip = document.createElement("span");
      chip.className = "football-trend-summary-chip";
      chip.textContent = value;
      return chip;
    }));
  }

  /** KPI 不改動原始統計節點，只增加可讀標題、定義與比較拆解。時間 O(k)，空間 O(k)。 */
  function decorateKpis() {
    const grid = document.getElementById("football-kpis");
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll(":scope > .football-kpi"));
    const context = { structureFraction: structureSampleContext(cards) };
    cards.forEach((card) => clarifyCard(card, context));
    ensureKpiLegend(grid);
    clarifyTrendSummary();
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
