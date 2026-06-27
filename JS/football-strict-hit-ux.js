// ==============================
// football-strict-hit-ux.js
// 世足賽事驗證：嚴格比分制命中顯示
// ==============================
// renderRows：O(r) 時間／O(r) DOM 空間。
// renderCell：O(1) 時間／O(1) 額外空間。
//
// 原版：主隊或客隊其中一邊進球數相同，也會出現單邊 Bingo。
// 本版：只保留「單張賽果、攻防賽果、確切比分」三個可計分項目；
//       單邊數字相同只作誤差資訊，不計命中。
// ==============================

(function initFootballStrictHitUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  let observer = null;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function makeBadge(label, hit, title) {
    const badge = document.createElement("span");
    badge.className = `football-hit-badge ${hit ? "is-hit" : "is-miss"}`;
    badge.textContent = label;
    if (title) badge.title = title;
    return badge;
  }

  function getState(record, evaluation) {
    if (!evaluation || evaluation.type === "legacy5") {
      const hits = Number(evaluation?.hitCount || 0);
      if (hits >= 5) return { key: "perfect", label: "完全命中" };
      if (hits >= 3) return { key: "strong", label: `${hits}／5 命中` };
      if (hits >= 1) return { key: "partial", label: `${hits}／5 命中` };
      return { key: "none", label: "全部未中" };
    }

    const mode = core.getMode(record);
    const hasDirect = core.modeIncludesDirect(mode);
    const hasStructure = core.modeIncludesStructure(mode);
    const directHit = hasDirect && evaluation.directResultHit;
    const structureResultHit = hasStructure && evaluation.structureResultHit;
    const exactHit = hasStructure && evaluation.structureExactHit;

    if (exactHit && (!hasDirect || directHit)) {
      return { key: "perfect", label: "完全命中" };
    }
    if (hasDirect && hasStructure && directHit && structureResultHit) {
      return { key: "strong", label: "兩模型賽果皆中" };
    }
    if ((!hasDirect && structureResultHit) || (!hasStructure && directHit)) {
      return { key: "strong", label: "賽果命中" };
    }
    if (directHit || structureResultHit) {
      return { key: "partial", label: "部分命中" };
    }
    return { key: "none", label: "全部未中" };
  }

  function renderLegacy(cell, row, evaluation) {
    const state = getState(null, evaluation);
    const wrapper = document.createElement("div");
    wrapper.className = "football-hit-visual";

    const summary = document.createElement("strong");
    summary.className = `football-hit-summary is-${state.key}`;
    summary.textContent = state.label;

    const detail = document.createElement("span");
    detail.className = "football-hit-detail";
    detail.textContent = "舊版五牌位核對";

    wrapper.append(summary, detail);
    cell.replaceChildren(wrapper);
    row.classList.add(`is-hit-${state.key}`);
  }

  /** 嚴格比分顯示：O(1) 時間／O(1) 額外空間。 */
  function renderCell(row, record) {
    const cell = row.children[4];
    if (!cell || !record?.actual) return;

    const evaluation = core.calculateEvaluation(record);
    if (!evaluation) return;

    row.classList.remove("is-hit-perfect", "is-hit-strong", "is-hit-partial", "is-hit-none");
    if (evaluation.type === "legacy5") {
      renderLegacy(cell, row, evaluation);
      return;
    }

    const mode = core.getMode(record);
    const state = getState(record, evaluation);
    const wrapper = document.createElement("div");
    wrapper.className = "football-hit-visual";

    const summary = document.createElement("strong");
    summary.className = `football-hit-summary is-${state.key}`;
    summary.textContent = state.label;

    const badges = document.createElement("div");
    badges.className = "football-hit-badges";

    if (core.modeIncludesDirect(mode)) {
      badges.appendChild(makeBadge(
        "單張賽果",
        evaluation.directResultHit,
        `預測 ${core.data.resultLabels[record.prediction.directResult]}；實際 ${core.data.resultLabels[evaluation.actualResult]}`
      ));
    }

    if (core.modeIncludesStructure(mode)) {
      badges.append(
        makeBadge(
          "攻防賽果",
          evaluation.structureResultHit,
          `預測 ${core.data.resultLabels[evaluation.structureResult]}；實際 ${core.data.resultLabels[evaluation.actualResult]}`
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
    if (core.modeIncludesStructure(mode)) {
      const oneSideSame = Boolean(evaluation.structureHomeGoalMatched || evaluation.structureAwayGoalMatched) && !evaluation.structureExactHit;
      detail.textContent = oneSideSame
        ? `預測 ${record.prediction.structureHomeGoals}：${record.prediction.structureAwayGoals}／實際 ${record.actual.homeGoals}：${record.actual.awayGoals}；單邊數字相同不計命中。`
        : `預測 ${record.prediction.structureHomeGoals}：${record.prediction.structureAwayGoals}／實際 ${record.actual.homeGoals}：${record.actual.awayGoals}；總誤差 ${evaluation.structureAbsoluteError} 球。`;
    } else {
      detail.textContent = "直接賽果模型核對";
    }

    wrapper.append(summary, badges, detail);
    cell.replaceChildren(wrapper);
    row.classList.add(`is-hit-${state.key}`);
  }

  /** 單次掃描全部列：O(r) 時間／O(r) DOM 空間。 */
  function renderRows() {
    if (applying) return;
    const body = byId("football-records-body");
    if (!body) return;

    applying = true;
    observer?.disconnect();
    try {
      const records = core
        .getRecords()
        .sort((a, b) => String(b.match?.kickoff || "").localeCompare(String(a.match?.kickoff || "")));
      Array.from(body.children).forEach((row, index) => {
        const record = records[index];
        if (record?.actual) renderCell(row, record);
      });
    } finally {
      applying = false;
      observer?.observe(body, { childList: true });
    }
  }

  function init() {
    const body = byId("football-records-body");
    if (!body) return;
    observer = new MutationObserver(() => window.requestAnimationFrame(renderRows));
    observer.observe(body, { childList: true });
    renderRows();
    byId("football-evaluation-form")?.addEventListener("submit", () => window.setTimeout(renderRows, 0));
  }

  init();
})();
