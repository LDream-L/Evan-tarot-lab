// ==============================
// divination-map.js
// 占卜時間流 Beta v3
// ==============================
//
// 核心設計：
// 1. 時間流移到獨立頁面，首頁只保留入口。
// 2. 新增「主題流」概念：每個案例 / 事件都可歸到某一個主題。
// 3. 支援兩種檢視模式：
//    - single：單一主流檢視（適合聚焦單一主題驗證）
//    - parallel：平行時間流檢視（適合比較多個主題）
//
// 關鍵函式複雜度：
// - initDivinationMap：O(n + m)
// - buildSingleLayout：O(k log k)
// - buildParallelLayout：O(k log k)
// - renderMap / renderTimeline：O(k log k)
//
// 更快替代方案比較：
// - 暴力法：所有節點都擠在一條線上，再靠顏色硬分群。
// - 本版：先建立主題流，再提供單流 / 平行流兩種檢視，辨識度與驗證性更高。
// ==============================

(function initDivinationMapModule() {
  const STORAGE_KEY = "evanTarotDivinationTimeflowV3";
  const LEGACY_KEYS = [
    "evanTarotDivinationTimeflowV2",
    "evanTarotDivinationMapV1",
  ];

  // 管理員鎖：GitHub Pages 是純前端，這只能防一般訪客誤改；真正防竄改仍需後端權限。
  // 上線前請把這串改成你自己的密碼。
  const ADMIN_PASSCODE = "EVAN";
  const ADMIN_SESSION_KEY = "evanTarotTimeflowAdminUnlocked";

  const DEFAULT_SCENE_WIDTH = 1680;
  const DEFAULT_SCENE_HEIGHT = 1500;
  const SINGLE_STREAM_X = 840;

  const PARALLEL_LANE_GAP = 520;
  const PARALLEL_FIRST_STREAM_X = 320;
  const PARALLEL_READING_X_OFFSET = -310;
  const PARALLEL_EVENT_X_OFFSET = 40;

  const NODE_SIZES = {
    reading: { width: 272, height: 154 },
    event: { width: 248, height: 136 },
  };

  const THEME_COLORS = [
    "#b794ff",
    "#7fe3b2",
    "#7de4ff",
    "#ffb3d8",
    "#ffd27a",
    "#a9b4ff",
    "#8fd7ff",
    "#ff9bb2",
  ];

  const CATEGORY_LABELS = {
    relationship: "人際 / 感情",
    career: "工作 / 職涯",
    self: "自我成長",
    money: "金錢 / 資源",
    study: "學習 / 考試",
    family: "家庭 / 關係",
    other: "其他",
  };

  const STATUS_LABELS = {
    pending: "尚未驗證",
    partial: "部分驗證",
    verified: "驗證成立",
    missed: "未應驗",
  };

  const TYPE_LABELS = {
    reading: "占卜案例",
    event: "驗證事件",
  };

  let state = null;
  let refs = {};
  let dragState = null;
  let panState = null;
  let currentLayout = {
    placements: new Map(),
    streams: [],
    dateMarkers: [],
    sceneWidth: DEFAULT_SCENE_WIDTH,
    sceneHeight: DEFAULT_SCENE_HEIGHT,
  };

  function createInitialState() {
    const defaultTheme = createThemeObject("第一主題流", "第一條驗證主線", 0);
    return {
      version: 3,
      themes: [defaultTheme],
      readings: [],
      events: [],
      ui: {
        zoom: 0.88,
        panX: -120,
        panY: 0,
        selectedId: null,
        filterStatus: "all",
        filterCategory: "all",
        search: "",
        activeThemeId: "all",
        viewMode: "single",
      },
    };
  }

  function createThemeObject(title, description, index) {
    return {
      id: createNodeId("theme"),
      title: title || `主題流 ${index + 1}`,
      description: description || "",
      color: THEME_COLORS[index % THEME_COLORS.length],
      createdAt: getNowIso(),
    };
  }

  function getNowIso() {
    return window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString();
  }

  function getTodayTaipeiDate() {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  }

  function createNodeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function ensureThemes(rawThemes) {
    const themes = Array.isArray(rawThemes) ? rawThemes.slice() : [];
    if (!themes.length) {
      return [createThemeObject("第一主題流", "第一條驗證主線", 0)];
    }

    return themes.map((theme, index) => ({
      id: theme.id || createNodeId("theme"),
      title: theme.title || `主題流 ${index + 1}`,
      description: theme.description || "",
      color: theme.color || THEME_COLORS[index % THEME_COLORS.length],
      createdAt: theme.createdAt || getNowIso(),
    }));
  }

  function ensureNode(node, type, fallbackThemeId) {
    return {
      id: node.id || createNodeId(type),
      type,
      title: node.title || "",
      category: node.category || "other",
      themeId: node.themeId || fallbackThemeId,
      date: node.date || "",
      subject: node.subject || "",
      cards: node.cards || "",
      interpretation: node.interpretation || "",
      predictions: node.predictions || "",
      description: node.description || "",
      note: node.note || "",
      status: node.status || "pending",
      relatedReadingId: node.relatedReadingId || "",
      position: {
        x: Number(node.position?.x || 0),
        y: Number(node.position?.y || 0),
      },
      createdAt: node.createdAt || getNowIso(),
      updatedAt: node.updatedAt || getNowIso(),
    };
  }

  function migrateLegacyState(parsed) {
    const initial = createInitialState();
    const fallbackThemeId = initial.themes[0].id;

    return {
      ...initial,
      version: 3,
      themes: initial.themes,
      readings: Array.isArray(parsed?.readings)
        ? parsed.readings.map((node) => ensureNode(node, "reading", fallbackThemeId))
        : [],
      events: Array.isArray(parsed?.events)
        ? parsed.events.map((node) => ensureNode(node, "event", fallbackThemeId))
        : [],
      ui: {
        ...initial.ui,
        ...(parsed?.ui || {}),
        activeThemeId: "all",
        viewMode: "single",
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const initial = createInitialState();
        const themes = ensureThemes(parsed?.themes);
        const fallbackThemeId = themes[0].id;

        return {
          ...initial,
          ...parsed,
          version: 3,
          themes,
          readings: Array.isArray(parsed?.readings)
            ? parsed.readings.map((node) => ensureNode(node, "reading", fallbackThemeId))
            : [],
          events: Array.isArray(parsed?.events)
            ? parsed.events.map((node) => ensureNode(node, "event", fallbackThemeId))
            : [],
          ui: {
            ...initial.ui,
            ...(parsed?.ui || {}),
            activeThemeId: parsed?.ui?.activeThemeId || "all",
            viewMode: parsed?.ui?.viewMode || "single",
          },
        };
      }

      for (const key of LEGACY_KEYS) {
        const legacyRaw = localStorage.getItem(key);
        if (legacyRaw) {
          return migrateLegacyState(JSON.parse(legacyRaw));
        }
      }

      return createInitialState();
    } catch (error) {
      console.warn("占卜時間流資料損壞，已重置。", error);
      localStorage.removeItem(STORAGE_KEY);
      return createInitialState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getAllNodes() {
    return [...state.readings, ...state.events];
  }

  function getThemeById(themeId) {
    return state.themes.find((theme) => theme.id === themeId) || null;
  }

  function getThemeTitle(themeId) {
    return getThemeById(themeId)?.title || "未分類主題";
  }

  function getThemeColor(themeId) {
    return getThemeById(themeId)?.color || THEME_COLORS[0];
  }

  function getDefaultCreateThemeId() {
    if (state.ui.activeThemeId !== "all" && getThemeById(state.ui.activeThemeId)) {
      return state.ui.activeThemeId;
    }
    return state.themes[0]?.id || createInitialState().themes[0].id;
  }

  function getNodeById(nodeId) {
    return getAllNodes().find((node) => node.id === nodeId) || null;
  }

  function updateNodeById(nodeId, updater) {
    const readingIndex = state.readings.findIndex((node) => node.id === nodeId);
    if (readingIndex !== -1) {
      state.readings[readingIndex] = updater(state.readings[readingIndex]);
      return;
    }

    const eventIndex = state.events.findIndex((node) => node.id === nodeId);
    if (eventIndex !== -1) {
      state.events[eventIndex] = updater(state.events[eventIndex]);
    }
  }

  function deleteNodeById(nodeId) {
    const isReading = state.readings.some((node) => node.id === nodeId);

    if (isReading) {
      state.readings = state.readings.filter((node) => node.id !== nodeId);
      state.events = state.events.map((eventNode) => {
        if (eventNode.relatedReadingId !== nodeId) return eventNode;
        return {
          ...eventNode,
          relatedReadingId: "",
          updatedAt: getNowIso(),
        };
      });
    } else {
      state.events = state.events.filter((node) => node.id !== nodeId);
    }

    if (state.ui.selectedId === nodeId) {
      state.ui.selectedId = null;
    }
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
      note: "",
      status: "pending",
      position: { x: 0, y: 0 },
      createdAt: getNowIso(),
      updatedAt: getNowIso(),
    };
  }

  function createEventNode(themeId, relatedReadingId) {
    const anchorReading = relatedReadingId
      ? state.readings.find((reading) => reading.id === relatedReadingId)
      : null;

    return {
      id: createNodeId("event"),
      type: "event",
      title: `新事件 ${state.events.length + 1}`,
      category: anchorReading?.category || "other",
      themeId: anchorReading?.themeId || themeId,
      date: getTodayTaipeiDate(),
      description: "",
      relatedReadingId: relatedReadingId || "",
      note: "",
      status: "pending",
      position: { x: 0, y: 0 },
      createdAt: getNowIso(),
      updatedAt: getNowIso(),
    };
  }

  function normalizeSortDate(dateValue) {
    return dateValue || "9999-12-31";
  }

  function getSortedNodes(nodes) {
    return nodes.slice().sort((a, b) => {
      const leftDate = normalizeSortDate(a.date);
      const rightDate = normalizeSortDate(b.date);
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

      if (a.type !== b.type) {
        return a.type === "reading" ? -1 : 1;
      }

      const leftCreated = a.createdAt || "";
      const rightCreated = b.createdAt || "";
      return leftCreated.localeCompare(rightCreated);
    });
  }

  function getVisibleNodes() {
    const keyword = state.ui.search.trim().toLowerCase();

    return getAllNodes().filter((node) => {
      const statusMatch =
        state.ui.filterStatus === "all" || node.status === state.ui.filterStatus;
      const categoryMatch =
        state.ui.filterCategory === "all" || node.category === state.ui.filterCategory;
      const themeMatch =
        state.ui.activeThemeId === "all" || node.themeId === state.ui.activeThemeId;

      if (!statusMatch || !categoryMatch || !themeMatch) return false;

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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }

  function groupNodesByDate(nodes) {
    const groups = [];
    let currentGroup = null;

    getSortedNodes(nodes).forEach((node) => {
      const dateKey = node.date || "未填日期";
      if (!currentGroup || currentGroup.dateKey !== dateKey) {
        currentGroup = { dateKey, nodes: [] };
        groups.push(currentGroup);
      }
      currentGroup.nodes.push(node);
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
      centerX: x + size.width / 2,
      centerY: y + size.height / 2,
    };
  }

  function placeGroupNodes(group, options) {
    const placements = [];
    let readingLaneCount = 0;
    let eventLaneCount = 0;

    group.nodes.forEach((node, index) => {
      const laneCount = node.type === "reading" ? readingLaneCount++ : eventLaneCount++;
      const outerShift = Math.floor(laneCount / 2) * options.laneSpread;
      const innerShift = laneCount % 2 === 1 ? options.laneStagger : 0;

      const baseX =
        node.type === "reading"
          ? options.streamX + options.readingBaseOffset - outerShift - innerShift
          : options.streamX + options.eventBaseOffset + outerShift + innerShift;

      const baseY = options.groupStartY + index * options.verticalGap;
      // 日期由欄位固定；position 只作為視覺偏移，方便檢閱與避開重疊。
      // 時間複雜度：O(1)；空間複雜度：O(1)。
      const offsetX = clamp(Number(node.position?.x || 0), -260, 260);
      const offsetY = clamp(Number(node.position?.y || 0), -220, 220);

      placements.push(
        createPlacement(
          node,
          baseX + offsetX,
          baseY + offsetY,
          baseX,
          baseY,
          options.streamX
        )
      );
    });

    return placements;
  }

  function buildSingleLayout(nodes) {
    const placements = new Map();
    const dateMarkers = [];
    const streamX = SINGLE_STREAM_X;
    let cursorY = 150;

    const groups = groupNodesByDate(nodes);

    groups.forEach((group) => {
      const groupStartY = cursorY;
      const groupPlacements = placeGroupNodes(group, {
        streamX,
        groupStartY,
        readingBaseOffset: -420,
        eventBaseOffset: 120,
        laneSpread: 72,
        laneStagger: 30,
        verticalGap: 156,
      });

      groupPlacements.forEach((placement) => {
        placements.set(placement.node.id, placement);
      });

      const groupHeight = Math.max(150, (group.nodes.length - 1) * 156 + 138);
      const markerY = groupStartY + groupHeight / 2 - 8;
      dateMarkers.push({
        streamX,
        dateKey: group.dateKey,
        y: markerY,
      });

      cursorY += groupHeight + 120;
    });

    return {
      placements,
      dateMarkers,
      streams: [
        {
          id: "single",
          title:
            state.ui.activeThemeId === "all"
              ? "全部主題"
              : getThemeTitle(state.ui.activeThemeId),
          color:
            state.ui.activeThemeId === "all"
              ? "#b794ff"
              : getThemeColor(state.ui.activeThemeId),
          x: streamX,
          topY: 70,
          bottomY: Math.max(cursorY, DEFAULT_SCENE_HEIGHT) - 70,
        },
      ],
      sceneWidth: DEFAULT_SCENE_WIDTH,
      sceneHeight: Math.max(cursorY + 120, DEFAULT_SCENE_HEIGHT),
    };
  }

  function buildParallelLayout(nodes) {
    const placements = new Map();
    const dateMarkers = [];
    const streams = [];
    const nodesByTheme = new Map();

    state.themes.forEach((theme) => nodesByTheme.set(theme.id, []));
    nodes.forEach((node) => {
      if (!nodesByTheme.has(node.themeId)) nodesByTheme.set(node.themeId, []);
      nodesByTheme.get(node.themeId).push(node);
    });

    const visibleThemeIds = state.ui.activeThemeId !== "all"
      ? [state.ui.activeThemeId]
      : state.themes
          .filter((theme) => (nodesByTheme.get(theme.id) || []).length > 0)
          .map((theme) => theme.id);

    const laneThemeIds = visibleThemeIds.length ? visibleThemeIds : [state.themes[0].id];
    const sceneWidth = Math.max(
      DEFAULT_SCENE_WIDTH,
      PARALLEL_FIRST_STREAM_X * 2 + (laneThemeIds.length - 1) * PARALLEL_LANE_GAP
    );

    let maxBottomY = DEFAULT_SCENE_HEIGHT;

    laneThemeIds.forEach((themeId, laneIndex) => {
      const streamX = PARALLEL_FIRST_STREAM_X + laneIndex * PARALLEL_LANE_GAP;
      const themeNodes = getSortedNodes(nodesByTheme.get(themeId) || []);
      const groups = groupNodesByDate(themeNodes);
      let cursorY = 180;

      groups.forEach((group) => {
        const groupStartY = cursorY;
        const groupPlacements = placeGroupNodes(group, {
          streamX,
          groupStartY,
          readingBaseOffset: PARALLEL_READING_X_OFFSET,
          eventBaseOffset: PARALLEL_EVENT_X_OFFSET,
          laneSpread: 54,
          laneStagger: 18,
          verticalGap: 150,
        });

        groupPlacements.forEach((placement) => {
          placements.set(placement.node.id, placement);
        });

        const groupHeight = Math.max(150, (group.nodes.length - 1) * 150 + 132);
        const markerY = groupStartY + groupHeight / 2 - 8;
        dateMarkers.push({
          streamX,
          dateKey: group.dateKey,
          y: markerY,
        });

        cursorY += groupHeight + 120;
      });

      const bottomY = Math.max(cursorY + 100, DEFAULT_SCENE_HEIGHT - 70);
      streams.push({
        id: themeId,
        title: getThemeTitle(themeId),
        color: getThemeColor(themeId),
        x: streamX,
        topY: 70,
        bottomY,
      });
      maxBottomY = Math.max(maxBottomY, bottomY + 70);
    });

    return {
      placements,
      dateMarkers,
      streams,
      sceneWidth,
      sceneHeight: maxBottomY,
    };
  }

  function buildLayout(nodes) {
    return state.ui.viewMode === "parallel"
      ? buildParallelLayout(nodes)
      : buildSingleLayout(nodes);
  }

  function renderThemeSelects() {
    const options = ['<option value="all">全部主題</option>']
      .concat(
        state.themes.map((theme) => {
          return `<option value="${theme.id}">${escapeHtml(theme.title)}</option>`;
        })
      )
      .join("");

    refs.activeTheme.innerHTML = options;
    refs.activeTheme.value = getThemeById(state.ui.activeThemeId) ? state.ui.activeThemeId : "all";

    const nodeThemeOptions = state.themes
      .map((theme) => `<option value="${theme.id}">${escapeHtml(theme.title)}</option>`)
      .join("");

    refs.fieldTheme.innerHTML = nodeThemeOptions;
  }

  function renderCategoryFilterOptions() {
    const categories = new Set();
    getAllNodes().forEach((node) => {
      if (node.category) categories.add(node.category);
    });

    const options = ['<option value="all">全部主題分類</option>'];
    Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
      if (categories.has(value) || value === state.ui.filterCategory) {
        options.push(`<option value="${value}">${label}</option>`);
      }
    });

    refs.filterCategory.innerHTML = options.join("");
    refs.filterCategory.value = state.ui.filterCategory;
  }

  function renderRelatedReadingOptions(selectedValue, themeId) {
    const currentThemeId = themeId || "";
    const readings = state.readings.slice().sort((a, b) => {
      const aScore = a.themeId === currentThemeId ? 0 : 1;
      const bScore = b.themeId === currentThemeId ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
      return normalizeSortDate(a.date).localeCompare(normalizeSortDate(b.date));
    });

    const options = ['<option value="">未連結</option>'];
    readings.forEach((reading) => {
      const title = `${reading.title || "未命名占卜案例"}｜${getThemeTitle(reading.themeId)}`;
      options.push(`<option value="${reading.id}">${escapeHtml(title)}</option>`);
    });

    refs.fieldRelatedReading.innerHTML = options.join("");
    refs.fieldRelatedReading.value = selectedValue || "";
  }

  function renderStats(nodes) {
    refs.stats.innerHTML = [
      `<span class="map-stat-pill">主題流 ${state.themes.length}</span>`,
      `<span class="map-stat-pill">案例 ${state.readings.length}</span>`,
      `<span class="map-stat-pill">事件 ${state.events.length}</span>`,
      `<span class="map-stat-pill">檢視 ${state.ui.viewMode === "parallel" ? "平行時間流" : "單一時間流"}</span>`,
      `<span class="map-stat-pill">目前顯示 ${nodes.length}</span>`,
    ].join("");
  }

  function applySceneTransform() {
    refs.scene.style.transform = `translate(${state.ui.panX}px, ${state.ui.panY}px) scale(${state.ui.zoom})`;
    refs.zoomReset.textContent = `${Math.round(state.ui.zoom * 100)}%`;
  }

  function renderConnections(layout) {
    refs.connections.setAttribute("viewBox", `0 0 ${layout.sceneWidth} ${layout.sceneHeight}`);
    refs.connections.setAttribute("width", String(layout.sceneWidth));
    refs.connections.setAttribute("height", String(layout.sceneHeight));

    const fragments = [];

    layout.streams.forEach((stream) => {
      fragments.push(
        `<line class="map-stream-axis" x1="${stream.x}" y1="${stream.topY}" x2="${stream.x}" y2="${stream.bottomY}" style="stroke:${stream.color};" />`,
        `<ellipse class="map-stream-glow" cx="${stream.x}" cy="${(stream.topY + stream.bottomY) / 2}" rx="52" ry="${Math.max(260, (stream.bottomY - stream.topY) / 2 - 40)}" style="fill:${hexToRgba(stream.color, 0.08)};" />`,
        `<text class="map-stream-title" x="${stream.x}" y="42" text-anchor="middle">${escapeHtml(stream.title)}</text>`
      );
    });

    layout.dateMarkers.forEach((marker) => {
      fragments.push(
        `<line class="map-stream-tick" x1="${marker.streamX - 26}" y1="${marker.y}" x2="${marker.streamX + 26}" y2="${marker.y}" />`,
        `<circle class="map-stream-marker" cx="${marker.streamX}" cy="${marker.y}" r="10" />`,
        `<text class="map-stream-date-label" x="${marker.streamX}" y="${marker.y - 20}" text-anchor="middle">${escapeHtml(marker.dateKey)}</text>`
      );
    });

    // 節點 → 主軸：柔和曲線，不做過度上下繞線。
    // 時間複雜度：O(k)，k = 顯示節點數；空間複雜度：O(k)。
    // 更快替代方案比較：
    // - 暴力法：直接畫水平直線 O(k)，最快但同日多節點時容易重疊、視覺生硬。
    // - 本實作：每條線仍只算一次 O(k)，用同日/同側路由給極小弧度，保留可讀性。
    const branchRouteCount = new Map();

    Array.from(layout.placements.values()).forEach((placement) => {
      const node = placement.node;
      const startX =
        node.type === "reading"
          ? placement.x + placement.width - 4
          : placement.x + 4;
      const startY = placement.centerY;
      const endX = placement.streamX;
      const endY = placement.centerY;
      const direction = endX >= startX ? 1 : -1;
      const distance = Math.abs(endX - startX);
      const curveStrength = clamp(distance * 0.32, 58, 138);

      const routeKey = `${endX}|${node.date || "nodate"}|${node.type}`;
      const routeIndex = branchRouteCount.get(routeKey) || 0;
      branchRouteCount.set(routeKey, routeIndex + 1);

      // 同日多線只加非常小的側向張力，不改變時間高度，避免曲線看起來亂飛。
      const routeLevel = routeIndex === 0 ? 0 : Math.ceil(routeIndex / 2) * (routeIndex % 2 === 1 ? 1 : -1);
      const routeBend = routeLevel * 10;

      const c1x = startX + direction * curveStrength;
      const c1y = startY + routeBend;
      const c2x = endX - direction * curveStrength * 0.62;
      const c2y = endY + routeBend;

      fragments.push(
        `<path class="map-stream-branch ${node.type}" d="M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}" style="stroke:${hexToRgba(getThemeColor(node.themeId), node.type === "reading" ? 0.58 : 0.52)};" />`
      );
    });

    state.events.forEach((eventNode) => {
      if (!eventNode.relatedReadingId) return;
      const eventPlacement = layout.placements.get(eventNode.id);
      const readingPlacement = layout.placements.get(eventNode.relatedReadingId);
      if (!eventPlacement || !readingPlacement) return;

      const fromX = eventPlacement.x;
      const fromY = eventPlacement.centerY;
      const toX = readingPlacement.x + readingPlacement.width;
      const toY = readingPlacement.centerY;
      const midX = (fromX + toX) / 2;

      // 事件 ↔ 占卜案例：使用柔和弧線，避免太大圈導致畫面怪異。
      // 時間複雜度：O(1)；空間複雜度：O(1)。
      const sameRowBoost = Math.abs(fromY - toY) < 90 ? 54 : 38;
      const verticalArc = fromY <= toY ? -sameRowBoost : sameRowBoost;
      const c1x = fromX - Math.max(80, Math.abs(fromX - toX) * 0.22);
      const c2x = toX + Math.max(80, Math.abs(fromX - toX) * 0.22);
      const c1y = fromY + verticalArc;
      const c2y = toY + verticalArc;

      fragments.push(
        `<path class="map-link-line" d="M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}" style="stroke:${hexToRgba(getThemeColor(eventNode.themeId), 0.46)};" />`
      );
    });

    refs.connections.innerHTML = fragments.join("");
  }

  function renderMap(nodes) {
    currentLayout = buildLayout(nodes);
    refs.scene.style.width = `${currentLayout.sceneWidth}px`;
    refs.scene.style.height = `${currentLayout.sceneHeight}px`;

    const fragment = document.createDocumentFragment();

    nodes.forEach((node) => {
      const placement = currentLayout.placements.get(node.id);
      if (!placement) return;

      const el = document.createElement("article");
      el.className = `map-node ${node.type} status-${node.status}${state.ui.selectedId === node.id ? " is-selected" : ""}`;
      el.dataset.id = node.id;
      el.dataset.type = node.type;
      el.style.left = `${placement.x}px`;
      el.style.top = `${placement.y}px`;
      el.style.setProperty("--theme-color", getThemeColor(node.themeId));
      el.style.setProperty("--theme-color-soft", hexToRgba(getThemeColor(node.themeId), 0.16));

      const metaText =
        node.type === "reading"
          ? `${CATEGORY_LABELS[node.category] || CATEGORY_LABELS.other} · ${node.subject || "未填對象"}`
          : `${CATEGORY_LABELS[node.category] || CATEGORY_LABELS.other}${node.relatedReadingId ? " · 已連結案例" : " · 未連結案例"}`;

      const previewText =
        node.type === "reading"
          ? node.interpretation || node.cards || "尚未填入解讀"
          : node.description || node.note || "尚未填入事件描述";

      el.innerHTML = `
        <div class="map-node-header">
          <span class="map-node-type">${TYPE_LABELS[node.type]}</span>
          <span class="map-node-date-badge">${escapeHtml(node.date || "未填日期")}</span>
        </div>
        <h5>${escapeHtml(node.title || "未命名節點")}</h5>
        <p class="map-node-meta">${escapeHtml(metaText)}</p>
        <p class="map-node-preview">${escapeHtml(previewText).replace(/\n/g, "<br />")}</p>
        <div class="map-node-footer">
          <span class="map-node-status">${STATUS_LABELS[node.status] || STATUS_LABELS.pending}</span>
          <span class="map-theme-pill">${escapeHtml(getThemeTitle(node.themeId))}</span>
        </div>
      `;

      el.addEventListener("pointerdown", handleNodePointerDown);
      el.addEventListener("click", handleNodeClick);
      fragment.appendChild(el);
    });

    refs.canvas.innerHTML = "";
    refs.canvas.appendChild(fragment);
    renderConnections(currentLayout);
  }

  function renderTimeline(nodes) {
    const items = getSortedNodes(nodes);

    if (!items.length) {
      refs.timeline.innerHTML =
        '<p class="map-timeline-empty">目前還沒有符合篩選條件的案例或事件。</p>';
      return;
    }

    refs.timeline.innerHTML = items
      .map((node) => {
        const body =
          node.type === "reading"
            ? node.interpretation || node.cards || "尚未填入解讀"
            : node.description || node.note || "尚未填入事件描述";

        return `
          <article class="map-timeline-item ${node.type}">
            <div class="map-timeline-top">
              <span class="map-node-type">${TYPE_LABELS[node.type]}</span>
              <span class="map-timeline-date">${escapeHtml(node.date || "未填日期")}</span>
            </div>
            <h5>${escapeHtml(node.title || "未命名節點")}</h5>
            <p>${escapeHtml(body).replace(/\n/g, "<br />")}</p>
            <div class="map-timeline-footer">
              <span class="map-theme-pill">${escapeHtml(getThemeTitle(node.themeId))}</span>
              <span class="map-node-preview">${escapeHtml(STATUS_LABELS[node.status] || STATUS_LABELS.pending)}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderDetailPanel() {
    const node = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
    const readingOnlyFields = refs.root.querySelectorAll("[data-reading-only]");
    const eventOnlyFields = refs.root.querySelectorAll("[data-event-only]");

    if (!node) {
      refs.emptyState.classList.remove("hidden");
      refs.detailForm.classList.add("hidden");
      return;
    }

    refs.emptyState.classList.add("hidden");
    refs.detailForm.classList.remove("hidden");

    refs.detailTypeLabel.textContent = TYPE_LABELS[node.type];
    refs.detailTitle.textContent = node.title || "節點內容";
    refs.selectedId.textContent = node.id;
    refs.detailId.value = node.id;
    refs.fieldTitle.value = node.title || "";
    refs.fieldDate.value = node.date || "";
    refs.fieldCategory.value = node.category || "other";
    refs.fieldStatus.value = node.status || "pending";
    refs.fieldNote.value = node.note || "";
    refs.fieldTheme.value = node.themeId || state.themes[0]?.id || "";

    const theme = getThemeById(node.themeId);
    refs.detailThemeHint.textContent = theme
      ? `${theme.title}${theme.description ? "｜" + theme.description : ""}`
      : "請先建立主題流";

    const isReading = node.type === "reading";
    readingOnlyFields.forEach((field) => field.classList.toggle("hidden", !isReading));
    eventOnlyFields.forEach((field) => field.classList.toggle("hidden", isReading));

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

  function renderAll() {
    renderThemeSelects();
    renderCategoryFilterOptions();
    refs.filterStatus.value = state.ui.filterStatus;
    refs.search.value = state.ui.search;
    refs.viewMode.value = state.ui.viewMode;
    refs.activeTheme.value = getThemeById(state.ui.activeThemeId) ? state.ui.activeThemeId : "all";

    const visibleNodes = getVisibleNodes();
    renderStats(visibleNodes);
    applySceneTransform();
    renderMap(visibleNodes);
    renderDetailPanel();
    renderTimeline(visibleNodes);
    updateAdminControls();
  }

  function isAdminUnlocked() {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
  }

  function setAdminUnlocked(value) {
    if (value) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    } else {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    }
    updateAdminControls();
  }

  function ensureAdminModal() {
    let modal = document.getElementById("map-admin-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "map-admin-modal";
    modal.className = "map-modal-backdrop hidden";
    modal.innerHTML = `
      <div class="map-modal" role="dialog" aria-modal="true" aria-labelledby="map-admin-modal-title">
        <div class="map-modal-orb" aria-hidden="true"></div>
        <div class="map-modal-header">
          <p class="map-form-kicker">Admin Gate</p>
          <h3 id="map-admin-modal-title">管理員驗證</h3>
          <p>此頁目前只開放瀏覽；新增、刪除與儲存需要管理員權限。</p>
        </div>
        <form id="map-admin-form" class="map-modal-form">
          <label>
            管理員密碼
            <input id="map-admin-passcode" type="password" autocomplete="current-password" placeholder="請輸入管理員密碼" />
          </label>
          <p id="map-admin-message" class="map-modal-message hidden" aria-live="polite"></p>
          <div class="map-modal-actions">
            <button type="button" id="map-admin-cancel" class="btn ghost">取消</button>
            <button type="submit" class="btn primary">解除鎖定</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  function openAdminModal() {
    return new Promise((resolve) => {
      const modal = ensureAdminModal();
      const form = modal.querySelector("#map-admin-form");
      const input = modal.querySelector("#map-admin-passcode");
      const cancel = modal.querySelector("#map-admin-cancel");
      const message = modal.querySelector("#map-admin-message");

      function cleanup(result) {
        form.removeEventListener("submit", handleSubmit);
        cancel.removeEventListener("click", handleCancel);
        modal.removeEventListener("click", handleBackdropClick);
        window.removeEventListener("keydown", handleKeydown);
        modal.classList.add("hidden");
        resolve(result);
      }

      function showError(text) {
        message.textContent = text;
        message.classList.remove("hidden");
        message.classList.add("is-error");
      }

      function handleSubmit(event) {
        event.preventDefault();
        const passcode = input.value.trim();
        if (passcode !== ADMIN_PASSCODE) {
          showError("密碼不正確，未開放修改。");
          input.select();
          return;
        }

        setAdminUnlocked(true);
        cleanup(true);
      }

      function handleCancel() {
        cleanup(false);
      }

      function handleBackdropClick(event) {
        if (event.target === modal) cleanup(false);
      }

      function handleKeydown(event) {
        if (event.key === "Escape") cleanup(false);
      }

      input.value = "";
      message.textContent = "";
      message.classList.add("hidden");
      message.classList.remove("is-error");
      modal.classList.remove("hidden");

      form.addEventListener("submit", handleSubmit);
      cancel.addEventListener("click", handleCancel);
      modal.addEventListener("click", handleBackdropClick);
      window.addEventListener("keydown", handleKeydown);

      setTimeout(() => input.focus(), 0);
    });
  }

  async function requireAdmin() {
    if (isAdminUnlocked()) return true;
    return openAdminModal();
  }

  function injectAdminControl() {
    if (!refs.addTheme || document.getElementById("map-admin-toggle")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "map-admin-toggle";
    button.className = "btn ghost map-admin-toggle";
    button.addEventListener("click", async () => {
      if (isAdminUnlocked()) {
        setAdminUnlocked(false);
        return;
      }
      await openAdminModal();
    });

    refs.addTheme.parentElement?.prepend(button);
    refs.adminToggle = button;
  }

  function updateAdminControls() {
    const unlocked = isAdminUnlocked();
    const editButtons = [refs.addTheme, refs.addReading, refs.addEvent, refs.deleteNode, refs.resetData].filter(Boolean);

    editButtons.forEach((button) => {
      button.classList.toggle("is-locked", !unlocked);
      button.title = unlocked ? "" : "目前僅管理員可修改";
    });

    if (refs.detailForm) {
      refs.detailForm.classList.toggle("is-admin-locked", !unlocked);
    }

    if (refs.adminToggle) {
      refs.adminToggle.textContent = unlocked ? "管理員已解鎖｜登出" : "管理員登入";
      refs.adminToggle.classList.toggle("is-unlocked", unlocked);
    }
  }

  async function addTheme() {
    if (!(await requireAdmin())) return;

    const title = await openTextModal({
      title: "新增主題流",
      description: "請輸入主題流名稱，例如：A 關係驗證、轉職驗證。",
      label: "主題流名稱",
      placeholder: "例如：A 關係驗證",
      required: true,
    });
    if (!title) return;

    const description = await openTextModal({
      title: "主題說明",
      description: "可補一句這條主題流要追蹤的範圍；也可以留空。",
      label: "主題說明",
      placeholder: "例如：觀察互動是否從冷淡轉為主動",
      required: false,
    });

    const theme = createThemeObject(title.trim(), (description || "").trim(), state.themes.length);
    state.themes.push(theme);
    state.ui.activeThemeId = theme.id;
    saveState();
    renderAll();
  }

  function ensureTextModal() {
    let modal = document.getElementById("map-text-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "map-text-modal";
    modal.className = "map-modal-backdrop hidden";
    modal.innerHTML = `
      <div class="map-modal" role="dialog" aria-modal="true" aria-labelledby="map-text-modal-title">
        <div class="map-modal-orb" aria-hidden="true"></div>
        <div class="map-modal-header">
          <p class="map-form-kicker">Timeflow Editor</p>
          <h3 id="map-text-modal-title"></h3>
          <p id="map-text-modal-description"></p>
        </div>
        <form id="map-text-form" class="map-modal-form">
          <label>
            <span id="map-text-label"></span>
            <input id="map-text-input" type="text" autocomplete="off" />
          </label>
          <p id="map-text-message" class="map-modal-message hidden" aria-live="polite"></p>
          <div class="map-modal-actions">
            <button type="button" id="map-text-cancel" class="btn ghost">取消</button>
            <button type="submit" class="btn primary">確認</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  function openTextModal(options) {
    return new Promise((resolve) => {
      const modal = ensureTextModal();
      const title = modal.querySelector("#map-text-modal-title");
      const description = modal.querySelector("#map-text-modal-description");
      const label = modal.querySelector("#map-text-label");
      const form = modal.querySelector("#map-text-form");
      const input = modal.querySelector("#map-text-input");
      const cancel = modal.querySelector("#map-text-cancel");
      const message = modal.querySelector("#map-text-message");

      function cleanup(result) {
        form.removeEventListener("submit", handleSubmit);
        cancel.removeEventListener("click", handleCancel);
        modal.removeEventListener("click", handleBackdropClick);
        window.removeEventListener("keydown", handleKeydown);
        modal.classList.add("hidden");
        resolve(result);
      }

      function handleSubmit(event) {
        event.preventDefault();
        const value = input.value.trim();
        if (options.required && !value) {
          message.textContent = "此欄位必填。";
          message.classList.remove("hidden");
          message.classList.add("is-error");
          input.focus();
          return;
        }
        cleanup(value);
      }

      function handleCancel() {
        cleanup(null);
      }

      function handleBackdropClick(event) {
        if (event.target === modal) cleanup(null);
      }

      function handleKeydown(event) {
        if (event.key === "Escape") cleanup(null);
      }

      title.textContent = options.title || "輸入內容";
      description.textContent = options.description || "";
      label.textContent = options.label || "內容";
      input.placeholder = options.placeholder || "";
      input.value = options.defaultValue || "";
      message.textContent = "";
      message.classList.add("hidden");
      message.classList.remove("is-error");
      modal.classList.remove("hidden");

      form.addEventListener("submit", handleSubmit);
      cancel.addEventListener("click", handleCancel);
      modal.addEventListener("click", handleBackdropClick);
      window.addEventListener("keydown", handleKeydown);

      setTimeout(() => input.focus(), 0);
    });
  }

  async function addReading() {
    if (!(await requireAdmin())) return;
    const node = createReadingNode(getDefaultCreateThemeId());
    state.readings.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll();
  }

  async function addEvent() {
    if (!(await requireAdmin())) return;
    const selectedNode = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
    const relatedReadingId =
      selectedNode?.type === "reading"
        ? selectedNode.id
        : selectedNode?.type === "event"
        ? selectedNode.relatedReadingId || ""
        : "";

    const relatedReading = relatedReadingId ? getNodeById(relatedReadingId) : null;
    const themeId = relatedReading?.themeId || getDefaultCreateThemeId();

    const node = createEventNode(themeId, relatedReadingId);
    state.events.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll();
  }

  function syncReadingEventsTheme(readingId, themeId) {
    state.events = state.events.map((eventNode) => {
      if (eventNode.relatedReadingId !== readingId) return eventNode;
      return {
        ...eventNode,
        themeId,
        updatedAt: getNowIso(),
      };
    });
  }

  async function saveDetailForm(event) {
    event.preventDefault();
    if (!(await requireAdmin())) return;
    const nodeId = refs.detailId.value;
    const currentNode = getNodeById(nodeId);
    if (!currentNode) return;

    updateNodeById(nodeId, (node) => {
      const base = {
        ...node,
        title: refs.fieldTitle.value.trim(),
        date: refs.fieldDate.value,
        category: refs.fieldCategory.value,
        status: refs.fieldStatus.value,
        note: refs.fieldNote.value.trim(),
        themeId: refs.fieldTheme.value || node.themeId,
        updatedAt: getNowIso(),
      };

      if (node.type === "reading") {
        return {
          ...base,
          subject: refs.fieldSubject.value.trim(),
          cards: refs.fieldCards.value.trim(),
          interpretation: refs.fieldInterpretation.value.trim(),
          predictions: refs.fieldPredictions.value.trim(),
        };
      }

      const relatedReadingId = refs.fieldRelatedReading.value;
      const relatedReading = relatedReadingId ? getNodeById(relatedReadingId) : null;

      return {
        ...base,
        description: refs.fieldEventDescription.value.trim(),
        relatedReadingId,
        themeId: relatedReading?.themeId || base.themeId,
        category: relatedReading?.category || base.category,
      };
    });

    const updatedNode = getNodeById(nodeId);
    if (updatedNode?.type === "reading") {
      syncReadingEventsTheme(nodeId, updatedNode.themeId);
    }

    saveState();
    renderAll();
  }

  function handleNodeClick(event) {
    const nodeId = event.currentTarget.dataset.id;
    state.ui.selectedId = nodeId;
    renderAll();
  }

  function screenToScene(clientX, clientY) {
    const rect = refs.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.ui.panX) / state.ui.zoom,
      y: (clientY - rect.top - state.ui.panY) / state.ui.zoom,
    };
  }

  function handleNodePointerDown(event) {
    event.stopPropagation();
    const nodeId = event.currentTarget.dataset.id;
    const placement = currentLayout.placements.get(nodeId);
    if (!placement) return;

    state.ui.selectedId = nodeId;
    const point = screenToScene(event.clientX, event.clientY);

    dragState = {
      nodeId,
      pointerOffsetX: point.x - placement.x,
      pointerOffsetY: point.y - placement.y,
      baseX: placement.baseX,
      baseY: placement.baseY,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", handleNodePointerMove);
    window.addEventListener("pointerup", handleNodePointerUp, { once: true });

    renderAll();
  }

  function handleNodePointerMove(event) {
    if (!dragState) return;
    const point = screenToScene(event.clientX, event.clientY);

    updateNodeById(dragState.nodeId, (node) => ({
      ...node,
      position: {
        // X/Y 都是視覺偏移，只用來讓窗格更好檢閱，不改日期。
        // 時間複雜度：O(1)；空間複雜度：O(1)。
        x: clamp(point.x - dragState.pointerOffsetX - dragState.baseX, -260, 260),
        y: clamp(point.y - dragState.pointerOffsetY - dragState.baseY, -220, 220),
      },
      updatedAt: getNowIso(),
    }));

    renderMap(getVisibleNodes());
    renderDetailPanel();
  }

  function handleNodePointerUp() {
    // 純視覺拖曳：只保存 position.x / position.y，不改 date。
    // 時間複雜度：O(1)；空間複雜度：O(1)。
    window.removeEventListener("pointermove", handleNodePointerMove);
    dragState = null;
    saveState();
    renderAll();
  }

  function handleViewportPointerDown(event) {
    if (event.target.closest(".map-node")) return;

    panState = {
      startX: event.clientX,
      startY: event.clientY,
      originPanX: state.ui.panX,
      originPanY: state.ui.panY,
    };

    refs.viewport.classList.add("is-panning");
    window.addEventListener("pointermove", handleViewportPointerMove);
    window.addEventListener("pointerup", handleViewportPointerUp, { once: true });
  }

  function handleViewportPointerMove(event) {
    if (!panState) return;
    state.ui.panX = panState.originPanX + (event.clientX - panState.startX);
    state.ui.panY = panState.originPanY + (event.clientY - panState.startY);
    applySceneTransform();
    renderStats(getVisibleNodes());
  }

  function handleViewportPointerUp() {
    refs.viewport.classList.remove("is-panning");
    window.removeEventListener("pointermove", handleViewportPointerMove);
    panState = null;
    saveState();
  }

  function handleViewportWheel(event) {
    event.preventDefault();

    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    const nextZoom = clamp(Number((state.ui.zoom + delta).toFixed(2)), 0.45, 1.8);
    if (nextZoom === state.ui.zoom) return;

    const rect = refs.viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const worldX = (pointerX - state.ui.panX) / state.ui.zoom;
    const worldY = (pointerY - state.ui.panY) / state.ui.zoom;

    state.ui.zoom = nextZoom;
    state.ui.panX = pointerX - worldX * nextZoom;
    state.ui.panY = pointerY - worldY * nextZoom;

    saveState();
    renderAll();
  }

  async function resetData() {
    if (!(await requireAdmin())) return;
    const confirmed = await window.EvanDialog.confirm("要清空占卜時間流的所有本機資料嗎？此動作無法復原。", "清空資料");
    if (!confirmed) return;

    state = createInitialState();
    saveState();
    renderAll();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `evan-tarot-timeflow-${getTodayTaipeiDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function adjustZoom(delta) {
    state.ui.zoom = clamp(Number((state.ui.zoom + delta).toFixed(2)), 0.45, 1.8);
    saveState();
    renderAll();
  }

  function resetView() {
    state.ui.zoom = 0.88;
    state.ui.panX = -120;
    state.ui.panY = 0;
    saveState();
    renderAll();
  }

  function bindEvents() {
    refs.addTheme.addEventListener("click", addTheme);
    refs.addReading.addEventListener("click", addReading);
    refs.addEvent.addEventListener("click", addEvent);
    refs.detailForm.addEventListener("submit", saveDetailForm);

    refs.deleteNode.addEventListener("click", async () => {
      if (!(await requireAdmin())) return;
      const nodeId = refs.detailId.value;
      if (!nodeId) return;
      const confirmed = await window.EvanDialog.confirm("確定要刪除此節點嗎？刪除後無法直接復原。", "刪除節點");
      if (!confirmed) return;
      deleteNodeById(nodeId);
      saveState();
      renderAll();
    });

    refs.filterStatus.addEventListener("change", (event) => {
      state.ui.filterStatus = event.target.value;
      saveState();
      renderAll();
    });

    refs.filterCategory.addEventListener("change", (event) => {
      state.ui.filterCategory = event.target.value;
      saveState();
      renderAll();
    });

    refs.search.addEventListener("input", (event) => {
      state.ui.search = event.target.value;
      saveState();
      renderAll();
    });

    refs.viewMode.addEventListener("change", (event) => {
      state.ui.viewMode = event.target.value;
      saveState();
      renderAll();
    });

    refs.activeTheme.addEventListener("change", (event) => {
      state.ui.activeThemeId = event.target.value;
      saveState();
      renderAll();
    });

    refs.fieldTheme.addEventListener("change", (event) => {
      const theme = getThemeById(event.target.value);
      refs.detailThemeHint.textContent = theme
        ? `${theme.title}${theme.description ? "｜" + theme.description : ""}`
        : "請先建立主題流";

      const currentNode = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
      if (currentNode?.type === "event") {
        renderRelatedReadingOptions(refs.fieldRelatedReading.value, event.target.value);
      }
    });

    refs.zoomIn.addEventListener("click", () => adjustZoom(0.1));
    refs.zoomOut.addEventListener("click", () => adjustZoom(-0.1));
    refs.zoomReset.addEventListener("click", resetView);
    refs.exportJson.addEventListener("click", exportJson);
    refs.resetData.addEventListener("click", resetData);

    refs.viewport.addEventListener("pointerdown", handleViewportPointerDown);
    refs.viewport.addEventListener("wheel", handleViewportWheel, { passive: false });
  }

  function cacheRefs(root) {
    refs = {
      root,
      addTheme: root.querySelector("#map-add-theme"),
      adminToggle: root.querySelector("#map-admin-toggle"),
      addReading: root.querySelector("#map-add-reading"),
      addEvent: root.querySelector("#map-add-event"),
      filterStatus: root.querySelector("#map-filter-status"),
      filterCategory: root.querySelector("#map-filter-category"),
      search: root.querySelector("#map-search"),
      activeTheme: root.querySelector("#map-active-theme"),
      viewMode: root.querySelector("#map-view-mode"),
      stats: root.querySelector("#map-stats"),
      viewport: root.querySelector("#map-viewport"),
      scene: root.querySelector("#map-scene"),
      connections: root.querySelector("#map-connections"),
      canvas: root.querySelector("#map-canvas"),
      zoomIn: root.querySelector("#map-zoom-in"),
      zoomOut: root.querySelector("#map-zoom-out"),
      zoomReset: root.querySelector("#map-zoom-reset"),
      exportJson: root.querySelector("#map-export-json"),
      resetData: root.querySelector("#map-reset-data"),
      emptyState: root.querySelector("#map-empty-state"),
      detailForm: root.querySelector("#map-detail-form"),
      detailTypeLabel: root.querySelector("#map-detail-type-label"),
      detailTitle: root.querySelector("#map-detail-title"),
      selectedId: root.querySelector("#map-selected-id"),
      detailId: root.querySelector("#map-detail-id"),
      fieldTheme: root.querySelector("#map-field-theme"),
      detailThemeHint: root.querySelector("#map-detail-theme-hint"),
      fieldTitle: root.querySelector("#map-field-title"),
      fieldDate: root.querySelector("#map-field-date"),
      fieldCategory: root.querySelector("#map-field-category"),
      fieldSubject: root.querySelector("#map-field-subject"),
      fieldCards: root.querySelector("#map-field-cards"),
      fieldInterpretation: root.querySelector("#map-field-interpretation"),
      fieldPredictions: root.querySelector("#map-field-predictions"),
      fieldEventDescription: root.querySelector("#map-field-event-description"),
      fieldRelatedReading: root.querySelector("#map-field-related-reading"),
      fieldStatus: root.querySelector("#map-field-status"),
      fieldNote: root.querySelector("#map-field-note"),
      deleteNode: root.querySelector("#map-delete-node"),
      timeline: root.querySelector("#map-timeline"),
    };
  }

  window.initDivinationMap = function initDivinationMap() {
    const root = document.getElementById("divination-map-app");
    if (!root || root.dataset.initialized === "true") return;

    root.dataset.initialized = "true";
    cacheRefs(root);
    state = loadState();

    injectAdminControl();
    bindEvents();
    updateAdminControls();
    renderAll();
  };

  function hexToRgba(hex, alpha) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return `rgba(183, 148, 255, ${alpha})`;
    const bigint = Number.parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(input) {
    if (input == null) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
