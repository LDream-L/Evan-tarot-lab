// 世足賽事驗證｜資料、抽牌模式與回測核心 ES Module
//
// 主要函式複雜度：
// - drawCardGroup：時間／空間 O(n)，n = 牌組張數 78。
// - validateCards：時間／空間 O(p)，p <= 5。
// - calculateStats：時間 O(r)、額外空間 O(1)，r = 紀錄數。
// - importRecords：時間／空間 O(r+i)，i = 匯入紀錄數。
//
// 更快替代方案比較：
// - 舊版把核心只掛在 window.FootballLabCore，依賴載入順序且無法靜態追蹤使用者。
// - 本版匯出具名函式與 footballCore 物件，並暫時回填同名 window API 供其餘舊模組相容。
// - 單張與攻防牌仍分開建模，不把兩套預測混成一組命中率。

import { footballData as data } from "./data.js";

let records = loadRecords();
let draft = null;

/** 本機載入：時間／空間 O(r)。 */
function loadRecords() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(data.storageKey) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === "object")
      : [];
  } catch (error) {
    console.warn("[football-lab] 本機紀錄解析失敗：", error);
    return [];
  }
}

/** 本機儲存：時間／空間 O(r)。 */
function saveRecords() {
  window.localStorage.setItem(data.storageKey, JSON.stringify(records));
}

