const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "src", "football", "betting-model.js");

/** 時間／空間 O(n)，n = 模組文字長度。 */
async function loadModel() {
  const source = fs.readFileSync(SOURCE, "utf8");
  const file = path.join(os.tmpdir(), `football-betting-model-${Date.now()}.mjs`);
  fs.writeFileSync(file, source);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 固定案例：時間／空間 O(1)。 */
async function run() {
  const model = await loadModel();

  assert.equal(model.calculatePotentialProfit(500, 2.35), 675);

  const awayWin = { marketType: "match_result", selection: "A", odds: 2.35, stake: 500 };
  assert.deepEqual(model.settleBet(awayWin, { homeGoals: 0, awayGoals: 1 }), {
    status: "won", profit: 675, error: "",
  });
  assert.deepEqual(model.settleBet(awayWin, { homeGoals: 2, awayGoals: 1 }), {
    status: "lost", profit: -500, error: "",
  });

  const handicapHome = {
    marketType: "handicap_result",
    awayBonus: 0,
    homeBonus: 2,
    selection: "H",
    odds: 1.3,
    stake: 1000,
  };
  assert.equal(model.settleBet(handicapHome, { homeGoals: 1, awayGoals: 1 }).status, "won");

  const exact = { marketType: "exact_score", homeGoals: 0, awayGoals: 1, odds: 6.5, stake: 200 };
  assert.equal(model.settleBet(exact, { homeGoals: 0, awayGoals: 1 }).profit, 1100);

  const range = { marketType: "total_goal_range", selection: "R23", odds: 1.94, stake: 300 };
  assert.equal(model.settleBet(range, { homeGoals: 1, awayGoals: 1 }).status, "won");

  const btts = { marketType: "both_teams_score", selection: "YES", odds: 1.94, stake: 60 };
  assert.equal(model.settleBet(btts, { homeGoals: 2, awayGoals: 1 }).status, "won");

  const selectableMarkets = model.FOOTBALL_BET_CATEGORIES.flatMap((category) => category.markets);
  assert.equal(selectableMarkets.includes("result_btts"), false);
  assert.equal(model.FOOTBALL_BET_CATEGORIES.some((category) => category.id === "combo"), false);
  // 舊版錯誤組合若已鎖定仍可讀取與結算，避免破壞歷史資料。
  const legacyCombo = { marketType: "result_btts", selection: "H", btts: "YES", odds: 2.25, stake: 400 };
  assert.equal(model.settleBet(legacyCombo, { homeGoals: 2, awayGoals: 1 }).status, "won");

  const summary = model.summarizeBets([awayWin, exact], { homeGoals: 0, awayGoals: 1 });
  assert.equal(summary.totalStake, 700);
  assert.equal(summary.settledStake, 700);
  assert.equal(summary.actualProfit, 1775);
  assert.equal(summary.won, 2);

  const locked = model.normalizeLockedBets([awayWin], {
    createId: () => "bet-1",
    lockedAt: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(locked[0].id, "bet-1");
  assert.equal(locked[0].lockedAt, "2026-08-06T00:00:00.000Z");
  assert.ok(Object.isFrozen(locked[0]));

  console.log("football betting model tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
