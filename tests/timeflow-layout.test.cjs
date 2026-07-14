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
    showPrivate: true,
  },
  topics: [{ id: "topic-1", title: "主題一", color: "#b794ff" }],
  timelines: [{ id: "line-1", topicId: "topic-1", title: "時間線一", parentNodeId: "", visibility: "public", collapsed: false, createdAt: "2026-01-01" }],
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

/** 測試用父分支查找；時間 O(L+N)，空間 O(1)。 */
function testParentLineId(line) {
  const parentNode = state.nodes.find((node) => node.id === line?.parentNodeId);
  return parentNode?.timelineId || "";
}

/** 測試用後代走訪；時間 O(L·D)，空間 O(D)。 */
function testDescendants(lineId) {
  const found = new Set([lineId]);
  const queue = [lineId];
  while (queue.length) {
    const parentId = queue.shift();
    state.timelines.forEach((line) => {
      if (!found.has(line.id) && testParentLineId(line) === parentId) {
        found.add(line.id);
        queue.push(line.id);
      }
    });
  }
  return found;
}

/** 測試用私密繼承；時間 O(H·(L+N))，空間 O(H)。 */
function testIsPrivate(lineId) {
  const seen = new Set();
  let line = state.timelines.find((item) => item.id === lineId);
  while (line && !seen.has(line.id)) {
    seen.add(line.id);
    if (line.visibility !== "public") return true;
    const parentId = testParentLineId(line);
    line = state.timelines.find((item) => item.id === parentId);
  }
  return false;
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
      nodeIndex: new Map(),
      parentTimelineByTimelineId: new Map(),
    },
    constants: { MIN_ZOOM: 0.35, MAX_ZOOM: 1.65 },
    C: { MIN_ZOOM: 0.35, MAX_ZOOM: 1.65 },
    app: { signedIn: true },
    activeTopics: () => state.topics,
    activeTimelines: () => state.timelines,
    activeNodes: () => state.nodes,
    dateRange,
    dayNumber,
    dayParts,
    parentLineId: testParentLineId,
    descendants: testDescendants,
    isTimelinePrivate: testIsPrivate,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    today: () => "2026-07-10",
  },
};

const modulePath = path.resolve(__dirname, "../JS/timeflow-v5-layout.js");
delete require.cache[modulePath];
require(modulePath);
const TF = global.window.EvanTimeflowV5;

/** 同步測試 fixture 索引；時間／空間 O(L+N)。 */
function refreshContextIndexes() {
  TF.ctx.timelineIndex = new Map(state.timelines.map((line) => [line.id, line]));
  TF.ctx.nodeIndex = new Map(state.nodes.map((node) => [node.id, node]));
  TF.ctx.parentTimelineByTimelineId = new Map(
    state.timelines.map((line) => [line.id, testParentLineId(line)]).filter(([, parentId]) => parentId)
  );
}

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
  assert.ok(layout.sceneHeight >= 620);
  assert.equal(layout.visibleLineIds.has("line-1"), true);
  assert.ok(layout.trunkY > 0);
  assert.equal(layout.visualTrunkLineId, "", "整體視角應保留全域主幹");
  assert.ok(layout.rows[0].branchEndX < layout.axisEnd, "一般分支不應再畫成全寬第二主軸");

  state.ui.viewMode = "single";
  const focused = TF.buildLayout({ lines: state.timelines, nodes: state.nodes });
  assert.equal(focused.visualTrunkLineId, "line-1");
  assert.equal(focused.rows[0].isVisualTrunk, true);
  assert.equal(focused.rows[0].axisY, focused.trunkY, "聚焦分支必須直接成為視覺主軸");

  state.ui.zoom = .5;
  const zoomed = TF.buildLayout({ lines: state.timelines, nodes: state.nodes });
  assert.equal(Math.round(zoomed.placements.get("day-1").width * state.ui.zoom), 224, "縮小後卡片實際寬度應維持可讀");
})();

(function testVisibilityCollapseAndFocusPerspective() {
  state.ui.zoom = 1;
  state.ui.viewMode = "all";
  state.ui.activeTopicId = "all";
  state.ui.activeTimelineId = "root-public";
  state.ui.showPrivate = true;
  state.timelines = [
    { id: "root-public", topicId: "topic-1", title: "公開根分支", parentNodeId: "", visibility: "public", collapsed: true, createdAt: "2026-01-01" },
    { id: "child-public", topicId: "topic-1", title: "公開子分支", parentNodeId: "root-event", visibility: "public", collapsed: false, createdAt: "2026-01-02" },
    { id: "root-private", topicId: "topic-1", title: "私密根分支", parentNodeId: "", visibility: "private", collapsed: false, createdAt: "2026-01-03" },
  ];
  state.nodes = [
    { id: "root-event", timelineId: "root-public", title: "公開起點", precision: "day", dateValue: "2026-03-19", status: "pending", category: "research", tags: [] },
    { id: "child-event", timelineId: "child-public", title: "公開後續", precision: "day", dateValue: "2026-04-02", status: "pending", category: "research", tags: [] },
    { id: "private-event", timelineId: "root-private", title: "私密研究", precision: "day", dateValue: "2026-04-09", status: "pending", category: "research", tags: [] },
  ];
  refreshContextIndexes();

  TF.app.signedIn = true;
  let data = TF.visibleData();
  assert.deepEqual(data.lines.map((line) => line.id), ["root-public", "root-private"]);
  assert.equal(data.collapsedCounts.get("root-public"), 1, "收合分支應隱藏下層並保留數量");

  state.ui.viewMode = "single";
  state.ui.activeTimelineId = "child-public";
  data = TF.visibleData();
  assert.deepEqual(data.lines.map((line) => line.id), ["child-public"], "聚焦下層時不受畫面外祖先的收合影響");

  state.ui.viewMode = "all";
  state.timelines[0].collapsed = false;
  TF.app.signedIn = false;
  data = TF.visibleData();
  assert.deepEqual(data.lines.map((line) => line.id), ["root-public", "child-public"], "未登入時私密分支必須完全隱藏");
})();

console.log("timeflow-layout tests passed");
