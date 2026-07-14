// ==============================
// timeflow-v5-core.js
// 時間樹 v6：單一時空主幹、遞迴分支、私密狀態、遷移與軟刪除
// ==============================
// 主要函式複雜度：
// - normalizeState：時間／空間 O(T+L+N+E)
// - rebuildIndexes：時間／空間 O(T+L+N+E)
// - descendants：時間 O(D)、空間 O(D)，D 為實際後代時間線數
// - timelinePath：時間／空間 O(H)，H 為分支祖先深度
// - sortNodes：時間 O(N log N)、空間 O(N)，日期鍵只計算一次
//
// 更快替代方案比較：
// - 暴力法：每次查後代都反覆掃描全部時間線，最壞 O(L²)。
// - 本實作：重建索引時預先建立 parent timeline → children 查表，查詢只走實際後代。
// - 暴力排序：比較器內重複解析日期，排序期間會重算 O(N log N) 次。
// - 本實作：decorate-sort-undecorate，先建立日期鍵再排序。
// ==============================
(function initTimeflowCore(TF) {
  "use strict";

  const C = TF.constants = Object.freeze({
    STORAGE_KEY: "evanTarotDivinationTimeflowV4",
    LEGACY_KEYS: ["evanTarotDivinationTimeflowV3", "evanTarotDivinationTimeflowV2", "evanTarotDivinationMapV1"],
    VERSION: 6,
    MIN_ZOOM: 0.6,
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
    topicIndex: new Map(),
    timelineIndex: new Map(),
    nodeIndex: new Map(),
    linkIndex: new Map(),
    childrenByTimelineId: new Map(),
    childTimelinesByParentNodeId: new Map(),
    parentTimelineByTimelineId: new Map(),
    privateTimelineIds: new Set(),
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

  function createTimeline(topicId, title, description, parentNodeId = "", visibility = "private") {
    const at = nowIso();
    return {
      id: id("timeline"),
      topicId,
      title: String(title || "新分支").trim(),
      description: String(description || "").trim(),
      parentNodeId: String(parentNodeId || ""),
      visibility: visibility === "public" ? "public" : "private",
      collapsed: false,
      createdAt: at,
      updatedAt: at,
      deletedAt: "",
      deletedBatchId: "",
    };
  }

  function createNode(timelineId, type = "event") {
    const at = nowIso();
    const names = { reading: "新占卜", event: "新事件", result: "新結果", note: "新補充" };
    return { id: id("node"), timelineId, type: C.TYPES[type] ? type : "event", role: type === "note" ? "supplement" : "normal", title: names[type] || "新節點", category: "other", subject: "", status: "pending", precision: "day", dateValue: today(), cards: "", interpretation: "", predictions: "", description: "", note: "", tags: [], createdAt: at, updatedAt: at, deletedAt: "", deletedBatchId: "" };
  }

  function initialState() {
    const topic = createTopic("第一分支", "從全域時空主幹長出的案例或研究主題。", 0);
    const timeline = createTimeline(topic.id, "第一分支", "事件會沿著這條分支發展，也能從任一節點再長出平行分支。");
    return {
      version: C.VERSION,
      topics: [topic],
      timelines: [timeline],
      nodes: [],
      links: [],
      ui: {
        zoom: .85,
        panX: 0,
        panY: 0,
        selectedId: "",
        activeTopicId: topic.id,
        activeTimelineId: timeline.id,
        viewMode: "all",
        showPrivate: true,
        filterStatus: "all",
        filterCategory: "all",
        search: "",
      },
    };
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
    return {
      id: String(item?.id || id("timeline")),
      topicId: String(item?.topicId || fallback),
      title: String(item?.title || `分支 ${index + 1}`).trim(),
      description: String(item?.description || "").trim(),
      parentNodeId: String(item?.parentNodeId || ""),
      // 舊資料沒有可見性欄位時採私密，避免升級後意外顯示個人研究。
      visibility: item?.visibility === "public" ? "public" : "private",
      collapsed: Boolean(item?.collapsed),
      createdAt: String(item?.createdAt || at),
      updatedAt: String(item?.updatedAt || item?.createdAt || at),
      deletedAt: String(item?.deletedAt || ""),
      deletedBatchId: String(item?.deletedBatchId || ""),
    };
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
    if (!timelines.length) timelines.push(createTimeline(fallbackTopic, "第一分支", "同一脈絡下的事件、占卜與驗證。"));
    const rawUi = raw?.ui || {}, mappedTopic = validTopics.has(String(rawUi.activeThemeId)) ? String(rawUi.activeThemeId) : fallbackTopic;
    const firstLine = timelines.find((v) => v.topicId === mappedTopic) || timelines[0];
    return { version: C.VERSION, topics, timelines, nodes, links, ui: { zoom: clamp(Number(rawUi.zoom || .85), C.MIN_ZOOM, C.MAX_ZOOM), panX: Number(rawUi.panX || 0), panY: Number(rawUi.panY || 0), selectedId: String(rawUi.selectedId || ""), activeTopicId: rawUi.activeThemeId === "all" ? "all" : mappedTopic, activeTimelineId: firstLine.id, viewMode: rawUi.viewMode === "parallel" ? "all" : "single", showPrivate: true, filterStatus: C.STATUSES[rawUi.filterStatus] ? rawUi.filterStatus : "all", filterCategory: C.CATEGORIES[rawUi.filterCategory] ? rawUi.filterCategory : "all", search: String(rawUi.search || "") } };
  }

  /** 正規化：時間 O(T+L+N+E)，空間 O(T+L+N+E)。 */
  function normalizeState(raw) {
    if (!raw || !Array.isArray(raw.topics)) return migrate(raw || {});
    const seed = initialState();
    const topics = raw.topics.length ? raw.topics.map(normalizeTopic) : seed.topics;
    const validTopics = new Set(topics.map((v) => v.id));
    const fallbackTopic = topics.find((v) => !v.deletedAt)?.id || topics[0].id;
    const timelines = (Array.isArray(raw.timelines) ? raw.timelines : []).map((v, i) => normalizeTimeline(v, fallbackTopic, i));
    timelines.forEach((v) => { if (!validTopics.has(v.topicId)) v.topicId = fallbackTopic; });
    if (!timelines.length) timelines.push(createTimeline(fallbackTopic, "第一分支", ""));
    const validLines = new Set(timelines.map((v) => v.id));
    const fallbackLine = timelines.find((v) => !v.deletedAt)?.id || timelines[0].id;
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map((v) => normalizeNode(v, fallbackLine));
    nodes.forEach((v) => { if (!validLines.has(v.timelineId)) v.timelineId = fallbackLine; });
    const ui = raw.ui || {};
    return { version: C.VERSION, topics, timelines, nodes, links: (Array.isArray(raw.links) ? raw.links : []).map(normalizeLink), ui: { zoom: clamp(Number(ui.zoom || .85), C.MIN_ZOOM, C.MAX_ZOOM), panX: Number(ui.panX || 0), panY: Number(ui.panY || 0), selectedId: String(ui.selectedId || ""), activeTopicId: String(ui.activeTopicId || fallbackTopic), activeTimelineId: String(ui.activeTimelineId || fallbackLine), viewMode: ui.viewMode === "all" ? "all" : "single", showPrivate: ui.showPrivate !== false, filterStatus: C.STATUSES[ui.filterStatus] ? ui.filterStatus : "all", filterCategory: C.CATEGORIES[ui.filterCategory] ? ui.filterCategory : "all", search: String(ui.search || "") } };
  }

  /** 本機載入：時間 O(T+L+N+E)，空間 O(T+L+N+E)。 */
  function load() {
    try {
      for (const key of [C.STORAGE_KEY, ...C.LEGACY_KEYS]) {
        const text = window.localStorage.getItem(key);
        if (!text) continue;
        try {
          const raw = JSON.parse(text);
          const state = normalizeState(raw);
          if (key !== C.STORAGE_KEY || raw.version !== C.VERSION) {
            window.localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state));
          }
          return state;
        } catch (error) {
          console.warn(`[timeflow] 無法讀取 ${key}`, error);
        }
      }
    } catch (error) {
      console.warn("[timeflow] 瀏覽器不允許讀取 localStorage，改用暫存資料。", error);
    }
    return initialState();
  }

  /** 本機儲存：時間／空間 O(S)，S 為序列化後資料量。 */
  function save() {
    ctx.state.version = C.VERSION;
    try {
      window.localStorage.setItem(C.STORAGE_KEY, JSON.stringify(ctx.state));
      return true;
    } catch (error) {
      console.error("[timeflow] 無法儲存 localStorage。", error);
      return false;
    }
  }

  /** 查表建立：時間／空間 O(T+L+N+E)。 */
  function rebuildIndexes() {
    const state = ctx.state;
    const topicIndex = new Map();
    const timelineIndex = new Map();
    const nodeIndex = new Map();
    const linkIndex = new Map();

    state.topics.forEach((item) => topicIndex.set(item.id, item));
    state.timelines.forEach((item) => timelineIndex.set(item.id, item));
    state.nodes.forEach((item) => nodeIndex.set(item.id, item));
    state.links.forEach((item) => linkIndex.set(item.id, item));

    const childrenByTimelineId = new Map();
    const childTimelinesByParentNodeId = new Map();
    const parentTimelineByTimelineId = new Map();

    state.timelines.forEach((line) => {
      const parentNodeId = String(line.parentNodeId || "");
      if (!parentNodeId) return;

      const parentNode = nodeIndex.get(parentNodeId);
      const parentTimelineId = String(parentNode?.timelineId || "");
      if (!parentTimelineId || parentTimelineId === line.id) return;

      parentTimelineByTimelineId.set(line.id, parentTimelineId);

      if (!childrenByTimelineId.has(parentTimelineId)) childrenByTimelineId.set(parentTimelineId, []);
      childrenByTimelineId.get(parentTimelineId).push(line.id);

      if (!childTimelinesByParentNodeId.has(parentNodeId)) childTimelinesByParentNodeId.set(parentNodeId, []);
      childTimelinesByParentNodeId.get(parentNodeId).push(line.id);
    });

    // 由父層向下繼承私密狀態；使用記憶化路徑壓縮，總計 O(L)。
    const privateMemo = new Map();
    const resolvePrivate = (lineId) => {
      if (privateMemo.has(lineId)) return privateMemo.get(lineId);
      const path = [];
      const seen = new Set();
      let cursor = lineId;

      while (cursor && !privateMemo.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor);
        path.push(cursor);
        cursor = parentTimelineByTimelineId.get(cursor) || "";
      }

      // 循環來源屬於損壞資料，採私密以避免意外曝光。
      let inherited = cursor && seen.has(cursor) ? true : Boolean(privateMemo.get(cursor));
      for (let index = path.length - 1; index >= 0; index -= 1) {
        const currentId = path[index];
        inherited = inherited || timelineIndex.get(currentId)?.visibility !== "public";
        privateMemo.set(currentId, inherited);
      }
      return Boolean(privateMemo.get(lineId));
    };
    state.timelines.forEach((line) => resolvePrivate(line.id));

    ctx.topicIndex = topicIndex;
    ctx.timelineIndex = timelineIndex;
    ctx.nodeIndex = nodeIndex;
    ctx.linkIndex = linkIndex;
    ctx.childrenByTimelineId = childrenByTimelineId;
    ctx.childTimelinesByParentNodeId = childTimelinesByParentNodeId;
    ctx.parentTimelineByTimelineId = parentTimelineByTimelineId;
    ctx.privateTimelineIds = new Set([...privateMemo].filter(([, value]) => value).map(([lineId]) => lineId));
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
    if (!lines.length) { const line = createTimeline(ctx.state.ui.activeTopicId === "all" ? topics[0].id : ctx.state.ui.activeTopicId, "第一分支", "系統自動建立。"); ctx.state.timelines.push(line); lines = [line]; rebuildIndexes(); }
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

  /** 日期排序：時間 O(N log N)，空間 O(N)。日期範圍只計算一次。 */
  function sortNodes(list) {
    return list
      .map((node, originalIndex) => ({
        node,
        originalIndex,
        start: dateRange(node).start ?? Number.POSITIVE_INFINITY,
        createdAt: String(node.createdAt || ""),
      }))
      .sort((a, b) =>
        a.start - b.start
        || a.createdAt.localeCompare(b.createdAt)
        || a.originalIndex - b.originalIndex
      )
      .map((entry) => entry.node);
  }

  const parentLineId = (line) => line?.parentNodeId ? (ctx.nodeIndex.get(line.parentNodeId)?.timelineId || "") : "";

  /** 後代查詢：時間 O(D)，空間 O(D)，D 為實際走訪的後代數。 */
  function descendants(rootId) {
    const found = new Set([rootId]);
    const queue = [rootId];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const parentId = queue[cursor];
      const children = ctx.childrenByTimelineId.get(parentId) || [];
      children.forEach((childId) => {
        if (found.has(childId)) return;
        found.add(childId);
        queue.push(childId);
      });
    }

    return found;
  }

  /** 祖先路徑：時間／空間 O(H)，並以 Set 防止損壞資料形成循環。 */
  function timelinePath(lineId) {
    const reversed = [];
    const seen = new Set();
    let cursor = String(lineId || "");
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const line = ctx.timelineIndex.get(cursor);
      if (!line) break;
      reversed.push(line);
      cursor = ctx.parentTimelineByTimelineId.get(cursor) || "";
    }
    return reversed.reverse();
  }

  const isTimelinePrivate = (lineId) => ctx.privateTimelineIds.has(String(lineId || ""));

  const markDeleted = (item, batch, at) => { item.deletedAt = at; item.deletedBatchId = batch; };

  function deleteNode(nodeId, includeChildren) {
    const node = ctx.nodeIndex.get(nodeId); if (!node) return;
    const batch = id("trash"), at = nowIso(), lineIds = new Set();

    if (includeChildren) {
      const directChildren = ctx.childTimelinesByParentNodeId.get(nodeId) || [];
      directChildren.forEach((lineId) => descendants(lineId).forEach((value) => lineIds.add(value)));
    }

    markDeleted(node, batch, at);
    ctx.state.timelines.forEach((line) => { if (lineIds.has(line.id)) markDeleted(line, batch, at); });
    ctx.state.nodes.forEach((value) => { if (lineIds.has(value.timelineId)) markDeleted(value, batch, at); });
    const deletedNodeIds = new Set(ctx.state.nodes.filter((value) => value.deletedBatchId === batch).map((value) => value.id));
    ctx.state.links.forEach((value) => { if (value.fromNodeId === nodeId || value.toNodeId === nodeId || deletedNodeIds.has(value.fromNodeId) || deletedNodeIds.has(value.toNodeId)) markDeleted(value, batch, at); });
    ctx.state.ui.selectedId = "";
  }

  function deleteTimeline(rootId) {
    const batch = id("trash"), at = nowIso(), lineIds = descendants(rootId);
    ctx.state.timelines.forEach((value) => { if (lineIds.has(value.id)) markDeleted(value, batch, at); });
    ctx.state.nodes.forEach((value) => { if (lineIds.has(value.timelineId)) markDeleted(value, batch, at); });
    const nodeIds = new Set(ctx.state.nodes.filter((value) => value.deletedBatchId === batch).map((value) => value.id));
    ctx.state.links.forEach((value) => { if (nodeIds.has(value.fromNodeId) || nodeIds.has(value.toNodeId)) markDeleted(value, batch, at); });
  }

  function deleteTopic(topicId) {
    const batch = id("trash"), at = nowIso(), lineIds = new Set(ctx.state.timelines.filter((value) => value.topicId === topicId).map((value) => value.id));
    const topic = ctx.topicIndex.get(topicId); if (topic) markDeleted(topic, batch, at);
    ctx.state.timelines.forEach((value) => { if (lineIds.has(value.id)) markDeleted(value, batch, at); });
    ctx.state.nodes.forEach((value) => { if (lineIds.has(value.timelineId)) markDeleted(value, batch, at); });
    const nodeIds = new Set(ctx.state.nodes.filter((value) => value.deletedBatchId === batch).map((value) => value.id));
    ctx.state.links.forEach((value) => { if (nodeIds.has(value.fromNodeId) || nodeIds.has(value.toNodeId)) markDeleted(value, batch, at); });
  }

  function restoreBatch(batch) {
    [ctx.state.topics, ctx.state.timelines, ctx.state.nodes, ctx.state.links].forEach((list) => list.forEach((value) => { if (value.deletedBatchId === batch) { value.deletedAt = ""; value.deletedBatchId = ""; } }));
  }

  Object.assign(TF, { C, nowIso, today, id, clamp, esc, truncate, rgba, tags, createTopic, createTimeline, createNode, initialState, normalizeState, load, save, rebuildIndexes, activeTopics, activeTimelines, activeNodes, topicTitle, topicColor, lineTitle, lineTopic, ensureSelection, dayNumber, dayParts, dateRange, sortNodes, parentLineId, descendants, timelinePath, isTimelinePrivate, deleteNode, deleteTimeline, deleteTopic, restoreBatch, normalizeLink });
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
