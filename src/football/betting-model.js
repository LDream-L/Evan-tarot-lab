// 塔羅X賽事驗證｜足球運彩單注模型
//
// 僅處理「不串關、單一投注項目」且能由 90 分鐘正式比分自動結算的台灣運彩足球玩法。
// 半場、第一球／下一球、最後進球、得分較高半場、角球、冠軍與特別項目
// 需要額外賽況，保留在後續擴充，不以最終比分猜測結果。
//
// 主要函式複雜度：
// - validateBet／settleBet／describeBet：時間／空間 O(1)。
// - summarizeBets：時間 O(b)、額外空間 O(1)，b = 單一牌源下注筆數。
// - normalizeLockedBets：時間／空間 O(b)。
//
// 更快替代方案比較：
// - 暴力法：用自由文字比對「客勝／浙江勝／客隊贏」等字串，容易誤判且需要多次搜尋。
// - 優化法：投注種類與選項全部存結構化代碼，每筆結算固定 O(1)，整組只掃一次 O(b)。

export const FOOTBALL_BET_MARKETS = Object.freeze({
  match_result: Object.freeze({ category: "result", label: "不讓分" }),
  handicap_result: Object.freeze({ category: "result", label: "讓分" }),
  double_chance: Object.freeze({ category: "result", label: "雙勝" }),
  total_over_under: Object.freeze({ category: "goals", label: "大小" }),
  team_total_over_under: Object.freeze({ category: "goals", label: "主(客)隊大小" }),
  odd_even: Object.freeze({ category: "goals", label: "單雙" }),
  team_odd_even: Object.freeze({ category: "goals", label: "主(客)隊單雙" }),
  total_goal_range: Object.freeze({ category: "goals", label: "足球總進球數" }),
  exact_total_goals: Object.freeze({ category: "goals", label: "正確進球數" }),
  exact_team_goals: Object.freeze({ category: "goals", label: "主(客)隊正確進球數" }),
  exact_score: Object.freeze({ category: "score", label: "正確比數" }),
  both_teams_score: Object.freeze({ category: "score", label: "兩隊是否都進球" }),
  // 舊版相容：曾錯誤開放的跨項目組合，只保留既有紀錄讀取／結算，不再出現在新增 UI。
  result_btts: Object.freeze({ category: "legacy", label: "舊版組合：不讓分／兩隊是否都進球", legacyOnly: true }),
});

export const FOOTBALL_BET_CATEGORIES = Object.freeze([
  Object.freeze({ id: "result", label: "賽果", markets: Object.freeze(["match_result", "handicap_result", "double_chance"]) }),
  Object.freeze({ id: "goals", label: "進球", markets: Object.freeze([
    "total_over_under",
    "team_total_over_under",
    "odd_even",
    "team_odd_even",
    "total_goal_range",
    "exact_total_goals",
    "exact_team_goals",
  ]) }),
  Object.freeze({ id: "score", label: "比分", markets: Object.freeze(["exact_score", "both_teams_score"]) }),
]);

export const DEFERRED_FOOTBALL_MARKETS = Object.freeze([
  "半場不讓分",
  "半場讓分",
  "半場雙勝",
  "半場大小",
  "半場主(客)隊大小",
  "半場單雙",
  "半場正確進球數",
  "上半場正確比數",
  "第一球／下一球",
  "最後進球球隊",
  "半／全場",
  "得分較高半場",
  "主(客)隊得分較高半場",
  "角球數大小",
  "角球數不讓分",
  "角球數單雙",
  "角球數區間",
  "冠軍",
  "特別項目",
]);

const RESULT_LABELS = Object.freeze({ H: "主勝", D: "和局", A: "客勝" });
const DOUBLE_CHANCE_LABELS = Object.freeze({ AD: "客勝或和局", DH: "和局或主勝", AH: "客勝或主勝" });
const YES_NO_LABELS = Object.freeze({ YES: "是", NO: "否" });
const ODD_EVEN_LABELS = Object.freeze({ ODD: "單", EVEN: "雙" });
const OVER_UNDER_LABELS = Object.freeze({ OVER: "大", UNDER: "小" });
const GOAL_RANGE_LABELS = Object.freeze({ R01: "0–1 球", R23: "2–3 球", R45: "4–5 球", R6P: "6 球+" });

/** 金額四捨五入至小數兩位：時間／空間 O(1)。 */
export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** 90 分鐘賽果：時間／空間 O(1)。 */
export function getBetResult(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return "H";
  if (homeGoals < awayGoals) return "A";
  return "D";
}

