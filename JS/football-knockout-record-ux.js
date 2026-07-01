// 世足賽事驗證 v1.5.0｜淘汰賽分階段紀錄視覺化
// renderRows：O(r + p) 時間／O(p) DOM 空間，r=紀錄數、p=該場決勝階段數（最多 3）。
// 更快替代方案：直接讀取結構化 knockout 資料，不解析畫面文字或重複掃描牌面。
(function initFootballKnockoutRecordUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const STAGE_META = Object.freeze({
    regulation: { short: "90 分", title: "90 分鐘" },
    extraTime: { short: "延長", title: "延長賽 30 分鐘" },
    penalties: { short: "PK", title: "PK 大戰" },
  });

  let observer = null;
  let applying = false;
  let scheduleToken = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function resultLabel(result) {
    return core.data.resultLabels[result] || "—";
  }

  function teamName(record, result) {
    if (result === "H") return record.match.homeTeam;
    if (result === "A") return record.match.awayTeam;
    return "和局";
  }

  function stageLabel(stage) {
    return STAGE_META[stage]?.title || "—";
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function addModelLine(container, label, value, emphasis = false) {
    const line = createElement("div", `football-stage-model-line${emphasis ? " is-emphasis" : ""}`);
    line.append(
      createElement("span", "football-stage-model-label", label),
      createElement("strong", "football-stage-model-value", value)
    );
    container.appendChild(line);
  }

  function buildStageBadge(stage, isFinal) {
    const badge = createElement("span", `football-stage-route-badge${isFinal ? " is-final" : ""}`);
    badge.append(
      createElement("span", "football-stage-route-dot"),
      createElement("span", "", STAGE_META[stage]?.short || stage)
    );
    return badge;
  }

  /** 最多三個階段，O(p) 時間／O(p) DOM 空間。 */
  function buildRoute(route, resolvedBy) {
    const wrapper = createElement("div", "football-stage-route");
    (Array.isArray(route) && route.length ? route : [resolvedBy || "regulation"]).forEach((stage, index, stages) => {
      wrapper.appendChild(buildStageBadge(stage, stage === resolvedBy));
      if (index < stages.length - 1) wrapper.appendChild(createElement("span", "football-stage-route-arrow", "→"));
    });
    return wrapper;
  }

  function buildRegulationPrediction(record) {
    const prediction = record.prediction || {};
    const mode = core.getMode(record);
    const section = createElement("section", "football-stage-block is-regulation");
    section.appendChild(createElement("h5", "football-stage-title", "90 分鐘"));

    if (core.modeIncludesDirect(mode)) {
      addModelLine(section, "單張", resultLabel(prediction.directResult));
    }
    if (core.modeIncludesStructure(mode)) {
      const home = prediction.structureHomeGoals;
      const away = prediction.structureAwayGoals;
      const result = core.getResult(home, away);
      addModelLine(section, "攻防", `${home}：${away}｜${resultLabel(result)}`);
    }
    return section;
  }

  function buildExtraPrediction(record, extra) {
    const mode = core.getMode(record);
    const section = createElement("section", "football-stage-block is-extra-time");
    section.appendChild(createElement("h5", "football-stage-title", "延長賽 30 分鐘"));

    if (core.modeIncludesDirect(mode) && extra?.directResult) {
      addModelLine(section, "單張", resultLabel(extra.directResult));
    }
    if (core.modeIncludesStructure(mode)
      && Number.isInteger(extra?.structureHomeGoals)
      && Number.isInteger(extra?.structureAwayGoals)) {
      const result = core.getResult(extra.structureHomeGoals, extra.structureAwayGoals);
      addModelLine(
        section,
        "攻防",
        `新增 ${extra.structureHomeGoals}：${extra.structureAwayGoals}｜${resultLabel(result)}`
      );
    }
    return section;
  }

  function buildPenaltyPrediction(record, penalties) {
    const section = createElement("section", "football-stage-block is-penalties");
    section.appendChild(createElement("h5", "football-stage-title", "PK 大戰"));
    addModelLine(section, "勝者", `${teamName(record, penalties?.winner)}晉級`, true);
    return section;
  }

  function buildFinalBanner(record, knockout, type) {
    const final = createElement("div", `football-stage-final is-${type}`);
    const label = type === "prediction" ? "預測最終晉級" : "實際最終晉級";
    const advance = type === "prediction" ? knockout.finalAdvance : record.actual?.advance;
    const decidedBy = type === "prediction" ? knockout.resolvedBy : knockout.decidedBy;
    const prefix = type === "prediction" ? "預計於" : "實際於";

    const main = createElement("div", "football-stage-final-main");
    main.append(
      createElement("span", "football-stage-final-label", label),
      createElement("strong", "football-stage-final-team", teamName(record, advance))
    );
    const detail = createElement(
      "span",
      "football-stage-final-detail",
      decidedBy ? `${prefix}${stageLabel(decidedBy)}分出勝負` : "決勝階段待確認"
    );
    final.append(main, detail);
    return final;
  }

  function buildCardsDetails(knockout) {
    const stageGroups = [];
    const extraCards = knockout?.stages?.extraTime?.cards;
    const penaltyCards = knockout?.stages?.penalties?.cards;
    if (Array.isArray(extraCards) && extraCards.length) stageGroups.push(["延長賽牌面", extraCards]);
    if (Array.isArray(penaltyCards) && penaltyCards.length) stageGroups.push(["PK 牌面", penaltyCards]);
    if (!stageGroups.length) return null;

    const details = createElement("details", "football-stage-card-details");
    details.appendChild(createElement("summary", "", "查看延長賽／PK 牌面"));
    const body = createElement("div", "football-stage-card-details-body");

    stageGroups.forEach(([title, cards]) => {
      const group = createElement("div", "football-stage-card-group");
      group.appendChild(createElement("strong", "football-stage-card-group-title", title));
      const list = createElement("div", "football-stage-card-list");
      cards.forEach((card) => {
        const item = createElement("span", "football-stage-card-chip");
        item.textContent = `${card.title || card.position}：${card.name}${card.orientation}`;
        list.appendChild(item);
      });
      group.appendChild(list);
      body.appendChild(group);
    });

    details.appendChild(body);
    return details;
  }

  function renderPredictionCell(cell, record) {
    const knockout = record?.prediction?.knockout;
    if (!knockout) return;

    const card = createElement("div", "football-stage-card is-prediction");
    const header = createElement("div", "football-stage-card-header");
    header.append(
      createElement("span", "football-outcome-eyebrow", "分階段預測"),
      buildRoute(knockout.route, knockout.resolvedBy)
    );
    card.appendChild(header);

    const stages = createElement("div", "football-stage-blocks");
    stages.appendChild(buildRegulationPrediction(record));
    if (knockout.stages?.extraTime) stages.appendChild(buildExtraPrediction(record, knockout.stages.extraTime));
    if (knockout.stages?.penalties) stages.appendChild(buildPenaltyPrediction(record, knockout.stages.penalties));
    card.appendChild(stages);
    card.appendChild(buildFinalBanner(record, knockout, "prediction"));

    const details = buildCardsDetails(knockout);
    if (details) card.appendChild(details);
    cell.replaceChildren(card);
  }

  function addActualStage(container, title, score, result, className) {
    const section = createElement("section", `football-stage-block ${className}`);
    section.appendChild(createElement("h5", "football-stage-title", title));
    addModelLine(section, "比分", score, true);
    if (result) addModelLine(section, "賽果", result);
    container.appendChild(section);
  }

  function renderActualCell(cell, record) {
    const predictionKnockout = record?.prediction?.knockout;
    if (!predictionKnockout) return;

    const card = createElement("div", "football-stage-card is-actual");
    if (!record.actual) {
      card.append(
        createElement("span", "football-outcome-eyebrow", "分階段實際"),
        createElement("strong", "football-stage-empty-title", "尚未輸入"),
        createElement("span", "football-stage-empty-note", "等待賽後輸入 90 分鐘、120 分鐘或 PK 結果")
      );
      cell.replaceChildren(card);
      return;
    }

    const actualKnockout = record.actual.knockout || {};
    const decidedBy = actualKnockout.decidedBy || "regulation";
    const route = decidedBy === "penalties"
      ? (record.match.knockoutRule === "penalties-only" ? ["regulation", "penalties"] : ["regulation", "extraTime", "penalties"])
      : decidedBy === "extraTime" ? ["regulation", "extraTime"] : ["regulation"];

    const header = createElement("div", "football-stage-card-header");
    header.append(
      createElement("span", "football-outcome-eyebrow", "分階段實際"),
      buildRoute(route, decidedBy)
    );
    card.appendChild(header);

    const stages = createElement("div", "football-stage-blocks");
    addActualStage(
      stages,
      "90 分鐘",
      `${record.actual.homeGoals}：${record.actual.awayGoals}`,
      resultLabel(core.getResult(record.actual.homeGoals, record.actual.awayGoals)),
      "is-regulation"
    );

    if (Number.isInteger(record.actual.extraHomeGoals) && Number.isInteger(record.actual.extraAwayGoals)) {
      addActualStage(
        stages,
        "120 分鐘總比分",
        `${record.actual.extraHomeGoals}：${record.actual.extraAwayGoals}`,
        resultLabel(core.getResult(record.actual.extraHomeGoals, record.actual.extraAwayGoals)),
        "is-extra-time"
      );
    }

    if (Number.isInteger(actualKnockout.penaltyHomeGoals) && Number.isInteger(actualKnockout.penaltyAwayGoals)) {
      const winner = actualKnockout.penaltyHomeGoals > actualKnockout.penaltyAwayGoals ? "H" : "A";
      addActualStage(
        stages,
        "PK 大戰",
        `${actualKnockout.penaltyHomeGoals}：${actualKnockout.penaltyAwayGoals}`,
        `${teamName(record, winner)}勝`,
        "is-penalties"
      );
    }

    card.appendChild(stages);
    card.appendChild(buildFinalBanner(record, actualKnockout, "actual"));
    cell.replaceChildren(card);
  }

  function updateHeaders() {
    const headers = document.querySelectorAll("#football-records .football-table thead th");
    if (headers[2]) headers[2].textContent = "分階段預測";
    if (headers[3]) headers[3].textContent = "分階段實際";
  }

  function injectStyles() {
    if (byId("football-knockout-record-style")) return;
    const style = document.createElement("style");
    style.id = "football-knockout-record-style";
    style.textContent = `
      #football-records .football-table { min-width: 1320px; }
      #football-records .football-table th:nth-child(3),
      #football-records .football-table td:nth-child(3) { min-width: 340px; width: 340px; }
      #football-records .football-table th:nth-child(4),
      #football-records .football-table td:nth-child(4) { min-width: 300px; width: 300px; }
      .football-stage-card {
        display: grid;
        gap: 0.78rem;
        min-width: 0;
        padding: 0.82rem;
        border-radius: 14px;
      }
      .football-stage-card.is-prediction {
        border: 1px solid rgba(174, 136, 255, 0.48);
        background: linear-gradient(145deg, rgba(117, 77, 209, 0.17), rgba(58, 43, 113, 0.07));
      }
      .football-stage-card.is-actual {
        border: 1px solid rgba(85, 205, 167, 0.46);
        background: linear-gradient(145deg, rgba(39, 145, 115, 0.16), rgba(29, 82, 70, 0.06));
      }
      .football-stage-card-header {
        display: grid;
        gap: 0.55rem;
      }
      .football-stage-route {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex-wrap: wrap;
      }
      .football-stage-route-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.23rem 0.48rem;
        border: 1px solid rgba(210, 199, 255, 0.24);
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 850;
        opacity: 0.72;
      }
      .football-stage-route-badge.is-final {
        border-color: rgba(235, 209, 255, 0.66);
        background: rgba(183, 130, 255, 0.18);
        opacity: 1;
      }
      .is-actual .football-stage-route-badge.is-final {
        border-color: rgba(126, 239, 202, 0.58);
        background: rgba(64, 184, 145, 0.18);
      }
      .football-stage-route-dot {
        width: 0.38rem;
        height: 0.38rem;
        border-radius: 50%;
        background: currentColor;
      }
      .football-stage-route-arrow { opacity: 0.46; font-size: 0.75rem; }
      .football-stage-blocks { display: grid; gap: 0.55rem; }
      .football-stage-block {
        display: grid;
        gap: 0.38rem;
        padding: 0.62rem 0.68rem;
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 11px;
        background: rgba(5, 5, 24, 0.2);
      }
      .football-stage-block.is-regulation { border-left: 3px solid rgba(165, 136, 255, 0.78); }
      .football-stage-block.is-extra-time { border-left: 3px solid rgba(243, 185, 105, 0.76); }
      .football-stage-block.is-penalties { border-left: 3px solid rgba(238, 114, 151, 0.76); }
      .football-stage-title {
        margin: 0;
        font-size: 0.77rem;
        font-weight: 900;
        letter-spacing: 0.02em;
      }
      .football-stage-model-line {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: baseline;
        gap: 0.45rem;
      }
      .football-stage-model-label {
        font-size: 0.68rem;
        font-weight: 800;
        opacity: 0.62;
        white-space: nowrap;
      }
      .football-stage-model-value {
        font-size: 0.82rem;
        line-height: 1.42;
        overflow-wrap: anywhere;
      }
      .football-stage-model-line.is-emphasis .football-stage-model-value { font-size: 0.92rem; }
      .football-stage-final {
        display: grid;
        gap: 0.3rem;
        padding: 0.7rem 0.75rem;
        border-radius: 12px;
      }
      .football-stage-final.is-prediction {
        border: 1px solid rgba(215, 175, 255, 0.42);
        background: rgba(156, 91, 225, 0.14);
      }
      .football-stage-final.is-actual {
        border: 1px solid rgba(109, 231, 192, 0.42);
        background: rgba(48, 167, 130, 0.14);
      }
      .football-stage-final-main {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.7rem;
      }
      .football-stage-final-label { font-size: 0.7rem; font-weight: 850; opacity: 0.72; }
      .football-stage-final-team { font-size: 1rem; font-weight: 950; }
      .football-stage-final-detail { font-size: 0.7rem; line-height: 1.4; opacity: 0.68; }
      .football-stage-card-details { font-size: 0.72rem; }
      .football-stage-card-details summary { cursor: pointer; font-weight: 800; opacity: 0.74; }
      .football-stage-card-details-body { display: grid; gap: 0.6rem; padding-top: 0.55rem; }
      .football-stage-card-group { display: grid; gap: 0.35rem; }
      .football-stage-card-group-title { font-size: 0.72rem; }
      .football-stage-card-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
      .football-stage-card-chip {
        padding: 0.25rem 0.42rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.035);
        line-height: 1.35;
      }
      .football-stage-empty-title { font-size: 1.02rem; }
      .football-stage-empty-note { font-size: 0.74rem; line-height: 1.5; opacity: 0.68; }
    `;
    document.head.appendChild(style);
  }

  /** 單次按既有排序映射每列，O(r) 時間／O(1) 額外空間。 */
  function renderRows() {
    if (applying) return;
    const body = byId("football-records-body");
    if (!body) return;

    applying = true;
    observer?.disconnect();
    try {
      updateHeaders();
      const records = core
        .getRecords()
        .sort((a, b) => String(b.match?.kickoff || "").localeCompare(String(a.match?.kickoff || "")));

      Array.from(body.children).forEach((row, index) => {
        const record = records[index];
        if (!record?.prediction?.knockout) return;
        if (row.children[2]) renderPredictionCell(row.children[2], record);
        if (row.children[3]) renderActualCell(row.children[3], record);
      });
    } finally {
      applying = false;
      observer?.observe(body, { childList: true });
    }
  }

  function scheduleRender() {
    scheduleToken += 1;
    const token = scheduleToken;
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (token === scheduleToken) renderRows();
        });
      });
    }, 0);
  }

  function init() {
    injectStyles();
    const body = byId("football-records-body");
    if (!body) return;
    observer = new MutationObserver(scheduleRender);
    observer.observe(body, { childList: true });
    byId("football-evaluation-form")?.addEventListener("submit", scheduleRender);
    scheduleRender();
  }

  init();
})();
