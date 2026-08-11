// ==============================
// football-performance-trends.js
// 世足賽事驗證：日期／場次滾動績效觀察
// ==============================
// 主要函式複雜度：
// - buildIndexes：O(r * m + B) 時間／O(r * m) 空間，r 為紀錄數、m 為固定統計欄位數、B 為期間內投注總筆數。
// - resolveWindow：O(log r + m) 時間／O(m) 空間。
// - decorateKpis：O(k) 時間／O(1) 額外空間，k 為固定 KPI 卡數。
//
// 更快替代方案比較：
// - 每次切換條件都重新掃描全部紀錄：單次 O(r)，資料增加後會重複運算。
// - 本版先依時間排序並建立前綴統計，日期區間以二分搜尋定位，查詢降為 O(log r + m)。
//
// 注意：此模組只依日期／場次切換績效，不把程式版本、模型版本或權重調整日期當成切點。
// ==============================

(function initFootballPerformanceTrends() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const TAIPEI_OFFSET = "+08:00";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_RATE_SAMPLE = 10;
  const RATE_NOTICE_PP = 5;
  const ERROR_NOTICE = 0.25;
  const METRIC_KEYS = Object.freeze([
    "total",
    "completed",
    "directGoalBandEligible",
    "directGoalBandHits",
    "directDrawEligible",
    "directDrawHits",
    "directLegacyEligible",
    "directLegacyHits",
    "structureEligible",
    "structureResultHits",
    "structureExactHits",
    "structureErrorTotal",
    "structureErrorSquareTotal",
    "dualEligible",
    "dualAgreements",
    "marketEligible",
    "marketHits",
    "advanceEligible",
    "advanceHits",
    "betCount",
    "betStake",
    "betProfit",
    "manualBetCount",
    "manualBetStake",
    "manualBetProfit",
    "randomBetCount",
    "randomBetStake",
    "randomBetProfit",
  ]);
  const SIGNED_METRIC_KEYS = new Set(["betProfit", "manualBetProfit", "randomBetProfit"]);

  let indexes = null;
  let gridObserver = null;
  let recordsObserver = null;
  let renderToken = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function emptyVector() {
    return Object.fromEntries(METRIC_KEYS.map((key) => [key, 0]));
  }

  function safeTimestamp(record) {
    const value = Date.parse(record?.match?.kickoff || "");
    return Number.isFinite(value) ? value : 0;
  }

  function getMarketFavorite(record) {
    const odds = record?.match?.odds || {};
    const entries = [["H", odds.home], ["D", odds.draw], ["A", odds.away]];
    if (!entries.every(([, value]) => Number.isFinite(value))) return "";
    return entries.reduce((best, item) => item[1] < best[1] ? item : best)[0];
  }

  function isEnergyRecord(record) {
    const energy = window.FootballDirectEnergy;
    if (typeof energy?.isEnergyRecord === "function") return energy.isEnergyRecord(record);
    return record?.prediction?.directModel === "energy-v1";
  }

  /**
   * 單筆建立固定欄位與該筆投注貢獻。
   * 時間複雜度：O(b)，b 為該紀錄投注筆數。
   * 空間複雜度：O(1)。
   * 更快替代方案比較：另外逐筆重掃歷史投注會使每次切換區間回到 O(r+B)；
   * 本版在建立前綴表時只結算一次，後續區間查詢仍維持 O(log r + m)。
   */
  function recordContribution(record) {
    const out = emptyVector();
    out.total = 1;
    const evaluation = core.calculateEvaluation(record);
    if (!evaluation) return out;

    out.completed = 1;

    const bets = Array.isArray(record?.prediction?.bets) ? record.prediction.bets : [];
    if (record.actual && bets.length && typeof core.summarizeBets === "function") {
      const betting = core.summarizeBets(bets, record.actual);
      const settledCount = Number(betting.settled || 0);
      const settledStake = Number(betting.settledStake ?? betting.totalStake ?? 0);
      const actualProfit = Number(betting.actualProfit || 0);
      out.betCount = settledCount;
      out.betStake = settledStake;
      out.betProfit = actualProfit;

      if (record.match?.cardSource === "manual") {
        out.manualBetCount = settledCount;
        out.manualBetStake = settledStake;
        out.manualBetProfit = actualProfit;
      } else if (record.match?.cardSource === "random") {
        out.randomBetCount = settledCount;
        out.randomBetStake = settledStake;
        out.randomBetProfit = actualProfit;
      }
    }

    if (evaluation.type === "legacy5") return out;

    if (core.modeIncludesDirect(evaluation.type)) {
      if (isEnergyRecord(record)) {
        out.directGoalBandEligible = 1;
        out.directGoalBandHits = evaluation.directGoalBandHit ? 1 : 0;
        out.directDrawEligible = 1;
        out.directDrawHits = evaluation.directDrawTendencyHit ? 1 : 0;
      } else if (typeof evaluation.directResultHit === "boolean") {
        out.directLegacyEligible = 1;
        out.directLegacyHits = evaluation.directResultHit ? 1 : 0;
      }
    }

    if (core.modeIncludesStructure(evaluation.type)) {
      const error = Number(evaluation.structureAbsoluteError || 0);
      out.structureEligible = 1;
      out.structureResultHits = evaluation.structureResultHit ? 1 : 0;
      out.structureExactHits = evaluation.structureExactHit ? 1 : 0;
      out.structureErrorTotal = error;
      out.structureErrorSquareTotal = error * error;
    }

    if (evaluation.type === "dual" && typeof evaluation.modelsAgree === "boolean") {
      out.dualEligible = 1;
      out.dualAgreements = evaluation.modelsAgree ? 1 : 0;
    }

    const favorite = getMarketFavorite(record);
    if (favorite) {
      out.marketEligible = 1;
      out.marketHits = favorite === evaluation.actualResult ? 1 : 0;
    }

    const knockout = evaluation.knockout;
    if (knockout?.finalAdvanceEligible) {
      out.advanceEligible = 1;
      out.advanceHits = knockout.finalAdvanceHit ? 1 : 0;
    } else if (evaluation.advanceEligible) {
      out.advanceEligible = 1;
      out.advanceHits = evaluation.advanceHit ? 1 : 0;
    }

    return out;
  }

  /** 建立固定欄位前綴表：O(r * m + B) 時間／O(r * m) 空間，B 為投注總筆數。 */
  function createIndex(records) {
    const rows = records
      .slice()
      .sort((a, b) => safeTimestamp(a) - safeTimestamp(b));
    const timestamps = Float64Array.from(rows.map(safeTimestamp));
    const prefix = Object.fromEntries(
      METRIC_KEYS.map((key) => [key, new Float64Array(rows.length + 1)])
    );

    rows.forEach((record, index) => {
      const contribution = recordContribution(record);
      METRIC_KEYS.forEach((key) => {
        prefix[key][index + 1] = prefix[key][index] + contribution[key];
      });
    });

    return { rows, timestamps, prefix };
  }

  /** 只在資料有變動時重建：O(r * m + B) 時間／O(r * m) 空間。 */
  function buildIndexes() {
    const records = core.getRecords();
    indexes = {
      all: createIndex(records),
      verified: createIndex(records.filter((record) => Boolean(record.actual))),
    };
    return indexes;
  }

  function lowerBound(values, target) {
    let left = 0;
    let right = values.length;
    while (left < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (values[middle] < target) left = middle + 1;
      else right = middle;
    }
    return left;
  }

  function upperBound(values, target) {
    let left = 0;
    let right = values.length;
    while (left < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (values[middle] <= target) left = middle + 1;
      else right = middle;
    }
    return left;
  }

  function querySlice(index, start, end) {
    const safeStart = Math.max(0, Math.min(start, index.rows.length));
    const safeEnd = Math.max(safeStart, Math.min(end, index.rows.length));
    const vector = emptyVector();
    METRIC_KEYS.forEach((key) => {
      vector[key] = index.prefix[key][safeEnd] - index.prefix[key][safeStart];
    });
    return { vector, start: safeStart, end: safeEnd, count: safeEnd - safeStart };
  }

  function queryDate(index, startMs, endMs) {
    const start = lowerBound(index.timestamps, startMs);
    const end = upperBound(index.timestamps, endMs);
    return querySlice(index, start, end);
  }

  /**
   * 向量相減：時間 O(m)、空間 O(m)。損益允許負值，其餘計數欄位避免浮點誤差落到負數。
   */
  function subtractVectors(source, removed) {
    const result = emptyVector();
    METRIC_KEYS.forEach((key) => {
      const difference = source[key] - removed[key];
      result[key] = SIGNED_METRIC_KEYS.has(key) ? difference : Math.max(0, difference);
    });
    return result;
  }

  function dateStart(dateText) {
    const value = Date.parse(`${dateText}T00:00:00${TAIPEI_OFFSET}`);
    return Number.isFinite(value) ? value : null;
  }

  function dateEnd(dateText) {
    const start = dateStart(dateText);
    return start == null ? null : start + DAY_MS - 1;
  }

  function formatDateInput(timestamp) {
    if (!Number.isFinite(timestamp)) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function latestVerifiedDate() {
    const values = indexes?.verified?.timestamps;
    if (!values?.length) return formatDateInput(Date.now());
    return formatDateInput(values[values.length - 1]);
  }

  function mergeDateWindow(startMs, endMs) {
    const all = queryDate(indexes.all, startMs, endMs).vector;
    const verified = queryDate(indexes.verified, startMs, endMs).vector;
    verified.total = all.total;
    verified.completed = all.completed;
    return verified;
  }

  function allVector() {
    return querySlice(indexes.all, 0, indexes.all.rows.length).vector;
  }

  function verifiedSliceVector(start, end) {
    const vector = querySlice(indexes.verified, start, end).vector;
    vector.total = vector.completed;
    return vector;
  }

  function selectedValue(id, fallback = "") {
    return String(byId(id)?.value || fallback).trim();
  }

  function positiveInteger(id, fallback) {
    const value = Number(selectedValue(id));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  /** 依控制器取得目前視窗與前一等長視窗：O(log r + m) 時間／O(m) 空間。 */
  function resolveWindow() {
    if (!indexes) buildIndexes();
    const mode = selectedValue("football-trend-mode", "all");
    const anchor = selectedValue("football-trend-anchor", latestVerifiedDate());
    const anchorEnd = dateEnd(anchor) ?? Date.now();
    let current = allVector();
    let previous = null;
    let title = "全期間";
    let previousTitle = "";

    if (mode === "day") {
      const start = dateStart(anchor) ?? 0;
      current = mergeDateWindow(start, start + DAY_MS - 1);
      previous = mergeDateWindow(start - DAY_MS, start - 1);
      title = anchor;
      previousTitle = "前一日";
    } else if (mode === "range") {
      const startText = selectedValue("football-trend-start", anchor);
      const endText = selectedValue("football-trend-end", anchor);
      const start = dateStart(startText) ?? 0;
      const end = dateEnd(endText) ?? start;
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      const duration = to - from + 1;
      current = mergeDateWindow(from, to);
      previous = mergeDateWindow(from - duration, from - 1);
      title = `${formatDateInput(from)}～${formatDateInput(to)}`;
      previousTitle = "前一等長區間";
    } else if (mode === "asof") {
      current = mergeDateWindow(Number.NEGATIVE_INFINITY, anchorEnd);
      title = `截至 ${anchor}`;
    } else if (mode === "matches") {
      const count = positiveInteger("football-trend-count", 10);
      const eligibleEnd = upperBound(indexes.verified.timestamps, anchorEnd);
      const currentStart = Math.max(0, eligibleEnd - count);
      const previousStart = Math.max(0, currentStart - count);
      current = verifiedSliceVector(currentStart, eligibleEnd);
      previous = verifiedSliceVector(previousStart, currentStart);
      title = `截至 ${anchor} 最近 ${current.completed} 場已核對`;
      previousTitle = `前 ${previous.completed} 場已核對`;
    } else if (mode === "days") {
      const days = positiveInteger("football-trend-days", 30);
      const currentStart = anchorEnd - days * DAY_MS + 1;
      current = mergeDateWindow(currentStart, anchorEnd);
      previous = mergeDateWindow(currentStart - days * DAY_MS, currentStart - 1);
      title = `截至 ${anchor} 最近 ${days} 天`;
      previousTitle = `前 ${days} 天`;
    }

    const compareMode = selectedValue("football-trend-compare", "previous");
    let baseline = compareMode === "previous" ? previous : null;
    let baselineTitle = previousTitle;
    if (compareMode === "rest") {
      baseline = subtractVectors(allVector(), current);
      baselineTitle = "其餘歷史資料";
    } else if (compareMode === "none") {
      baseline = null;
      baselineTitle = "";
    }

    if (mode === "all" && compareMode === "rest") baseline = null;
    return { mode, current, baseline, title, baselineTitle };
  }

  function formatRate(hits, total) {
    return total ? `${Math.round((hits / total) * 1000) / 10}%` : "—";
  }

  function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return "—";
    return String(Math.round(value * 10 ** digits) / 10 ** digits);
  }

  /** 金額格式：時間／空間 O(1)，損益不包含本金。 */
  function formatMoney(value, signed = false) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    const normalized = Math.round((number + Number.EPSILON) * 100) / 100;
    const prefix = signed && normalized > 0 ? "+" : "";
    return `${prefix}$${normalized.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
  }

  /** ROI = 淨損益／已結算成本：時間／空間 O(1)。 */
  function formatRoi(profit, stake) {
    const cost = Number(stake);
    if (!Number.isFinite(cost) || cost <= 0) return "—";
    const value = (Number(profit) / cost) * 100;
    return `${value > 0 ? "+" : ""}${formatNumber(value, 1)}%`;
  }

  function wilsonInterval(hits, total) {
    if (!total) return null;
    const z = 1.96;
    const proportion = hits / total;
    const denominator = 1 + (z * z) / total;
    const center = (proportion + (z * z) / (2 * total)) / denominator;
    const margin = (z / denominator) * Math.sqrt(
      (proportion * (1 - proportion)) / total + (z * z) / (4 * total * total)
    );
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
  }

  function rateTrend(currentHits, currentTotal, baseHits, baseTotal, direction = "high") {
    if (!currentTotal || !baseTotal) return { text: "比較資料不足", state: "unknown", delta: "—" };
    const delta = (currentHits / currentTotal - baseHits / baseTotal) * 100;
    const deltaText = `${delta >= 0 ? "+" : ""}${formatNumber(delta, 1)} 個百分點`;
    if (currentTotal < MIN_RATE_SAMPLE || baseTotal < MIN_RATE_SAMPLE) {
      return { text: "樣本不足，暫不確認趨勢", state: "unknown", delta: deltaText };
    }

    const currentInterval = wilsonInterval(currentHits, currentTotal);
    const baseInterval = wilsonInterval(baseHits, baseTotal);
    const clearlyUp = currentInterval[0] > baseInterval[1];
    const clearlyDown = currentInterval[1] < baseInterval[0];
    const magnitudeSmall = Math.abs(delta) < RATE_NOTICE_PP;

    if (direction === "neutral") {
      if (clearlyUp) return { text: "較明確上升", state: "up", delta: deltaText };
      if (clearlyDown) return { text: "較明確下降", state: "down", delta: deltaText };
      if (magnitudeSmall) return { text: "大致持平", state: "flat", delta: deltaText };
      return { text: delta > 0 ? "觀察到上升，尚未確認" : "觀察到下降，尚未確認", state: delta > 0 ? "up" : "down", delta: deltaText };
    }

    if (clearlyUp) return { text: "較明確提升", state: "up", delta: deltaText };
    if (clearlyDown) return { text: "較明確下降", state: "down", delta: deltaText };
    if (magnitudeSmall) return { text: "大致持平", state: "flat", delta: deltaText };
    return { text: delta > 0 ? "觀察到提升，尚未確認" : "觀察到下降，尚未確認", state: delta > 0 ? "up" : "down", delta: deltaText };
  }

  function meanErrorStats(vector) {
    const total = vector.structureEligible;
    if (!total) return null;
    const mean = vector.structureErrorTotal / total;
    if (total < 2) return { total, mean, low: mean, high: mean };
    const variance = Math.max(
      0,
      (vector.structureErrorSquareTotal - total * mean * mean) / (total - 1)
    );
    const margin = 1.96 * Math.sqrt(variance / total);
    return { total, mean, low: Math.max(0, mean - margin), high: mean + margin };
  }

  function errorTrend(currentVector, baseVector) {
    const current = meanErrorStats(currentVector);
    const baseline = meanErrorStats(baseVector);
    if (!current || !baseline) return { text: "比較資料不足", state: "unknown", delta: "—" };
    const delta = current.mean - baseline.mean;
    const deltaText = `${delta >= 0 ? "+" : ""}${formatNumber(delta, 2)} 球`;
    if (current.total < MIN_RATE_SAMPLE || baseline.total < MIN_RATE_SAMPLE) {
      return { text: "樣本不足，暫不確認誤差趨勢", state: "unknown", delta: deltaText };
    }
    if (current.high < baseline.low) return { text: "平均誤差較明確改善", state: "up", delta: deltaText };
    if (current.low > baseline.high) return { text: "平均誤差較明確惡化", state: "down", delta: deltaText };
    if (Math.abs(delta) < ERROR_NOTICE) return { text: "平均誤差大致持平", state: "flat", delta: deltaText };
    return {
      text: delta < 0 ? "平均誤差改善，尚未確認" : "平均誤差惡化，尚未確認",
      state: delta < 0 ? "up" : "down",
      delta: deltaText,
    };
  }

  function findDetailSpan(card) {
    return Array.from(card.children).find((child) => (
      child.tagName === "SPAN" && !child.classList.contains("football-trend-detail")
    ));
  }

  function ensureTrendMeta(card) {
    let meta = card.querySelector(":scope > .football-trend-card-meta");
    if (meta) return meta;
    meta = createElement("div", "football-trend-card-meta");
    card.appendChild(meta);
    return meta;
  }

  function renderTrendLine(meta, comparison, label = "較比較區間") {
    const line = createElement("div", `football-trend-detail is-${comparison.state}`);
    line.append(
      createElement("span", "football-trend-delta", `${label} ${comparison.delta}`),
      createElement("strong", "football-trend-state", comparison.text)
    );
    meta.appendChild(line);
  }

  function updateRateCard(card, label, hits, total, baseHits, baseTotal, baselineTitle, direction = "high") {
    const strong = card.querySelector(":scope > strong");
    const detail = findDetailSpan(card);
    if (strong) strong.textContent = formatRate(hits, total);
    if (detail) detail.textContent = `${hits}／${total}`;
    const meta = ensureTrendMeta(card);
    meta.replaceChildren();
    if (baselineTitle) {
      renderTrendLine(meta, rateTrend(hits, total, baseHits, baseTotal, direction), `較${baselineTitle}`);
    } else {
      meta.appendChild(createElement("span", "football-trend-no-compare", label));
    }
  }

  function decorateCard(card, windowState) {
    const label = card.querySelector(":scope > small")?.textContent?.trim() || "";
    const current = windowState.current;
    const baseline = windowState.baseline || emptyVector();
    const baselineTitle = windowState.baseline ? windowState.baselineTitle : "";

    if (label === "總紀錄") {
      const strong = card.querySelector(":scope > strong");
      const detail = findDetailSpan(card);
      if (strong) strong.textContent = String(current.total);
      if (detail) detail.textContent = `${current.completed} 場已核對`;
      const meta = ensureTrendMeta(card);
      meta.replaceChildren(createElement("span", "football-trend-no-compare", windowState.title));
      return;
    }

    if (label === "單張總進球區間") {
      updateRateCard(card, windowState.title, current.directGoalBandHits, current.directGoalBandEligible, baseline.directGoalBandHits, baseline.directGoalBandEligible, baselineTitle);
      return;
    }
    if (label === "單張和局傾向") {
      updateRateCard(card, windowState.title, current.directDrawHits, current.directDrawEligible, baseline.directDrawHits, baseline.directDrawEligible, baselineTitle);
      return;
    }
    if (label === "舊版單張賽果" || label === "單張賽果") {
      updateRateCard(card, windowState.title, current.directLegacyHits, current.directLegacyEligible, baseline.directLegacyHits, baseline.directLegacyEligible, baselineTitle);
      return;
    }
    if (label === "攻防推導賽果" || label === "攻防推論賽果") {
      updateRateCard(card, windowState.title, current.structureResultHits, current.structureEligible, baseline.structureResultHits, baseline.structureEligible, baselineTitle);
      return;
    }
    if (label === "攻防確切比分") {
      const strong = card.querySelector(":scope > strong");
      const detail = findDetailSpan(card);
      const mean = current.structureEligible ? current.structureErrorTotal / current.structureEligible : null;
      if (strong) strong.textContent = formatRate(current.structureExactHits, current.structureEligible);
      if (detail) detail.textContent = mean == null ? "—" : `平均總誤差 ${formatNumber(mean, 2)} 球`;
      const meta = ensureTrendMeta(card);
      meta.replaceChildren();
      if (baselineTitle) {
        renderTrendLine(
          meta,
          rateTrend(current.structureExactHits, current.structureEligible, baseline.structureExactHits, baseline.structureEligible),
          `確切比分較${baselineTitle}`
        );
        renderTrendLine(meta, errorTrend(current, baseline), `誤差較${baselineTitle}`);
      } else {
        meta.appendChild(createElement("span", "football-trend-no-compare", windowState.title));
      }
      return;
    }
    if (label === "雙模型一致率" || label === "雙模型和局判斷一致率") {
      updateRateCard(card, windowState.title, current.dualAgreements, current.dualEligible, baseline.dualAgreements, baseline.dualEligible, baselineTitle, "neutral");
      return;
    }
    if (label === "市場熱門基準") {
      updateRateCard(card, windowState.title, current.marketHits, current.marketEligible, baseline.marketHits, baseline.marketEligible, baselineTitle);
      return;
    }
    if (label === "最終晉級" || label === "最終合盤") {
      updateRateCard(card, windowState.title, current.advanceHits, current.advanceEligible, baseline.advanceHits, baseline.advanceEligible, baselineTitle);
    }
  }


  /** 固定建立三張期間投注卡：時間／DOM 空間 O(1)。 */
  function createBettingPerformanceCard(scope, label) {
    const card = createElement("article", "football-trend-betting-card");
    card.dataset.bettingScope = scope;
    card.append(
      createElement("small", "", label),
      createElement("strong", "", "—"),
      createElement("span", "", "此期間尚無已結算投注")
    );
    return card;
  }

  /** 固定三組牌源損益：時間／DOM 空間 O(1)。 */
  function ensureBettingPerformanceSummary() {
    let block = byId("football-trend-betting-block");
    if (block) return block;
    const body = byId("football-performance-body");
    const periodSummary = byId("football-trend-summary");
    if (!body || !periodSummary) return null;

    block = createElement("section", "football-trend-betting-block");
    block.id = "football-trend-betting-block";
    const heading = createElement("div", "football-trend-betting-heading");
    heading.append(
      createElement("h4", "", "運彩期間損益"),
      createElement("p", "", "依目前觀察區間累計；總損益與 ROI 都不把本金當成獲利。")
    );
    const grid = createElement("div", "football-trend-betting-grid");
    grid.id = "football-trend-betting-summary";
    grid.append(
      createBettingPerformanceCard("all", "全部投注｜總損益"),
      createBettingPerformanceCard("manual", "自己抽牌｜總損益"),
      createBettingPerformanceCard("random", "網站隨機抽牌｜總損益")
    );
    block.append(heading, grid);
    periodSummary.insertAdjacentElement("afterend", block);
    return block;
  }

  /**
   * 以目前時間視窗更新總成本、總損益與 ROI。
   * 時間複雜度：O(1)，前綴查詢已在 resolveWindow 完成。
   * DOM 空間複雜度：O(1)。
   * 更快替代方案比較：每次切日期重新掃全部投注為 O(r+B)；本版只讀前綴向量的固定 9 個數值。
   */
  function renderBettingPerformance(windowState) {
    if (!ensureBettingPerformanceSummary()) return;
    const vector = windowState.current;
    const scopes = [
      ["all", vector.betCount, vector.betStake, vector.betProfit],
      ["manual", vector.manualBetCount, vector.manualBetStake, vector.manualBetProfit],
      ["random", vector.randomBetCount, vector.randomBetStake, vector.randomBetProfit],
    ];

    scopes.forEach(([scope, count, stake, profit]) => {
      const card = document.querySelector(`[data-betting-scope="${scope}"]`);
      if (!card) return;
      const strong = card.querySelector(":scope > strong");
      const detail = card.querySelector(":scope > span");
      if (Number(count) <= 0) {
        if (strong) strong.textContent = "—";
        if (detail) detail.textContent = "此期間尚無已結算投注";
        return;
      }
      if (strong) strong.textContent = formatMoney(profit, true);
      if (detail) {
        detail.textContent = `總成本 ${formatMoney(stake)}｜已結算 ${Number(count)} 筆｜ROI ${formatRoi(profit, stake)}`;
      }
    });
  }

  /** 固定 KPI 卡數，直接更新現有卡片：O(k) 時間／O(1) 額外空間。 */
  function decorateKpis() {
    const grid = byId("football-kpis");
    if (!grid?.children.length) return;
    const windowState = resolveWindow();
    Array.from(grid.querySelectorAll(":scope > .football-kpi")).forEach((card) => decorateCard(card, windowState));
    renderBettingPerformance(windowState);

    const summary = byId("football-trend-summary");
    if (summary) {
      const compareText = windowState.baseline
        ? `；比較基準：${windowState.baselineTitle}`
        : "；目前未啟用比較";
      summary.textContent = `目前顯示：${windowState.title}；已核對 ${windowState.current.completed} 場${compareText}。命中率以 95% 區間判斷，樣本不足時不宣告已確認。`;
    }
  }

  function scheduleRender(rebuild = false) {
    renderToken += 1;
    const token = renderToken;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (token !== renderToken) return;
      if (rebuild) buildIndexes();
      decorateKpis();
    }));
  }

  function refreshFieldVisibility() {
    const mode = selectedValue("football-trend-mode", "all");
    document.querySelectorAll("[data-trend-field]").forEach((field) => {
      const modes = String(field.dataset.trendField || "").split(" ");
      field.hidden = !modes.includes(mode);
    });
  }

  function option(value, text) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    return item;
  }

  function createSelectField(labelText, id, options, modes = "all day range asof matches days") {
    const label = createElement("label", "football-trend-field");
    label.dataset.trendField = modes;
    label.appendChild(document.createTextNode(labelText));
    const select = document.createElement("select");
    select.id = id;
    options.forEach(([value, text]) => select.appendChild(option(value, text)));
    label.appendChild(select);
    return label;
  }

  function createDateField(labelText, id, value, modes) {
    const label = createElement("label", "football-trend-field");
    label.dataset.trendField = modes;
    label.appendChild(document.createTextNode(labelText));
    const input = document.createElement("input");
    input.type = "date";
    input.id = id;
    input.value = value;
    label.appendChild(input);
    return label;
  }

  function injectStyles() {
    if (byId("football-performance-trends-style")) return;
    const style = document.createElement("style");
    style.id = "football-performance-trends-style";
    style.textContent = `
      .football-trend-panel {
        margin: 1.2rem 0;
        border: 1px solid rgba(176, 145, 255, 0.3);
        border-radius: 18px;
        background: linear-gradient(145deg, rgba(24, 20, 66, 0.72), rgba(9, 8, 34, 0.82));
        overflow: hidden;
      }
      .football-trend-panel > summary { list-style: none; cursor: pointer; user-select: none; }
      .football-trend-panel > summary::-webkit-details-marker { display: none; }
      .football-trend-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
      }
      .football-trend-heading-copy { display: grid; gap: 0.35rem; min-width: 0; }
      .football-trend-heading h3,
      .football-trend-heading p { margin: 0; }
      .football-trend-heading p { max-width: 920px; font-size: 0.86rem; line-height: 1.6; opacity: 0.76; }
      .football-trend-toggle {
        flex: 0 0 auto;
        padding: .4rem .72rem;
        border: 1px solid rgba(176, 145, 255, 0.28);
        border-radius: 999px;
        background: rgba(142, 125, 255, 0.1);
        font-size: .78rem;
        white-space: nowrap;
      }
      .football-trend-body { display: grid; gap: 1rem; padding: 0 1rem 1rem; }
      .football-trend-betting-block { display: grid; gap: .7rem; }
      .football-trend-betting-heading { display: grid; gap: .22rem; }
      .football-trend-betting-heading h4,
      .football-trend-betting-heading p { margin: 0; }
      .football-trend-betting-heading p { font-size: .78rem; line-height: 1.5; opacity: .72; }
      .football-trend-betting-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: .7rem;
      }
      .football-trend-betting-card {
        display: grid;
        gap: .28rem;
        padding: .78rem .82rem;
        border: 1px solid rgba(142, 125, 255, .25);
        border-radius: 14px;
        background: rgba(16, 12, 47, .42);
      }
      .football-trend-betting-card small { opacity: .74; }
      .football-trend-betting-card strong { font-size: 1.08rem; }
      .football-trend-betting-card span { font-size: .76rem; line-height: 1.45; opacity: .82; }
      .football-trend-controls {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.8rem;
      }
      .football-trend-field { display: grid; gap: 0.42rem; font-size: 0.78rem; font-weight: 800; }
      .football-trend-field[hidden] { display: none !important; }
      .football-trend-field select,
      .football-trend-field input { width: 100%; }
      .football-trend-summary {
        margin: 0;
        padding: 0.72rem 0.85rem;
        border-left: 3px solid rgba(190, 154, 255, 0.72);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.025);
        font-size: 0.82rem;
        line-height: 1.55;
      }
      .football-trend-card-meta {
        display: grid;
        gap: 0.38rem;
        margin-top: 0.7rem;
        padding-top: 0.65rem;
        border-top: 1px solid rgba(176, 145, 255, 0.16);
      }
      .football-trend-detail { display: grid; gap: 0.18rem; font-size: 0.72rem; line-height: 1.35; }
      .football-trend-delta { opacity: 0.72; }
      .football-trend-state { font-size: 0.74rem; }
      .football-trend-detail.is-up .football-trend-state { color: #baffd4; }
      .football-trend-detail.is-down .football-trend-state { color: #ffc0ca; }
      .football-trend-detail.is-flat .football-trend-state { color: #e4dcff; }
      .football-trend-detail.is-unknown .football-trend-state { color: #ffe0a6; }
      .football-trend-no-compare { font-size: 0.72rem; line-height: 1.4; opacity: 0.68; }
      @media (max-width: 980px) {
        .football-trend-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .football-trend-betting-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 620px) {
        .football-trend-heading { display: grid; align-items: stretch; }
        .football-trend-toggle { justify-self: start; }
        .football-trend-controls { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureControls() {
    if (byId("football-performance-observer")) return;
    const grid = byId("football-kpis");
    if (!grid) return;

    const latest = latestVerifiedDate();
    const endMs = dateEnd(latest) ?? Date.now();
    const start = formatDateInput(endMs - 29 * DAY_MS);
    const parent = grid.parentElement;
    if (!parent) return;
    const panel = createElement("details", "football-trend-panel football-stats-subsection");
    panel.id = "football-performance-observer";

    const heading = createElement("summary", "football-trend-heading");
    const headingCopy = createElement("div", "football-trend-heading-copy");
    headingCopy.append(
      createElement("h3", "", "滾動績效觀察"),
      createElement("p", "", "可依單日、日期區間、截至日期、最近已核對場次或最近天數回看；同一區間也會累計運彩總成本、總損益與 ROI。")
    );
    const toggle = createElement("span", "football-trend-toggle", "展開");
    heading.append(headingCopy, toggle);

    const controls = createElement("div", "football-trend-controls");
    controls.append(
      createSelectField("觀察方式", "football-trend-mode", [
        ["all", "全期間"],
        ["day", "指定單日"],
        ["range", "自訂日期區間"],
        ["asof", "截至某一天"],
        ["matches", "最近 N 場已核對"],
        ["days", "最近 N 天"],
      ]),
      createDateField("觀察日期／截止日", "football-trend-anchor", latest, "day asof matches days"),
      createDateField("開始日期", "football-trend-start", start, "range"),
      createDateField("結束日期", "football-trend-end", latest, "range"),
      createSelectField("滾動場數", "football-trend-count", [["5", "最近 5 場"], ["10", "最近 10 場"], ["20", "最近 20 場"], ["30", "最近 30 場"]], "matches"),
      createSelectField("滾動天數", "football-trend-days", [["7", "最近 7 天"], ["30", "最近 30 天"], ["60", "最近 60 天"], ["90", "最近 90 天"]], "days"),
      createSelectField("比較基準", "football-trend-compare", [["previous", "前一相同區間"], ["rest", "其餘歷史資料"], ["none", "不比較"]])
    );

    const summary = createElement("p", "football-trend-summary");
    summary.id = "football-trend-summary";
    const body = createElement("div", "football-trend-body");
    body.id = "football-performance-body";

    parent.insertBefore(panel, grid);
    body.append(controls, summary, grid);
    panel.append(heading, body);
    panel.addEventListener("toggle", () => {
      toggle.textContent = panel.open ? "收合" : "展開";
    });
    ensureBettingPerformanceSummary();

    controls.addEventListener("change", () => {
      refreshFieldVisibility();
      scheduleRender(false);
    });
    controls.addEventListener("input", () => scheduleRender(false));
    refreshFieldVisibility();
  }

  function observeRenders() {
    const grid = byId("football-kpis");
    const body = byId("football-records-body");
    if (grid) {
      gridObserver = new MutationObserver(() => scheduleRender(false));
      gridObserver.observe(grid, { childList: true });
    }
    if (body) {
      recordsObserver = new MutationObserver(() => scheduleRender(true));
      recordsObserver.observe(body, { childList: true });
    }

    byId("football-evaluation-form")?.addEventListener("submit", () => window.setTimeout(() => scheduleRender(true), 0));
    byId("football-reading-form")?.addEventListener("submit", () => window.setTimeout(() => scheduleRender(true), 0));
    byId("football-import-json")?.addEventListener("change", () => window.setTimeout(() => scheduleRender(true), 0));
    window.addEventListener("football-energy-render", () => scheduleRender(true));
  }

  function init() {
    injectStyles();
    buildIndexes();
    ensureControls();
    observeRenders();
    scheduleRender(false);
  }

  init();
})();