/** 單筆賽前潛在收益，不含本金：時間／空間 O(1)。 */
export function calculatePotentialProfit(stake, odds) {
  const normalizedStake = Number(stake);
  const normalizedOdds = Number(odds);
  if (!Number.isFinite(normalizedStake) || !Number.isFinite(normalizedOdds)) return null;
  return roundMoney(normalizedStake * (normalizedOdds - 1));
}

/**
 * 驗證單筆結構化投注。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 更快替代方案比較：逐欄以 regex 猜自由文字會增加分支且不穩定；
 * 本版依 marketType 直接查固定必填欄位，所有分支上限固定。
 */
export function validateBet(bet) {
  if (!bet || !FOOTBALL_BET_MARKETS[bet.marketType]) return "請選擇有效的投注項目。";
  const odds = Number(bet.odds);
  const stake = Number(bet.stake);
  if (!Number.isFinite(odds) || odds < 1.01 || odds > 999) return "倍率必須介於 1.01 與 999。";
  if (!Number.isFinite(stake) || stake <= 0) return "成本必須大於 0。";

  const validResult = bet.selection === "H" || bet.selection === "D" || bet.selection === "A";
  const validTeam = bet.team === "H" || bet.team === "A";
  const validOverUnder = bet.selection === "OVER" || bet.selection === "UNDER";
  const validOddEven = bet.selection === "ODD" || bet.selection === "EVEN";
  const validYesNo = bet.selection === "YES" || bet.selection === "NO";

  switch (bet.marketType) {
    case "match_result":
      return validResult ? "" : "請選擇不讓分結果。";
    case "handicap_result": {
      const awayBonus = Number(bet.awayBonus);
      const homeBonus = Number(bet.homeBonus);
      if (!validResult) return "請選擇讓分後結果。";
      if (!Number.isInteger(awayBonus) || !Number.isInteger(homeBonus) || awayBonus < 0 || homeBonus < 0) {
        return "足球讓分必須填寫非負整數。";
      }
      if (awayBonus === 0 && homeBonus === 0) return "讓分不能同時為 0：0。";
      return "";
    }
    case "double_chance":
      return ["AD", "DH", "AH"].includes(bet.selection) ? "" : "請選擇雙勝組合。";
    case "total_over_under":
      return validOverUnder && Number.isFinite(Number(bet.line)) && Number(bet.line) >= 0
        ? ""
        : "請完整填寫大小盤口與方向。";
    case "team_total_over_under":
      return validTeam && validOverUnder && Number.isFinite(Number(bet.line)) && Number(bet.line) >= 0
        ? ""
        : "請完整填寫球隊、大小盤口與方向。";
    case "odd_even":
      return validOddEven ? "" : "請選擇單或雙。";
    case "team_odd_even":
      return validTeam && validOddEven ? "" : "請完整填寫球隊與單雙。";
    case "total_goal_range":
      return ["R01", "R23", "R45", "R6P"].includes(bet.selection) ? "" : "請選擇總進球區間。";
    case "exact_total_goals":
      return Number.isInteger(Number(bet.goalCount)) && Number(bet.goalCount) >= 0 && Number(bet.goalCount) <= 6
        ? ""
        : "正確進球數請選擇 0–5 球或 6 球+。";
    case "exact_team_goals":
      return validTeam && Number.isInteger(Number(bet.goalCount)) && Number(bet.goalCount) >= 0 && Number(bet.goalCount) <= 6
        ? ""
        : "請完整填寫球隊與正確進球數。";
    case "exact_score":
      return Number.isInteger(Number(bet.homeGoals)) && Number.isInteger(Number(bet.awayGoals))
        && Number(bet.homeGoals) >= 0 && Number(bet.homeGoals) <= 20
        && Number(bet.awayGoals) >= 0 && Number(bet.awayGoals) <= 20
        ? ""
        : "正確比數必須是 0–20 的整數。";
    case "both_teams_score":
      return validYesNo ? "" : "請選擇兩隊是否都進球。";
    case "result_btts":
      return validResult && (bet.btts === "YES" || bet.btts === "NO")
        ? ""
        : "請完整填寫不讓分結果與兩隊是否都進球。";
    default:
      return "尚未支援此投注項目。";
  }
}

/** 大小盤單一值判斷：時間／空間 O(1)。 */
function settleOverUnder(value, line, selection) {
  if (value === line) return "void";
  if (selection === "OVER") return value > line ? "won" : "lost";
  return value < line ? "won" : "lost";
}

