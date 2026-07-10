// 世足賽事驗證｜延長賽與 PK 編輯純資料模型
//
// 本檔只處理階段規格、牌組驗證、路徑推導與完整 prediction 建立；
// 不讀取 DOM、window、localStorage 或 Google Sheets。
//
// 主要函式複雜度：
// - specsFor／resultsFor／consensusWinner／isKnockoutEligible：時間／空間 O(1)。
// - drawCards：時間 O(d+p)、空間 O(d+p)，d = 78、p <= 5。
// - validateStageCards：時間／空間 O(p)，p <= 5。
// - buildKnockoutRecord：時間／空間 O(p)，p 為 prediction 與階段牌組大小。
//
// 更快替代方案比較：
// - 每次重抽完整 78 張牌會破壞既有階段；本版只在缺少必要階段時做部分 Fisher-Yates。
// - 以巢狀迴圈檢查重複牌需 O(p²)；本版使用 Set 單次掃描 O(p)。

import {
  buildUpdatedMatch,
  cloneValue,
  nonNegativeInteger,
} from "./record-edit-model.js";

export const ADVANCE_SCOPE = "advance";
export const EXTRA_RULE = "extra-time-then-penalties";
export const PENALTY_RULE = "penalties-only";
export const VALID_RESULTS = Object.freeze(new Set(["H", "D", "A"]));
export const VALID_WINNERS = Object.freeze(new Set(["H", "A"]));
export const KNOCKOUT_STAGES = Object.freeze(new Set([
  "32強",
  "16強",
  "8強",
  "準決賽",
  "季軍賽",
  "決賽",
]));

export const EXTRA_SPECS = Object.freeze([
  Object.freeze(["extraResult", "延長賽單張", "direct"]),
  Object.freeze(["extraHomeAttack", "主隊延長賽進攻", "structure"]),
  Object.freeze(["extraAwayDefense", "客隊延長賽防守", "structure"]),
  Object.freeze(["extraAwayAttack", "客隊延長賽進攻", "structure"]),
  Object.freeze(["extraHomeDefense", "主隊延長賽防守", "structure"]),
]);

export const PENALTY_SPECS = Object.freeze([
  Object.freeze(["homeShooters", "主隊罰球穩定度"]),
  Object.freeze(["homeKeeper", "主隊門將表現"]),
  Object.freeze(["awayShooters", "客隊罰球穩定度"]),
  Object.freeze(["awayKeeper", "客隊門將表現"]),
  Object.freeze(["penaltyResult", "PK 最終結果牌"]),
]);

/** 依模式取得固定階段規格：時間／空間 O(1)。 */
export function specsFor(core, mode, stage) {
  if (stage === "penalty") return PENALTY_SPECS;
  return EXTRA_SPECS.filter((spec) => (
    (spec[2] === "direct" && core.modeIncludesDirect(mode))
    || (spec[2] === "structure" && core.modeIncludesStructure(mode))
  ));
}

/**
 * 只抽必要張數的部分 Fisher-Yates。
 * 時間 O(d+p)、空間 O(d+p)。
 */
export function drawCards(deck, specs, randomInt) {
  if (!Array.isArray(deck) || typeof randomInt !== "function") {
    throw new Error("缺少牌組或安全亂數來源。");
  }
  const pool = deck.slice();
  const cards = [];
  for (let index = 0; index < specs.length; index += 1) {
    const remaining = pool.length - index;
    const offset = randomInt(remaining);
    if (!Number.isInteger(offset) || offset < 0 || offset >= remaining) {
      throw new Error("亂數來源回傳超出範圍的索引。");
    }
    const swapIndex = index + offset;
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    cards.push({
      position: specs[index][0],
      title: specs[index][1],
      name: pool[index],
      orientation: randomInt(2) === 0 ? "正位" : "逆位",
    });
  }
  return cards;
}

/** 取得既有階段牌組快照：時間／空間 O(p)。 */
export function stageCardsFromRecord(record, stage) {
  const cards = stage === "extra"
    ? record?.prediction?.knockout?.stages?.extraTime?.cards
    : record?.prediction?.knockout?.stages?.penalties?.cards;
  return Array.isArray(cards) ? cloneValue(cards) : null;
}

/** 同階段牌面查表驗證：時間／空間 O(p)。 */
export function validateStageCards(deck, cards, stageLabel, expectedCount = null) {
  const list = Array.isArray(cards) ? cards : [];
  if (Number.isInteger(expectedCount) && list.length !== expectedCount) {
    throw new Error(`${stageLabel}牌組應有 ${expectedCount} 張，目前為 ${list.length} 張。`);
  }
  const deckSet = deck instanceof Set ? deck : new Set(deck || []);
  const used = new Set();
  for (const card of list) {
    if (!deckSet.has(card?.name)) throw new Error(`請完整記錄「${card?.title || "牌面"}」。`);
    if (card.orientation !== "正位" && card.orientation !== "逆位") {
      throw new Error(`請選擇「${card.title}」正逆位。`);
    }
    if (used.has(card.name)) throw new Error(`「${card.name}」在${stageLabel}牌組中重複出現。`);
    used.add(card.name);
  }
}

/** 固定最多兩個模型結果：時間／空間 O(1)。 */
export function resultsFor(core, mode, directResult, home, away) {
  const results = [];
  if (core.modeIncludesDirect(mode) && VALID_RESULTS.has(directResult)) results.push(directResult);
  if (core.modeIncludesStructure(mode) && Number.isInteger(home) && Number.isInteger(away)) {
    results.push(core.getResult(home, away));
  }
  return results;
}

/** 時間／空間 O(1)。 */
export function hasDraw(results) {
  return results.includes("D");
}

