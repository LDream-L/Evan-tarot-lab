// 世足賽事驗證｜單張 90 分鐘整體能量純模型
//
// 本檔只處理固定資料、輸入驗證、預測正規化與結果核對；
// 不讀取 DOM、localStorage，也不修改核心紀錄狀態。
//
// 主要函式複雜度：
// - validateEnergyPrediction：時間／空間 O(1)。
// - normalizeEnergyPrediction：時間／空間 O(1)。
// - applyEnergyEvaluation：時間／空間 O(1)。
// - createEnergyData：時間／空間 O(1)，固定少量模式標籤。
//
// 更快替代方案比較：
// - 在 UI、統計與匯出各自重寫規則，會造成重複判定與版本漂移。
// - 本模組集中成單一查表與單次核對；呼叫端只傳資料，避免重複掃描紀錄或 DOM。

import { footballData } from "./data.js";

export const ENERGY_MODEL_VERSION = footballData.modelVersion;
export const ENERGY_MODEL_KEY = "energy-v1";
export const NON_DRAW_CODE = "ND";

export const GOAL_BANDS = Object.freeze({
  low: Object.freeze({ label: "0–1 球（低比分）", short: "0–1 球" }),
  medium: Object.freeze({ label: "2–3 球（中等比分）", short: "2–3 球" }),
  high: Object.freeze({ label: "4 球以上（高比分）", short: "4 球以上" }),
});

export const DRAW_TENDENCIES = Object.freeze({
  draw: Object.freeze({ label: "和局／進入決勝階段", short: "和局傾向" }),
  decisive: Object.freeze({ label: "90 分鐘內分出勝負", short: "非和局傾向" }),
});

/** 固定查表：時間／空間 O(1)。 */
export function validGoalBand(value) {
  return Object.prototype.hasOwnProperty.call(GOAL_BANDS, value);
}

/** 固定查表：時間／空間 O(1)。 */
export function validDrawTendency(value) {
  return Object.prototype.hasOwnProperty.call(DRAW_TENDENCIES, value);
}

/** 總進球轉區間：時間／空間 O(1)。 */
export function getActualGoalBand(totalGoals) {
  const goals = Number(totalGoals);
  if (!Number.isFinite(goals) || goals < 0) return "";
  if (goals <= 1) return "low";
  if (goals <= 3) return "medium";
  return "high";
}

/** 實際比分轉和局傾向：時間／空間 O(1)。 */
export function getActualDrawTendency(homeGoals, awayGoals) {
  const home = Number(homeGoals);
  const away = Number(awayGoals);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return "";
  return home === away ? "draw" : "decisive";
}

/** 表單相容碼：時間／空間 O(1)。 */
export function directCodeFromTendency(tendency) {
  return tendency === "draw" ? "D" : NON_DRAW_CODE;
}

/** 判斷新版單張能量預測：時間／空間 O(1)。 */
export function isEnergyPrediction(prediction) {
  return Boolean(
    prediction
    && prediction.directModel === ENERGY_MODEL_KEY
    && validGoalBand(prediction.directGoalBand)
    && validDrawTendency(prediction.directDrawTendency)
  );
}

/** 判斷新版單張能量紀錄：時間／空間 O(1)。 */
export function isEnergyRecord(record) {
  return isEnergyPrediction(record?.prediction);
}

/**
 * 驗證單張能量輸入。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function validateEnergyPrediction(prediction, energyInput, includesDirect = true) {
  if (!includesDirect) return "";
  if (!validGoalBand(energyInput?.goalBand)) {
    return "請選擇單張牌對應的 90 分鐘總進球區間。";
  }
  if (!validDrawTendency(energyInput?.drawTendency)) {
    return "請選擇單張牌判斷的 90 分鐘和局傾向。";
  }
  if (!String(prediction?.directNotes || "").trim()) {
    return "請完成單張整體能量的原始解讀。";
  }
  if (
    !Number.isInteger(prediction?.directConfidence)
    || prediction.directConfidence < 1
    || prediction.directConfidence > 5
  ) {
    return "單張整體能量的信心程度不正確。";
  }
  return "";
}

/**
 * 產生送交基礎核心的預測副本，不修改原物件。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function normalizeEnergyPrediction(
  prediction,
  energyInput,
  { includesDirect = true, lock = false } = {}
) {
  if (!includesDirect) return { ...prediction };

  const normalized = {
    ...prediction,
    directResult: directCodeFromTendency(energyInput?.drawTendency),
  };

  if (!lock) return normalized;
  return {
    ...normalized,
    directModel: ENERGY_MODEL_KEY,
    directGoalBand: energyInput?.goalBand || "",
    directDrawTendency: energyInput?.drawTendency || "",
  };
}

/**
 * 將單張能量核對結果疊加到既有評估，不重算攻防與嚴格比分欄位。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function applyEnergyEvaluation(record, baseEvaluation, getMode) {
  if (!baseEvaluation || !isEnergyRecord(record)) return baseEvaluation;

  const actualHome = Number(record.actual?.homeGoals);
  const actualAway = Number(record.actual?.awayGoals);
  const actualTotalGoals = actualHome + actualAway;
  const actualGoalBand = getActualGoalBand(actualTotalGoals);
  const actualDrawTendency = getActualDrawTendency(actualHome, actualAway);
  const goalBandHit = record.prediction.directGoalBand === actualGoalBand;
  const drawTendencyHit = record.prediction.directDrawTendency === actualDrawTendency;

  const next = {
    ...baseEvaluation,
    directModel: ENERGY_MODEL_KEY,
    directResultHit: null,
    directActualTotalGoals: actualTotalGoals,
    directActualGoalBand: actualGoalBand,
    directGoalBandHit: goalBandHit,
    directActualDrawTendency: actualDrawTendency,
    directDrawTendencyHit: drawTendencyHit,
    directEnergyEligibleCount: 2,
    directEnergyHitCount: Number(goalBandHit) + Number(drawTendencyHit),
  };

  const mode = typeof getMode === "function" ? getMode(record) : record?.match?.mode;
  if (mode === "dual" && next.structureResult) {
    next.modelsAgree = (record.prediction.directDrawTendency === "draw")
      === (next.structureResult === "D");
    next.bothResultHit = drawTendencyHit && next.structureResultHit;
  }
  return next;
}

/**
 * 建立只覆寫能量模式文案的不可變資料外殼，共用原查表與牌組。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function createEnergyData(baseData = footballData) {
  const modeLabels = Object.freeze({
    ...baseData.modeLabels,
    direct: "單張整體能量模式",
    dual: "雙模型比較模式",
  });

  return Object.freeze({
    ...baseData,
    modelVersion: ENERGY_MODEL_VERSION,
    modeLabels,
  });
}

export const footballEnergyModel = Object.freeze({
  modelVersion: ENERGY_MODEL_VERSION,
  modelKey: ENERGY_MODEL_KEY,
  nonDrawCode: NON_DRAW_CODE,
  goalBands: GOAL_BANDS,
  drawTendencies: DRAW_TENDENCIES,
  validGoalBand,
  validDrawTendency,
  getActualGoalBand,
  getActualDrawTendency,
  directCodeFromTendency,
  isEnergyPrediction,
  isEnergyRecord,
  validateEnergyPrediction,
  normalizeEnergyPrediction,
  applyEnergyEvaluation,
  createEnergyData,
});

// 相容與除錯入口；不包含 DOM 操作。
window.FootballEnergyModel = footballEnergyModel;
