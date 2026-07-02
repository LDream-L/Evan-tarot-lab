// ==============================
// football-direct-energy-ux.js
// 世足賽事驗證 v1.6.0：單張整體能量顯示與匯出
// ==============================
// 主要函式複雜度：
// - decorateRows：O(r) 時間／O(1) 額外空間。
// - decorateKpis：O(k) 時間／O(1) 額外空間，k 為固定 KPI 數。
// - buildCsv：O(r) 時間／O(r) 輸出空間。
//
// 更快替代方案比較：
// - 重建整張紀錄表：會重複既有淘汰賽與工作流渲染。
// - 本版：只更新單張模型相關欄位，保留既有 DOM 與事件。
// ==============================

(function initFootballDirectEnergyUx() {
  "use strict";

  const core = window.FootballLabCore;
  const energy = window.FootballDirectEnergy;
  if (!core || !energy) return;

  let bodyObserver = null;
  let kpiObserver = null;
  let scoreObserver = null;
  let bodyApplying = false;
  let kpiApplying = false;
  let scoreApplying = false;
  let renderToken = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function formatRate(hits, total) {
    return total ? `${Math.round((hits / total) * 1000) / 10}%` : "—";
  }

  function goalBandLabel(value, short = false) {
    const item = energy.goalBands[value];
    return item ? (short ? item.short : item.label) : "—";
  }

  function drawTendencyLabel(value, short = false) {
    const item = energy.drawTendencies[value];
    return item ? (short ? item.short : item.label) : "—";
  }

  function actualDrawLabel(value) {
    return value === "draw" ? "和局" : value === "decisive" ? "非和局" : "—";
  }

  function energyPredictionText(record) {
    return `總進球 ${goalBandLabel(record.prediction.directGoalBand, true)}｜${drawTendencyLabel(record.prediction.directDrawTendency, true)}`;
  }

  function setKpiCard(card, label, value, detail) {
    if (!card) return;
    const small = card.querySelector("small");
    const strong = card.querySelector("strong");
    const span = card.querySelector("span");
    if (small) small.textContent = label;
    if (strong) strong.textContent = value;
    if (span) span.textContent = detail;
  }

  function createKpiCard(label, value, detail, key) {
    const card = document.createElement("article");
    card.className = "football-kpi";
    card.dataset.energyKpi = key;
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = detail;
    card.append(small, strong, span);
    return card;
  }

  /** 固定 KPI 數量更新：O(k) 時間／O(1) 額外空間。 */
  function decorateKpis() {
    if (kpiApplying) return;
    const grid = byId("football-kpis");
    if (!grid || !grid.children.length) return;

    kpiApplying = true;
    kpiObserver?.disconnect();
    try {
      const stats = core.calculateStats();
      const cards = Array.from(grid.querySelectorAll(".football-kpi"));
      const findCard = (label) => cards.find((card) => card.querySelector("small")?.textContent === label);

      let directCard = findCard("單張賽果") || findCard("單張總進球區間") || findCard("舊版單張賽果");
      grid.querySelectorAll("[data-energy-kpi]").forEach((card) => card.remove());

      if (stats.directGoalBandEligible > 0) {
        if (!directCard) {
          directCard = createKpiCard("", "", "", "goal-band-base");
          grid.appendChild(directCard);
        }
        setKpiCard(
          directCard,
          "單張總進球區間",
          formatRate(stats.directGoalBandHits, stats.directGoalBandEligible),
          `${stats.directGoalBandHits}／${stats.directGoalBandEligible}`
        );

        const drawCard = createKpiCard(
          "單張和局傾向",
          formatRate(stats.directDrawHits, stats.directDrawEligible),
          `${stats.directDrawHits}／${stats.directDrawEligible}`,
          "draw-tendency"
        );
        directCard.insertAdjacentElement("afterend", drawCard);

        if (stats.directLegacyEligible > 0) {
          drawCard.insertAdjacentElement("afterend", createKpiCard(
            "舊版單張賽果",
            formatRate(stats.directLegacyHits, stats.directLegacyEligible),
            `${stats.directLegacyHits}／${stats.directLegacyEligible}`,
            "legacy-direct"
          ));
        }
      } else if (directCard) {
        setKpiCard(
          directCard,
          "舊版單張賽果",
          formatRate(stats.directLegacyHits, stats.directLegacyEligible),
          `${stats.directLegacyHits}／${stats.directLegacyEligible}`
        );
      }

      const structureResult = findCard("攻防推導賽果");
      setKpiCard(
        structureResult,
        "攻防推導賽果",
        formatRate(stats.structureResultHits, stats.structureEligible),
        `${stats.structureResultHits}／${stats.structureEligible}`
      );

      const structureExact = findCard("攻防確切比分");
      const mae = stats.structureEligible
        ? Math.round((stats.structureErrorTotal / stats.structureEligible) * 100) / 100
        : null;
      setKpiCard(
        structureExact,
        "攻防確切比分",
        formatRate(stats.structureExactHits, stats.structureEligible),
        mae == null ? "—" : `平均總誤差 ${mae} 球`
      );

      const agreement = findCard("雙模型一致率") || findCard("雙模型和局判斷一致率");
      setKpiCard(
        agreement,
        "雙模型和局判斷一致率",
        formatRate(stats.dualAgreements, stats.dualEligible),
        `${stats.dualAgreements}／${stats.dualEligible}`
      );

      const market = findCard("市場熱門基準");
      setKpiCard(
        market,
        "市場熱門基準",
        formatRate(stats.marketHits, stats.marketEligible),
        `${stats.marketHits}／${stats.marketEligible}`
      );
    } finally {
      kpiApplying = false;
      kpiObserver?.observe(grid, { childList: true });
    }
  }

  function makeBadge(label, hit, title) {
    const badge = document.createElement("span");
    badge.className = `football-hit-badge ${hit ? "is-hit" : "is-miss"}`;
    badge.textContent = label;
    if (title) badge.title = title;
    return badge;
  }

  function getOverallState(checks) {
    const total = checks.length;
    const hits = checks.filter(Boolean).length;
    if (total > 0 && hits === total) return { key: "perfect", label: "完全命中" };
    if (hits === 0) return { key: "none", label: "全部未中" };
    if (hits >= Math.ceil(total * 0.6)) return { key: "strong", label: `${hits}／${total} 命中` };
    return { key: "partial", label: `${hits}／${total} 命中` };
  }

  /** 單筆新版紀錄命中顯示：O(1) 時間／O(1) 額外空間。 */
  function renderEnergyHitCell(row, record) {
    const cell = row.children[4];
    if (!cell || !record.actual) return;
    const evaluation = core.calculateEvaluation(record);
    if (!evaluation) return;

    const mode = core.getMode(record);
    const checks = [evaluation.directGoalBandHit, evaluation.directDrawTendencyHit];
    if (core.modeIncludesStructure(mode)) {
      checks.push(
        evaluation.structureResultHit,
        evaluation.structureHomeGoalHit,
        evaluation.structureAwayGoalHit,
        evaluation.structureExactHit
      );
    }
    const state = getOverallState(checks);

    row.classList.remove("is-hit-perfect", "is-hit-strong", "is-hit-partial", "is-hit-none");
    row.classList.add(`is-hit-${state.key}`);

    const wrapper = document.createElement("div");
    wrapper.className = "football-hit-visual";

    const summary = document.createElement("strong");
    summary.className = `football-hit-summary is-${state.key}`;
    summary.textContent = state.label;

    const badges = document.createElement("div");
    badges.className = "football-hit-badges";
    badges.append(
      makeBadge(
        "單張總進球",
        evaluation.directGoalBandHit,
        `預測 ${goalBandLabel(record.prediction.directGoalBand)}；實際 ${evaluation.directActualTotalGoals} 球（${goalBandLabel(evaluation.directActualGoalBand)}）`
      ),
      makeBadge(
        "單張和局傾向",
        evaluation.directDrawTendencyHit,
        `預測 ${drawTendencyLabel(record.prediction.directDrawTendency)}；實際 ${actualDrawLabel(evaluation.directActualDrawTendency)}`
      )
    );

    if (core.modeIncludesStructure(mode)) {
      badges.append(
        makeBadge(
          "攻防賽果",
          evaluation.structureResultHit,
          `預測 ${core.data.resultLabels[evaluation.structureResult]}；實際 ${core.data.resultLabels[evaluation.actualResult]}`
        ),
        makeBadge(
          "主隊進球",
          evaluation.structureHomeGoalHit,
          `預測 ${record.prediction.structureHomeGoals}；實際 ${record.actual.homeGoals}`
        ),
        makeBadge(
          "客隊進球",
          evaluation.structureAwayGoalHit,
          `預測 ${record.prediction.structureAwayGoals}；實際 ${record.actual.awayGoals}`
        ),
        makeBadge(
          "確切比分",
          evaluation.structureExactHit,
          `預測 ${record.prediction.structureHomeGoals}：${record.prediction.structureAwayGoals}；實際 ${record.actual.homeGoals}：${record.actual.awayGoals}`
        )
      );
    }

    const detail = document.createElement("span");
    detail.className = "football-hit-detail";
    detail.textContent = core.modeIncludesStructure(mode)
      ? `單張核對整體能量；攻防比分總誤差 ${evaluation.structureAbsoluteError} 球。`
      : "單張只核對總進球區間與和局傾向。";

    wrapper.append(summary, badges, detail);
    cell.replaceChildren(wrapper);
  }

  function updateStandardPredictionCell(cell, record) {
    const lines = Array.from(cell.querySelectorAll(".football-prediction-line"));
    const line = lines.find((item) => item.querySelector(".football-prediction-kind")?.textContent === "單張");
    const value = line?.querySelector(".football-prediction-value");
    if (value) value.textContent = energyPredictionText(record);
  }

  function updateKnockoutPredictionCell(cell, record) {
    const regulation = cell.querySelector(".football-stage-block.is-regulation");
    if (!regulation) return;
    const lines = Array.from(regulation.querySelectorAll(".football-stage-model-line"));
    const line = lines.find((item) => item.querySelector(".football-stage-model-label")?.textContent === "單張");
    const value = line?.querySelector(".football-stage-model-value");
    if (value) value.textContent = energyPredictionText(record);
  }

  function decorateRecordRow(row, record) {
    if (!row || !energy.isEnergyRecord(record)) return;

    const modeBadge = row.querySelector(".football-record-mode");
    if (modeBadge) {
      modeBadge.textContent = core.getMode(record) === "direct" ? "單張能量" : "雙模型";
    }

    row.querySelectorAll(".football-compact-card").forEach((item) => {
      const label = item.querySelector(".football-compact-card-label");
      if (label?.textContent === "結果牌：") label.textContent = "能量牌：";
    });

    const predictionCell = row.children[2];
    if (predictionCell) {
      updateStandardPredictionCell(predictionCell, record);
      updateKnockoutPredictionCell(predictionCell, record);
    }

    renderEnergyHitCell(row, record);
  }

  /** 按既有排序映射紀錄列：O(r) 時間／O(1) 額外空間。 */
  function decorateRows() {
    if (bodyApplying) return;
    const body = byId("football-records-body");
    if (!body) return;

    bodyApplying = true;
    bodyObserver?.disconnect();
    try {
      const records = core
        .getRecords()
        .sort((a, b) => String(b.match?.kickoff || "").localeCompare(String(a.match?.kickoff || "")));
      Array.from(body.children).forEach((row, index) => decorateRecordRow(row, records[index]));
    } finally {
      bodyApplying = false;
      bodyObserver?.observe(body, { childList: true });
    }
  }

  function createScoreItem(label, hit, detail) {
    const item = document.createElement("article");
    item.className = `football-score-item ${hit ? "is-hit" : "is-miss"}`;
    item.dataset.energyScore = label;
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = hit ? "命中" : "未中";
    const span = document.createElement("span");
    span.textContent = detail;
    item.append(small, strong, span);
    return item;
  }

  function fullPredictionText(record) {
    const parts = [`單張能量：${energyPredictionText(record)}`];
    if (core.modeIncludesStructure(core.getMode(record))) {
      const h = record.prediction.structureHomeGoals;
      const a = record.prediction.structureAwayGoals;
      parts.push(`攻防：${h}：${a}（${core.data.resultLabels[core.getResult(h, a)]}）`);
    }
    return parts.join("｜");
  }

  function decorateEvaluationSummary(record) {
    const summary = byId("football-evaluation-summary");
    if (!summary) return;
    summary.querySelectorAll(".football-summary-item").forEach((item) => {
      if (item.querySelector("small")?.textContent === "鎖定預測") {
        const value = item.querySelector("strong");
        if (value) value.textContent = fullPredictionText(record);
      }
      if (item.querySelector("small")?.textContent === "模式") {
        const value = item.querySelector("strong");
        if (value) value.textContent = core.data.modeLabels[core.getMode(record)] || value.textContent;
      }
    });
  }

  /** 只替換單張核對項目：O(k) 時間／O(1) 額外空間。 */
  function decorateScorecard() {
    if (scoreApplying) return;
    const scorecard = byId("football-scorecard");
    const recordId = byId("football-evaluation-id")?.value;
    const record = recordId ? core.getRecord(recordId) : null;
    if (!scorecard || !energy.isEnergyRecord(record) || !record.actual) return;

    scoreApplying = true;
    scoreObserver?.disconnect();
    try {
      const evaluation = core.calculateEvaluation(record);
      const grid = scorecard.querySelector(".football-score-grid");
      if (!grid || !evaluation) return;

      grid.querySelectorAll("[data-energy-score]").forEach((item) => item.remove());
      Array.from(grid.querySelectorAll(".football-score-item")).forEach((item) => {
        if (item.querySelector("small")?.textContent === "單張結果") item.remove();
      });

      const fragment = document.createDocumentFragment();
      fragment.append(
        createScoreItem(
          "單張總進球區間",
          evaluation.directGoalBandHit,
          `預測 ${goalBandLabel(record.prediction.directGoalBand)}／實際 ${evaluation.directActualTotalGoals} 球（${goalBandLabel(evaluation.directActualGoalBand)}）`
        ),
        createScoreItem(
          "單張和局傾向",
          evaluation.directDrawTendencyHit,
          `預測 ${drawTendencyLabel(record.prediction.directDrawTendency)}／實際 ${actualDrawLabel(evaluation.directActualDrawTendency)}`
        )
      );
      grid.prepend(fragment);

      const title = scorecard.querySelector("h4");
      if (title && core.getMode(record) === "direct") title.textContent = "單張整體能量模式核對";
      decorateEvaluationSummary(record);
    } finally {
      scoreApplying = false;
      scoreObserver?.observe(scorecard, { childList: true, subtree: true });
    }
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  /** 新版 CSV 保留舊欄位並加入單張能量欄位：O(r) 時間／O(r) 空間。 */
  function buildCsv() {
    const headers = [
      "id", "modelVersion", "mode", "competition", "stage", "kickoff", "infoState", "homeTeam", "awayTeam",
      "cardSource", "homeOdds", "drawOdds", "awayOdds", "cardsJson", "directModel", "directGoalBand",
      "directGoalBandLabel", "directDrawTendency", "directDrawTendencyLabel", "legacyDirectResult", "directConfidence",
      "directNotes", "structureHomeGoals", "structureAwayGoals", "structureResult", "structureConfidence", "structureNotes",
      "advancePrediction", "knockoutPredictionJson", "lockedAt", "actualHomeGoals", "actualAwayGoals", "actualTotalGoals",
      "extraHomeGoals", "extraAwayGoals", "actualAdvance", "knockoutActualJson", "actualNotes", "reviewAnalysis",
      "directGoalBandHit", "directDrawTendencyHit", "legacyDirectResultHit", "structureResultHit", "structureHomeGoalHit",
      "structureAwayGoalHit", "structureExactHit", "structureAbsoluteError", "modelsAgree", "marketFavorite"
    ];

    const rows = core.getRecords().map((record) => {
      const evaluation = core.calculateEvaluation(record);
      const mode = core.getMode(record);
      const structureResult = core.modeIncludesStructure(mode)
        ? core.getResult(record.prediction.structureHomeGoals, record.prediction.structureAwayGoals)
        : "";
      const odds = record.match.odds || {};
      const marketFavorite = [odds.home, odds.draw, odds.away].every(Number.isFinite)
        ? [["H", odds.home], ["D", odds.draw], ["A", odds.away]].sort((a, b) => a[1] - b[1])[0][0]
        : "";
      const isEnergy = energy.isEnergyRecord(record);

      return [
        record.id,
        record.modelVersion,
        mode,
        record.match.competition,
        record.match.stage,
        record.match.kickoff,
        record.match.infoState,
        record.match.homeTeam,
        record.match.awayTeam,
        record.match.cardSource || "legacy",
        odds.home,
        odds.draw,
        odds.away,
        JSON.stringify(record.cards),
        isEnergy ? record.prediction.directModel : "legacy-result",
        isEnergy ? record.prediction.directGoalBand : "",
        isEnergy ? goalBandLabel(record.prediction.directGoalBand) : "",
        isEnergy ? record.prediction.directDrawTendency : "",
        isEnergy ? drawTendencyLabel(record.prediction.directDrawTendency) : "",
        isEnergy ? "" : record.prediction.directResult,
        record.prediction.directConfidence,
        record.prediction.directNotes,
        record.prediction.structureHomeGoals,
        record.prediction.structureAwayGoals,
        structureResult,
        record.prediction.structureConfidence,
        record.prediction.structureNotes,
        record.prediction.advance,
        JSON.stringify(record.prediction.knockout || null),
        record.lockedAt,
        record.actual?.homeGoals,
        record.actual?.awayGoals,
        record.actual ? Number(record.actual.homeGoals) + Number(record.actual.awayGoals) : "",
        record.actual?.extraHomeGoals,
        record.actual?.extraAwayGoals,
        record.actual?.advance,
        JSON.stringify(record.actual?.knockout || null),
        record.actual?.notes,
        record.actual?.reviewAnalysis,
        isEnergy ? evaluation?.directGoalBandHit : "",
        isEnergy ? evaluation?.directDrawTendencyHit : "",
        isEnergy ? "" : evaluation?.directResultHit,
        evaluation?.structureResultHit,
        evaluation?.structureHomeGoalHit,
        evaluation?.structureAwayGoalHit,
        evaluation?.structureExactHit,
        evaluation?.structureAbsoluteError,
        evaluation?.modelsAgree,
        marketFavorite,
      ].map(csvEscape).join(",");
    });

    return `\uFEFF${[headers.map(csvEscape).join(","), ...rows].join("\n")}`;
  }

  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindCsvExport() {
    byId("football-export-csv")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadFile(
        `football_tarot_records_${new Date().toISOString().slice(0, 10)}.csv`,
        buildCsv(),
        "text/csv;charset=utf-8"
      );
    }, true);
  }

  function scheduleRender() {
    renderToken += 1;
    const token = renderToken;
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (token !== renderToken) return;
          decorateKpis();
          decorateRows();
          decorateScorecard();
        });
      });
    }, 0);
  }

  function init() {
    const body = byId("football-records-body");
    const kpis = byId("football-kpis");
    const scorecard = byId("football-scorecard");

    if (body) {
      bodyObserver = new MutationObserver(scheduleRender);
      bodyObserver.observe(body, { childList: true });
    }
    if (kpis) {
      kpiObserver = new MutationObserver(scheduleRender);
      kpiObserver.observe(kpis, { childList: true });
    }
    if (scorecard) {
      scoreObserver = new MutationObserver(scheduleRender);
      scoreObserver.observe(scorecard, { childList: true, subtree: true });
    }

    byId("football-evaluation-form")?.addEventListener("submit", scheduleRender);
    byId("football-records-body")?.addEventListener("click", scheduleRender);
    window.addEventListener("football-energy-render", scheduleRender);
    bindCsvExport();
    scheduleRender();
  }

  init();
})();
