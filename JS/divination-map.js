// ==============================
// divination-map.js
// 占卜時間流 v4.0
// ==============================
//
// 核心修正：
// 1. 移除公開在前端的管理員密碼，改用全站 Google 登入狀態控制本機編輯。
// 2. 資料仍先保存在目前瀏覽器 localStorage；登入只控制編輯，不假裝是後端權限。
// 3. 單一時間流必須聚焦單一主題；全部主題只能使用平行時間流。
// 4. 日期只顯示在主軸與右側編輯欄，不在節點卡片重複顯示。
// 5. 畫布依可見內容自動置中，避免固定 1680px 場景造成大量空白。
//
// 主要函式複雜度：
// - loadState / normalizeState：O(n + m)
// - getVisibleNodes：O(n + m)
// - buildSingleLayout / buildParallelLayout：O(k log k)
// - renderMap / renderTimeline：O(k log k)
// - fitSceneToContent：O(k)
// 空間複雜度：O(n + m + k)
//
// 更快替代方案比較：
// - 每次查找節點都掃描兩個陣列：實作簡單，但大量節點時會重複 O(n)。
// - 本版每次 render 先建立 nodeIndex / themeIndex 查表，後續查詢直接取值，降低重複搜尋。
// ==============================

(function initDivinationMapModule() {
  "use strict";

  const STORAGE_KEY = "evanTarotDivinationTimeflowV4";
  const LEGACY_KEYS = [
    "evanTarotDivinationTimeflowV3",
    "evanTarotDivinationTimeflowV2",
    "evanTarotDivinationMapV1",
  ];
  const AUTH_EVENT = "evan-google-auth-change";
  const MIN_ZOOM = 0.45;
  const MAX_ZOOM = 1.35;
  const FIT_PADDING = 56;
  const DEFAULT_SCENE_HEIGHT = 980;
  const NODE_SIZES = Object.freeze({
    reading: { width: 272, height: 154 },
    event: { width: 248, height: 136 },
  });
  const THEME_COLORS = Object.freeze([
    "#b794ff",
    "#7fe3b2",
    "#7de4ff",
    "#ffb3d8",
    "#ffd27a",
    "#a9b4ff",
    "#8fd7ff",
    "#ff9bb2",
  ]);
  const CATEGORY_LABELS = Object.freeze({
    relationship: "人際 / 感情",
    career: "工作 / 職涯",
    self: "自我成長",
    money: "金錢 / 資源",
    study: "學習 / 考試",
    family: "家庭 / 關係",
    other: "其他",
  });
  const STATUS_LABELS = Object.freeze({
    pending: "尚未驗證",
    partial: "部分驗證",
    verified: "驗證成立",
    missed: "未應驗",
  });
  const TYPE_LABELS = Object.freeze({
    reading: "占卜案例",
    event: "驗證事件",
  });

  let state = null;
  let refs = {};
  let nodeIndex = new Map();
  let themeIndex = new Map();
  let isSignedIn = false;
  let dragState = null;
  let panState = null;
  let currentLayout = createEmptyLayout();
  let shouldFitAfterRender = true;

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function createEmptyLayout() {
    return {
      placements: new Map(),
      streams: [],
      dateMarkers: [],
      sceneWidth: 1200,
      sceneHeight: DEFAULT_SCENE_HEIGHT,
      bounds: { left: 0, top: 0, right: 1200, bottom: DEFAULT_SCENE_HEIGHT },
    };
  }

  function createNodeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getNowIso() {
    return window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString();
  }

  function getTodayTaipeiDate() {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function createThemeObject(title, description, index) {
    return {
      id: createNodeId("theme"),
      title: String(title || `主題流 ${index + 1}`).trim(),
      description: String(description || "").trim(),
      color: THEME_COLORS[index % THEME_COLORS.length],
      createdAt: getNowIso(),
    };
  }

  function createInitialState() {
    const defaultTheme = createThemeObject("第一主題流", "第一條驗證主線", 0);
    return {
      version: 4,
      themes: [defaultTheme],
      readings: [],
      events: [],
      ui: {
        zoom: 0.85,
        panX: 0,
        panY: 0,
        selectedId: null,
        filterStatus: "all",
        filterCategory: "all",
        search: "",
        activeThemeId: defaultTheme.id,
        viewMode: "single",
      },
    };
  }

  function normalizeTheme(theme, index) {
    return {
      id: String(theme?.id || createNodeId("theme")),
      title: String(theme?.title || `主題流 ${index + 1}`).trim(),
      description: String(theme?.description || "").trim(),
      color: String(theme?.color || THEME_COLORS[index % THEME_COLORS.length]),
      createdAt: String(theme?.createdAt || getNowIso()),
    };
  }

  function normalizeNode(node, type, fallbackThemeId) {
    const rawPosition = node?.position || {};
    return {
      id: String(node?.id || createNodeId(type)),
      type,
      title: String(node?.title || "").trim(),
      category: CATEGORY_LABELS[node?.category] ? node.category : "other",
      themeId: String(node?.themeId || fallbackThemeId),
      date: String(node?.date || ""),
      subject: String(node?.subject || ""),
      cards: String(node?.cards || ""),
      interpretation: String(node?.interpretation || ""),
      predictions: String(node?.predictions || ""),
      description: String(node?.description || ""),
      note: String(node?.note || ""),
      status: STATUS_LABELS[node?.status] ? node.status : "pending",
      relatedReadingId: String(node?.relatedReadingId || ""),
      position: {
        x: Number.isFinite(Number(rawPosition.x)) ? Number(rawPosition.x) : 0,
        y: Number.isFinite(Number(rawPosition.y)) ? Number(rawPosition.y) : 0,
      },
      createdAt: String(node?.createdAt || getNowIso()),
      updatedAt: String(node?.updatedAt || getNowIso()),
    };
  }

  /** 時間複雜度 O(n + m)，空間複雜度 O(n + m)。 */
  function normalizeState(raw) {
    const initial = createInitialState();
    const rawThemes = Array.isArray(raw?.themes) && raw.themes.length
      ? raw.themes
      : initial.themes;
    const themes = rawThemes.map(normalizeTheme);
    const validThemeIds = new Set(themes.map((theme) => theme.id));
    const fallbackThemeId = themes[0].id;
    const readings = Array.isArray(raw?.readings)
      ? raw.readings.map((node) => normalizeNode(node, "reading", fallbackThemeId))
      : [];
    const events = Array.isArray(raw?.events)
      ? raw.events.map((node) => normalizeNode(node, "event", fallbackThemeId))
      : [];

    readings.forEach((node) => {
      if (!validThemeIds.has(node.themeId)) node.themeId = fallbackThemeId;
    });
    events.forEach((node) => {
      if (!validThemeIds.has(node.themeId)) node.themeId = fallbackThemeId;
    });

    const rawUi = raw?.ui || {};
    const requestedViewMode = rawUi.viewMode === "parallel" ? "parallel" : "single";
    let activeThemeId = String(rawUi.activeThemeId || fallbackThemeId);
    if (requestedViewMode === "single" && !validThemeIds.has(activeThemeId)) {
      activeThemeId = fallbackThemeId;
    }
    if (requestedViewMode === "parallel" && activeThemeId !== "all" && !validThemeIds.has(activeThemeId)) {
      activeThemeId = "all";
    }

    return {
      version: 4,
      themes,
      readings,
      events,
      ui: {
        zoom: clamp(Number(rawUi.zoom || initial.ui.zoom), MIN_ZOOM, MAX_ZOOM),
        panX: Number(rawUi.panX || 0),
        panY: Number(rawUi.panY || 0),
        selectedId: String(rawUi.selectedId || "") || null,
        filterStatus: STATUS_LABELS[rawUi.filterStatus] ? rawUi.filterStatus : "all",
        filterCategory: CATEGORY_LABELS[rawUi.filterCategory] ? rawUi.filterCategory : "all",
        search: String(rawUi.search || ""),
        activeThemeId,
        viewMode: requestedViewMode,
      },
    };
  }

  /** 時間複雜度 O(n + m)，空間複雜度 O(n + m)。 */
  function loadState() {
    const keys = [STORAGE_KEY, ...LEGACY_KEYS];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const normalized = normalizeState(JSON.parse(raw));
        if (key !== STORAGE_KEY) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }
        return normalized;
      } catch (error) {
        console.warn(`[timeflow] 無法讀取 ${key}，略過損壞資料。`, error);
      }
    }
    return createInitialState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /** 時間複雜度 O(n + m)，空間複雜度 O(n + m)。 */
  function rebuildIndexes() {
    themeIndex = new Map(state.themes.map((theme) => [theme.id, theme]));
    nodeIndex = new Map();
    state.readings.forEach((node) => nodeIndex.set(node.id, node));
    state.events.forEach((node) => nodeIndex.set(node.id, node));
  }

  function getThemeById(themeId) {
    return themeIndex.get(themeId) || null;
  }

  function getNodeById(nodeId) {
    return nodeIndex.get(nodeId) || null;
  }

  function getThemeTitle(themeId) {
    return getThemeById(themeId)?.title || "未分類主題";
  }

  function getThemeColor(themeId) {
    return getThemeById(themeId)?.color || THEME_COLORS[0];
  }

  function getDefaultThemeId() {
    if (state.ui.activeThemeId !== "all" && getThemeById(state.ui.activeThemeId)) {
      return state.ui.activeThemeId;
    }
    return state.themes[0]?.id || "";
  }

  function updateNodeById(nodeId, updater) {
    const node = getNodeById(nodeId);
    if (!node) return false;
    const collection = node.type === "reading" ? state.readings : state.events;
    const index = collection.findIndex((item) => item.id === nodeId);
    if (index < 0) return false;
    collection[index] = updater(collection[index]);
    return true;
  }

  function deleteNodeById(nodeId) {
    const node = getNodeById(nodeId);
    if (!node) return;
    if (node.type === "reading") {
      state.readings = state.readings.filter((item) => item.id !== nodeId);
      state.events = state.events.map((eventNode) => (
        eventNode.relatedReadingId === nodeId
          ? { ...eventNode, relatedReadingId: "", updatedAt: getNowIso() }
          : eventNode
      ));
    } else {
      state.events = state.events.filter((item) => item.id !== nodeId);
    }
    if (state.ui.selectedId === nodeId) state.ui.selectedId = null;
  }

  function createReadingNode(themeId) {
    return {
      id: createNodeId("reading"),
      type: "reading",
      title: `新占卜案例 ${state.readings.length + 1}`,
      category: "relationship",
      themeId,
      subject: "",
      date: getTodayTaipeiDate(),
      cards: "",
      interpretation: "",
      predictions: "",
      description: "",
      note: "",
      status: "pending",
      relatedReadingId: "",
      position: { x: 0, y: 0 },
      createdAt: getNowIso(),
      updatedAt: getNowIso(),
    };
  }

  function createEventNode(themeId, relatedReadingId) {
    const anchorReading = getNodeById(relatedReadingId);
    return {
      id: createNodeId("event"),
      type: "event",
      title: `新事件 ${state.events.length + 1}`,
      category: anchorReading?.category || "other",
      themeId: anchorReading?.themeId || themeId,
      subject: "",
      date: getTodayTaipeiDate(),
      cards: "",
      interpretation: "",
      predictions: "",
      description: "",
      note: "",
      status: "pending",
      relatedReadingId: relatedReadingId || "",
      position: { x: 0, y: 0 },
      createdAt: getNowIso(),
      updatedAt: getNowIso(),
    };
  }

  function normalizeSortDate(dateValue) {
    return dateValue || "9999-12-31";
  }

  function sortNodes(nodes) {
    return nodes.slice().sort((left, right) => {
      const dateCompare = normalizeSortDate(left.date).localeCompare(normalizeSortDate(right.date));
      if (dateCompare) return dateCompare;
      if (left.type !== right.type) return left.type === "reading" ? -1 : 1;
      return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
    });
  }

  /** 時間複雜度 O(n + m)，空間複雜度 O(n + m)。 */
  function getVisibleNodes() {
    const keyword = state.ui.search.trim().toLowerCase();
    const allNodes = [...state.readings, ...state.events];
    return allNodes.filter((node) => {
      if (state.ui.filterStatus !== "all" && node.status !== state.ui.filterStatus) return false;
      if (state.ui.filterCategory !== "all" && node.category !== state.ui.filterCategory) return false;
      if (state.ui.activeThemeId !== "all" && node.themeId !== state.ui.activeThemeId) return false;
      if (!keyword) return true;
      const haystack = [
        node.title,
        node.subject,
        node.cards,
        node.interpretation,
        node.predictions,
        node.description,
        node.note,
        node.date,
        getThemeTitle(node.themeId),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function groupNodesByDate(nodes) {
    const groups = [];
    let current = null;
    sortNodes(nodes).forEach((node) => {
      const dateKey = node.date || "未填日期";
      if (!current || current.dateKey !== dateKey) {
        current = { dateKey, nodes: [] };
        groups.push(current);
      }
      current.nodes.push(node);
    });
    return groups;
  }

  function createPlacement(node, x, y, baseX, baseY, streamX) {
    const size = NODE_SIZES[node.type];
    return {
      node,
      width: size.width,
      height: size.height,
      x,
      y,
      baseX,
      baseY,
      streamX,
      anchorY: baseY + size.height / 2,
      centerX: x + size.width / 2,
      centerY: y + size.height / 2,
    };
  }

  function placeGroupNodes(group, options) {
    const placements = [];
    let readingCount = 0;
    let eventCount = 0;
    group.nodes.forEach((node, index) => {
      const laneIndex = node.type === "reading" ? readingCount++ : eventCount++;
      const outward = Math.floor(laneIndex / 2) * options.laneSpread;
      const stagger = laneIndex % 2 ? options.laneStagger : 0;
      const baseX = node.type === "reading"
        ? options.streamX + options.readingOffset - outward - stagger
        : options.streamX + options.eventOffset + outward + stagger;
      const baseY = options.startY + index * options.verticalGap;
      const offsetX = clamp(Number(node.position?.x || 0), -280, 280);
      const offsetY = clamp(Number(node.position?.y || 0), -220, 220);
      placements.push(createPlacement(
        node,
        baseX + offsetX,
        baseY + offsetY,
        baseX,
        baseY,
        options.streamX
      ));
    });
    return placements;
  }

  function calculateBounds(placements, streams, sceneWidth, sceneHeight) {
    if (!placements.size) {
      const xValues = streams.map((stream) => stream.x);
      const centerX = xValues.length ? xValues.reduce((sum, value) => sum + value, 0) / xValues.length : sceneWidth / 2;
      return {
        left: centerX - 160,
        top: 20,
        right: centerX + 160,
        bottom: Math.min(sceneHeight, 520),
      };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    placements.forEach((placement) => {
      left = Math.min(left, placement.x, placement.streamX - 70);
      top = Math.min(top, placement.y, placement.anchorY - 40);
      right = Math.max(right, placement.x + placement.width, placement.streamX + 70);
      bottom = Math.max(bottom, placement.y + placement.height, placement.anchorY + 40);
    });
    return { left, top: Math.max(0, top - 54), right, bottom: bottom + 54 };
  }

  /** 時間複雜度 O(k log k)，空間複雜度 O(k)。 */
  function buildSingleLayout(nodes) {
    const placements = new Map();
    const dateMarkers = [];
    const streamX = 660;
    let cursorY = 120;
    const groups = groupNodesByDate(nodes);

    groups.forEach((group) => {
      const groupPlacements = placeGroupNodes(group, {
        streamX,
        startY: cursorY,
        readingOffset: -390,
        eventOffset: 110,
        laneSpread: 62,
        laneStagger: 24,
        verticalGap: 150,
      });
      groupPlacements.forEach((placement) => placements.set(placement.node.id, placement));
      const groupHeight = Math.max(148, (group.nodes.length - 1) * 150 + 138);
      dateMarkers.push({ streamX, dateKey: group.dateKey, y: cursorY + groupHeight / 2 - 6 });
      cursorY += groupHeight + 88;
    });

    const sceneWidth = 1180;
    const sceneHeight = Math.max(DEFAULT_SCENE_HEIGHT, cursorY + 120);
    const streams = [{
      id: state.ui.activeThemeId,
      title: getThemeTitle(state.ui.activeThemeId),
      color: getThemeColor(state.ui.activeThemeId),
      x: streamX,
      topY: 62,
      bottomY: Math.max(520, cursorY - 42),
    }];
    return {
      placements,
      dateMarkers,
      streams,
      sceneWidth,
      sceneHeight,
      bounds: calculateBounds(placements, streams, sceneWidth, sceneHeight),
    };
  }

  /** 時間複雜度 O(k log k + t)，空間複雜度 O(k + t)。 */
  function buildParallelLayout(nodes) {
    const placements = new Map();
    const dateMarkers = [];
    const streams = [];
    const nodesByTheme = new Map(state.themes.map((theme) => [theme.id, []]));
    nodes.forEach((node) => {
      if (!nodesByTheme.has(node.themeId)) nodesByTheme.set(node.themeId, []);
      nodesByTheme.get(node.themeId).push(node);
    });

    const visibleThemeIds = state.ui.activeThemeId === "all"
      ? state.themes.filter((theme) => (nodesByTheme.get(theme.id) || []).length > 0).map((theme) => theme.id)
      : [state.ui.activeThemeId];
    const laneThemeIds = visibleThemeIds.length ? visibleThemeIds : [state.themes[0].id];
    const firstStreamX = 420;
    const laneGap = 520;
    let maxBottom = 700;

    laneThemeIds.forEach((themeId, laneIndex) => {
      const streamX = firstStreamX + laneIndex * laneGap;
      let cursorY = 130;
      const groups = groupNodesByDate(nodesByTheme.get(themeId) || []);
      groups.forEach((group) => {
        const groupPlacements = placeGroupNodes(group, {
          streamX,
          startY: cursorY,
          readingOffset: -310,
          eventOffset: 50,
          laneSpread: 48,
          laneStagger: 18,
          verticalGap: 146,
        });
        groupPlacements.forEach((placement) => placements.set(placement.node.id, placement));
        const groupHeight = Math.max(144, (group.nodes.length - 1) * 146 + 132);
        dateMarkers.push({ streamX, dateKey: group.dateKey, y: cursorY + groupHeight / 2 - 6 });
        cursorY += groupHeight + 82;
      });
      const bottomY = Math.max(560, cursorY - 34);
      streams.push({
        id: themeId,
        title: getThemeTitle(themeId),
        color: getThemeColor(themeId),
        x: streamX,
        topY: 62,
        bottomY,
      });
      maxBottom = Math.max(maxBottom, bottomY + 120);
    });

    const sceneWidth = Math.max(1180, firstStreamX * 2 + (laneThemeIds.length - 1) * laneGap);
    const sceneHeight = Math.max(DEFAULT_SCENE_HEIGHT, maxBottom);
    return {
      placements,
      dateMarkers,
      streams,
      sceneWidth,
      sceneHeight,
      bounds: calculateBounds(placements, streams, sceneWidth, sceneHeight),
    };
  }

  function buildLayout(nodes) {
    return state.ui.viewMode === "parallel"
      ? buildParallelLayout(nodes)
      : buildSingleLayout(nodes);
  }

  function escapeHtml(input) {
    return String(input == null ? "" : input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hexToRgba(hex, alpha) {
    const normalized = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(183,148,255,${alpha})`;
    const value = Number.parseInt(normalized, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function truncate(text, maxLength) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  }

  function renderThemeSelects() {
    const allOption = state.ui.viewMode === "parallel"
      ? '<option value="all">全部主題</option>'
      : "";
    const options = state.themes.map((theme) => (
      `<option value="${escapeHtml(theme.id)}">${escapeHtml(theme.title)}</option>`
    )).join("");
    refs.activeTheme.innerHTML = allOption + options;
    refs.activeTheme.value = state.ui.activeThemeId;
    refs.fieldTheme.innerHTML = options;
  }

  function renderCategoryFilterOptions() {
    const used = new Set([...state.readings, ...state.events].map((node) => node.category));
    const options = ['<option value="all">全部主題分類</option>'];
    Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
      if (used.has(value) || state.ui.filterCategory === value) {
        options.push(`<option value="${value}">${label}</option>`);
      }
    });
    refs.filterCategory.innerHTML = options.join("");
    refs.filterCategory.value = state.ui.filterCategory;
  }

  function renderRelatedReadingOptions(selectedValue, themeId) {
    const readings = sortNodes(state.readings).sort((left, right) => {
      const leftPriority = left.themeId === themeId ? 0 : 1;
      const rightPriority = right.themeId === themeId ? 0 : 1;
      return leftPriority - rightPriority;
    });
    refs.fieldRelatedReading.innerHTML = [
      '<option value="">未連結</option>',
      ...readings.map((reading) => (
        `<option value="${escapeHtml(reading.id)}">${escapeHtml(reading.title || "未命名占卜案例")}｜${escapeHtml(getThemeTitle(reading.themeId))}</option>`
      )),
    ].join("");
    refs.fieldRelatedReading.value = selectedValue || "";
  }

  function renderStats(nodes) {
    const storageText = "本機儲存";
    const authText = isSignedIn ? "已登入・可編輯" : "訪客唯讀";
    refs.stats.innerHTML = [
      `<span class="map-stat-pill">主題流 ${state.themes.length}</span>`,
      `<span class="map-stat-pill">案例 ${state.readings.length}</span>`,
      `<span class="map-stat-pill">事件 ${state.events.length}</span>`,
      `<span class="map-stat-pill">目前顯示 ${nodes.length}</span>`,
      `<span class="map-stat-pill map-storage-pill">${storageText}</span>`,
      `<span class="map-stat-pill ${isSignedIn ? "map-auth-ok" : "map-auth-readonly"}">${authText}</span>`,
    ].join("");
  }

  function applySceneTransform() {
    refs.scene.style.width = `${currentLayout.sceneWidth}px`;
    refs.scene.style.minHeight = `${currentLayout.sceneHeight}px`;
    refs.scene.style.transform = `translate(${state.ui.panX}px, ${state.ui.panY}px) scale(${state.ui.zoom})`;
    refs.zoomReset.textContent = `${Math.round(state.ui.zoom * 100)}%`;
  }

  /** 時間複雜度 O(k)，空間複雜度 O(k)。 */
  function renderConnections(layout) {
    refs.connections.setAttribute("viewBox", `0 0 ${layout.sceneWidth} ${layout.sceneHeight}`);
    refs.connections.setAttribute("width", String(layout.sceneWidth));
    refs.connections.setAttribute("height", String(layout.sceneHeight));
    const fragments = [];

    layout.streams.forEach((stream) => {
      fragments.push(
        `<line class="map-stream-axis" x1="${stream.x}" y1="${stream.topY}" x2="${stream.x}" y2="${stream.bottomY}" style="stroke:${stream.color}" />`,
        `<ellipse class="map-stream-glow" cx="${stream.x}" cy="${(stream.topY + stream.bottomY) / 2}" rx="48" ry="${Math.max(220, (stream.bottomY - stream.topY) / 2 - 28)}" style="fill:${hexToRgba(stream.color, 0.08)}" />`,
        `<text class="map-stream-title" x="${stream.x}" y="38" text-anchor="middle">${escapeHtml(stream.title)}</text>`
      );
    });

    layout.dateMarkers.forEach((marker) => {
      fragments.push(
        `<line class="map-stream-tick" x1="${marker.streamX - 24}" y1="${marker.y}" x2="${marker.streamX + 24}" y2="${marker.y}" />`,
        `<circle class="map-stream-marker" cx="${marker.streamX}" cy="${marker.y}" r="9" />`,
        `<text class="map-stream-date-label" x="${marker.streamX}" y="${marker.y - 18}" text-anchor="middle">${escapeHtml(marker.dateKey)}</text>`
      );
    });

    layout.placements.forEach((placement) => {
      const startX = placement.node.type === "reading"
        ? placement.x + placement.width
        : placement.x;
      const startY = placement.centerY;
      const endX = placement.streamX;
      const endY = placement.anchorY;
      const direction = endX >= startX ? 1 : -1;
      const distance = Math.abs(endX - startX);
      const curve = clamp(distance * 0.42, 66, 170);
      const verticalGap = endY - startY;
      fragments.push(
        `<path class="map-stream-branch ${placement.node.type}" d="M ${startX} ${startY} C ${startX + direction * curve} ${startY + verticalGap * 0.08}, ${endX - direction * curve * 0.45} ${endY - verticalGap * 0.18}, ${endX} ${endY}" style="stroke:${hexToRgba(getThemeColor(placement.node.themeId), 0.56)}" />`
      );
    });

    state.events.forEach((eventNode) => {
      if (!eventNode.relatedReadingId) return;
      const eventPlacement = layout.placements.get(eventNode.id);
      const readingPlacement = layout.placements.get(eventNode.relatedReadingId);
      if (!eventPlacement || !readingPlacement) return;
      const startX = readingPlacement.x + readingPlacement.width / 2;
      const startY = readingPlacement.y + readingPlacement.height;
      const endX = eventPlacement.x + eventPlacement.width / 2;
      const endY = eventPlacement.y;
      const middleY = startY + (endY - startY) / 2;
      fragments.push(
        `<path class="map-link-line" d="M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}" />`
      );
    });

    refs.connections.innerHTML = fragments.join("");
  }

  function createNodeElement(placement) {
    const node = placement.node;
    const themeColor = getThemeColor(node.themeId);
    const previewSource = node.type === "reading"
      ? (node.interpretation || node.cards || node.predictions || "尚未填入解讀")
      : (node.description || node.note || "尚未填入事件描述");
    const element = document.createElement("button");
    element.type = "button";
    element.className = `map-node ${node.type} status-${node.status}${state.ui.selectedId === node.id ? " is-selected" : ""}`;
    element.dataset.nodeId = node.id;
    element.style.left = `${placement.x}px`;
    element.style.top = `${placement.y}px`;
    element.style.setProperty("--theme-color", themeColor);
    element.style.setProperty("--theme-color-soft", hexToRgba(themeColor, 0.14));
    element.innerHTML = `
      <span class="map-node-header">
        <span class="map-node-type">${TYPE_LABELS[node.type]}</span>
        <span class="map-theme-pill">${escapeHtml(getThemeTitle(node.themeId))}</span>
      </span>
      <span class="map-node-title">${escapeHtml(node.title || "未命名節點")}</span>
      <span class="map-node-meta">${escapeHtml(CATEGORY_LABELS[node.category] || "其他")}${node.subject ? `・${escapeHtml(node.subject)}` : ""}</span>
      <span class="map-node-preview">${escapeHtml(truncate(previewSource, 66))}</span>
      <span class="map-node-footer">
        <span class="map-node-status">${STATUS_LABELS[node.status]}</span>
      </span>
    `;
    element.addEventListener("click", (event) => {
      if (dragState?.moved) return;
      event.stopPropagation();
      state.ui.selectedId = node.id;
      saveState();
      renderAll({ fit: false });
    });
    element.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id));
    return element;
  }

  function renderMap(nodes) {
    currentLayout = buildLayout(nodes);
    refs.canvas.replaceChildren();
    currentLayout.placements.forEach((placement) => {
      refs.canvas.appendChild(createNodeElement(placement));
    });
    if (!nodes.length) {
      const empty = document.createElement("div");
      empty.className = "map-canvas-empty";
      empty.textContent = "目前篩選條件下沒有節點。";
      refs.canvas.appendChild(empty);
    }
    renderConnections(currentLayout);
  }

  function renderDetailPanel() {
    const node = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
    refs.emptyState.classList.toggle("hidden", Boolean(node));
    refs.detailForm.classList.toggle("hidden", !node);
    if (!node) return;

    refs.detailId.value = node.id;
    refs.detailTypeLabel.textContent = TYPE_LABELS[node.type];
    refs.detailTitle.textContent = node.title || "節點內容";
    refs.selectedId.textContent = node.id;
    refs.fieldTheme.value = node.themeId;
    refs.fieldDate.value = node.date || "";
    refs.fieldTitle.value = node.title || "";
    refs.fieldCategory.value = node.category || "other";
    refs.fieldStatus.value = node.status || "pending";
    refs.fieldNote.value = node.note || "";
    refs.detailThemeHint.textContent = `${getThemeTitle(node.themeId)}｜${getThemeById(node.themeId)?.description || "未填主題說明"}`;

    const isReading = node.type === "reading";
    document.querySelectorAll("[data-reading-only]").forEach((field) => field.classList.toggle("hidden", !isReading));
    document.querySelectorAll("[data-event-only]").forEach((field) => field.classList.toggle("hidden", isReading));
    if (isReading) {
      refs.fieldSubject.value = node.subject || "";
      refs.fieldCards.value = node.cards || "";
      refs.fieldInterpretation.value = node.interpretation || "";
      refs.fieldPredictions.value = node.predictions || "";
    } else {
      renderRelatedReadingOptions(node.relatedReadingId || "", node.themeId);
      refs.fieldEventDescription.value = node.description || "";
    }
  }

  function renderTimeline(nodes) {
    const sorted = sortNodes(nodes);
    if (!sorted.length) {
      refs.timeline.innerHTML = '<p class="map-timeline-empty">目前沒有符合條件的占卜案例或事件。</p>';
      return;
    }
    refs.timeline.innerHTML = sorted.map((node) => {
      const content = node.type === "reading"
        ? (node.interpretation || node.predictions || node.cards || "尚未填入內容")
        : (node.description || node.note || "尚未填入事件描述");
      return `
        <article class="map-timeline-item ${node.type}" data-timeline-node-id="${escapeHtml(node.id)}">
          <div class="map-timeline-top">
            <span class="map-node-type">${TYPE_LABELS[node.type]}</span>
            <span class="map-timeline-date">${escapeHtml(node.date || "未填日期")}</span>
          </div>
          <h5>${escapeHtml(node.title || "未命名節點")}</h5>
          <p>${escapeHtml(truncate(content, 150))}</p>
          <div class="map-timeline-footer">
            <span class="map-theme-pill" style="--theme-color:${getThemeColor(node.themeId)};--theme-color-soft:${hexToRgba(getThemeColor(node.themeId), 0.14)}">${escapeHtml(getThemeTitle(node.themeId))}</span>
            <button type="button" class="map-timeline-open" data-open-node="${escapeHtml(node.id)}">查看內容</button>
          </div>
        </article>
      `;
    }).join("");
    refs.timeline.querySelectorAll("[data-open-node]").forEach((button) => {
      button.addEventListener("click", () => {
        state.ui.selectedId = button.dataset.openNode || null;
        saveState();
        renderAll({ fit: false });
        refs.detailForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }

  function setEditingEnabled(enabled) {
    isSignedIn = Boolean(enabled);
    const editButtons = [refs.addTheme, refs.addReading, refs.addEvent, refs.deleteNode, refs.resetData];
    editButtons.forEach((button) => {
      if (!button) return;
      button.disabled = !isSignedIn;
      button.title = isSignedIn ? "" : "請先從右上角登入 Google 帳號";
    });
    refs.detailForm?.querySelectorAll("input, select, textarea, button").forEach((element) => {
      if (element.id === "map-detail-id") return;
      element.disabled = !isSignedIn;
    });
    refs.detailForm?.classList.toggle("is-auth-readonly", !isSignedIn);
    const signInHint = document.getElementById("map-auth-hint");
    if (signInHint) {
      signInHint.textContent = isSignedIn
        ? "已登入，可編輯；資料目前仍只保存在這個瀏覽器。"
        : "訪客僅能瀏覽；請從右上角登入 Google 帳號後編輯。";
      signInHint.classList.toggle("is-signed-in", isSignedIn);
    }
  }

  /** 時間複雜度 O(k)，空間複雜度 O(1)。 */
  function fitSceneToContent(persist = true) {
    const viewportWidth = refs.viewport.clientWidth;
    const viewportHeight = refs.viewport.clientHeight;
    if (!viewportWidth || !viewportHeight) return;
    const bounds = currentLayout.bounds;
    const contentWidth = Math.max(320, bounds.right - bounds.left);
    const contentHeight = Math.max(260, bounds.bottom - bounds.top);
    const zoom = clamp(
      Math.min(
        (viewportWidth - FIT_PADDING * 2) / contentWidth,
        (viewportHeight - FIT_PADDING * 2) / contentHeight,
        0.92
      ),
      MIN_ZOOM,
      MAX_ZOOM
    );
    state.ui.zoom = zoom;
    state.ui.panX = (viewportWidth - contentWidth * zoom) / 2 - bounds.left * zoom;
    state.ui.panY = (viewportHeight - contentHeight * zoom) / 2 - bounds.top * zoom;
    applySceneTransform();
    if (persist) saveState();
  }

  function renderAll(options = {}) {
    rebuildIndexes();
    if (state.ui.viewMode === "single" && state.ui.activeThemeId === "all") {
      state.ui.activeThemeId = state.themes[0]?.id || "";
    }
    renderThemeSelects();
    renderCategoryFilterOptions();
    refs.filterStatus.value = state.ui.filterStatus;
    refs.search.value = state.ui.search;
    refs.viewMode.value = state.ui.viewMode;
    refs.activeTheme.value = state.ui.activeThemeId;
    const visibleNodes = getVisibleNodes();
    renderStats(visibleNodes);
    renderMap(visibleNodes);
    renderDetailPanel();
    renderTimeline(visibleNodes);
    setEditingEnabled(isSignedIn);
    applySceneTransform();
    if (options.fit || shouldFitAfterRender) {
      shouldFitAfterRender = false;
      window.requestAnimationFrame(() => fitSceneToContent(true));
    }
  }

  function openTextModal({ title, description, label, value = "" }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "map-modal-backdrop";
      backdrop.innerHTML = `
        <div class="map-modal" role="dialog" aria-modal="true" aria-labelledby="map-text-modal-title">
          <div class="map-modal-header">
            <p class="map-form-kicker">Timeflow</p>
            <h3 id="map-text-modal-title">${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
          </div>
          <form class="map-modal-form">
            <label>${escapeHtml(label)}<input type="text" maxlength="60" value="${escapeHtml(value)}" required /></label>
            <div class="map-modal-actions">
              <button type="button" class="btn ghost" data-cancel>取消</button>
              <button type="submit" class="btn primary">確認</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(backdrop);
      const form = backdrop.querySelector("form");
      const input = backdrop.querySelector("input");
      const cleanup = (result) => {
        backdrop.remove();
        resolve(result);
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const result = input.value.trim();
        if (result) cleanup(result);
      });
      backdrop.querySelector("[data-cancel]").addEventListener("click", () => cleanup(""));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) cleanup("");
      });
      window.requestAnimationFrame(() => input.focus());
    });
  }

  async function confirmAction(message, title) {
    if (window.EvanDialog?.confirm) return window.EvanDialog.confirm(message, title);
    return window.confirm(message);
  }

  async function addTheme() {
    if (!isSignedIn) return openAccountPanel();
    const title = await openTextModal({
      title: "新增主題流",
      description: "主題流用來把同一問題的占卜與後續事件接在一起。",
      label: "主題流名稱",
    });
    if (!title) return;
    const theme = createThemeObject(title, "", state.themes.length);
    state.themes.push(theme);
    state.ui.activeThemeId = theme.id;
    state.ui.viewMode = "single";
    saveState();
    renderAll({ fit: true });
  }

  function addReading() {
    if (!isSignedIn) return openAccountPanel();
    const node = createReadingNode(getDefaultThemeId());
    state.readings.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll({ fit: true });
  }

  function addEvent() {
    if (!isSignedIn) return openAccountPanel();
    const selected = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
    const relatedReadingId = selected?.type === "reading"
      ? selected.id
      : selected?.type === "event"
        ? selected.relatedReadingId
        : "";
    const node = createEventNode(getDefaultThemeId(), relatedReadingId);
    state.events.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll({ fit: true });
  }

  function saveDetailForm(event) {
    event.preventDefault();
    if (!isSignedIn) return openAccountPanel();
    const nodeId = refs.detailId.value;
    const current = getNodeById(nodeId);
    if (!current) return;
    updateNodeById(nodeId, (node) => ({
      ...node,
      themeId: refs.fieldTheme.value,
      date: refs.fieldDate.value,
      title: refs.fieldTitle.value.trim(),
      category: refs.fieldCategory.value,
      status: refs.fieldStatus.value,
      subject: node.type === "reading" ? refs.fieldSubject.value.trim() : "",
      cards: node.type === "reading" ? refs.fieldCards.value.trim() : "",
      interpretation: node.type === "reading" ? refs.fieldInterpretation.value.trim() : "",
      predictions: node.type === "reading" ? refs.fieldPredictions.value.trim() : "",
      description: node.type === "event" ? refs.fieldEventDescription.value.trim() : "",
      relatedReadingId: node.type === "event" ? refs.fieldRelatedReading.value : "",
      note: refs.fieldNote.value.trim(),
      updatedAt: getNowIso(),
    }));
    saveState();
    renderAll({ fit: false });
  }

  async function deleteSelectedNode() {
    if (!isSignedIn) return openAccountPanel();
    const nodeId = refs.detailId.value;
    if (!nodeId) return;
    const confirmed = await confirmAction("確定要刪除此節點嗎？刪除後無法直接復原。", "刪除節點");
    if (!confirmed) return;
    deleteNodeById(nodeId);
    saveState();
    renderAll({ fit: true });
  }

  async function resetData() {
    if (!isSignedIn) return openAccountPanel();
    const confirmed = await confirmAction("要清空這個瀏覽器內的所有占卜時間流資料嗎？此動作無法復原。", "清空本機資料");
    if (!confirmed) return;
    state = createInitialState();
    saveState();
    renderAll({ fit: true });
  }

  function exportJson() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=UTF-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `evan-tarot-timeflow-${getTodayTaipeiDate()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function openAccountPanel() {
    window.EvanSiteAccount?.open?.();
  }

  function updateAuthState(authState) {
    const nextSignedIn = Boolean(authState?.isSignedIn || window.EvanGoogleAuth?.isSignedIn?.());
    if (nextSignedIn === isSignedIn) {
      setEditingEnabled(nextSignedIn);
      renderStats(getVisibleNodes());
      return;
    }
    isSignedIn = nextSignedIn;
    setEditingEnabled(isSignedIn);
    renderStats(getVisibleNodes());
  }

  function changeZoom(delta, centerX, centerY) {
    const previousZoom = state.ui.zoom;
    const nextZoom = clamp(previousZoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === previousZoom) return;
    const viewportRect = refs.viewport.getBoundingClientRect();
    const localX = centerX == null ? viewportRect.width / 2 : centerX - viewportRect.left;
    const localY = centerY == null ? viewportRect.height / 2 : centerY - viewportRect.top;
    const sceneX = (localX - state.ui.panX) / previousZoom;
    const sceneY = (localY - state.ui.panY) / previousZoom;
    state.ui.zoom = nextZoom;
    state.ui.panX = localX - sceneX * nextZoom;
    state.ui.panY = localY - sceneY * nextZoom;
    saveState();
    applySceneTransform();
  }

  function startPan(event) {
    if (event.button !== 0 || event.target.closest(".map-node")) return;
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: state.ui.panX,
      panY: state.ui.panY,
    };
    refs.viewport.setPointerCapture(event.pointerId);
    refs.viewport.classList.add("is-panning");
  }

  function movePan(event) {
    if (!panState || panState.pointerId !== event.pointerId) return;
    state.ui.panX = panState.panX + event.clientX - panState.startX;
    state.ui.panY = panState.panY + event.clientY - panState.startY;
    applySceneTransform();
  }

  function endPan(event) {
    if (!panState || panState.pointerId !== event.pointerId) return;
    panState = null;
    refs.viewport.classList.remove("is-panning");
    saveState();
  }

  function startNodeDrag(event, nodeId) {
    if (event.button !== 0 || !isSignedIn) return;
    const placement = currentLayout.placements.get(nodeId);
    const node = getNodeById(nodeId);
    if (!placement || !node) return;
    event.stopPropagation();
    dragState = {
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number(node.position?.x || 0),
      originY: Number(node.position?.y || 0),
      moved: false,
    };
    refs.viewport.setPointerCapture(event.pointerId);
  }

  function moveNodeDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = (event.clientX - dragState.startX) / state.ui.zoom;
    const dy = (event.clientY - dragState.startY) / state.ui.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    updateNodeById(dragState.nodeId, (node) => ({
      ...node,
      position: {
        x: clamp(dragState.originX + dx, -280, 280),
        y: clamp(dragState.originY + dy, -220, 220),
      },
      updatedAt: getNowIso(),
    }));
    rebuildIndexes();
    renderMap(getVisibleNodes());
    applySceneTransform();
  }

  function endNodeDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const moved = dragState.moved;
    dragState = null;
    if (moved) saveState();
  }

  function bindEvents() {
    refs.addTheme.addEventListener("click", addTheme);
    refs.addReading.addEventListener("click", addReading);
    refs.addEvent.addEventListener("click", addEvent);
    refs.detailForm.addEventListener("submit", saveDetailForm);
    refs.deleteNode.addEventListener("click", deleteSelectedNode);
    refs.resetData.addEventListener("click", resetData);
    refs.exportJson.addEventListener("click", exportJson);

    refs.viewMode.addEventListener("change", () => {
      state.ui.viewMode = refs.viewMode.value === "parallel" ? "parallel" : "single";
      state.ui.activeThemeId = state.ui.viewMode === "single"
        ? (state.ui.activeThemeId === "all" ? state.themes[0].id : state.ui.activeThemeId)
        : state.ui.activeThemeId;
      saveState();
      renderAll({ fit: true });
    });
    refs.activeTheme.addEventListener("change", () => {
      state.ui.activeThemeId = refs.activeTheme.value;
      saveState();
      renderAll({ fit: true });
    });
    refs.filterStatus.addEventListener("change", () => {
      state.ui.filterStatus = refs.filterStatus.value;
      saveState();
      renderAll({ fit: true });
    });
    refs.filterCategory.addEventListener("change", () => {
      state.ui.filterCategory = refs.filterCategory.value;
      saveState();
      renderAll({ fit: true });
    });
    refs.search.addEventListener("input", () => {
      state.ui.search = refs.search.value;
      saveState();
      renderAll({ fit: true });
    });

    refs.zoomOut.addEventListener("click", () => changeZoom(-0.1));
    refs.zoomIn.addEventListener("click", () => changeZoom(0.1));
    refs.zoomReset.addEventListener("click", () => fitSceneToContent(true));
    refs.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      changeZoom(event.deltaY > 0 ? -0.08 : 0.08, event.clientX, event.clientY);
    }, { passive: false });
    refs.viewport.addEventListener("pointerdown", startPan);
    refs.viewport.addEventListener("pointermove", (event) => {
      movePan(event);
      moveNodeDrag(event);
    });
    refs.viewport.addEventListener("pointerup", (event) => {
      endPan(event);
      endNodeDrag(event);
    });
    refs.viewport.addEventListener("pointercancel", (event) => {
      endPan(event);
      endNodeDrag(event);
    });
    refs.viewport.addEventListener("click", (event) => {
      if (event.target === refs.viewport || event.target === refs.scene || event.target === refs.canvas) {
        state.ui.selectedId = null;
        saveState();
        renderAll({ fit: false });
      }
    });

    window.addEventListener(AUTH_EVENT, (event) => updateAuthState(event.detail));
    window.addEventListener("resize", debounce(() => fitSceneToContent(false), 180));
  }

  function debounce(callback, delay) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  function collectRefs() {
    refs = {
      addTheme: document.getElementById("map-add-theme"),
      addReading: document.getElementById("map-add-reading"),
      addEvent: document.getElementById("map-add-event"),
      viewMode: document.getElementById("map-view-mode"),
      activeTheme: document.getElementById("map-active-theme"),
      filterStatus: document.getElementById("map-filter-status"),
      filterCategory: document.getElementById("map-filter-category"),
      search: document.getElementById("map-search"),
      stats: document.getElementById("map-stats"),
      zoomOut: document.getElementById("map-zoom-out"),
      zoomReset: document.getElementById("map-zoom-reset"),
      zoomIn: document.getElementById("map-zoom-in"),
      exportJson: document.getElementById("map-export-json"),
      resetData: document.getElementById("map-reset-data"),
      viewport: document.getElementById("map-viewport"),
      scene: document.getElementById("map-scene"),
      connections: document.getElementById("map-connections"),
      canvas: document.getElementById("map-canvas"),
      emptyState: document.getElementById("map-empty-state"),
      detailForm: document.getElementById("map-detail-form"),
      detailTypeLabel: document.getElementById("map-detail-type-label"),
      detailTitle: document.getElementById("map-detail-title"),
      selectedId: document.getElementById("map-selected-id"),
      detailId: document.getElementById("map-detail-id"),
      fieldTheme: document.getElementById("map-field-theme"),
      fieldDate: document.getElementById("map-field-date"),
      detailThemeHint: document.getElementById("map-detail-theme-hint"),
      fieldTitle: document.getElementById("map-field-title"),
      fieldCategory: document.getElementById("map-field-category"),
      fieldSubject: document.getElementById("map-field-subject"),
      fieldRelatedReading: document.getElementById("map-field-related-reading"),
      fieldStatus: document.getElementById("map-field-status"),
      fieldCards: document.getElementById("map-field-cards"),
      fieldInterpretation: document.getElementById("map-field-interpretation"),
      fieldPredictions: document.getElementById("map-field-predictions"),
      fieldEventDescription: document.getElementById("map-field-event-description"),
      fieldNote: document.getElementById("map-field-note"),
      deleteNode: document.getElementById("map-delete-node"),
      timeline: document.getElementById("map-timeline"),
    };
    return Object.values(refs).every(Boolean);
  }

  async function init() {
    if (!collectRefs()) return;
    state = loadState();
    rebuildIndexes();
    isSignedIn = Boolean(window.EvanGoogleAuth?.isSignedIn?.());
    bindEvents();
    renderAll({ fit: true });
    if (window.EvanGoogleAuth?.onChange) {
      window.EvanGoogleAuth.onChange(updateAuthState);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
