// 世足賽事驗證｜已鎖定紀錄編輯純資料模型
//
// 本檔只處理日期、賽事欄位、比分與淘汰賽路徑正規化；
// 不讀取 DOM、window、localStorage 或 Google Sheets。
//
// 主要函式複雜度：
// - taipeiParts／taipeiInputToIso／buildUpdatedMatch：時間／空間 O(1)。
// - stageResults／consensusWinner／normalize*Route：時間／空間 O(1)，模型數固定最多 2。
// - buildUpdatedPrediction／buildUpdatedRecord：時間／空間 O(p)，p 為 knockout 階段與牌面資料大小。
//
// 更快替代方案比較：
// - 從畫面文字反解析比分與晉級路徑會重複格式化並容易受文案變更影響。
// - 本模型只讀寫結構化 record／prediction，畫面文字僅由 UI 層呈現。

export const TAIPEI_TIME_ZONE = "Asia/Taipei";
export const TAIPEI_OFFSET = "+08:00";
export const VALID_RESULTS = Object.freeze(new Set(["H", "D", "A"]));

/** 字串清理：時間／空間 O(n)。 */
export function clean(value) {
  return String(value == null ? "" : value).trim();
}

/** 深複製：時間／空間 O(n)，n = 輸入資料大小。 */
export function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** 選填數字：時間／空間 O(1)。 */
export function optionalNumber(value) {
  const raw = clean(value);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** 非負整數驗證：時間／空間 O(1)。 */
export function nonNegativeInteger(value, label, maximum = 20) {
  const raw = clean(value);
  const number = Number(raw);
  if (raw === "" || !Number.isInteger(number) || number < 0 || number > maximum) {
    throw new Error(`請填寫有效的「${label}」（0～${maximum}）。`);
  }
  return number;
}

/** ISO 時間轉台灣日期／時間：時間／空間 O(1)。 */
export function taipeiParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
  };
}

