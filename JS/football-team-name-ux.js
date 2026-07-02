// ==============================
// football-team-name-ux.js
// 世足賽事驗證：核對卡片改用隊名顯示
// ==============================
// decorateScorecard：O(k) 時間／O(1) 額外空間，k 為核對項目數，固定上限。
//
// 更快替代方案比較：
// - 原版：直接顯示資料代碼 H／A，使用者必須回頭確認主客隊。
// - 本版：以目前紀錄查表轉成隊名，保留主客隊與代碼作為輔助資訊。
// ==============================

(function initFootballTeamNameUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core || typeof core.getRecord !== "function") return;

  const STAGE_LABELS = Object.freeze({
    regulation: "90 分鐘",
    extraTime: "延長賽",
    penalties: "PK 大戰",
  });

  let observer = null;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  /** 代碼轉隊名：O(1) 時間／O(1) 空間。 */
  function teamLabel(record, value) {
    if (value === "H") return `${record.match.homeTeam}（主隊 H）`;
    if (value === "A") return `${record.match.awayTeam}（客隊 A）`;
    if (value === "D") return "和局（D）";
    return "—";
  }

  /** 固定數量核對卡片掃描：O(k) 時間／O(1) 額外空間。 */
  function decorateScorecard() {
    if (applying) return;

    const scorecard = byId("football-scorecard");
    const recordId = byId("football-evaluation-id")?.value;
    const record = recordId ? core.getRecord(recordId) : null;
    if (!scorecard || !record) return;

    applying = true;
    observer?.disconnect();
    try {
      const items = scorecard.querySelectorAll(".football-score-item");
      items.forEach((item) => {
        const label = item.querySelector("small")?.textContent?.trim();
        const detail = item.querySelector("span");
        if (!detail) return;

        if (label === "最終晉級") {
          const predicted = record.prediction?.knockout?.finalAdvance ?? record.prediction?.advance;
          const actual = record.actual?.advance;
          detail.textContent = `預測：${teamLabel(record, predicted)}／實際：${teamLabel(record, actual)}`;
          return;
        }

        if (label === "決勝階段") {
          const evaluation = core.calculateEvaluation(record)?.knockout;
          if (!evaluation) return;
          const predictedStage = STAGE_LABELS[evaluation.predictedResolvedBy] || evaluation.predictedResolvedBy || "—";
          const actualStage = STAGE_LABELS[evaluation.actualDecidedBy] || evaluation.actualDecidedBy || "—";
          detail.textContent = `預測：${predictedStage}／實際：${actualStage}`;
        }
      });
    } finally {
      applying = false;
      observer?.observe(scorecard, { childList: true, subtree: true });
    }
  }

  function init() {
    const scorecard = byId("football-scorecard");
    if (!scorecard) return;

    observer = new MutationObserver(() => window.requestAnimationFrame(decorateScorecard));
    observer.observe(scorecard, { childList: true, subtree: true });

    byId("football-evaluation-form")?.addEventListener("submit", () => {
      window.setTimeout(decorateScorecard, 0);
    });

    decorateScorecard();
  }

  init();
})();