/** 固定最多兩項：時間／空間 O(1)。 */
export function consensusWinner(results) {
  const decided = results.filter((result) => result !== "D");
  return decided.length && decided.every((result) => result === decided[0])
    ? decided[0]
    : "";
}

/** 判斷紀錄是否需要決勝編輯：時間／空間 O(1)。 */
export function isKnockoutEligible(match, prediction) {
  return match?.predictionScope === ADVANCE_SCOPE
    || Boolean(prediction?.knockout)
    || KNOCKOUT_STAGES.has(match?.stage);
}

/** 建立延長賽階段：時間／空間 O(p)。 */
export function buildExtraStage(core, mode, input) {
  const cards = cloneValue(input.cards || []);
  validateStageCards(
    core.data.deck,
    cards,
    "延長賽",
    specsFor(core, mode, "extra").length
  );
  const extra = { cards };

  if (core.modeIncludesDirect(mode)) {
    extra.directResult = input.directResult;
    extra.directNotes = String(input.directNotes || "").trim();
    if (!VALID_RESULTS.has(extra.directResult) || !extra.directNotes) {
      throw new Error("請完成延長賽單張結果與解讀。");
    }
  }
  if (core.modeIncludesStructure(mode)) {
    extra.structureHomeGoals = nonNegativeInteger(input.structureHomeGoals, "延長賽主隊新增進球");
    extra.structureAwayGoals = nonNegativeInteger(input.structureAwayGoals, "延長賽客隊新增進球");
    extra.structureNotes = String(input.structureNotes || "").trim();
    if (!extra.structureNotes) throw new Error("請完成延長賽攻防解讀。");
  }
  return extra;
}

/** 建立 PK 階段：時間／空間 O(p)。 */
export function buildPenaltyStage(core, input) {
  const cards = cloneValue(input.cards || []);
  validateStageCards(core.data.deck, cards, "PK", PENALTY_SPECS.length);
  const winner = String(input.winner || "").trim();
  const notes = String(input.notes || "").trim();
  if (!VALID_WINNERS.has(winner) || !notes) {
    throw new Error("請完成 PK 最終勝者與牌面解讀。");
  }
  return { cards, winner, notes };
}

/**
 * 建立含完整決勝路徑的更新紀錄；不修改原始 record。
 * 時間／空間 O(p)。
 */
export function buildKnockoutRecord(core, record, baseValues, stageInput, now = new Date().toISOString()) {
  const match = buildUpdatedMatch(record, baseValues);
  const matchError = core.validateMatch(match);
  if (matchError) throw new Error(matchError);

  const prediction = cloneValue(record.prediction || {});
  const mode = core.getMode(record);
  if (core.modeIncludesStructure(mode)) {
    prediction.structureHomeGoals = nonNegativeInteger(
      baseValues.structureHomeGoals,
      "90 分鐘主隊預測進球"
    );
    prediction.structureAwayGoals = nonNegativeInteger(
      baseValues.structureAwayGoals,
      "90 分鐘客隊預測進球"
    );
  }

  if (!isKnockoutEligible(match, prediction)) {
    delete prediction.knockout;
    return { ...record, match, prediction, updatedAt: now };
  }

  match.predictionScope = ADVANCE_SCOPE;
  match.knockoutRule = match.knockoutRule || prediction.knockout?.rule || EXTRA_RULE;
  const regulationResults = resultsFor(
    core,
    mode,
    prediction.directResult,
    prediction.structureHomeGoals,
    prediction.structureAwayGoals
  );
  const stages = {};
  const route = ["regulation"];
  let resolvedBy = "regulation";
  let finalAdvance = consensusWinner(regulationResults)
    || prediction.advance
    || prediction.knockout?.finalAdvance
    || "";

  if (hasDraw(regulationResults)) {
    if (match.knockoutRule === PENALTY_RULE) {
      const penalties = buildPenaltyStage(core, stageInput.penalty);
      stages.penalties = penalties;
      route.push("penalties");
      resolvedBy = "penalties";
      finalAdvance = penalties.winner;
    } else {
      const extraTime = buildExtraStage(core, mode, stageInput.extra);
      stages.extraTime = extraTime;
      route.push("extraTime");
      resolvedBy = "extraTime";
      const extraResults = resultsFor(
        core,
        mode,
        extraTime.directResult,
        extraTime.structureHomeGoals,
        extraTime.structureAwayGoals
      );
      finalAdvance = consensusWinner(extraResults) || finalAdvance;

      if (hasDraw(extraResults)) {
        const penalties = buildPenaltyStage(core, stageInput.penalty);
        stages.penalties = penalties;
        route.push("penalties");
        resolvedBy = "penalties";
        finalAdvance = penalties.winner;
      }
    }
  }

  prediction.advance = finalAdvance;
  prediction.knockout = {
    version: prediction.knockout?.version || "1.0.0",
    rule: match.knockoutRule,
    route,
    stages,
    finalAdvance,
    resolvedBy,
  };

  return { ...record, match, prediction, updatedAt: now };
}

export const footballRecordKnockoutEditModel = Object.freeze({
  ADVANCE_SCOPE,
  EXTRA_RULE,
  PENALTY_RULE,
  VALID_RESULTS,
  VALID_WINNERS,
  KNOCKOUT_STAGES,
  EXTRA_SPECS,
  PENALTY_SPECS,
  specsFor,
  drawCards,
  stageCardsFromRecord,
  validateStageCards,
  resultsFor,
  hasDraw,
  consensusWinner,
  isKnockoutEligible,
  buildExtraStage,
  buildPenaltyStage,
  buildKnockoutRecord,
});
