// 世足賽事驗證 v1.2.0｜資料、抽牌模式與回測核心
// drawCardGroup：O(n) 時間／O(n) 空間，n=78；calculateStats：O(r) 時間／O(1) 額外空間。
// 暴力法會把單張結果與攻防牌混成同一判讀；本版分開建模，再以雙模型模式做對照。
(function defineFootballLabCore() {
  "use strict";

  const data = window.FOOTBALL_LAB_DATA;
  if (!data) throw new Error("FOOTBALL_LAB_DATA 尚未載入。");

  let records = loadRecords();
  let draft = null;

  function loadRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(data.storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
    } catch (error) {
      console.warn("[football-lab] 本機紀錄解析失敗：", error);
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(data.storageKey, JSON.stringify(records));
  }

  function createId() {
    return window.crypto?.randomUUID?.() || `football_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /** rejection sampling：期望時間 O(1)，空間 O(1)。 */
  function secureRandomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("亂數上限不正確。");
    if (!window.crypto?.getRandomValues) throw new Error("此瀏覽器不支援加密亂數，無法進行正式抽牌。");
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

  function getMode(recordOrMatch) {
    return recordOrMatch?.match?.mode || recordOrMatch?.mode || "legacy5";
  }

  function modeIncludesDirect(mode) {
    return mode === "direct" || mode === "dual";
  }

  function modeIncludesStructure(mode) {
    return mode === "structure" || mode === "dual";
  }

  function getExpectedPositions(mode) {
    const expected = [];
    if (modeIncludesDirect(mode)) {
      data.positionSets.direct.forEach((key) => expected.push({ group: "direct", ...data.positionMap[key] }));
    }
    if (modeIncludesStructure(mode)) {
      data.positionSets.structure.forEach((key) => expected.push({ group: "structure", ...data.positionMap[key] }));
    }
    return expected;
  }

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

  /** 每個模型獨立洗牌；部分 Fisher-Yates：O(n) 時間、O(n) 空間，n=78。 */
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

  function drawCards(mode) {
    const cards = [];
    if (modeIncludesDirect(mode)) {
      const specs = data.positionSets.direct.map((key) => ({ group: "direct", ...data.positionMap[key] }));
      cards.push(...drawCardGroup(specs));
    }
    if (modeIncludesStructure(mode)) {
      const specs = data.positionSets.structure.map((key) => ({ group: "structure", ...data.positionMap[key] }));
      cards.push(...drawCardGroup(specs));
    }
    return cards;
  }

  /** 固定最多 5 張：O(p) 時間、O(p) 空間。雙模型分組檢查，允許兩次獨立抽牌出現同名牌。 */
  function validateCards(cards, mode) {
    const expected = getExpectedPositions(mode);
    if (!Array.isArray(cards) || cards.length !== expected.length) return `請完整記錄 ${expected.length} 個牌位。`;
    const usedByGroup = new Map();
    for (let index = 0; index < expected.length; index += 1) {
      const spec = expected[index];
      const card = cards[index];
      if (!card || card.group !== spec.group || card.position !== spec.key) return `第 ${index + 1} 個位置與固定牌位不一致。`;
      if (!data.deck.includes(card.name)) return `請選擇「${spec.title}」抽到的牌。`;
      if (card.orientation !== "正位" && card.orientation !== "逆位") return `請選擇「${spec.title}」的正逆位。`;
      if (!usedByGroup.has(spec.group)) usedByGroup.set(spec.group, new Set());
      const used = usedByGroup.get(spec.group);
      if (used.has(card.name)) return `「${card.name}」在同一組抽牌中重複出現。`;
      used.add(card.name);
    }
    return "";
  }

  function formatDateTime(value) {
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

  function toIsoFromLocal(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function getBand(goals) {
    return goals >= 3 ? "3+" : String(goals);
  }

  function getResult(homeGoals, awayGoals) {
    if (homeGoals > awayGoals) return "H";
    if (homeGoals < awayGoals) return "A";
    return "D";
  }

  function validateMatch(match) {
    if (!match.competition || !match.kickoff || !match.homeTeam || !match.awayTeam) return "請完整填寫賽事名稱、開賽時間與兩隊名稱。";
    if (match.homeTeam.localeCompare(match.awayTeam, "zh-Hant", { sensitivity: "base" }) === 0) return "主隊與客隊不能是同一支隊伍。";
    if (!data.modeLabels[match.mode]) return "請選擇實驗模式。";
    if (match.cardSource !== "manual" && match.cardSource !== "random") return "請選擇牌面來源。";
    const odds = [match.odds.home, match.odds.draw, match.odds.away];
    const count = odds.filter((value) => value != null).length;
    if (count !== 0 && count !== 3) return "市場賠率要嘛三項都填，要嘛全部留白。";
    return "";
  }

  function validatePrediction(prediction, mode) {
    if (modeIncludesDirect(mode)) {
      if (!prediction.directResult || !prediction.directNotes) return "請完成單張結果模型的賽果與原始解讀。";
      if (!Number.isInteger(prediction.directConfidence) || prediction.directConfidence < 1 || prediction.directConfidence > 5) return "單張結果模型的信心程度不正確。";
    }
    if (modeIncludesStructure(mode)) {
      const scores = [prediction.structureHomeGoals, prediction.structureAwayGoals];
      if (scores.some((value) => !Number.isInteger(value) || value < 0 || value > 20)) return "四張攻防模型必須填寫兩隊 0–20 的整數預測進球。";
      if (!prediction.structureNotes) return "請完成四張攻防模型的原始解讀。";
      if (!Number.isInteger(prediction.structureConfidence) || prediction.structureConfidence < 1 || prediction.structureConfidence > 5) return "四張攻防模型的信心程度不正確。";
    }
    return "";
  }

  function createDraft(match) {
    if (draft) throw new Error("目前已有尚未鎖定的草稿，不能直接覆蓋。請先放棄原草稿。");
    const cards = match.cardSource === "random" ? drawCards(match.mode) : createEmptyCards(match.mode);
    draft = { match, cards, drawnAt: new Date().toISOString() };
    return draft;
  }

  function lockDraft(prediction, submittedCards) {
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

  function calculateLegacyEvaluation(record) {
    const p = record.prediction;
    const a = record.actual;
    const homeBand = getBand(a.homeGoals);
    const awayBand = getBand(a.awayGoals);
    const actualResult = getResult(a.homeGoals, a.awayGoals);
    const checks = {
      homeAttack: p.homeAttackBand === homeBand,
      homeDefense: p.homeDefenseBand === awayBand,
      awayAttack: p.awayAttackBand === awayBand,
      awayDefense: p.awayDefenseBand === homeBand,
      result: p.result === actualResult,
    };
    return { type: "legacy5", actualResult, checks, hitCount: Object.values(checks).filter(Boolean).length };
  }

  function calculateEvaluation(record) {
    if (!record?.actual) return null;
    const mode = getMode(record);
    if (mode === "legacy5") return calculateLegacyEvaluation(record);
    const p = record.prediction;
    const a = record.actual;
    const actualResult = getResult(a.homeGoals, a.awayGoals);
    const evaluation = { type: mode, actualResult };

    if (modeIncludesDirect(mode)) {
      evaluation.directResultHit = p.directResult === actualResult;
    }
    if (modeIncludesStructure(mode)) {
      const structureResult = getResult(p.structureHomeGoals, p.structureAwayGoals);
      evaluation.structureResult = structureResult;
      evaluation.structureResultHit = structureResult === actualResult;
      evaluation.structureHomeGoalHit = p.structureHomeGoals === a.homeGoals;
      evaluation.structureAwayGoalHit = p.structureAwayGoals === a.awayGoals;
      evaluation.structureExactHit = evaluation.structureHomeGoalHit && evaluation.structureAwayGoalHit;
      evaluation.structureAbsoluteError = Math.abs(p.structureHomeGoals - a.homeGoals) + Math.abs(p.structureAwayGoals - a.awayGoals);
    }
    if (mode === "dual") {
      evaluation.modelsAgree = p.directResult === evaluation.structureResult;
      evaluation.bothResultHit = evaluation.directResultHit && evaluation.structureResultHit;
    }
    evaluation.advanceEligible = Boolean(p.advance && a.advance);
    evaluation.advanceHit = evaluation.advanceEligible && p.advance === a.advance;
    return evaluation;
  }

  function getMarketFavorite(record) {
    const odds = record.match?.odds || {};
    if (![odds.home, odds.draw, odds.away].every(Number.isFinite)) return "";
    return [["H", odds.home], ["D", odds.draw], ["A", odds.away]].sort((a, b) => a[1] - b[1])[0][0];
  }

  /** 單次掃描所有紀錄：O(r) 時間、O(1) 額外空間。舊版五牌位不混入新版 KPI。 */
  function calculateStats() {
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
      const e = calculateEvaluation(record);
      if (!e) return;
      stats.completed += 1;
      if (e.type === "legacy5") {
        stats.legacyCompleted += 1;
        return;
      }
      if (modeIncludesDirect(e.type)) {
        stats.directEligible += 1;
        stats.directHits += e.directResultHit ? 1 : 0;
      }
      if (modeIncludesStructure(e.type)) {
        stats.structureEligible += 1;
        stats.structureResultHits += e.structureResultHit ? 1 : 0;
        stats.structureExactHits += e.structureExactHit ? 1 : 0;
        stats.structureErrorTotal += e.structureAbsoluteError;
      }
      if (e.type === "dual") {
        stats.dualEligible += 1;
        stats.dualAgreements += e.modelsAgree ? 1 : 0;
      }
      const favorite = getMarketFavorite(record);
      if (favorite) {
        stats.marketEligible += 1;
        stats.marketHits += favorite === e.actualResult ? 1 : 0;
      }
    });
    return stats;
  }

  function updateActual(recordId, actual) {
    const record = records.find((item) => item.id === recordId);
    if (!record) throw new Error("找不到對應紀錄。");
    record.actual = { ...actual, recordedAt: new Date().toISOString() };
    saveRecords();
    return record;
  }

  function deleteRecord(recordId) {
    records = records.filter((item) => item.id !== recordId);
    saveRecords();
  }

  function importRecords(imported) {
    const valid = imported.filter((item) => item?.id && item?.match && item?.prediction && Array.isArray(item?.cards));
    const map = new Map(records.map((item) => [item.id, item]));
    valid.forEach((item) => map.set(item.id, item));
    records = Array.from(map.values());
    saveRecords();
    return valid.length;
  }

  window.FootballLabCore = Object.freeze({
    data,
    getRecords: () => records.slice(),
    getRecord: (id) => records.find((item) => item.id === id) || null,
    getDraft: () => draft,
    clearDraft: () => { draft = null; },
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
})();
