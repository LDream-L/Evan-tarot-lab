// ==============================
// football-record-display-ux.js
// 世足賽事驗證：精簡牌位與強化預測／實際辨識
// ==============================
// 主要函式複雜度：
// - refreshRows：O(r)
// - renderRecordRow：O(c)，c <= 5
// - renderMatchCell：O(c log c)，c <= 5
// 空間複雜度：O(r + c) DOM
//
// 更快替代方案比較：
// - 原版：重複輸出完整模型名稱，並將預測與實際結果當一般文字顯示。
// - 本版：以固定牌位查表縮寫，並建立獨立預測卡／實際卡，避免逐字解析。
// - 牌面來源直接由 record.match.cardSource 查表顯示，不再從既有文字節點反向解析，維持 O(1)。
// ==============================

(function initFootballRecordDisplayUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const POSITION_LABELS = Object.freeze({
    directResult: "結果牌",
    homeAttack: "主攻",
    homeDefense: "主防",
    awayAttack: "客攻",
    awayDefense: "客防",
  });

  const POSITION_ORDER = Object.freeze({
    directResult: 0,
    homeAttack: 1,
    homeDefense: 2,
    awayAttack: 3,
    awayDefense: 4,
  });

  const MODE_SHORT_LABELS = Object.freeze({
    direct: "單張模式",
    structure: "攻防模式",
    dual: "雙模型",
    legacy5: "舊版五牌位",
  });

  const CARD_SOURCE_SHORT_LABELS = Object.freeze({
    manual: "牌源｜手動實體抽牌",
    random: "牌源｜網站隨機抽牌",
  });

  let observer = null;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function injectStyles() {
    if (byId("football-record-display-style")) return;

    const style = document.createElement("style");
    style.id = "football-record-display-style";
    style.textContent = `
      .football-record-match {
        display: grid;
        gap: 0.55rem;
        min-width: 245px;
      }
      .football-record-match-title {
        font-size: 1rem;
        font-weight: 850;
        line-height: 1.45;
      }
      .football-record-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.42rem;
      }
      .football-record-mode,
      .football-record-source {
        display: inline-flex;
        width: fit-content;
        padding: 0.18rem 0.52rem;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 800;
        line-height: 1.35;
      }
      .football-record-mode {
        border: 1px solid rgba(171, 151, 255, 0.35);
        background: rgba(131, 105, 221, 0.1);
      }
      .football-record-source {
        border: 1px solid rgba(126, 195, 255, 0.34);
        background: rgba(67, 142, 214, 0.1);
        color: rgba(220, 239, 255, 0.92);
      }
      .football-record-source.is-manual {
        border-color: rgba(205, 166, 255, 0.4);
        background: rgba(150, 112, 255, 0.11);
        color: rgba(239, 230, 255, 0.94);
      }
      .football-record-source.is-random {
        border-color: rgba(91, 205, 239, 0.38);
        background: rgba(53, 159, 194, 0.1);
        color: rgba(213, 248, 255, 0.94);
      }
      .football-record-source.is-unknown {
        border-color: rgba(190, 190, 205, 0.28);
        background: rgba(180, 180, 195, 0.07);
        color: rgba(226, 226, 236, 0.75);
      }
      .football-compact-cards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.35rem 0.65rem;
      }
      .football-compact-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: baseline;
        gap: 0.35rem;
        min-width: 0;
        font-size: 0.78rem;
        line-height: 1.4;
      }
      .football-compact-card-label {
        color: rgba(211, 203, 255, 0.72);
        font-weight: 850;
        white-space: nowrap;
      }
      .football-compact-card-value {
        overflow-wrap: anywhere;
      }
      .football-outcome-card {
        display: grid;
        gap: 0.48rem;
        min-width: 135px;
        padding: 0.7rem 0.75rem;
        border-radius: 13px;
      }
      .football-outcome-card.is-prediction {
        border: 1px solid rgba(174, 136, 255, 0.45);
        background: linear-gradient(145deg, rgba(117, 77, 209, 0.15), rgba(58, 43, 113, 0.06));
      }
      .football-outcome-card.is-actual {
        border: 1px solid rgba(85, 205, 167, 0.43);
        background: linear-gradient(145deg, rgba(39, 145, 115, 0.14), rgba(29, 82, 70, 0.05));
      }
      .football-outcome-eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 0.14rem 0.46rem;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        line-height: 1.3;
      }
      .is-prediction .football-outcome-eyebrow {
        color: #dfd1ff;
        background: rgba(151, 111, 238, 0.18);
      }
      .is-actual .football-outcome-eyebrow {
        color: #bfffe9;
        background: rgba(56, 182, 142, 0.17);
      }
      .football-outcome-score {
        font-size: 1.28rem;
        font-weight: 900;
        line-height: 1.2;
        letter-spacing: 0.02em;
      }
      .football-outcome-result {
        font-size: 0.83rem;
        font-weight: 800;
        line-height: 1.35;
      }
      .football-prediction-lines {
        display: grid;
        gap: 0.42rem;
      }
      .football-prediction-line {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0.42rem;
        align-items: baseline;
      }
      .football-prediction-kind {
        color: rgba(223, 213, 255, 0.7);
        font-size: 0.72rem;
        font-weight: 850;
        white-space: nowrap;
      }
      .football-prediction-value {
        font-size: 0.87rem;
        font-weight: 850;
        line-height: 1.4;
      }
      .football-outcome-note {
        font-size: 0.72rem;
        line-height: 1.4;
        opacity: 0.66;
      }
      @media (max-width: 980px) {
        .football-compact-cards { grid-template-columns: 1fr; }
        .football-record-match { min-width: 205px; }
      }
    `;
    document.head.appendChild(style);
  }

  function updateHeaders() {
    const headers = document.querySelectorAll("#football-records .football-table thead th");
    if (headers[1]) headers[1].textContent = "賽事與牌面";
    if (headers[2]) headers[2].textContent = "預測";
    if (headers[3]) headers[3].textContent = "實際";
  }

  function getPositionLabel(card) {
    if (POSITION_LABELS[card?.position]) return POSITION_LABELS[card.position];
    const title = String(card?.positionTitle || "");
    if (title.includes("主隊進攻")) return "主攻";
    if (title.includes("主隊防守")) return "主防";
    if (title.includes("客隊進攻")) return "客攻";
    if (title.includes("客隊防守")) return "客防";
    if (title.includes("結果")) return "結果牌";
    return title || "牌位";
  }

  function getCardOrder(card) {
    return POSITION_ORDER[card?.position] ?? 99;
  }

  /** 牌面來源標籤直接查表：時間／空間 O(1)。 */
  function getCardSourceLabel(record) {
    const source = String(record?.match?.cardSource || "").trim();
    if (CARD_SOURCE_SHORT_LABELS[source]) return CARD_SOURCE_SHORT_LABELS[source];
    const legacyLabel = core.data.cardSourceLabels?.[source];
    return legacyLabel ? `牌源｜${legacyLabel}` : "牌源｜舊版未標記";
  }

  /** 建立牌面縮寫區：O(c log c)，c <= 5；實際上限固定。 */
  function buildCompactCards(record) {
    const list = document.createElement("div");
    list.className = "football-compact-cards";

    const cards = Array.isArray(record?.cards)
      ? record.cards.slice().sort((a, b) => getCardOrder(a) - getCardOrder(b))
      : [];

    cards.forEach((card) => {
      const item = document.createElement("div");
      item.className = "football-compact-card";

      const label = document.createElement("span");
      label.className = "football-compact-card-label";
      label.textContent = `${getPositionLabel(card)}：`;

      const value = document.createElement("span");
      value.className = "football-compact-card-value";
      value.textContent = `${card.name || "—"}${card.orientation || ""}`;

      item.append(label, value);
      list.appendChild(item);
    });

    return list;
  }

  /** 賽事卡固定輸出模式＋牌面來源：O(c log c)，c <= 5。 */
  function renderMatchCell(cell, record) {
    const wrapper = document.createElement("div");
    wrapper.className = "football-record-match";

    const title = document.createElement("strong");
    title.className = "football-record-match-title";
    title.textContent = `${record.match.homeTeam} vs ${record.match.awayTeam}`;

    const tags = document.createElement("div");
    tags.className = "football-record-tags";

    const mode = document.createElement("span");
    mode.className = "football-record-mode";
    mode.textContent = MODE_SHORT_LABELS[core.getMode(record)] || "實驗模式";

    const sourceKey = String(record?.match?.cardSource || "").trim();
    const source = document.createElement("span");
    source.className = `football-record-source ${sourceKey === "manual" ? "is-manual" : sourceKey === "random" ? "is-random" : "is-unknown"}`;
    source.textContent = getCardSourceLabel(record);

    tags.append(mode, source);
    wrapper.append(title, tags, buildCompactCards(record));
    cell.replaceChildren(wrapper);
  }

  function addPredictionLine(container, kind, value) {
    const line = document.createElement("div");
    line.className = "football-prediction-line";

    const label = document.createElement("span");
    label.className = "football-prediction-kind";
    label.textContent = kind;

    const content = document.createElement("span");
    content.className = "football-prediction-value";
    content.textContent = value;

    line.append(label, content);
    container.appendChild(line);
  }

  function renderPredictionCell(cell, record) {
    const mode = core.getMode(record);
    const prediction = record.prediction || {};

    const card = document.createElement("div");
    card.className = "football-outcome-card is-prediction";

    const eyebrow = document.createElement("span");
    eyebrow.className = "football-outcome-eyebrow";
    eyebrow.textContent = "預測";

    const lines = document.createElement("div");
    lines.className = "football-prediction-lines";

    if (mode === "legacy5") {
      addPredictionLine(lines, "賽果", core.data.resultLabels[prediction.result] || "—");
    } else {
      if (core.modeIncludesDirect(mode)) {
        addPredictionLine(lines, "單張", core.data.resultLabels[prediction.directResult] || "—");
      }
      if (core.modeIncludesStructure(mode)) {
        const home = prediction.structureHomeGoals;
        const away = prediction.structureAwayGoals;
        const result = core.data.resultLabels[core.getResult(home, away)] || "—";
        addPredictionLine(lines, "攻防", `${home}：${away}｜${result}`);
      }
    }

    const note = document.createElement("span");
    note.className = "football-outcome-note";
    note.textContent = "賽前鎖定";

    card.append(eyebrow, lines, note);
    cell.replaceChildren(card);
  }

  function renderActualCell(cell, record) {
    const card = document.createElement("div");
    card.className = "football-outcome-card is-actual";

    const eyebrow = document.createElement("span");
    eyebrow.className = "football-outcome-eyebrow";
    eyebrow.textContent = "實際";

    const score = document.createElement("strong");
    score.className = "football-outcome-score";

    const result = document.createElement("span");
    result.className = "football-outcome-result";

    if (record.actual) {
      score.textContent = `${record.actual.homeGoals}：${record.actual.awayGoals}`;
      result.textContent = core.data.resultLabels[core.getResult(record.actual.homeGoals, record.actual.awayGoals)] || "—";
    } else {
      score.textContent = "—";
      result.textContent = "尚未輸入";
    }

    card.append(eyebrow, score, result);
    cell.replaceChildren(card);
  }

  /** 每列只處理三格：O(c)，c <= 5。 */
  function renderRecordRow(row, record) {
    if (!row || !record) return;
    if (row.children[1]) renderMatchCell(row.children[1], record);
    if (row.children[2]) renderPredictionCell(row.children[2], record);
    if (row.children[3]) renderActualCell(row.children[3], record);
  }

  /** 單次掃描紀錄：O(r) 時間／O(r) DOM 空間。 */
  function refreshRows() {
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

      Array.from(body.children).forEach((row, index) => renderRecordRow(row, records[index]));
    } finally {
      applying = false;
      observer?.observe(body, { childList: true });
    }
  }

  function init() {
    injectStyles();
    updateHeaders();

    const body = byId("football-records-body");
    if (!body) return;

    observer = new MutationObserver(() => window.requestAnimationFrame(refreshRows));
    observer.observe(body, { childList: true });
    refreshRows();

    byId("football-evaluation-form")?.addEventListener("submit", () => {
      window.setTimeout(refreshRows, 0);
    });
  }

  init();
})();
