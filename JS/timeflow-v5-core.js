// ==============================
// timeflow-v5-core.js
// 主題時間流 v5：資料模型、遷移、日期與軟刪除
// ==============================
// 主要函式：normalizeState O(T+L+N+E) / rebuildIndexes O(T+L+N+E)，空間 O(T+L+N+E)。
// 快速方案：以 Map / Set 取代每次線性搜尋；刪除使用批次標記，不重建整份資料。
(function initTimeflowCore(TF) {
  "use strict";

  const C = TF.constants = Object.freeze({
    STORAGE_KEY: "evanTarotDivinationTimeflowV4",
    LEGACY_KEYS: ["evanTarotDivinationTimeflowV3", "evanTarotDivinationTimeflowV2", "evanTarotDivinationMapV1"],
    VERSION: 5,
    MIN_ZOOM: 0.35,
    MAX_ZOOM: 1.65,
    DAY_MS: 86400000,
    COLORS: ["#b794ff", "#7fe3b2", "#7de4ff", "#ffb3d8", "#ffd27a", "#a9b4ff", "#8fd7ff", "#ff9bb2"],
    CATEGORIES: {
      relationship: "人際 / 感情", career: "工作 / 職涯", self: "自我成長", money: "金錢 / 資源",
      study: "學習 / 考試", family: "家庭 / 關係", sports: "運動 / 賽事", research: "研究 / 驗證",
      project: "專案 / 系統", other: "其他",
    },
    STATUSES: { pending: "尚未驗證", partial: "部分驗證", verified: "驗證成立", missed: "未應驗" },
    TYPES: { reading: "占卜", event: "事件", result: "實際結果", note: "補充說明" },
    ROLES: { normal: "一般節點", background: "回溯背景", verification: "驗證結果", supplement: "補充說明" },
    LINKS: { related: "相關", verification: "驗證", cause: "因果", supplement: "補充", contrast: "對照", contradiction: "矛盾", same: "同一事件" },
  });

  const ctx = TF.ctx = {
    state: null,
    topicIndex: new Map(), timelineIndex: new Map(), nodeIndex: new Map(), linkIndex: new Map(),
  };

  const nowIso = () => window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString();
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const esc = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const truncate = (value, max) => { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max)}…` : text; };
  const rgba = (hex, alpha) => {
    const raw = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return `rgba(183,148,255,${alpha})`;
    const n = Number.parseInt(raw, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  };
  const tags = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(/[，,]/)).map((v) => String(v).trim()).filter(Boolean))].slice(0, 30);

  function createTopic(title, description, index = 0) {
    const at = nowIso();
    return { id: id("topic"), title: String(title || `主題 ${index + 1}`).trim(), description: String(description || "").trim(), color: C.COLORS[index % C.COLORS.length], createdAt: at, updatedAt: at, deletedAt: "", deletedBatchId: "" };
  }

  function createTimeline(topicId, title, description, parentNodeId = "") {
    const at = nowIso();
    return { id: id("timeline"), topicId, title: String(title || "新案例時間線").trim(), description: String(description || "").trim(), parentNodeId: String(parentNodeId || ""), createdAt: at, updatedAt: at, deletedAt: "", deletedBatchId: "" };
  }

  function createNode(timelineId, type = "event") {
    const at = nowIso();
    const names = { reading: "新占卜", event: "新事件", result: "新結果", note: "新補充" };
    return { id: id("node"), timelineId, type: C.TYPES[type] ? type : "event", role: type === "note" ? "supplement" : "normal", title: names[type] || "新節點", category: "other", subject: "", status: "pending", precision: "day", dateValue: today(), cards: "", interpretation: "", predictions: "", description: "", note: "", tags: [], createdAt: at, updatedAt: at, deletedAt: "", deletedBatchId: "" };
  }

  function initialState() {
    const topic = createTopic("第一主題", "可用於人物、關係、專案、研究或事物。", 0);
    const timeline = createTimeline(topic.id, "第一案例時間線", "同一脈絡下的事件、占卜與驗證。");
    return { version: C.VERSION, topics: [topic], timelines: [timeline], nodes: [], links: [], ui: { zoom: .85, panX: 0, panY: 0, selectedId: "", activeTopicId: topic.id, activeTimelineId: timeline.id, viewMode: "single", filterStatus: "all", filterCategory: "all", search: "" } };
  }

  function precision(value, supplied) {
    if (["day", "month", "year", "unknown"].includes(supplied)) return supplied;
    const raw = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "day";
    if (/^\d{4}-\d{2}$/.test(raw)) return "month";
    if (/^\d{4}$/.test(raw)) return "year";
    return "unknown";
  }

  function dateValue(value, p) {
    const raw = String(value || "").trim();
    if (p === "day" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (p === "month" && /^\d{4}-\d{2}$/.test(raw)) return raw;
    if (p === "year" && /^\d{4}$/.test(raw)) return raw;
    return "";
  }

  function normalizeTopic(item, index) {
    const at = nowIso();
    return { id: String(item?.id || id("topic")), title: String(item?.title || `主題 ${index + 1}`).trim(), description: String(item?.description || "").trim(), color: String(item?.color || C.COLORS[index % C.COLORS.length]), createdAt: String(item?.createdAt || at), updatedAt: String(item?.updatedAt || item?.createdAt || at), deletedAt: String(item?.deletedAt || ""), deletedBatchId: String(item?.deletedBatchId || "") };
  }

  function normalizeTimeline(item, fallback, index) {
    const at = nowIso();
    return { id: String(item?.id || id("timeline")), topicId: String(item?.topicId || fallback), title: String(item?.title || `案例時間線 ${index + 1}`).trim(), description: String(item?.description || "").trim(), parentNodeId: String(item?.parentNodeId || ""), createdAt: String(item?.createdAt || at), updatedAt: String(item?.updatedAt || item?.createdAt || at), deletedAt: String(item?.deletedAt || ""), deletedBatchId: String(item?.deletedBatchId || "") };
  }

  function normalizeNode(item, fallback) {
    const at = nowIso();
    const p = precision(item?.dateValue || item?.date, item?.precision);
    const type = C.TYPES[item?.type] ? item.type : "event";
    return { id: String(item?.id || id("node")), timelineId: String(item?.timelineId || fallback), type, role: C.ROLES[item?.role] ? item.role : (type === "note" ? "supplement" : "normal"), title: String(item?.title || "").trim(), category: C.CATEGORIES[item?.category] ? item.category : "other", subject: String(item?.subject || "").trim(), status: C.STATUSES[item?.status] ? item.status : "pending", precision: p, dateValue: dateValue(item?.dateValue || item?.date, p), cards: String(item?.cards || "").trim(), interpretation: String(item?.interpretation || "").trim(), predictions: String(item?.predictions || "").trim(), description: String(item?.description || "").trim(), note: String(item?.note || "").trim(), tags: tags(item?.tags), createdAt: String(item?.createdAt || at), updatedAt: String(item?.updatedAt || item?.createdAt || at), deletedAt: String(item?.deletedAt || ""), deletedBatchId: String(item?.deletedBatchId || "") };
  }

  function normalizeLink(item) {
    const at = nowIso();
    return { id: String(item?.id || id("link")), fromNodeId: String(item?.fromNodeId || ""), toNodeId: String(item?.toNodeId || ""), type: C.LINKS[item?.type] ? item.type : "related", note: String(item?.note || "").trim(), createdAt: String(item?.createdAt || at), deletedAt: String(item?.deletedAt || ""), deletedBatchId: String(item?.deletedBatchId || "") };
  }

  /** 舊版遷移：時間 O(T+R+E)，空間 O(T+R+E)。 */
  function migrate(raw) {
    const seed = initialState();
    const sourceThemes = Array.isArray(raw?.themes) && raw.themes.length ? raw.themes : seed.topics;
    const topics = sourceThemes.map((v, i) => normalizeTopic(v, i));
    const validTopics = new Set(topics.map((v) => v.id));
    const fallbackTopic = topics[0].id;
    const timelines = [], nodes = [], links = [];
    const readingTimeline = new Map(), fallbackTimeline = new Map();
    const readings = Array.isArray(raw?.readings) ? raw.readings : [];
    const events = Array.isArray(raw?.events) ? raw.events : [];
    readings.forEach((reading, index) => {
      const topicId = validTopics.has(String(reading?.themeId)) ? String(reading.themeId) : fallbackTopic;
      const line = normalizeTimeline({ id: `timeline_${String(reading?.id || id("legacy"))}`, topicId, title: reading?.title || `占卜案例 ${index + 1}`, description: reading?.subject || "", createdAt: reading?.createdAt, updatedAt: reading?.updatedAt }, topicId, index);
      timelines.push(line); readingTimeline.set(String(reading?.id || ""), line.id);
      nodes.push(normalizeNode({ ...reading, timelineId: line.id, type: "reading", role: "normal" }, line.id));
    });
    const fallbackFor = (topicId) => {
      if (fallbackTimeline.has(topicId)) return fallbackTimeline.get(topicId);
      const line = createTimeline(topicId, `${topics.find((v) => v.id === topicId)?.title || "主題"}｜未分類案例`, "由舊版未連結事件自動建立。");
      timelines.push(line); fallbackTimeline.set(topicId, line.id); return line.id;
    };
    events.forEach((event) => {
      const topicId = validTopics.has(String(event?.themeId)) ? String(event.themeId) : fallbackTopic;
      const related = String(event?.relatedReadingId || "");
      const lineId = readingTimeline.get(related) || fallbackFor(topicId);
      const node = normalizeNode({ ...event, timelineId: lineId, type: "event", role: "normal" }, lineId);
      nodes.push(node);
      if (related && readingTimeline.has(related)) links.push(normalizeLink({ fromNodeId: related, toNodeId: node.id, type: event?.status === "pending" ? "related" : "verification", note: event?.note || "由舊版關聯轉入" }));
    });
    if (!timelines.length) timelines.push(createTimeline(fallbackTopic, "第一案例時間線", "同一脈絡下的事件、占卜與驗證。"));
    const rawUi = raw?.ui || {}, mappedTopic = validTopics.has(String(rawUi.activeThemeId)) ? String(rawUi.activeThemeId) : fallbackTopic;
    const firstLine = timelines.find((v) => v.topicId === mappedTopic) || timelines[0];
    return { version: C.VERSION, topics, timelines, nodes, links, ui: { zoom: clamp(Number(rawUi.zoom || .85), C.MIN_ZOOM, C.MAX_ZOOM), panX: Number(rawUi.panX || 0), panY: Number(rawUi.panY || 0), selectedId: String(rawUi.selectedId || ""), activeTopicId: rawUi.activeThemeId === "all" ? "all" : mappedTopic, activeTimelineId: firstLine.id, viewMode: rawUi.viewMode === "parallel" ? "all" : "single", filterStatus: C.STATUSES[rawUi.filterStatus] ? rawUi.filterStatus : "all", filterCategory: C.CATEGORIES[rawUi.filterCategory] ? rawUi.filterCategory : "all", search: String(rawUi.search || "") } };
  }

  /** 正規化：時間 O(T+L+N+E)，空間 O(T+L+N+E)。 */
  function normalizeState(raw) {
    if (!raw || Number(raw.version || 0) < C.VERSION || !Array.isArray(raw.topics)) return migrate(raw || {});
    const seed = initialState();
    const topics = raw.topics.length ? raw.topics.map(normalizeTopic) : seed.topics;
    const validTopics = new Set(topics.map((v) => v.id));
    const fallbackTopic = topics.find((v) => !v.deletedAt)?.id || topics[0].id;
    const timelines = (Array.isArray(raw.timelines) ? raw.timelines : []).map((v, i) => normalizeTimeline(v, fallbackTopic, i));
    timelines.forEach((v) => { if (!validTopics.has(v.topicId)) v.topicId = fallbackTopic; });
    if (!timelines.length) timelines.push(createTimeline(fallbackTopic, "第一案例時間線", ""));
    const validLines = new Set(timelines.map((v) => v.id));
    const fallbackLine = timelines.find((v) => !v.deletedAt)?.id || timelines[0].id;
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map((v) => normalizeNode(v, fallbackLine));
    nodes.forEach((v) => { if (!validLines.has(v.timelineId)) v.timelineId = fallbackLine; });
    const ui = raw.ui || {};
    return { version: C.VERSION, topics, timelines, nodes, links: (Array.isArray(raw.links) ? raw.links : []).map(normalizeLink), ui: { zoom: clamp(Number(ui.zoom || .85), C.MIN_ZOOM, C.MAX_ZOOM), panX: Number(ui.panX || 0), panY: Number(ui.panY || 0), selectedId: String(ui.selectedId || ""), activeTopicId: String(ui.activeTopicId || fallbackTopic), activeTimelineId: String(ui.activeTimelineId || fallbackLine), viewMode: ui.viewMode === "all" ? "all" : "single", filterStatus: C.STATUSES[ui.filterStatus] ? ui.filterStatus : "all", filterCategory: C.CATEGORIES[ui.filterCategory] ? ui.filterCategory : "all", search: String(ui.search || "") } };
  }

  function load() {
    for (const key of [C.STORAGE_KEY, ...C.LEGACY_KEYS]) {
      const text = localStorage.getItem(key); if (!text) continue;
      try { const raw = JSON.parse(text), state = normalizeState(raw); if (key !== C.STORAGE_KEY || raw.version !== C.VERSION) localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state)); return state; }
      catch (error) { console.warn(`[timeflow] 無法讀取 ${key}`, error); }
    }
    return initialState();
  }

  function save() { ctx.state.version = C.VERSION; localStorage.setItem(C.STORAGE_KEY, JSON.stringify(ctx.state)); }

  /** 查表建立：時間/空間 O(T+L+N+E)。 */
  function rebuildIndexes() {
    const s = ctx.state;
    ctx.topicIndex = new Map(s.topics.map((v) => [v.id, v]));
    ctx.timelineIndex = new Map(s.timelines.map((v) => [v.id, v]));
    ctx.nodeIndex = new Map(s.nodes.map((v) => [v.id, v]));
    ctx.linkIndex = new Map(s.links.map((v) => [v.id, v]));
  }

  const activeTopics = () => ctx.state.topics.filter((v) => !v.deletedAt);
  const activeTimelines = () => ctx.state.timelines.filter((v) => !v.deletedAt && !ctx.topicIndex.get(v.topicId)?.deletedAt);
  const activeNodes = () => ctx.state.nodes.filter((v) => { const line = ctx.timelineIndex.get(v.timelineId); return !v.deletedAt && line && !line.deletedAt && !ctx.topicIndex.get(line.topicId)?.deletedAt; });
  const topicTitle = (topicId) => ctx.topicIndex.get(topicId)?.title || "未分類主題";
  const topicColor = (topicId) => ctx.topicIndex.get(topicId)?.color || C.COLORS[0];
  const lineTitle = (lineId) => ctx.timelineIndex.get(lineId)?.title || "未分類時間線";
  const lineTopic = (lineId) => ctx.timelineIndex.get(lineId)?.topicId || "";

  function ensureSelection() {
    let topics = activeTopics();
    if (!topics.length) { const topic = createTopic("復原主題", "系統自動建立。", ctx.state.topics.length); ctx.state.topics.push(topic); topics = [topic]; rebuildIndexes(); }
    if (ctx.state.ui.viewMode === "single" && ctx.state.ui.activeTopicId === "all") ctx.state.ui.activeTopicId = topics[0].id;
    if (ctx.state.ui.activeTopicId !== "all" && !topics.some((v) => v.id === ctx.state.ui.activeTopicId)) ctx.state.ui.activeTopicId = topics[0].id;
    let lines = activeTimelines();
    if (!lines.length) { const line = createTimeline(ctx.state.ui.activeTopicId === "all" ? topics[0].id : ctx.state.ui.activeTopicId, "第一案例時間線", "系統自動建立。"); ctx.state.timelines.push(line); lines = [line]; rebuildIndexes(); }
    const available = ctx.state.ui.activeTopicId === "all" ? lines : lines.filter((v) => v.topicId === ctx.state.ui.activeTopicId);
    if (!available.some((v) => v.id === ctx.state.ui.activeTimelineId)) ctx.state.ui.activeTimelineId = (available[0] || lines[0]).id;
    const selected = ctx.nodeIndex.get(ctx.state.ui.selectedId); if (!selected || selected.deletedAt) ctx.state.ui.selectedId = "";
  }

  const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / C.DAY_MS);
  const dayParts = (n) => { const d = new Date(n * C.DAY_MS); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function dateRange(node) {
    if (!node || node.precision === "unknown" || !node.dateValue) return { start: null, end: null, label: "日期不詳" };
    if (node.precision === "day") { const [y, m, d] = node.dateValue.split("-").map(Number), n = dayNumber(y, m, d); return { start: n, end: n, label: node.dateValue.replaceAll("-", "/") }; }
    if (node.precision === "month") { const [y, m] = node.dateValue.split("-").map(Number); return { start: dayNumber(y, m, 1), end: dayNumber(y, m, daysInMonth(y, m)), label: `${y}/${String(m).padStart(2, "0")}（日不詳）` }; }
    const y = Number(node.dateValue); return { start: dayNumber(y, 1, 1), end: dayNumber(y, 12, 31), label: `${y}（月日不詳）` };
  }

  const sortValue = (node) => dateRange(node).start ?? Number.POSITIVE_INFINITY;
  function sortNodes(list) { return list.slice().sort((a, b) => sortValue(a) - sortValue(b) || String(a.createdAt).localeCompare(String(b.createdAt))); }
  const parentLineId = (line) => line?.parentNodeId ? (ctx.nodeIndex.get(line.parentNodeId)?.timelineId || "") : "";

  /** 子時間線查找：時間 O(L²) 最壞；一般資料量小。更快替代為 children Map，可在大量案例時啟用。 */
  function descendants(rootId) {
    const set = new Set([rootId]); let changed = true;
    while (changed) { changed = false; ctx.state.timelines.forEach((line) => { if (!set.has(line.id) && set.has(parentLineId(line))) { set.add(line.id); changed = true; } }); }
    return set;
  }

  const markDeleted = (item, batch, at) => { item.deletedAt = at; item.deletedBatchId = batch; };
  function deleteNode(nodeId, includeChildren) {
    const node = ctx.nodeIndex.get(nodeId); if (!node) return;
    const batch = id("trash"), at = nowIso(), lineIds = new Set();
    if (includeChildren) ctx.state.timelines.forEach((line) => { if (line.parentNodeId === nodeId) descendants(line.id).forEach((v) => lineIds.add(v)); });
    markDeleted(node, batch, at);
    ctx.state.timelines.forEach((line) => { if (lineIds.has(line.id)) markDeleted(line, batch, at); });
    ctx.state.nodes.forEach((v) => { if (lineIds.has(v.timelineId)) markDeleted(v, batch, at); });
    const deletedNodeIds = new Set(ctx.state.nodes.filter((v) => v.deletedBatchId === batch).map((v) => v.id));
    ctx.state.links.forEach((v) => { if (v.fromNodeId === nodeId || v.toNodeId === nodeId || deletedNodeIds.has(v.fromNodeId) || deletedNodeIds.has(v.toNodeId)) markDeleted(v, batch, at); });
    ctx.state.ui.selectedId = "";
  }

  function deleteTimeline(rootId) {
    const batch = id("trash"), at = nowIso(), lineIds = descendants(rootId);
    ctx.state.timelines.forEach((v) => { if (lineIds.has(v.id)) markDeleted(v, batch, at); });
    ctx.state.nodes.forEach((v) => { if (lineIds.has(v.timelineId)) markDeleted(v, batch, at); });
    const nodeIds = new Set(ctx.state.nodes.filter((v) => v.deletedBatchId === batch).map((v) => v.id));
    ctx.state.links.forEach((v) => { if (nodeIds.has(v.fromNodeId) || nodeIds.has(v.toNodeId)) markDeleted(v, batch, at); });
  }

  function deleteTopic(topicId) {
    const batch = id("trash"), at = nowIso(), lineIds = new Set(ctx.state.timelines.filter((v) => v.topicId === topicId).map((v) => v.id));
    const topic = ctx.topicIndex.get(topicId); if (topic) markDeleted(topic, batch, at);
    ctx.state.timelines.forEach((v) => { if (lineIds.has(v.id)) markDeleted(v, batch, at); });
    ctx.state.nodes.forEach((v) => { if (lineIds.has(v.timelineId)) markDeleted(v, batch, at); });
    const nodeIds = new Set(ctx.state.nodes.filter((v) => v.deletedBatchId === batch).map((v) => v.id));
    ctx.state.links.forEach((v) => { if (nodeIds.has(v.fromNodeId) || nodeIds.has(v.toNodeId)) markDeleted(v, batch, at); });
  }

  function restoreBatch(batch) {
    [ctx.state.topics, ctx.state.timelines, ctx.state.nodes, ctx.state.links].forEach((list) => list.forEach((v) => { if (v.deletedBatchId === batch) { v.deletedAt = ""; v.deletedBatchId = ""; } }));
  }

  Object.assign(TF, { C, nowIso, today, id, clamp, esc, truncate, rgba, tags, createTopic, createTimeline, createNode, initialState, normalizeState, load, save, rebuildIndexes, activeTopics, activeTimelines, activeNodes, topicTitle, topicColor, lineTitle, lineTopic, ensureSelection, dayNumber, dayParts, dateRange, sortNodes, parentLineId, descendants, deleteNode, deleteTimeline, deleteTopic, restoreBatch, normalizeLink });
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