/** 台灣表單日期／時間轉 ISO：時間／空間 O(1)。 */
export function taipeiInputToIso(dateValue, timeValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(dateValue))) return "";
  if (!/^\d{2}:\d{2}$/.test(clean(timeValue))) return "";
  const date = new Date(`${dateValue}T${timeValue}:00${TAIPEI_OFFSET}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** 固定兩個比分推導文字：時間／空間 O(1)。 */
export function resultText(core, home, away) {
  if (!Number.isInteger(home) || !Number.isInteger(away)) return "請填寫兩隊進球";
  const result = core.getResult(home, away);
  return `${home}：${away}｜${core.data.resultLabels[result] || "—"}`;
}

/** 固定賽事欄位更新：時間／空間 O(1)。 */
export function buildUpdatedMatch(record, values) {
  return {
    ...record.match,
    competition: clean(values.competition),
    stage: clean(values.stage),
    kickoff: taipeiInputToIso(values.kickoffDate, values.kickoffTime),
    infoState: clean(values.infoState),
    homeTeam: clean(values.homeTeam),
    awayTeam: clean(values.awayTeam),
    odds: {
      home: optionalNumber(values.homeOdds),
      draw: optionalNumber(values.drawOdds),
      away: optionalNumber(values.awayOdds),
    },
    knownInfo: clean(values.knownInfo),
  };
}

/** 最多兩個模型結果：時間／空間 O(1)。 */
export function stageResults(core, mode, prediction, homeGoals, awayGoals, stage = "regulation") {
  const results = [];
  const directResult = stage === "regulation"
    ? prediction.directResult
    : prediction.knockout?.stages?.extraTime?.directResult;
  if (core.modeIncludesDirect(mode) && VALID_RESULTS.has(directResult)) results.push(directResult);
  if (
    core.modeIncludesStructure(mode)
    && Number.isInteger(homeGoals)
    && Number.isInteger(awayGoals)
  ) {
    results.push(core.getResult(homeGoals, awayGoals));
  }
  return results;
}

/** 固定最多兩項：時間／空間 O(1)。 */
export function consensusWinner(results) {
  const decided = results.filter((result) => result !== "D");
  return decided.length && decided.every((result) => result === decided[0])
    ? decided[0]
    : "";
}

/** 依 90 分鐘比分正規化既有 knockout 路徑：時間／空間 O(1)。 */
export function normalizeRegulationRoute(core, prediction, mode, homeGoals, awayGoals) {
  const knockout = prediction.knockout;
  if (!knockout) return prediction;

  const results = stageResults(core, mode, prediction, homeGoals, awayGoals);
  if (results.includes("D")) {
    const hasExtra = Boolean(knockout.stages?.extraTime);
    const hasPenalties = Boolean(knockout.stages?.penalties);
    if (!hasExtra && !hasPenalties) {
      throw new Error(
        "將 90 分鐘預測改成和局會啟動延長賽／PK，但這筆紀錄沒有後續牌組；請在完整編輯面板補建階段。"
      );
    }
    knockout.route = [
      "regulation",
      ...(hasExtra ? ["extraTime"] : []),
      ...(hasPenalties ? ["penalties"] : []),
    ];
    knockout.resolvedBy = hasPenalties ? "penalties" : "extraTime";
    return prediction;
  }

  const winner = consensusWinner(results);
  knockout.route = ["regulation"];
  knockout.stages = {};
  knockout.resolvedBy = "regulation";
  if (winner) {
    knockout.finalAdvance = winner;
    prediction.advance = winner;
  }
  return prediction;
}

/** 依延長賽比分正規化 PK 路徑：時間／空間 O(1)。 */
export function normalizeExtraTimeRoute(core, prediction, mode, homeGoals, awayGoals) {
  const knockout = prediction.knockout;
  const extra = knockout?.stages?.extraTime;
  if (!knockout || !extra) return prediction;

  const results = stageResults(core, mode, prediction, homeGoals, awayGoals, "extraTime");
  if (results.includes("D")) {
    const penalties = knockout.stages?.penalties;
    if (!penalties) {
      throw new Error(
        "將延長賽預測改成和局會啟動 PK，但這筆紀錄沒有 PK 牌組；請在完整編輯面板補建階段。"
      );
    }
    knockout.route = ["regulation", "extraTime", "penalties"];
    knockout.resolvedBy = "penalties";
    if (VALID_RESULTS.has(penalties.winner) && penalties.winner !== "D") {
      knockout.finalAdvance = penalties.winner;
      prediction.advance = penalties.winner;
    }
    return prediction;
  }

  const winner = consensusWinner(results);
  delete knockout.stages.penalties;
  knockout.route = ["regulation", "extraTime"];
  knockout.resolvedBy = "extraTime";
  if (winner) {
    knockout.finalAdvance = winner;
    prediction.advance = winner;
  }
  return prediction;
}

/**
 * 只修改結構化比分，牌面、信心與解讀原文保留。
 * 時間／空間 O(p)，p = prediction 深複製大小。
 */
export function buildUpdatedPrediction(core, record, values) {
  const prediction = cloneValue(record.prediction || {});
  const mode = core.getMode(record);
  if (mode === "legacy5" || !core.modeIncludesStructure(mode)) return prediction;

  const homeGoals = nonNegativeInteger(values.structureHomeGoals, "90 分鐘主隊預測進球");
  const awayGoals = nonNegativeInteger(values.structureAwayGoals, "90 分鐘客隊預測進球");
  prediction.structureHomeGoals = homeGoals;
  prediction.structureAwayGoals = awayGoals;
  normalizeRegulationRoute(core, prediction, mode, homeGoals, awayGoals);

  const extra = prediction.knockout?.stages?.extraTime;
  if (extra && values.extraFieldVisible) {
    const extraHome = nonNegativeInteger(values.extraStructureHomeGoals, "延長賽主隊新增進球");
    const extraAway = nonNegativeInteger(values.extraStructureAwayGoals, "延長賽客隊新增進球");
    extra.structureHomeGoals = extraHome;
    extra.structureAwayGoals = extraAway;
    normalizeExtraTimeRoute(core, prediction, mode, extraHome, extraAway);
  }
  return prediction;
}

/** 建立完整更新紀錄：時間／空間 O(p)。 */
export function buildUpdatedRecord(core, record, values, now = new Date().toISOString()) {
  const match = buildUpdatedMatch(record, values);
  const validationError = core.validateMatch(match);
  if (validationError) throw new Error(validationError);
  return {
    ...record,
    match,
    prediction: buildUpdatedPrediction(core, record, values),
    updatedAt: now,
  };
}

export const footballRecordEditModel = Object.freeze({
  clean,
  cloneValue,
  optionalNumber,
  nonNegativeInteger,
  taipeiParts,
  taipeiInputToIso,
  resultText,
  buildUpdatedMatch,
  stageResults,
  consensusWinner,
  normalizeRegulationRoute,
  normalizeExtraTimeRoute,
  buildUpdatedPrediction,
  buildUpdatedRecord,
});
