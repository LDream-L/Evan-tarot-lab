const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "record-knockout-edit-model.js");

/** 時間／空間複雜度 O(B)，B 為模型 source 大小。 */
function loadModel() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-knockout-edit-model-"));
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
  const deck = Array.from({ length: 20 }, (_, index) => `牌${index + 1}`);
  return {
    data: {
      deck,
      resultLabels: { H: "主隊勝", D: "和局", A: "客隊勝" },
    },
    getMode(record) { return record.match.mode; },
    modeIncludesDirect(mode) { return mode === "direct" || mode === "dual"; },
    modeIncludesStructure(mode) { return mode === "structure" || mode === "dual"; },
    getResult(home, away) { return home > away ? "H" : home < away ? "A" : "D"; },
    validateMatch(match) {
      return match.competition && match.homeTeam && match.awayTeam && match.kickoff
        ? ""
        : "賽事欄位不完整。";
    },
  };
}

/** 依規格建立不重複牌組：時間／空間 O(p)。 */
function cardsFor(specs, deck, offset = 0) {
  return specs.map((spec, index) => ({
    position: spec[0],
    title: spec[1],
    name: deck[offset + index],
    orientation: index % 2 ? "逆位" : "正位",
  }));
}

/** 固定基本欄位：時間／空間 O(1)。 */
function baseValues(home = "2", away = "1") {
  return {
    competition: "測試盃",
    stage: "16強",
    kickoffDate: "2026-07-12",
    kickoffTime: "20:30",
    infoState: "賽前且先發未公布",
    homeTeam: "甲隊",
    awayTeam: "乙隊",
    homeOdds: "2.10",
    drawOdds: "3.20",
    awayOdds: "3.60",
    knownInfo: "無重大傷停",
    structureHomeGoals: home,
    structureAwayGoals: away,
  };
}

