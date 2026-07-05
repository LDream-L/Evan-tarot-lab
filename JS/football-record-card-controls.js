// ==============================
// football-record-card-controls.js
// 世足賽事驗證：精簡紀錄牌面文字並提供明確的比分修改入口
// ==============================
// 主要函式複雜度：
// - decorateRows：O(r * c)，r 為紀錄數、c 為每場牌數，固定上限 5。
// - simplifyBoard：O(c)，c 為單場牌數。
// - addScoreButton：O(1) 時間／O(1) 空間。
//
// 更快替代方案比較：
// - 直接重寫紀錄渲染器：會和淘汰賽、能量模型及其他 UX 模組重複處理 DOM。
// - 本版：只在最終渲染後移除註記並補上比分修改按鈕，避免干擾既有資料流程。
// ==============================

(function initFootballRecordCardControls() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const POSITION_LABELS = Object.freeze([
    ["主隊進攻", "主隊進攻"],
    ["客隊防守", "客隊防守"],
    ["客隊進攻", "客隊進攻"],
    ["主隊防守", "主隊防守"],
  ]);

  let observer = null;
  let scheduled = false;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function shortPositionLabel(value) {
    const text = String(value || "");
    if (text.includes("單張") || text.includes("整體能量") || text.includes("結果牌")) return "單張";
    const matched = POSITION_LABELS.find(([keyword]) => text.includes(keyword));
    return matched ? matched[1] : text.replace(/^攻防組[｜|]/, "").trim() || "牌位";
  }

  function injectStyles() {
    if (byId("football-record-card-controls-style")) return;

    const style = document.createElement("style");
    style.id = "football-record-card-controls-style";
    style.textContent = `
      .football-record-card-board .football-card-group-heading p {
        display: none;
      }
      .football-record-card-board .football-card-group-heading {
        padding: 0.65rem 0.8rem;
      }
      .football-record-card {
        min-height: 0 !important;
        gap: 0.62rem !important;
        padding: 0.9rem !important;
      }
      .football-record-card .football-card-order,
      .football-record-card .football-card-role {
        display: none !important;
      }
      .football-record-card .football-card-name {
        font-size: 0.98rem;
      }
      .football-record-score-edit-bar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-bottom: 0.1rem;
      }
      .football-score-edit-button {
        white-space: nowrap;
        text-decoration: none;
      }
      #football-edit-score-fieldset {
        scroll-margin-top: 1rem;
      }
    `;
    document.head.appendChild(style);
  }

  /** 單場固定最多五張：O(c) 時間／O(1) 額外空間。 */
  function simplifyBoard(board) {
    if (!board) return;

    board.querySelectorAll(".football-card-group-heading p").forEach((note) => note.remove());
    board.querySelectorAll(".football-record-card").forEach((card) => {
      card.querySelector(".football-card-order")?.remove();
      card.querySelector(".football-card-role")?.remove();
      const title = card.querySelector(".football-card-name");
      if (title) title.textContent = shortPositionLabel(title.textContent);
    });
  }

  /** 單筆紀錄補上比分修改入口：O(1) 時間／O(1) 空間。 */
  function addScoreButton(row, record) {
    if (!row || !record || !core.modeIncludesStructure(core.getMode(record))) return;

    const predictionCell = row.children[2];
    if (!predictionCell) return;

    const predictionCard = predictionCell.querySelector(
      ".football-stage-card.is-prediction, .football-outcome-card.is-prediction"
    );
    if (!predictionCard) return;

    let bar = predictionCard.querySelector(":scope > .football-record-score-edit-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "football-record-score-edit-bar";
      predictionCard.prepend(bar);
    }

    let button = bar.querySelector('button[data-action="edit-score"]');
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "football-small-button football-score-edit-button";
      button.dataset.action = "edit-score";
      button.textContent = "修改比分";
      bar.appendChild(button);
    }

    button.dataset.id = record.id;
    button.setAttribute(
      "aria-label",
      `修改 ${record.match?.homeTeam || "主隊"} 對 ${record.match?.awayTeam || "客隊"} 的預測比分`
    );
  }

  /** 掃描紀錄列並套用最終顯示：O(r * c) 時間／O(1) 額外空間。 */
  function decorateRows() {
    scheduled = false;
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
        if (!record) return;
        simplifyBoard(row.children[1]?.querySelector(".football-record-card-board"));
        addScoreButton(row, record);
      });
    } finally {
      applying = false;
      observer?.observe(body, { childList: true, subtree: true });
    }
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => window.requestAnimationFrame(decorateRows));
  }

  function openScoreEditor(recordId) {
    const record = core.getRecord(recordId);
    if (!record) return;

    window.FootballLabRecordEdit?.open?.(recordId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const fieldset = byId("football-edit-score-fieldset");
        if (!fieldset) return;
        fieldset.classList.remove("football-hidden");
        fieldset.scrollIntoView({ behavior: "smooth", block: "center" });
        byId("football-edit-structure-home-goals")?.focus();
      });
    });
  }

  function bindEvents() {
    byId("football-records-body")?.addEventListener("click", (event) => {
      const button = event.target.closest('button[data-action="edit-score"]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      openScoreEditor(String(button.dataset.id || ""));
    });
  }

  function init() {
    injectStyles();
    bindEvents();

    const body = byId("football-records-body");
    if (!body) return;
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(body, { childList: true, subtree: true });

    window.addEventListener("football-energy-render", scheduleDecorate);
    byId("football-edit-form")?.addEventListener("submit", scheduleDecorate);
    scheduleDecorate();
  }

  init();
})();