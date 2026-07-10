const assert = require("node:assert/strict");
const path = require("node:path");

function loadCore(localStorage) {
  global.window = {
    localStorage,
    nowTaipeiISO: () => "2026-07-10T18:00:00",
    EvanTimeflowV5: {},
  };

  const modulePath = path.resolve(__dirname, "../JS/timeflow-v5-core.js");
  delete require.cache[modulePath];
  require(modulePath);
  return global.window.EvanTimeflowV5;
}

function buildState() {
  return {
    version: 5,
    topics: [
      { id: "topic-1", title: "測試", color: "#b794ff", deletedAt: "", deletedBatchId: "" },
    ],
    timelines: [
      { id: "root", topicId: "topic-1", title: "根", parentNodeId: "", deletedAt: "", deletedBatchId: "" },
      { id: "child-a", topicId: "topic-1", title: "子 A", parentNodeId: "node-root", deletedAt: "", deletedBatchId: "" },
      { id: "child-b", topicId: "topic-1", title: "子 B", parentNodeId: "node-root", deletedAt: "", deletedBatchId: "" },
      { id: "grandchild", topicId: "topic-1", title: "孫", parentNodeId: "node-child", deletedAt: "", deletedBatchId: "" },
      { id: "orphan", topicId: "topic-1", title: "孤兒", parentNodeId: "missing-node", deletedAt: "", deletedBatchId: "" },
    ],
    nodes: [
      { id: "node-root", timelineId: "root", title: "根節點", deletedAt: "", deletedBatchId: "" },
      { id: "node-child", timelineId: "child-a", title: "子節點", deletedAt: "", deletedBatchId: "" },
      { id: "node-b", timelineId: "child-b", title: "B 節點", deletedAt: "", deletedBatchId: "" },
      { id: "node-grand", timelineId: "grandchild", title: "孫節點", deletedAt: "", deletedBatchId: "" },
      { id: "node-unrelated", timelineId: "root", title: "保留節點", deletedAt: "", deletedBatchId: "" },
    ],
    links: [
      { id: "link-1", fromNodeId: "node-root", toNodeId: "node-child", deletedAt: "", deletedBatchId: "" },
      { id: "link-2", fromNodeId: "node-unrelated", toNodeId: "node-grand", deletedAt: "", deletedBatchId: "" },
      { id: "link-3", fromNodeId: "node-unrelated", toNodeId: "node-unrelated", deletedAt: "", deletedBatchId: "" },
    ],
    ui: {
      zoom: 0.85,
      panX: 0,
      panY: 0,
      selectedId: "node-root",
      activeTopicId: "topic-1",
      activeTimelineId: "root",
      viewMode: "all",
      filterStatus: "all",
      filterCategory: "all",
      search: "",
    },
  };
}

(function testIndexesAndDescendants() {
  const TF = loadCore({ getItem: () => null, setItem: () => {} });
  TF.ctx.state = buildState();
  TF.rebuildIndexes();

  assert.deepEqual(
    [...TF.descendants("root")].sort(),
    ["child-a", "child-b", "grandchild", "root"].sort()
  );
  assert.deepEqual(
    TF.ctx.childTimelinesByParentNodeId.get("node-root"),
    ["child-a", "child-b"]
  );
  assert.equal(TF.descendants("orphan").size, 1);
})();

(function testSortNodes() {
  const TF = loadCore({ getItem: () => null, setItem: () => {} });
  const input = [
    { id: "unknown-2", precision: "unknown", dateValue: "", createdAt: "2026-02-01" },
    { id: "day", precision: "day", dateValue: "2026-01-15", createdAt: "2026-01-15" },
    { id: "month", precision: "month", dateValue: "2026-02", createdAt: "2026-01-01" },
    { id: "unknown-1", precision: "unknown", dateValue: "", createdAt: "2026-01-01" },
  ];

  assert.deepEqual(
    TF.sortNodes(input).map((node) => node.id),
    ["day", "month", "unknown-1", "unknown-2"]
  );
  assert.notEqual(TF.sortNodes(input), input);
})();

(function testDeleteNodeWithChildren() {
  const TF = loadCore({ getItem: () => null, setItem: () => {} });
  TF.ctx.state = buildState();
  TF.rebuildIndexes();
  TF.deleteNode("node-root", true);

  const byTimeline = new Map(TF.ctx.state.timelines.map((item) => [item.id, item]));
  assert.equal(byTimeline.get("root").deletedAt, "");
  assert.ok(byTimeline.get("child-a").deletedAt);
  assert.ok(byTimeline.get("child-b").deletedAt);
  assert.ok(byTimeline.get("grandchild").deletedAt);
  assert.equal(byTimeline.get("orphan").deletedAt, "");

  const byNode = new Map(TF.ctx.state.nodes.map((item) => [item.id, item]));
  assert.ok(byNode.get("node-root").deletedAt);
  assert.ok(byNode.get("node-child").deletedAt);
  assert.ok(byNode.get("node-b").deletedAt);
  assert.ok(byNode.get("node-grand").deletedAt);
  assert.equal(byNode.get("node-unrelated").deletedAt, "");

  const byLink = new Map(TF.ctx.state.links.map((item) => [item.id, item]));
  assert.ok(byLink.get("link-1").deletedAt);
  assert.ok(byLink.get("link-2").deletedAt);
  assert.equal(byLink.get("link-3").deletedAt, "");
  assert.equal(TF.ctx.state.ui.selectedId, "");
})();

(function testStorageFailureFallback() {
  const TF = loadCore({
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  });

  const state = TF.load();
  assert.equal(state.version, 5);
  TF.ctx.state = state;
  assert.equal(TF.save(), false);
})();

console.log("timeflow-core tests passed");