/** 時間／空間 O(p)，p 為固定測試 prediction 與牌組大小。 */
function run() {
  const runtime = loadModel();
  const model = runtime.model;
  const core = makeCore();

  try {
    assert.equal(model.specsFor(core, "direct", "extra").length, 1);
    assert.equal(model.specsFor(core, "structure", "extra").length, 4);
    assert.equal(model.specsFor(core, "dual", "extra").length, 5);
    assert.equal(model.specsFor(core, "structure", "penalty").length, 5);

    const drawn = model.drawCards(core.data.deck, model.specsFor(core, "dual", "extra"), () => 0);
    assert.equal(drawn.length, 5);
    assert.equal(new Set(drawn.map((card) => card.name)).size, 5);
    assert.ok(drawn.every((card) => card.orientation === "正位"));
    assert.throws(
      () => model.validateStageCards(core.data.deck, drawn.slice(0, 4), "延長賽", 5),
      /應有 5 張/
    );
    const duplicated = drawn.map((card) => ({ ...card }));
    duplicated[1].name = duplicated[0].name;
    assert.throws(
      () => model.validateStageCards(core.data.deck, duplicated, "延長賽", 5),
      /重複出現/
    );

    const baseRecord = {
      id: "R-KO",
      match: {
        competition: "舊賽事",
        stage: "16強",
        kickoff: "2026-07-12T12:30:00.000Z",
        infoState: "賽前且先發未公布",
        homeTeam: "甲隊",
        awayTeam: "乙隊",
        mode: "structure",
        cardSource: "manual",
        predictionScope: "advance",
        knockoutRule: model.EXTRA_RULE,
        odds: { home: 2, draw: 3, away: 4 },
        knownInfo: "原始資訊",
      },
      prediction: {
        structureHomeGoals: 2,
        structureAwayGoals: 1,
        structureConfidence: 3,
        structureNotes: "原始攻防解讀",
        advance: "H",
        knockout: {
          version: "1.0.0",
          rule: model.EXTRA_RULE,
          route: ["regulation"],
          stages: {},
          finalAdvance: "H",
          resolvedBy: "regulation",
        },
      },
      cards: [{ name: "牌1", orientation: "正位" }],
      actual: null,
    };

    const unusedStages = {
      extra: { cards: [] },
      penalty: { cards: [] },
    };
    const regulation = model.buildKnockoutRecord(
      core,
      baseRecord,
      baseValues("3", "1"),
      unusedStages,
      "2026-07-11T00:00:00.000Z"
    );
    assert.deepEqual(regulation.prediction.knockout.route, ["regulation"]);
    assert.deepEqual(regulation.prediction.knockout.stages, {});
    assert.equal(regulation.prediction.knockout.finalAdvance, "H");
    assert.equal(regulation.prediction.structureHomeGoals, 3);
    assert.equal(baseRecord.prediction.structureHomeGoals, 2, "不得修改原始 prediction");
    assert.deepEqual(baseRecord.prediction.knockout.route, ["regulation"]);

    const directPkRecord = {
      ...baseRecord,
      match: { ...baseRecord.match, mode: "structure", knockoutRule: model.PENALTY_RULE },
      prediction: {
        ...baseRecord.prediction,
        structureHomeGoals: 1,
        structureAwayGoals: 1,
        knockout: {
          ...baseRecord.prediction.knockout,
          rule: model.PENALTY_RULE,
        },
      },
    };
    const penaltyCards = cardsFor(model.PENALTY_SPECS, core.data.deck, 5);
    const directPk = model.buildKnockoutRecord(
      core,
      directPkRecord,
      baseValues("1", "1"),
      {
        extra: { cards: [] },
        penalty: { cards: penaltyCards, winner: "A", notes: "客隊抗壓較穩" },
      }
    );
    assert.deepEqual(directPk.prediction.knockout.route, ["regulation", "penalties"]);
    assert.equal(directPk.prediction.knockout.resolvedBy, "penalties");
    assert.equal(directPk.prediction.advance, "A");
    assert.equal(directPk.prediction.knockout.stages.penalties.cards.length, 5);

    const extraSpecs = model.specsFor(core, "structure", "extra");
    const extraCards = cardsFor(extraSpecs, core.data.deck, 0);
    const extraDecisive = model.buildKnockoutRecord(
      core,
      baseRecord,
      baseValues("1", "1"),
      {
        extra: {
          cards: extraCards,
          structureHomeGoals: "1",
          structureAwayGoals: "0",
          structureNotes: "延長賽主隊持續施壓",
        },
        penalty: { cards: [] },
      }
    );
    assert.deepEqual(extraDecisive.prediction.knockout.route, ["regulation", "extraTime"]);
    assert.equal(extraDecisive.prediction.knockout.resolvedBy, "extraTime");
    assert.equal(extraDecisive.prediction.advance, "H");
    assert.equal(extraDecisive.prediction.knockout.stages.extraTime.cards.length, 4);

    const extraThenPk = model.buildKnockoutRecord(
      core,
      baseRecord,
      baseValues("1", "1"),
      {
        extra: {
          cards: extraCards,
          structureHomeGoals: "0",
          structureAwayGoals: "0",
          structureNotes: "延長賽仍僵持",
        },
        penalty: {
          cards: penaltyCards,
          winner: "H",
          notes: "主隊門將撲救較穩",
        },
      }
    );
    assert.deepEqual(
      extraThenPk.prediction.knockout.route,
      ["regulation", "extraTime", "penalties"]
    );
    assert.equal(extraThenPk.prediction.knockout.resolvedBy, "penalties");
    assert.equal(extraThenPk.prediction.advance, "H");
    assert.equal(extraThenPk.prediction.structureNotes, "原始攻防解讀");
    assert.strictEqual(extraThenPk.cards, baseRecord.cards);

    assert.throws(
      () => model.buildKnockoutRecord(
        core,
        baseRecord,
        baseValues("1", "1"),
        {
          extra: {
            cards: [],
            structureHomeGoals: "1",
            structureAwayGoals: "0",
            structureNotes: "缺牌",
          },
          penalty: { cards: [] },
        }
      ),
      /應有 4 張/
    );

    console.log("football-record-knockout-edit model tests passed");
  } finally {
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  }
}

run();
