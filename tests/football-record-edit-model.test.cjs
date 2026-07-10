const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "record-edit-model.js");

/** 時間／空間複雜度 O(B)，B 為模型 source 大小。 */
function loadModel() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-record-edit-model-"));
  const bundle = path.join(directory, "model.cjs");
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: bundle,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: ["node22"],
    logLevel: "silent",
  });
  delete require.cache[bundle];
  return { model: require(bundle), directory };
}

/** 固定核心 stub：時間／空間 O(1)。 */
function makeCore() {
  return {
    data: { resultLabels: { H: "主隊勝", D: "和局", A: "客隊勝" } },
    getMode(record) { return record.match.mode; },
    modeIncludesDirect(mode) { return mode === "direct" || mode === "dual"; },
    modeIncludesStructure(mode) { return mode === "structure" || mode === "dual"; },
    getResult(home, away) { return home > away ? "H" : home < away ? "A" : "D"; },
    validateMatch(match) {
      if (!match.competition || !match.homeTeam || !match.awayTeam || !match.kickoff) {
        return "賽事欄位不完整。";
      }
      return "";
    },
  };
}

/** 時間／空間 O(p)，p 為固定測試 prediction 大小。 */
function run() {
  const runtime = loadModel();
  const model = runtime.model;
  const core = makeCore();

  try {
    assert.deepEqual(model.taipeiParts("2026-07-12T12:30:00.000Z"), {
      date: "2026-07-12",
      time: "20:30",
    });
    assert.equal(
      model.taipeiInputToIso("2026-07-12", "20:30"),
      "2026-07-12T12:30:00.000Z"
    );
    assert.equal(model.taipeiInputToIso("2026/07/12", "20:30"), "");
    assert.equal(model.resultText(core, 2, 1), "2：1｜主隊勝");
    assert.equal(model.resultText(core, null, 1), "請填寫兩隊進球");
    assert.equal(model.optionalNumber(""), null);
    assert.equal(model.optionalNumber("2.35"), 2.35);
    assert.throws(() => model.nonNegativeInteger("-1", "比分"), /0～20/);

    const baseRecord = {
      id: "R-1",
      match: {
        competition: "舊賽事",
        stage: "小組賽",
        kickoff: "2026-07-12T12:30:00.000Z",
        infoState: "賽前且先發未公布",
        homeTeam: "甲隊",
        awayTeam: "乙隊",
        mode: "structure",
        odds: { home: 2, draw: 3, away: 4 },
        knownInfo: "舊資訊",
      },
      prediction: {
        structureHomeGoals: 1,
        structureAwayGoals: 1,
        structureConfidence: 3,
        structureNotes: "原始解讀",
      },
      cards: [{ name: "愚者", orientation: "正位" }],
      actual: { homeGoals: 1, awayGoals: 0 },
    };
    const values = {
      competition: " 新賽事 ",
      stage: "16強",
      kickoffDate: "2026-07-13",
      kickoffTime: "21:15",
      infoState: "賽前且先發已公布",
      homeTeam: "主隊",
      awayTeam: "客隊",
      homeOdds: "1.85",
      drawOdds: "3.40",
      awayOdds: "4.50",
      knownInfo: " 傷停一人 ",
      structureHomeGoals: "2",
      structureAwayGoals: "1",
      extraFieldVisible: false,
    };

    const updated = model.buildUpdatedRecord(core, baseRecord, values, "2026-07-11T00:00:00.000Z");
    assert.equal(updated.match.competition, "新賽事");
    assert.equal(updated.match.kickoff, "2026-07-13T13:15:00.000Z");
    assert.deepEqual(updated.match.odds, { home: 1.85, draw: 3.4, away: 4.5 });
    assert.equal(updated.prediction.structureHomeGoals, 2);
    assert.equal(updated.prediction.structureAwayGoals, 1);
    assert.equal(updated.prediction.structureNotes, "原始解讀");
    assert.strictEqual(updated.cards, baseRecord.cards);
    assert.strictEqual(updated.actual, baseRecord.actual);
    assert.equal(updated.updatedAt, "2026-07-11T00:00:00.000Z");
    assert.equal(baseRecord.match.competition, "舊賽事", "不得修改原始 match");
    assert.equal(baseRecord.prediction.structureHomeGoals, 1, "不得修改原始 prediction");

    const knockoutRecord = {
      ...baseRecord,
      match: { ...baseRecord.match, mode: "structure", predictionScope: "advance" },
      prediction: {
        ...baseRecord.prediction,
        knockout: {
          version: "1.0.0",
          route: ["regulation", "extraTime", "penalties"],
          resolvedBy: "penalties",
          finalAdvance: "A",
          stages: {
            extraTime: { structureHomeGoals: 0, structureAwayGoals: 0 },
            penalties: { winner: "A", cards: [] },
          },
        },
      },
    };
    const decisive = model.buildUpdatedPrediction(core, knockoutRecord, {
      structureHomeGoals: "3",
      structureAwayGoals: "1",
      extraFieldVisible: false,
    });
    assert.deepEqual(decisive.knockout.route, ["regulation"]);
    assert.deepEqual(decisive.knockout.stages, {});
    assert.equal(decisive.knockout.resolvedBy, "regulation");
    assert.equal(decisive.knockout.finalAdvance, "H");
    assert.equal(decisive.advance, "H");

    const noStages = {
      ...baseRecord,
      match: { ...baseRecord.match, mode: "structure", predictionScope: "advance" },
      prediction: {
        ...baseRecord.prediction,
        knockout: { route: ["regulation"], stages: {}, resolvedBy: "regulation" },
      },
    };
    assert.throws(
      () => model.buildUpdatedPrediction(core, noStages, {
        structureHomeGoals: "1",
        structureAwayGoals: "1",
        extraFieldVisible: false,
      }),
      /沒有後續牌組/
    );

    console.log("football-record-edit model tests passed");
  } finally {
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  }
}

run();
