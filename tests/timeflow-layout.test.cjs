const assert = require("node:assert/strict");
const path = require("node:path");

const state = {
  ui: {
    zoom: 1,
    viewMode: "all",
    activeTopicId: "all",
    activeTimelineId: "line-1",
    filterStatus: "all",
    filterCategory: "all",
    search: "",
  },
  topics: [{ id: "topic-1", title: "主題一", color: "#b794ff" }],
  timelines: [{ id: "line-1", topicId: "topic-1", title: "時間線一", createdAt: "2026-01-01" }],
  nodes: [],
};

function dayNumber(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function dayParts(value) {
  const date = new Date(value * 86400000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function dateRange(node) {
  if (node.precision === "unknown") return { start: null, end: null, label: "日期不詳" };
  if (node.precision === "day") {
    const [year, month, day] = node.dateValue.split("-").map(Number);
    const value = dayNumber(year, month, day);
    return { start: value, end: value, label: node.dateValue };
  }
  if (node.precision === "month") {
    const [year, month] = node.dateValue.split("-").map(Number);
    return {
      start: dayNumber(year, month, 1),
      end: dayNumber(year, month + 1, 0),
      label: node.dateValue,
    };
  }
  const year = Number(node.dateValue);
  return {
    start: dayNumber(year, 1, 1),
    end: dayNumber(year, 12, 31),
    label: node.dateValue,
  };
}

global.document = {
  getElementById: () => null,
  createElement: () => ({ id: "", textContent: "" }),
  head: { appendChild: () => {} },
};

global.window = {
  EvanTimeflowV5: {
    ctx: {
      state,
      timelineIndex: new Map(state.timelines.map((item) => [item.id, item])),
      topicIndex: new Map(state.topics.map((item) => [item.id, item])),
    },
    constants: { MIN_ZOOM: 0.35 },
    activeTopics: () => state.topics,
    activeTimelines: () => state.timelines,
    activeNodes: () => state.nodes,
    dateRange,
    dayNumber,
    dayParts,
    parentLineId: () => "",
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    today: () => "2026-07-10",
  },
};

const modulePath = path.resolve(__dirname, "../JS/timeflow-v5-layout.js");
delete require.cache[modulePath];
require(modulePath);
const TF = global.window.EvanTimeflowV5;

function assertNoOverlap(items, gap) {
  const byLevel = new Map();
  items.forEach((item) => {
    if (!byLevel.has(item.level)) byLevel.set(item.level, []);
    byLevel.get(item.level).push(item);
  });

  byLevel.forEach((levelItems) => {
    levelItems.sort((a, b) => a.start - b.start);
    for (let index = 1; index < levelItems.length; index += 1) {
      assert.ok(
        levelItems[index].start > levelItems[index - 1].end + gap,
        `level ${levelItems[index].level} has overlap`
      );
    }
  });
}

function bruteAllocate(items, gap) {
  const levelEnds = [];
  return items.map((item) => {
    let level = 0;
    while (level < levelEnds.length && item.start <= levelEnds[level] + gap) level += 1;
    if (level === levelEnds.length) levelEnds.push(item.end);
    else levelEnds[level] = item.end;
    return { ...item, level };
  });
}

(function testLevelReuse() {
  const input = [
    { id: "a", start: 0, end: 100 },
    { id: "b", start: 1, end: 2 },
    { id: "c", start: 3, end: 4 },
    { id: "d", start: 101, end: 102 },
  ];
  const output = TF.allocateLevels(input, "start", "end", 0);
  assert.deepEqual(output.map((item) => item.level), [0, 1, 1, 0]);
  assertNoOverlap(output, 0);
})();

(function testGapBoundary() {
  const touching = TF.allocateLevels(
    [{ start: 0, end: 10 }, { start: 12, end: 20 }],
    "start",
    "end",
    2
  );
  assert.deepEqual(touching.map((item) => item.level), [0, 1]);

  const separated = TF.allocateLevels(
    [{ start: 0, end: 10 }, { start: 13, end: 20 }],
    "start",
    "end",
    2
  );
  assert.deepEqual(separated.map((item) => item.level), [0, 0]);
})();

(function testFullOverlap() {
  const input = Array.from({ length: 500 }, (_, index) => ({
    id: index,
    start: 0,
    end: 1000 + index,
  }));
  const output = TF.allocateLevels(input, "start", "end", 0);
  assert.equal(new Set(output.map((item) => item.level)).size, 500);
  assert.equal(Math.max(...output.map((item) => item.level)), 499);
})();

(function compareWithBruteForce() {
  let seed = 20260710;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let round = 0; round < 40; round += 1) {
    const input = Array.from({ length: 200 }, (_, index) => {
      const start = Math.floor(random() * 2000);
      const length = 1 + Math.floor(random() * 120);
      return { id: index, start, end: start + length };
    }).sort((a, b) => a.start - b.start || a.end - b.end);

    const fast = TF.allocateLevels(input, "start", "end", 7);
    const brute = bruteAllocate(input, 7);
    const fastLevels = Math.max(-1, ...fast.map((item) => item.level)) + 1;
    const bruteLevels = Math.max(-1, ...brute.map((item) => item.level)) + 1;
    assert.equal(fastLevels, bruteLevels);
    assertNoOverlap(fast, 7);
  }
})();

(function testBuildLayoutSmoke() {
  state.nodes = [
    {
      id: "day-1",
      timelineId: "line-1",
      title: "精確事件",
      precision: "day",
      dateValue: "2026-07-10",
      status: "pending",
      category: "other",
      tags: [],
    },
    {
      id: "month-1",
      timelineId: "line-1",
      title: "月份事件",
      precision: "month",
      dateValue: "2026-07",
      status: "pending",
      category: "other",
      tags: [],
    },
    {
      id: "unknown-1",
      timelineId: "line-1",
      title: "日期不詳",
      precision: "unknown",
      dateValue: "",
      status: "pending",
      category: "other",
      tags: [],
    },
  ];

  const layout = TF.buildLayout({ lines: state.timelines, nodes: state.nodes });
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.placements.size, 3);
  assert.ok(layout.sceneWidth > 0);
  assert.ok(layout.sceneHeight >= 820);
  assert.equal(layout.visibleLineIds.has("line-1"), true);
})();

console.log("timeflow-layout tests passed");
