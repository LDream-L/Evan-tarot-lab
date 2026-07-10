// 世足賽事驗證｜嚴格比分命中評分 ES Module
//
// 核心規則：
// - 單張賽果只核對主勝／和局／客勝。
// - 攻防模型分別核對主隊進球、客隊進球，0 球也必須能獨立命中。
// - 確切比分只有主客進球同時完全一致才成立。
//
// 主要函式複雜度：
// - calculateEvaluationStrict：時間／空間 O(1)。
// - createScoredCore：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 重新計算整份評估會重複賽果、晉級與誤差運算。
// - 本模組沿用基礎核心的一次評估，只覆寫嚴格比分欄位，避免重複工作。

import { footballCore } from "./core.js";

export const SCORING_POLICY = "individual-goals-plus-exact-score";

/**
 * 分開核對兩隊進球，並另外判斷完整比分。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function calculateEvaluationStrict(record, baseCore = footballCore) {
  const evaluation = baseCore.calculateEvaluation(record);
  if (!evaluation || evaluation.type === "legacy5") return evaluation;
  if (!baseCore.modeIncludesStructure(evaluation.type)) return evaluation;

  const predictedHome = Number(record?.prediction?.structureHomeGoals);
  const predictedAway = Number(record?.prediction?.structureAwayGoals);
  const actualHome = Number(record?.actual?.homeGoals);
  const actualAway = Number(record?.actual?.awayGoals);

  const homeNumberMatched = predictedHome === actualHome;
  const awayNumberMatched = predictedAway === actualAway;
  const exactScoreHit = homeNumberMatched && awayNumberMatched;

  return {
    ...evaluation,
    scoringPolicy: SCORING_POLICY,
    structureHomeGoalMatched: homeNumberMatched,
    structureAwayGoalMatched: awayNumberMatched,
    structureHomeGoalHit: homeNumberMatched,
    structureAwayGoalHit: awayNumberMatched,
    structureExactHit: exactScoreHit,
  };
}

/**
 * 建立不修改基礎核心的評分包裝。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function createScoredCore(baseCore = footballCore) {
  if (!baseCore || typeof baseCore.calculateEvaluation !== "function") {
    throw new Error("世足基礎核心尚未載入，無法建立評分層。");
  }

  return Object.freeze({
    ...baseCore,
    calculateEvaluation(record) {
      return calculateEvaluationStrict(record, baseCore);
    },
  });
}

export const scoredFootballCore = createScoredCore(footballCore);

export const footballScoring = Object.freeze({
  policy: SCORING_POLICY,
  baseCore: footballCore,
  core: scoredFootballCore,
  calculateEvaluation: scoredFootballCore.calculateEvaluation,
});

// 相容層：呈現、能量、編輯與雲端模組尚未完成具名 import 前保留原公開 API。
window.FootballLabCore = scoredFootballCore;
window.FootballStrictScoring = footballScoring;