/** 建立識別碼：時間／空間 O(1)。 */
function createId() {
  return window.crypto?.randomUUID?.()
    || `football_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** rejection sampling：期望時間 O(1)，空間 O(1)。 */
function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("亂數上限不正確。");
  }
  if (!window.crypto?.getRandomValues) {
    throw new Error("此瀏覽器不支援加密亂數，無法進行正式抽牌。");
  }

  const range = 0x100000000;
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);
  let value;
  do {
    window.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % maxExclusive;
}

/** 模式解析：時間／空間 O(1)。 */
export function getMode(recordOrMatch) {
  return recordOrMatch?.match?.mode || recordOrMatch?.mode || "legacy5";
}

/** 時間／空間 O(1)。 */
export function modeIncludesDirect(mode) {
  return mode === "direct" || mode === "dual";
}

/** 時間／空間 O(1)。 */
export function modeIncludesStructure(mode) {
  return mode === "structure" || mode === "dual";
}

/** 固定最多五個牌位：時間／空間 O(p)。 */
export function getExpectedPositions(mode) {
  const expected = [];
  if (modeIncludesDirect(mode)) {
    data.positionSets.direct.forEach((key) => {
      expected.push({ group: "direct", ...data.positionMap[key] });
    });
  }
  if (modeIncludesStructure(mode)) {
    data.positionSets.structure.forEach((key) => {
      expected.push({ group: "structure", ...data.positionMap[key] });
    });
  }
  return expected;
}

/** 時間／空間 O(p)。 */
function createEmptyCards(mode) {
  return getExpectedPositions(mode).map((spec) => ({
    group: spec.group,
    position: spec.key,
    positionTitle: spec.title,
    positionNote: spec.note,
    name: "",
    orientation: "正位",
  }));
}

/** 每個模型獨立洗牌；部分 Fisher-Yates：時間／空間 O(n)，n = 78。 */
function drawCardGroup(specs) {
  const pool = data.deck.slice();
  return specs.map((spec, index) => {
    const swapIndex = index + secureRandomInt(pool.length - index);
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    return {
      group: spec.group,
      position: spec.key,
      positionTitle: spec.title,
      positionNote: spec.note,
      name: pool[index],
      orientation: secureRandomInt(2) === 0 ? "正位" : "逆位",
    };
  });
}

/** 時間 O(n)、空間 O(n)，n = 78。 */
function drawCards(mode) {
  const cards = [];
  if (modeIncludesDirect(mode)) {
    const specs = data.positionSets.direct.map((key) => ({
      group: "direct",
      ...data.positionMap[key],
    }));
    cards.push(...drawCardGroup(specs));
  }
  if (modeIncludesStructure(mode)) {
    const specs = data.positionSets.structure.map((key) => ({
      group: "structure",
      ...data.positionMap[key],
    }));
    cards.push(...drawCardGroup(specs));
  }
  return cards;
}

/** 固定最多 5 張：時間／空間 O(p)。 */
export function validateCards(cards, mode) {
  const expected = getExpectedPositions(mode);
  if (!Array.isArray(cards) || cards.length !== expected.length) {
    return `請完整記錄 ${expected.length} 個牌位。`;
  }

  const usedByGroup = new Map();
  for (let index = 0; index < expected.length; index += 1) {
    const spec = expected[index];
    const card = cards[index];
    if (!card || card.group !== spec.group || card.position !== spec.key) {
      return `第 ${index + 1} 個位置與固定牌位不一致。`;
    }
    if (!data.deck.includes(card.name)) {
      return `請選擇「${spec.title}」抽到的牌。`;
    }
    if (card.orientation !== "正位" && card.orientation !== "逆位") {
      return `請選擇「${spec.title}」的正逆位。`;
    }
    if (!usedByGroup.has(spec.group)) usedByGroup.set(spec.group, new Set());
    const used = usedByGroup.get(spec.group);
    if (used.has(card.name)) {
      return `「${card.name}」在同一組抽牌中重複出現。`;
    }
    used.add(card.name);
  }
  return "";
}

/** 日期格式化：時間／空間 O(1)。 */
export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 時間／空間 O(1)。 */
export function toIsoFromLocal(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** 時間／空間 O(1)。 */
function getBand(goals) {
  return goals >= 3 ? "3+" : String(goals);
}

/** 時間／空間 O(1)。 */
export function getResult(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return "H";
  if (homeGoals < awayGoals) return "A";
  return "D";
}

/** 固定欄位驗證：時間／空間 O(1)。 */
export function validateMatch(match) {
  if (!match.competition || !match.kickoff || !match.homeTeam || !match.awayTeam) {
    return "請完整填寫賽事名稱、開賽時間與兩隊名稱。";
  }
  if (match.homeTeam.localeCompare(match.awayTeam, "zh-Hant", { sensitivity: "base" }) === 0) {
    return "主隊與客隊不能是同一支隊伍。";
  }
  if (!data.modeLabels[match.mode]) return "請選擇實驗模式。";
  if (match.cardSource !== "manual" && match.cardSource !== "random") {
    return "請選擇牌面來源。";
  }
  const odds = [match.odds.home, match.odds.draw, match.odds.away];
  const count = odds.filter((value) => value != null).length;
  if (count !== 0 && count !== 3) {
    return "市場賠率要嘛三項都填，要嘛全部留白。";
  }
  return "";
}

/** 固定兩套模型欄位驗證：時間／空間 O(1)。 */
export function validatePrediction(prediction, mode) {
  if (modeIncludesDirect(mode)) {
    if (!prediction.directResult || !prediction.directNotes) {
      return "請完成單張結果模型的賽果與原始解讀。";
    }
    if (
      !Number.isInteger(prediction.directConfidence)
      || prediction.directConfidence < 1
      || prediction.directConfidence > 5
    ) {
      return "單張結果模型的信心程度不正確。";
    }
  }

  if (modeIncludesStructure(mode)) {
    const scores = [prediction.structureHomeGoals, prediction.structureAwayGoals];
    if (scores.some((value) => !Number.isInteger(value) || value < 0 || value > 20)) {
      return "四張攻防模型必須填寫兩隊 0–20 的整數預測進球。";
    }
    if (!prediction.structureNotes) return "請完成四張攻防模型的原始解讀。";
    if (
      !Number.isInteger(prediction.structureConfidence)
      || prediction.structureConfidence < 1
      || prediction.structureConfidence > 5
    ) {
      return "四張攻防模型的信心程度不正確。";
    }
  }
  return "";
}

/** 建立草稿：隨機模式 O(n)，手動模式 O(p)。 */
export function createDraft(match) {
  if (draft) {
    throw new Error("目前已有尚未鎖定的草稿，不能直接覆蓋。請先放棄原草稿。");
  }
  const cards = match.cardSource === "random"
    ? drawCards(match.mode)
    : createEmptyCards(match.mode);
  draft = { match, cards, drawnAt: new Date().toISOString() };
  return draft;
}

/** 鎖定草稿：時間／空間 O(p)。 */
export function lockDraft(prediction, submittedCards) {
  if (!draft) throw new Error("目前沒有可鎖定的抽牌草稿。");
  const cards = draft.match.cardSource === "manual" ? submittedCards : draft.cards;
  const cardError = validateCards(cards, draft.match.mode);
  if (cardError) throw new Error(cardError);
  const predictionError = validatePrediction(prediction, draft.match.mode);
  if (predictionError) throw new Error(predictionError);

  const record = {
    id: createId(),
    modelVersion: data.modelVersion,
    match: draft.match,
    cards,
    prediction,
    drawnAt: draft.drawnAt,
    lockedAt: new Date().toISOString(),
    actual: null,
  };
  records.push(record);
  draft = null;
  saveRecords();
  return record;
}

/** 舊版五牌位評估：時間／空間 O(1)。 */
function calculateLegacyEvaluation(record) {
  const prediction = record.prediction;
  const actual = record.actual;
  const homeBand = getBand(actual.homeGoals);
  const awayBand = getBand(actual.awayGoals);
  const actualResult = getResult(actual.homeGoals, actual.awayGoals);
  const checks = {
    homeAttack: prediction.homeAttackBand === homeBand,
    homeDefense: prediction.homeDefenseBand === awayBand,
    awayAttack: prediction.awayAttackBand === awayBand,
    awayDefense: prediction.awayDefenseBand === homeBand,
    result: prediction.result === actualResult,
  };
  return {
    type: "legacy5",
    actualResult,
    checks,
    hitCount: Object.values(checks).filter(Boolean).length,
  };
}

/** 單筆評估：時間／空間 O(1)。 */
export function calculateEvaluation(record) {
  if (!record?.actual) return null;
  const mode = getMode(record);
  if (mode === "legacy5") return calculateLegacyEvaluation(record);

  const prediction = record.prediction;
  const actual = record.actual;
  const actualResult = getResult(actual.homeGoals, actual.awayGoals);
  const evaluation = { type: mode, actualResult };

  if (modeIncludesDirect(mode)) {
    evaluation.directResultHit = prediction.directResult === actualResult;
  }
  if (modeIncludesStructure(mode)) {
    const structureResult = getResult(
      prediction.structureHomeGoals,
      prediction.structureAwayGoals
    );
    evaluation.structureResult = structureResult;
    evaluation.structureResultHit = structureResult === actualResult;
    evaluation.structureHomeGoalHit = prediction.structureHomeGoals === actual.homeGoals;
    evaluation.structureAwayGoalHit = prediction.structureAwayGoals === actual.awayGoals;
    evaluation.structureExactHit = evaluation.structureHomeGoalHit && evaluation.structureAwayGoalHit;
    evaluation.structureAbsoluteError =
      Math.abs(prediction.structureHomeGoals - actual.homeGoals)
      + Math.abs(prediction.structureAwayGoals - actual.awayGoals);
  }
  if (mode === "dual") {
    evaluation.modelsAgree = prediction.directResult === evaluation.structureResult;
    evaluation.bothResultHit = evaluation.directResultHit && evaluation.structureResultHit;
  }
  evaluation.advanceEligible = Boolean(prediction.advance && actual.advance);
  evaluation.advanceHit = evaluation.advanceEligible && prediction.advance === actual.advance;
  return evaluation;
}

/** 市場最低賠率選項：固定三項，時間／空間 O(1)。 */
function getMarketFavorite(record) {
  const odds = record.match?.odds || {};
  if (![odds.home, odds.draw, odds.away].every(Number.isFinite)) return "";
  return [["H", odds.home], ["D", odds.draw], ["A", odds.away]]
    .sort((left, right) => left[1] - right[1])[0][0];
}

/** 單次掃描所有紀錄：時間 O(r)、額外空間 O(1)。 */
export function calculateStats() {
  const stats = {
    total: records.length,
    completed: 0,
    directEligible: 0,
    directHits: 0,
    structureEligible: 0,
    structureResultHits: 0,
    structureExactHits: 0,
    structureErrorTotal: 0,
    dualEligible: 0,
    dualAgreements: 0,
    marketEligible: 0,
    marketHits: 0,
    legacyCompleted: 0,
  };

  records.forEach((record) => {
    const evaluation = calculateEvaluation(record);
    if (!evaluation) return;
    stats.completed += 1;
    if (evaluation.type === "legacy5") {
      stats.legacyCompleted += 1;
      return;
    }
    if (modeIncludesDirect(evaluation.type)) {
      stats.directEligible += 1;
      stats.directHits += evaluation.directResultHit ? 1 : 0;
    }
    if (modeIncludesStructure(evaluation.type)) {
      stats.structureEligible += 1;
      stats.structureResultHits += evaluation.structureResultHit ? 1 : 0;
      stats.structureExactHits += evaluation.structureExactHit ? 1 : 0;
      stats.structureErrorTotal += evaluation.structureAbsoluteError;
    }
    if (evaluation.type === "dual") {
      stats.dualEligible += 1;
      stats.dualAgreements += evaluation.modelsAgree ? 1 : 0;
    }
    const favorite = getMarketFavorite(record);
    if (favorite) {
      stats.marketEligible += 1;
      stats.marketHits += favorite === evaluation.actualResult ? 1 : 0;
    }
  });
  return stats;
}

/** 更新實際結果：查找 O(r)，額外空間 O(1)。 */
export function updateActual(recordId, actual) {
  const record = records.find((item) => item.id === recordId);
  if (!record) throw new Error("找不到對應紀錄。");
  record.actual = { ...actual, recordedAt: new Date().toISOString() };
  saveRecords();
  return record;
}

/** 刪除紀錄：時間／空間 O(r)。 */
export function deleteRecord(recordId) {
  records = records.filter((item) => item.id !== recordId);
  saveRecords();
}

/** 合併匯入：時間／空間 O(r+i)。 */
export function importRecords(imported) {
  const valid = imported.filter(
    (item) => item?.id && item?.match && item?.prediction && Array.isArray(item?.cards)
  );
  const map = new Map(records.map((item) => [item.id, item]));
  valid.forEach((item) => map.set(item.id, item));
  records = Array.from(map.values());
  saveRecords();
  return valid.length;
}

/** 取得紀錄快照：時間／空間 O(r)。 */
export function getRecords() {
  return records.slice();
}

/** 查找單筆：時間 O(r)、空間 O(1)。 */
export function getRecord(id) {
  return records.find((item) => item.id === id) || null;
}

/** 時間／空間 O(1)。 */
export function getDraft() {
  return draft;
}

/** 時間／空間 O(1)。 */
export function clearDraft() {
  draft = null;
}

export const footballCore = Object.freeze({
  data,
  getRecords,
  getRecord,
  getDraft,
  clearDraft,
  getMode,
  modeIncludesDirect,
  modeIncludesStructure,
  getExpectedPositions,
  createDraft,
  lockDraft,
  validateCards,
  validateMatch,
  validatePrediction,
  calculateEvaluation,
  calculateStats,
  updateActual,
  deleteRecord,
  importRecords,
  getResult,
  formatDateTime,
  toIsoFromLocal,
});

// 相容層：其餘 27 個模組尚未完成具名 import 前，維持原本公開 API。
window.FootballLabCore = footballCore;
