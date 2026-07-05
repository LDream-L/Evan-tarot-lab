// ==============================
// football-record-card-controls.js
// 世足賽事驗證：精簡牌面並將紀錄表改成可閱讀的卡片網格
// ==============================
// 主要函式複雜度：
// - decorateRows：O(r * c)，r 為紀錄數、c 為每場牌數，固定上限 5。
// - simplifyBoard：O(c)，c 為單場牌數。
// 空間複雜度：O(1) 額外空間。
//
// 更快替代方案比較：
// - 保留寬表格並依賴橫向捲動：改動較少，但預測與實際結果會長期落在畫面外。
// - 本版：沿用既有七個儲存格，以 CSS Grid 重排成單筆卡片；不搬移資料節點，避免重建事件。
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
      #football-records .football-table-wrap {
        overflow: visible;
      }
      #football-records .football-table {
        display: block;
        width: 100%;
        min-width: 0 !important;
        border: 0;
        background: transparent;
      }
      #football-records .football-table thead {
        display: none;
      }
      #football-records .football-table tbody {
        display: grid;
        gap: 1rem;
      }
      #football-records .football-table tbody tr {
        display: grid;
        grid-template-columns: 138px minmax(0, 1fr) minmax(270px, 320px);
        grid-template-areas:
          "time match prediction"
          "status match actual"
          "actions match hit";
        gap: 0.75rem;
        align-items: start;
        padding: 0.85rem;
        border: 1px solid rgba(176, 145, 255, 0.28);
        border-radius: 18px;
        background: rgba(5, 5, 24, 0.54);
      }
      #football-records .football-table tbody td {
        display: grid;
        gap: 0.45rem;
        min-width: 0 !important;
        width: auto !important;
        padding: 0.72rem;
        border: 1px solid rgba(176, 145, 255, 0.14);
        border-radius: 13px;
        background: rgba(255, 255, 255, 0.018);
        vertical-align: top;
        overflow: visible;
      }
      #football-records .football-table tbody td::before {
        display: block;
        color: rgba(218, 209, 255, 0.64);
        font-size: 0.69rem;
        font-weight: 850;
        letter-spacing: 0.04em;
      }
      #football-records .football-table tbody td:nth-child(1) { grid-area: time; }
      #football-records .football-table tbody td:nth-child(1)::before { content: "開賽時間"; }
      #football-records .football-table tbody td:nth-child(2) { grid-area: match; padding: 0; border: 0; background: transparent; }
      #football-records .football-table tbody td:nth-child(2)::before { content: none; }
      #football-records .football-table tbody td:nth-child(3) { grid-area: prediction; }
      #football-records .football-table tbody td:nth-child(3)::before { content: "分階段預測"; }
      #football-records .football-table tbody td:nth-child(4) { grid-area: actual; }
      #football-records .football-table tbody td:nth-child(4)::before { content: "分階段實際"; }
      #football-records .football-table tbody td:nth-child(5) { grid-area: hit; }
      #football-records .football-table tbody td:nth-child(5)::before { content: "命中結果"; }
      #football-records .football-table tbody td:nth-child(6) { grid-area: status; }
      #football-records .football-table tbody td:nth-child(6)::before { content: "紀錄狀態"; }
      #football-records .football-table tbody td:nth-child(7) { grid-area: actions; }
      #football-records .football-table tbody td:nth-child(7)::before { content: "操作"; }
      #football-records .football-table tbody td > small {
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      #football-records .football-row-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.45rem;
      }
      #football-records .football-row-actions .football-small-button {
        width: 100%;
      }
      .football-record-match {
        min-width: 0 !important;
        width: 100%;
      }
      .football-record-card-board .football-card-group-heading p {
        display: none;
      }
      .football-record-card-board .football-card-group-heading {
        padding: 0.65rem 0.8rem;
      }
      .football-record-card-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .football-record-card-grid.is-single {
        grid-template-columns: minmax(150px, 220px) !important;
        max-width: none !important;
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
      .football-stage-card,
      .football-outcome-card {
        min-width: 0 !important;
        width: 100%;
        box-sizing: border-box;
      }
      .football-stage-final-main,
      .football-stage-model-line,
      .football-prediction-line {
        min-width: 0;
      }
      .football-stage-final-team,
      .football-stage-model-value,
      .football-prediction-value {
        overflow-wrap: anywhere;
      }
      .football-record-score-edit-bar,
      .football-score-edit-button {
        display: none !important;
      }
      @media (max-width: 980px) {
        #football-records .football-table tbody tr {
          grid-template-columns: 120px minmax(0, 1fr);
          grid-template-areas:
            "time status"
            "match match"
            "prediction actual"
            "hit actions";
        }
      }
      @media (max-width: 680px) {
        #football-records .football-table tbody tr {
          grid-template-columns: 1fr;
          grid-template-areas:
            "time"
            "match"
            "prediction"
            "actual"
            "hit"
            "status"
            "actions";
          padding: 0.65rem;
        }
        .football-record-card-grid,
        .football-record-card-grid.is-single {
          grid-template-columns: 1fr !important;
        }
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

  /** 移除先前版本建立的第二個比分編輯入口：O(1) 時間／O(1) 空間。 */
  function removeDuplicateScoreButton(row) {
    row?.querySelectorAll('.football-record-score-edit-bar, button[data-action="edit-score"]').forEach((element) => element.remove());
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
      Array.from(body.children).forEach((row) => {
        simplifyBoard(row.children[1]?.querySelector(".football-record-card-board"));
        removeDuplicateScoreButton(row);
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

  function init() {
    injectStyles();

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