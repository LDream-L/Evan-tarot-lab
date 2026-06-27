// ==============================
// football-strict-scoring.js
// 世足賽事驗證：嚴格比分命中規則
// ==============================
// 核心規則：
// - 單張賽果：只看主勝／和局／客勝。
// - 攻防賽果：只看由預測比分推導出的勝負。
// - 確切比分：主客兩隊進球數必須同時完全一致才算命中。
// - 單邊進球數即使剛好相同，也不獨立計為 Bingo。
//
// calculateEvaluationStrict：O(1) 時間／O(1) 空間。
// 更快替代方案：直接沿用既有評估結果，再覆寫比分相關欄位，避免重算其他模型。
// ==============================

(function applyFootballStrictScoring() {
  "use strict";

  const base = window.FootballLabCore;
  if (!base || typeof base.calculateEvaluation !== "function") return;

  /**
   * 嚴格比分制：只有完整比分命中時，主客隊進球欄位才可標記為命中。
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
      scoringPolicy: "exact-score-only",
      structureHomeGoalMatched: homeNumberMatched,
      structureAwayGoalMatched: awayNumberMatched,
      structureExactHit: exactScoreHit,
      // 保留舊欄位名稱供既有畫面與匯出使用，但不再允許單邊命中。
      structureHomeGoalHit: exactScoreHit,
      structureAwayGoalHit: exactScoreHit,
    };
  }

  window.FootballLabCore = Object.freeze({
    ...base,
    calculateEvaluation: calculateEvaluationStrict,
  });
})();
