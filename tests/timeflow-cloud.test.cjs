const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../JS/timeflow-cloud.js"), "utf8");
const window = {
  addEventListener() {},
  confirm() { return false; },
};
const document = {
  readyState: "loading",
  addEventListener() {},
};
window.window = window;

vm.runInNewContext(source, {
  AbortController,
  console,
  document,
  fetch() { throw new Error("測試不應發出網路請求"); },
  localStorage: {
    getItem() { return null; },
    removeItem() {},
    setItem() {},
  },
  Map,
  JSON,
  Number,
  Object,
  String,
  window,
});

const cloud = window.EvanTimeflowCloud;
assert.ok(cloud, "應公開可測試的雲端格式轉換函式");

const localState = {
  version: 6,
  topics: [
    { id: "topic-1", title: "台灣彩券", description: "研究開獎", color: "#b794ff" },
  ],
  timelines: [
    { id: "line-root", topicId: "topic-1", title: "台灣彩券", parentNodeId: "" },
    { id: "line-child", topicId: "topic-1", title: "第二分支", parentNodeId: "event-1" },
  ],
  nodes: [
    { id: "reading-1", timelineId: "line-root", type: "reading", title: "占卜", dateValue: "2026-03-19" },
    { id: "event-1", timelineId: "line-root", type: "event", title: "開獎", dateValue: "2026-03-26" },
    { id: "event-2", timelineId: "line-child", type: "event", title: "後續事件", dateValue: "2026-04" },
  ],
  links: [
    { id: "link-1", fromNodeId: "reading-1", toNodeId: "event-1", type: "verification" },
  ],
  ui: {
    activeTopicId: "all",
    activeTimelineId: "line-root",
    viewMode: "all",
    showPrivate: true,
  },
};
const original = JSON.parse(JSON.stringify(localState));
const prepared = cloud.prepareStateForCloud(localState);
const plainPrepared = JSON.parse(JSON.stringify(prepared));

assert.deepEqual(localState, original, "建立相容資料時不得修改本機正式狀態");
assert.deepEqual(plainPrepared.topics, original.topics, "v6 topics 必須完整保留");
assert.deepEqual(plainPrepared.timelines, original.timelines, "分支與親緣必須完整保留");
assert.deepEqual(plainPrepared.nodes, original.nodes, "正式節點不得被舊格式取代");
assert.deepEqual(plainPrepared.links, original.links, "節點關係不得遺失");
assert.equal(plainPrepared.themes.length, 1, "舊後端必須能看到至少一條主題流");
assert.equal(plainPrepared.themes[0].id, "topic-1");
assert.equal(plainPrepared.readings.length, 1);
assert.equal(plainPrepared.readings[0].themeId, "topic-1");
assert.equal(plainPrepared.readings[0].date, "2026-03-19");
assert.equal(plainPrepared.events.length, 2);
assert.equal(plainPrepared.events[0].relatedReadingId, "reading-1");
assert.equal(plainPrepared.events[1].relatedReadingId, "");
assert.equal(plainPrepared.ui.activeThemeId, "all");
assert.deepEqual(
  JSON.parse(JSON.stringify(cloud.cleanStateFromCloud(prepared))),
  original,
  "從雲端讀回時應移除舊後端專用鏡像欄位"
);

assert.equal(cloud.isLegacySchemaError("至少需要一條主題流。"), true);
assert.equal(cloud.isLegacySchemaError("登入憑證已過期"), false);

console.log("timeflow-cloud tests passed");
