// ==============================
// football-record-card-controls.js
// 世足賽事驗證：精簡牌面並重做紀錄卡片版面
// ==============================
// 主要函式複雜度：
// - decorateRows：O(r * c)，r 為紀錄數、c 為每場牌數，固定上限 5。
// - simplifyBoard：O(c)，c 為單場牌數。
// 空間複雜度：O(1) 額外空間。
//
// 更快替代方案比較：
// - 只調小原本三欄卡片：改動少，但資訊層級仍碎裂。
// - 本版：保留既有七個儲存格供其他模組使用，只用 CSS Grid 重排為「主內容／結果側欄／底部工具列」。
// ==============================

(function initFootballRecordCardControls() {
  "use strict";

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
        gap: 1.1rem;
      }
      #football-records .football-table tbody tr {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(285px, 340px);
        grid-template-areas:
          "match prediction"
          "match actual"
          "match hit"
          "time status"
          "actions actions";
        gap: 0.8rem 1rem;
        align-items: start;
        padding: 1rem;
        border: 1px solid rgba(176, 145, 255, 0.28);
        border-radius: 18px;
        background: linear-gradient(145deg, rgba(17, 15, 49, 0.88), rgba(7, 7, 28, 0.94));
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.16);
      }
      #football-records .football-table tbody td {
        min-width: 0 !important;
        width: auto !important;
        padding: 0;
        border: 0;
        background: transparent;
        vertical-align: top;
        overflow: visible;
      }
      #football-records .football-table tbody td::before {
        display: block;
        margin-bottom: 0.45rem;
        color: rgba(218, 209, 255, 0.58);
        font-size: 0.68rem;
        font-weight: 850;
        letter-spacing: 0.05em;
      }

      #football-records .football-table tbody td:nth-child(1) {
        grid-area: time;
        display: flex;
        align-items: center;
        gap: 0.65rem;
        min-height: 38px;
        padding-top: 0.8rem;
        border-top: 1px solid rgba(176, 145, 255, 0.14);
      }
      #football-records .football-table tbody td:nth-child(1)::before {
        content: "開賽";
        flex: 0 0 auto;
        margin: 0;
      }
      #football-records .football-table tbody td:nth-child(1) > span {
        font-weight: 800;
      }
      #football-records .football-table tbody td:nth-child(1) > small {
        opacity: 0.66;
      }

      #football-records .football-table tbody td:nth-child(2) {
        grid-area: match;
      }
      #football-records .football-table tbody td:nth-child(2)::before {
        content: none;
      }

      #football-records .football-table tbody td:nth-child(3),
      #football-records .football-table tbody td:nth-child(4),
      #football-records .football-table tbody td:nth-child(5) {
        display: grid;
        gap: 0.45rem;
      }
      #football-records .football-table tbody td:nth-child(3) { grid-area: prediction; }
      #football-records .football-table tbody td:nth-child(3)::before { content: "分階段預測"; }
      #football-records .football-table tbody td:nth-child(4) { grid-area: actual; }
      #football-records .football-table tbody td:nth-child(4)::before { content: "分階段實際"; }
      #football-records .football-table tbody td:nth-child(5) { grid-area: hit; }
      #football-records .football-table tbody td:nth-child(5)::before { content: "命中結果"; }

      #football-records .football-table tbody td:nth-child(6) {
        grid-area: status;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 0.65rem;
        min-height: 38px;
        padding-top: 0.8rem;
        border-top: 1px solid rgba(176, 145, 255, 0.14);
        text-align: right;
      }
      #football-records .football-table tbody td:nth-child(6)::before {
        content: "狀態";
        flex: 0 0 auto;
        margin: 0;
      }

      #football-records .football-table tbody td:nth-child(7) {
        grid-area: actions;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        padding-top: 0.1rem;
      }
      #football-records .football-table tbody td:nth-child(7)::before {
        content: none;
      }

      #football-records .football-row-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.55rem;
        flex-wrap: wrap;
      }
      #football-records .football-row-actions .football-small-button {
        width: auto;
        min-width: 92px;
      }

      .football-record-match {
        min-width: 0 !important;
        width: 100%;
        display: grid;
        gap: 0.9rem;
      }
      .football-record-match-header {
        align-items: center !important;
        min-height: 38px;
      }
      .football-record-match-title {
        font-size: 1rem;
        font-weight: 900;
      }
      .football-record-card-board {
        gap: 0.75rem !important;
      }
      .football-record-card-board .football-card-group-heading {
        padding: 0.62rem 0.75rem;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.018);
      }
      .football-record-card-board .football-card-group-heading p {
        display: none;
      }
      .football-record-card-board .football-card-group-heading h4 {
        margin: 0;
        font-size: 0.93rem;
      }
      .football-record-card-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
        gap: 0.65rem !important;
      }
      .football-record-card-grid.is-single {
        grid-template-columns: minmax(150px, 210px) !important;
        max-width: none !important;
      }
      .football-record-card {
        min-height: 0 !important;
        gap: 0.52rem !important;
        padding: 0.78rem !important;
        border-radius: 12px !important;
      }
      .football-record-card .football-card-order,
      .football-record-card .football-card-role {
        display: none !important;
      }
      .football-record-card .football-card-name {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.3;
      }
      .football-record-card .football-random-card-name {
        font-size: 0.98rem;
      }

      .football-stage-card,
      .football-outcome-card {
        min-width: 0 !important;
        width: 100%;
        box-sizing: border-box;
        border-radius: 14px !important;
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

      @media (max-width: 1080px) {
        #football-records .football-table tbody tr {
          grid-template-columns: minmax(0, 1fr) minmax(250px, 300px);
        }
        .football-record-card-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
      }

      @media (max-width: 820px) {
        #football-records .football-table tbody tr {
          grid-template-columns: 1fr;
          grid-template-areas:
            "match"
            "prediction"
            "actual"
            "hit"
            "time"
            "status"
            "actions";
        }
        #football-records .football-table tbody td:nth-child(1),
        #football-records .football-table tbody td:nth-child(6) {
          justify-content: flex-start;
          text-align: left;
        }
        #football-records .football-table tbody td:nth-child(7),
        #football-records .football-row-actions {
          justify-content: flex-start;
        }
      }

      @media (max-width: 560px) {
        #football-records .football-table tbody tr {
          padding: 0.75rem;
        }
        .football-record-card-grid,
        .football-record-card-grid.is-single {
          grid-template-columns: 1fr !important;
        }
        #football-records .football-row-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          width: 100%;
        }
        #football-records .football-row-actions .football-small-button {
          width: 100%;
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