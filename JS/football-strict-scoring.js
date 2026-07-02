// ==============================
// football-strict-scoring.js
// 世足賽事驗證：比分命中規則
// ==============================
// 核心規則：
// - 單張賽果：只看主勝／和局／客勝。
// - 攻防賽果：只看由預測比分推導出的勝負。
// - 主隊進球、客隊進球：各自與實際進球比較，可獨立命中；0 與 0 也算命中。
// - 確切比分：主客兩隊進球數必須同時完全一致才算命中。
//
// calculateEvaluationStrict：O(1) 時間／O(1) 空間。
// 更快替代方案：直接沿用既有評估結果，再以數值化後的比分覆寫命中欄位，避免重算其他模型。
// ==============================

(function applyFootballStrictScoring() {
  "use strict";

  const base = window.FootballLabCore;
  if (!base || typeof base.calculateEvaluation !== "function") return;

  /**
   * 分開核對兩隊進球，並另外判斷完整比分。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function calculateEvaluationStrict(record) {
    const evaluation = base.calculateEvaluation(record);
    if (!evaluation || evaluation.type === "legacy5") return evaluation;
    if (!base.modeIncludesStructure(evaluation.type)) return evaluation;

    const predictedHome = Number(record?.prediction?.structureHomeGoals);
    const predictedAway = Number(record?.prediction?.structureAwayGoals);
    const actualHome = Number(record?.actual?.homeGoals);
    const actualAway = Number(record?.actual?.awayGoals);

    const homeNumberMatched = predictedHome === actualHome;
    const awayNumberMatched = predictedAway === actualAway;
    const exactScoreHit = homeNumberMatched && awayNumberMatched;

    return {
      ...evaluation,
      scoringPolicy: "individual-goals-plus-exact-score",
      structureHomeGoalMatched: homeNumberMatched,
      structureAwayGoalMatched: awayNumberMatched,
      structureHomeGoalHit: homeNumberMatched,
      structureAwayGoalHit: awayNumberMatched,
      structureExactHit: exactScoreHit,
    };
  }

  window.FootballLabCore = Object.freeze({
    ...base,
    calculateEvaluation: calculateEvaluationStrict,
  });
})();
