// ==============================
// football-hit-ux.js
// 世足賽事驗證：已驗證紀錄命中視覺化
// ==============================
// 主要函式複雜度：
// - renderHitRows：O(r)
// - renderHitCell：O(1)
// 空間複雜度：O(r) DOM
//
// 更快替代方案比較：
// - 原版：把所有命中結果串成文字，閱讀時必須逐字比對。
// - 本版：一次計算後建立固定數量標籤，每場最多 5 個，掃視即可辨認。
// ==============================

(function initFootballHitUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  let observer = null;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function injectStyles() {
    if (byId("football-hit-ux-style")) return;

    const style = document.createElement("style");
    style.id = "football-hit-ux-style";
    style.textContent = `
      #football-records-body tr {
        transition: background 160ms ease, box-shadow 160ms ease;
      }
      #football-records-body tr.is-hit-perfect {
        box-shadow: inset 4px 0 0 rgba(94, 230, 150, 0.95);
        background: rgba(55, 154, 99, 0.055);
      }
      #football-records-body tr.is-hit-strong {
        box-shadow: inset 4px 0 0 rgba(151, 226, 104, 0.9);
        background: rgba(116, 163, 60, 0.045);
      }
      #football-records-body tr.is-hit-partial {
        box-shadow: inset 4px 0 0 rgba(255, 190, 92, 0.9);
        background: rgba(194, 130, 43, 0.04);
      }
      #football-records-body tr.is-hit-none {
        box-shadow: inset 4px 0 0 rgba(255, 106, 126, 0.82);
        background: rgba(178, 54, 74, 0.035);
      }
      .football-hit-visual {
        display: grid;
        gap: 0.52rem;
        min-width: 150px;
      }
      .football-hit-summary {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 0.26rem 0.65rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 900;
        line-height: 1.35;
      }
      .football-hit-summary.is-perfect {
        color: #baffd4;
        border: 1px solid rgba(94, 230, 150, 0.6);
        background: rgba(55, 154, 99, 0.19);
      }
      .football-hit-summary.is-strong {
        color: #dcffb7;
        border: 1px solid rgba(151, 226, 104, 0.56);
        background: rgba(116, 163, 60, 0.16);
      }
      .football-hit-summary.is-partial {
        color: #ffe1a6;
        border: 1px solid rgba(255, 190, 92, 0.58);
        background: rgba(194, 130, 43, 0.15);
      }
      .football-hit-summary.is-none {
        color: #ffbdc7;
        border: 1px solid rgba(255, 106, 126, 0.55);
        background: rgba(178, 54, 74, 0.16);
      }
      .football-hit-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 0.36rem;
      }
      .football-hit-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        padding: 0.22rem 0.5rem;
        border-radius: 8px;
        font-size: 0.76rem;
        font-weight: 800;
        line-height: 1.35;
        white-space: nowrap;
      }
      .football-hit-badge::before {
        font-size: 0.74rem;
        font-weight: 1000;
      }
      .football-hit-badge.is-hit {
        color: #c8ffdc;
        border: 1px solid rgba(94, 230, 150, 0.45);
        background: rgba(55, 154, 99, 0.14);
      }
      .football-hit-badge.is-hit::before {
        content: "✓";
      }
      .football-hit-badge.is-miss {
        color: #ffc7cf;
        border: 1px solid rgba(255, 106, 126, 0.42);
        background: rgba(178, 54, 74, 0.12);
      }
      .football-hit-badge.is-miss::before {
        content: "✕";
      }
      .football-hit-detail {
        display: block;
        font-size: 0.75rem;
        line-height: 1.45;
        opacity: 0.72;
      }
      @media (max-width: 900px) {
        .football-hit-visual { min-width: 130px; }
      }
    `;
    document.head.appendChild(style);
  }

  function makeBadge(label, hit, title) {
    const badge = document.createElement("span");
    badge.className = `football-hit-badge ${hit ? "is-hit" : "is-miss"}`;
    badge.textContent = label;
    if (title) badge.title = title;
    return badge;
  }

  function getOverallState(record, evaluation) {
    if (!evaluation || evaluation.type === "legacy5") {
      const legacyHits = Number(evaluation?.hitCount || 0);
      if (legacyHits >= 5) return { key: "perfect", label: "完全命中" };
      if (legacyHits >= 3) return { key: "strong", label: `${legacyHits}／5 命中` };
      if (legacyHits >= 1) return { key: "partial", label: `${legacyHits}／5 命中` };
      return { key: "none", label: "全部未中" };
    }

    const mode = core.getMode(record);
    const hasDirect = core.modeIncludesDirect(mode);
    const hasStructure = core.modeIncludesStructure(mode);
    const resultHits = [
      hasDirect ? evaluation.directResultHit : null,
      hasStructure ? evaluation.structureResultHit : null,
    ].filter((value) => value !== null);
    const resultHitCount = resultHits.filter(Boolean).length;

    if (hasStructure && evaluation.structureExactHit && (!hasDirect || evaluation.directResultHit)) {
      return { key: "perfect", label: "完全命中" };
    }
    if (resultHits.length > 0 && resultHitCount === resultHits.length) {
      return { key: "strong", label: resultHits.length === 2 ? "兩模型賽果皆中" : "賽果命中" };
    }
    if (resultHitCount > 0 || (hasStructure && (evaluation.structureHomeGoalHit || evaluation.structureAwayGoalHit))) {
      return { key: "partial", label: "部分命中" };
    }
    return { key: "none", label: "全部未中" };
  }

  function renderLegacy(cell, evaluation) {
    const wrapper = document.createElement("div");
    wrapper.className = "football-hit-visual";
    const state = getOverallState(null, evaluation);
    const summary = document.createElement("strong");
    summary.className = `football-hit-summary is-${state.key}`;
    summary.textContent = state.label;
    const detail = document.createElement("span");
    detail.className = "football-hit-detail";
    detail.textContent = "舊版五牌位核對";
    wrapper.append(summary, detail);
    cell.replaceChildren(wrapper);
    return state;
  }

  /** 每場建立最多 5 個固定標籤：O(1) 時間／O(1) 額外空間。 */
  function renderHitCell(row, record) {
    const cell = row.children[4];
    if (!cell || !record?.actual) return;

    const evaluation = core.calculateEvaluation(record);
    if (!evaluation) return;

    row.classList.remove("is-hit-perfect", "is-hit-strong", "is-hit-partial", "is-hit-none");

    if (evaluation.type === "legacy5") {
      const state = renderLegacy(cell, evaluation);
      row.classList.add(`is-hit-${state.key}`);
      return;
    }

    const mode = core.getMode(record);
    const wrapper = document.createElement("div");
    wrapper.className = "football-hit-visual";

    const state = getOverallState(record, evaluation);
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
        )
      );
    }

    const detail = document.createElement("span");
    detail.className = "football-hit-detail";
    detail.textContent = core.modeIncludesStructure(mode)
      ? `攻防比分總誤差：${evaluation.structureAbsoluteError} 球`
      : "直接賽果模型核對";

    wrapper.append(summary, badges, detail);
    cell.replaceChildren(wrapper);
    row.classList.add(`is-hit-${state.key}`);
  }

  /** 單次掃描表格：O(r) 時間／O(r) DOM 空間。 */
  function renderHitRows() {
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
        if (record?.actual) renderHitCell(row, record);
      });
    } finally {
      applying = false;
      observer?.observe(body, { childList: true });
    }
  }

  function init() {
    injectStyles();
    const body = byId("football-records-body");
    if (!body) return;

    observer = new MutationObserver(() => window.requestAnimationFrame(renderHitRows));
    observer.observe(body, { childList: true });
    renderHitRows();

    byId("football-evaluation-form")?.addEventListener("submit", () => {
      window.setTimeout(renderHitRows, 0);
    });
  }

  init();
})();