/** 正確進球數（6 代表 6+）判斷：時間／空間 O(1)。 */
function matchesGoalCount(actualGoals, selectedCount) {
  return selectedCount === 6 ? actualGoals >= 6 : actualGoals === selectedCount;
}

/**
 * 用 90 分鐘正式比分結算一筆投注。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 更快替代方案比較：用每種玩法各自掃描比分／紀錄屬多餘工作；
 * 本版只取本筆需要的固定數值並直接分支，不建立中間集合。
 */
export function settleBet(bet, actual) {
  const error = validateBet(bet);
  if (error) return Object.freeze({ status: "invalid", profit: null, error });
  const home = Number(actual?.homeGoals);
  const away = Number(actual?.awayGoals);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    return Object.freeze({ status: "pending", profit: null, error: "" });
  }

  const total = home + away;
  const actualResult = getBetResult(home, away);
  const bothScored = home > 0 && away > 0;
  let status = "lost";

  switch (bet.marketType) {
    case "match_result":
      status = bet.selection === actualResult ? "won" : "lost";
      break;
    case "handicap_result": {
      const adjustedAway = away + Number(bet.awayBonus);
      const adjustedHome = home + Number(bet.homeBonus);
      status = bet.selection === getBetResult(adjustedHome, adjustedAway) ? "won" : "lost";
      break;
    }
    case "double_chance": {
      const allowed = bet.selection === "AD" ? ["A", "D"] : bet.selection === "DH" ? ["D", "H"] : ["A", "H"];
      status = allowed.includes(actualResult) ? "won" : "lost";
      break;
    }
    case "total_over_under":
      status = settleOverUnder(total, Number(bet.line), bet.selection);
      break;
    case "team_total_over_under":
      status = settleOverUnder(bet.team === "H" ? home : away, Number(bet.line), bet.selection);
      break;
    case "odd_even":
      status = (total % 2 === 0 ? "EVEN" : "ODD") === bet.selection ? "won" : "lost";
      break;
    case "team_odd_even": {
      const value = bet.team === "H" ? home : away;
      status = (value % 2 === 0 ? "EVEN" : "ODD") === bet.selection ? "won" : "lost";
      break;
    }
    case "total_goal_range": {
      const range = total <= 1 ? "R01" : total <= 3 ? "R23" : total <= 5 ? "R45" : "R6P";
      status = range === bet.selection ? "won" : "lost";
      break;
    }
    case "exact_total_goals":
      status = matchesGoalCount(total, Number(bet.goalCount)) ? "won" : "lost";
      break;
    case "exact_team_goals":
      status = matchesGoalCount(bet.team === "H" ? home : away, Number(bet.goalCount)) ? "won" : "lost";
      break;
    case "exact_score":
      status = home === Number(bet.homeGoals) && away === Number(bet.awayGoals) ? "won" : "lost";
      break;
    case "both_teams_score":
      status = (bothScored ? "YES" : "NO") === bet.selection ? "won" : "lost";
      break;
    case "result_btts":
      status = bet.selection === actualResult && bet.btts === (bothScored ? "YES" : "NO") ? "won" : "lost";
      break;
    default:
      return Object.freeze({ status: "invalid", profit: null, error: "尚未支援此投注項目。" });
  }

  const stake = roundMoney(bet.stake);
  const profit = status === "won"
    ? calculatePotentialProfit(stake, bet.odds)
    : status === "void" ? 0 : roundMoney(-stake);
  return Object.freeze({ status, profit, error: "" });
}

/** 球隊標籤：時間／空間 O(1)。 */
function teamLabel(team, match) {
  return team === "H" ? (match?.homeTeam || "主隊") : (match?.awayTeam || "客隊");
}

/** 進球數選項：時間／空間 O(1)。 */
function goalCountLabel(value) {
  return Number(value) === 6 ? "6 球+" : `${Number(value)} 球`;
}

