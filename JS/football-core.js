// 世足賽事驗證 v1.0.0｜資料、亂數與回測核心
// drawCards：O(n) 時間／O(n) 空間，n=78；calculateStats：O(r) 時間／O(1) 空間。
// 暴力法會對每個畫面區塊重掃全部紀錄；本版集中單次線性統計並重用結果。
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

  /** 部分 Fisher-Yates：O(n) 時間、O(n) 空間，n=78。 */
  function drawCards() {
    const pool = data.deck.slice();
    const cards = [];
    for (let index = 0; index < data.positions.length; index += 1) {
      const swapIndex = index + secureRandomInt(pool.length - index);
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
      const position = data.positions[index];
      cards.push({
        position: position.key,
        positionTitle: position.title,
        positionNote: position.note,
        name: pool[index],
        orientation: secureRandomInt(2) === 0 ? "正位" : "逆位",
      });
    }
    return cards;
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
    if (!match.competition || !match.kickoff || !match.homeTeam || !match.awayTeam) {
      return "請完整填寫賽事名稱、開賽時間與兩隊名稱。";
    }
    if (match.homeTeam.localeCompare(match.awayTeam, "zh-Hant", { sensitivity: "base" }) === 0) {
      return "主隊與客隊不能是同一支隊伍。";
    }
    const odds = [match.odds.home, match.odds.draw, match.odds.away];
    const count = odds.filter((value) => value != null).length;
    if (count !== 0 && count !== 3) return "市場賠率要嘛三項都填，要嘛全部留白。";
    return "";
  }

  function validatePrediction(prediction) {
    const required = [
      prediction.homeAttackBand,
      prediction.homeDefenseBand,
      prediction.awayAttackBand,
      prediction.awayDefenseBand,
      prediction.result,
      prediction.notes,
    ];
    if (required.some((value) => !value)) return "請完成四項攻防判讀、90 分鐘結果與原始解讀。";
    const exact = [prediction.homeExact, prediction.awayExact];
    const exactCount = exact.filter((value) => value != null).length;
    if (exactCount === 1) return "確切比分需要主客隊兩個數字都填，或兩個都留白。";
    if (exactCount === 2) {
      if (exact.some((value) => !Number.isInteger(value) || value < 0)) return "確切比分必須是 0 以上的整數。";
      if (getBand(prediction.homeExact) !== prediction.homeAttackBand || getBand(prediction.awayExact) !== prediction.awayAttackBand) {
        return "確切比分必須與兩隊得分牌的進球區間一致。";
      }
      if (getResult(prediction.homeExact, prediction.awayExact) !== prediction.result) {
        return "確切比分必須與 90 分鐘最終結果一致。";
      }
    }
    return "";
  }

  function createDraft(match) {
    if (draft) throw new Error("目前已有固定牌面的草稿，不能直接覆蓋重抽。");
    draft = { match, cards: drawCards(), drawnAt: new Date().toISOString() };
    return draft;
  }

  function lockDraft(prediction) {
    if (!draft) throw new Error("目前沒有可鎖定的抽牌草稿。");
    const record = {
      id: createId(),
      modelVersion: data.modelVersion,
      match: draft.match,
      cards: draft.cards,
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

  function calculateEvaluation(record) {
    if (!record?.actual) return null;
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
    const hitCount = Object.values(checks).filter(Boolean).length;
    const exactEligible = p.homeExact != null && p.awayExact != null;
    const advanceEligible = Boolean(p.advance && a.advance);
    return {
      actualResult,
      checks,
      hitCount,
      exactEligible,
      exactHit: exactEligible && p.homeExact === a.homeGoals && p.awayExact === a.awayGoals,
      advanceEligible,
      advanceHit: advanceEligible && p.advance === a.advance,
    };
  }

  function getMarketFavorite(record) {
    const odds = record.match?.odds || {};
    if (![odds.home, odds.draw, odds.away].every(Number.isFinite)) return "";
    return [["H", odds.home], ["D", odds.draw], ["A", odds.away]].sort((a, b) => a[1] - b[1])[0][0];
  }

  /** 單次掃描所有紀錄：O(r) 時間、O(1) 額外空間。 */
  function calculateStats() {
    const stats = {
      total: records.length,
      completed: 0,
      resultHits: 0,
      dimensionHits: 0,
      dimensionTotal: 0,
      exactEligible: 0,
      exactHits: 0,
      marketEligible: 0,
      marketHits: 0,
    };
    records.forEach((record) => {
      const evaluation = calculateEvaluation(record);
      if (!evaluation) return;
      stats.completed += 1;
      stats.resultHits += evaluation.checks.result ? 1 : 0;
      stats.dimensionHits += evaluation.hitCount - (evaluation.checks.result ? 1 : 0);
      stats.dimensionTotal += 4;
      if (evaluation.exactEligible) {
        stats.exactEligible += 1;
        stats.exactHits += evaluation.exactHit ? 1 : 0;
      }
      const favorite = getMarketFavorite(record);
      if (favorite) {
        stats.marketEligible += 1;
        stats.marketHits += favorite === evaluation.actualResult ? 1 : 0;
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
    createDraft,
    lockDraft,
    validateMatch,
    validatePrediction,
    calculateEvaluation,
    calculateStats,
    updateActual,
    deleteRecord,
    importRecords,
    formatDateTime,
    toIsoFromLocal,
  });
})();