/**
 * 結構化投注轉成人類可讀文字。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function describeBet(bet, match = {}) {
  const market = FOOTBALL_BET_MARKETS[bet?.marketType];
  if (!market) return "未知投注";
  switch (bet.marketType) {
    case "match_result":
      return `${market.label}｜${RESULT_LABELS[bet.selection] || "—"}`;
    case "handicap_result":
      return `${market.label} ${Number(bet.awayBonus)}:${Number(bet.homeBonus)}（客:主）｜${RESULT_LABELS[bet.selection] || "—"}`;
    case "double_chance":
      return `${market.label}｜${DOUBLE_CHANCE_LABELS[bet.selection] || "—"}`;
    case "total_over_under":
      return `${market.label}｜${OVER_UNDER_LABELS[bet.selection] || "—"} ${bet.line}`;
    case "team_total_over_under":
      return `${teamLabel(bet.team, match)}大小｜${OVER_UNDER_LABELS[bet.selection] || "—"} ${bet.line}`;
    case "odd_even":
      return `${market.label}｜${ODD_EVEN_LABELS[bet.selection] || "—"}`;
    case "team_odd_even":
      return `${teamLabel(bet.team, match)}單雙｜${ODD_EVEN_LABELS[bet.selection] || "—"}`;
    case "total_goal_range":
      return `${market.label}｜${GOAL_RANGE_LABELS[bet.selection] || "—"}`;
    case "exact_total_goals":
      return `${market.label}｜${goalCountLabel(bet.goalCount)}`;
    case "exact_team_goals":
      return `${teamLabel(bet.team, match)}正確進球數｜${goalCountLabel(bet.goalCount)}`;
    case "exact_score":
      return `${market.label}｜${match?.homeTeam || "主隊"} ${Number(bet.homeGoals)}:${Number(bet.awayGoals)} ${match?.awayTeam || "客隊"}`;
    case "both_teams_score":
      return `${market.label}｜${YES_NO_LABELS[bet.selection] || "—"}`;
    case "result_btts":
      return `${market.label}｜${RESULT_LABELS[bet.selection] || "—"}／${YES_NO_LABELS[bet.btts] || "—"}`;
    default:
      return market.label;
  }
}

/**
 * 鎖定前將下注複製成不可回寫的資料快照。
 * 時間複雜度：O(b)
 * 空間複雜度：O(b)
 *
 * 更快替代方案比較：直接保存 UI state 雖少一次複製，但後續 UI 修改可能污染已鎖定紀錄；
 * 本版只在鎖定瞬間複製一次，換取資料不可變性。
 */
export function normalizeLockedBets(bets, { createId, lockedAt } = {}) {
  const source = Array.isArray(bets) ? bets : [];
  const timestamp = lockedAt || new Date().toISOString();
  return source.map((bet, index) => {
    const error = validateBet(bet);
    if (error) throw new Error(`第 ${index + 1} 筆運彩：${error}`);
    return Object.freeze({
      ...bet,
      id: bet.id || (typeof createId === "function" ? createId() : `bet_${Date.now()}_${index}`),
      odds: Number(bet.odds),
      stake: roundMoney(bet.stake),
      lockedAt: timestamp,
    });
  });
}

/**
 * 單次掃描本牌源全部投注，產生賽前／賽後總計。
 * 時間複雜度：O(b)
 * 空間複雜度：O(1)
 *
 * 更快替代方案比較：分別 reduce 成本、潛在收益、實際損益會掃三次；
 * 本版同一迴圈一次完成所有加總。
 */
export function summarizeBets(bets, actual = null) {
  const source = Array.isArray(bets) ? bets : [];
  let totalStake = 0;
  let potentialProfit = 0;
  let actualProfit = 0;
  let settledStake = 0;
  let won = 0;
  let lost = 0;
  let voided = 0;
  let settled = 0;

  for (let index = 0; index < source.length; index += 1) {
    const bet = source[index];
    const stake = Number(bet.stake) || 0;
    totalStake += stake;
    potentialProfit += calculatePotentialProfit(stake, bet.odds) || 0;
    const settlement = settleBet(bet, actual);
    if (settlement.status === "won" || settlement.status === "lost" || settlement.status === "void") {
      settled += 1;
      settledStake += stake;
      actualProfit += Number(settlement.profit) || 0;
      if (settlement.status === "won") won += 1;
      if (settlement.status === "lost") lost += 1;
      if (settlement.status === "void") voided += 1;
    }
  }

  return Object.freeze({
    count: source.length,
    totalStake: roundMoney(totalStake),
    potentialProfit: roundMoney(potentialProfit),
    actualProfit: roundMoney(actualProfit),
    settledStake: roundMoney(settledStake),
    settled,
    won,
    lost,
    voided,
  });
}

export const footballBettingModel = Object.freeze({
  markets: FOOTBALL_BET_MARKETS,
  categories: FOOTBALL_BET_CATEGORIES,
  deferredMarkets: DEFERRED_FOOTBALL_MARKETS,
  roundMoney,
  getBetResult,
  calculatePotentialProfit,
  validateBet,
  settleBet,
  describeBet,
  normalizeLockedBets,
  summarizeBets,
});
