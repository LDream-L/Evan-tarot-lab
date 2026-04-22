// ==============================
// divination-map.js
// 占卜時間流 Beta
// ==============================
//
// 核心設計：
// 1. 主視覺改為「時間流」，節點依日期自動往下排列。
// 2. reading / event 共用同一份 state，側欄與下方時間軸同步更新。
// 3. position 不再是絕對座標，而是相對於時間流基準點的「微調偏移」。
//
// 關鍵函式複雜度：
// - initDivinationMap：O(n + m) / O(n + m)
// - buildTimeflowLayout：O(k log k) / O(k)
// - renderMap：O(k log k) / O(k)
// - updateNodeById：O(n) 或 O(m) / O(1)
//
// 更快的替代方案比較：
// - 暴力法：保留自由畫布，再額外疊一條 timeline，使用者要自己對齊時間與關聯。
// - 本版優化：直接以日期驅動版面，時間順序天然成立；節點僅保留小幅拖曳偏移，
//   既有時間流感，也不會失去手動調整彈性。
// ==============================

(function initDivinationMapModule() {
  const STORAGE_KEY = "evanTarotDivinationTimeflowV2";
  const SCENE_WIDTH = 1680;
  const DEFAULT_SCENE_HEIGHT = 1500;
  const STREAM_X = 840;
  const NODE_SIZES = {
    reading: { width: 272, height: 154 },
    event: { width: 248, height: 136 },
  };

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
  let currentLayoutMap = new Map();

  function createInitialState() {
    return {
      version: 2,
      readings: [],
      events: [],
      ui: {
        zoom: 0.84,
        panX: -110,
        panY: 0,
        selectedId: null,
        filterStatus: "all",
        filterCategory: "all",
        search: "",
      },
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

  function migrateNodeForTimeflow(node, type) {
    return {
      ...node,
      type: node.type || type,
      position: {
        x: 0,
        y: 0,
      },
      updatedAt: node.updatedAt || getNowIso(),
      createdAt: node.createdAt || getNowIso(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const initial = createInitialState();
        return {
          ...initial,
          ...parsed,
          version: 2,
          readings: Array.isArray(parsed.readings) ? parsed.readings : [],
          events: Array.isArray(parsed.events) ? parsed.events : [],
          ui: {
            ...initial.ui,
            ...(parsed.ui || {}),
          },
        };
      }

      const legacyRaw = localStorage.getItem("evanTarotDivinationMapV1");
      if (!legacyRaw) return createInitialState();

      const legacyParsed = JSON.parse(legacyRaw);
      const initial = createInitialState();
      return {
        ...initial,
        readings: Array.isArray(legacyParsed.readings)
          ? legacyParsed.readings.map((node) => migrateNodeForTimeflow(node, "reading"))
          : [],
        events: Array.isArray(legacyParsed.events)
          ? legacyParsed.events.map((node) => migrateNodeForTimeflow(node, "event"))
          : [],
        ui: {
          ...initial.ui,
          ...(legacyParsed.ui || {}),
          zoom: initial.ui.zoom,
          panX: initial.ui.panX,
          panY: initial.ui.panY,
        },
      };
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

  function createReadingNode() {
    return {
      id: createNodeId("reading"),
      type: "reading",
      title: `新占卜案例 ${state.readings.length + 1}`,
      category: "relationship",
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

  function createEventNode(relatedReadingId) {
    const anchorReading = relatedReadingId
      ? state.readings.find((reading) => reading.id === relatedReadingId)
      : null;

    return {
      id: createNodeId("event"),
      type: "event",
      title: `新事件 ${state.events.length + 1}`,
      category: anchorReading?.category || "other",
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

  function getFilteredNodes() {
    const keyword = state.ui.search.trim().toLowerCase();

    return getAllNodes().filter((node) => {
      const statusMatch =
        state.ui.filterStatus === "all" || node.status === state.ui.filterStatus;
      const categoryMatch =
        state.ui.filterCategory === "all" || node.category === state.ui.filterCategory;

      if (!statusMatch || !categoryMatch) return false;
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }

  function buildTimeflowLayout(nodes) {
    const sortedNodes = getSortedNodes(nodes);
    const groups = [];
    let currentGroup = null;

    sortedNodes.forEach((node) => {
      const dateKey = node.date || "未填日期";
      if (!currentGroup || currentGroup.dateKey !== dateKey) {
        currentGroup = { dateKey, nodes: [] };
        groups.push(currentGroup);
      }
      currentGroup.nodes.push(node);
    });

    const placements = new Map();
    const dateMarkers = [];
    let cursorY = 140;

    groups.forEach((group) => {
      let readingLaneCount = 0;
      let eventLaneCount = 0;
      const groupStartY = cursorY;

      group.nodes.forEach((node, index) => {
        const size = NODE_SIZES[node.type];
        const laneCount = node.type === "reading" ? readingLaneCount++ : eventLaneCount++;
        const outerShift = Math.floor(laneCount / 2) * 72;
        const innerShift = laneCount % 2 === 1 ? 30 : 0;
        const baseX =
          node.type === "reading"
            ? STREAM_X - 420 - outerShift - innerShift
            : STREAM_X + 120 + outerShift + innerShift;
        const baseY = groupStartY + index * 156;
        const offsetX = clamp(Number(node.position?.x || 0), -190, 190);
        const offsetY = clamp(Number(node.position?.y || 0), -90, 90);
        const x = baseX + offsetX;
        const y = baseY + offsetY;

        placements.set(node.id, {
          node,
          width: size.width,
          height: size.height,
          x,
          y,
          baseX,
          baseY,
          centerX: x + size.width / 2,
          centerY: y + size.height / 2,
        });
      });

      const groupHeight = Math.max(150, (group.nodes.length - 1) * 156 + 138);
      const markerY = groupStartY + groupHeight / 2 - 8;
      dateMarkers.push({
        dateKey: group.dateKey,
        y: markerY,
        topY: groupStartY - 34,
        bottomY: groupStartY + groupHeight - 8,
      });
      cursorY += groupHeight + 120;
    });

    return {
      placements,
      dateMarkers,
      sceneHeight: Math.max(cursorY + 120, DEFAULT_SCENE_HEIGHT),
    };
  }

  function renderCategoryFilterOptions() {
    const categories = new Set();
    getAllNodes().forEach((node) => {
      if (node.category) categories.add(node.category);
    });

    const options = ['<option value="all">全部主題</option>'];
    Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
      if (categories.has(value) || value === state.ui.filterCategory) {
        options.push(`<option value="${value}">${label}</option>`);
      }
    });

    refs.filterCategory.innerHTML = options.join("");
    refs.filterCategory.value = state.ui.filterCategory;
  }

  function renderRelatedReadingOptions(selectedValue) {
    const options = ['<option value="">未連結</option>'];

    state.readings.forEach((reading) => {
      options.push(
        `<option value="${reading.id}">${escapeHtml(reading.title || "未命名占卜案例")}</option>`
      );
    });

    refs.fieldRelatedReading.innerHTML = options.join("");
    refs.fieldRelatedReading.value = selectedValue || "";
  }

  function renderStats() {
    const filteredCount = getFilteredNodes().length;
    refs.stats.innerHTML = [
      `<span class="map-stat-pill">案例 ${state.readings.length}</span>`,
      `<span class="map-stat-pill">事件 ${state.events.length}</span>`,
      `<span class="map-stat-pill">時間流縮放 ${Math.round(state.ui.zoom * 100)}%</span>`,
      `<span class="map-stat-pill">目前顯示 ${filteredCount}</span>`,
    ].join("");
  }

  function applySceneTransform() {
    refs.scene.style.transform = `translate(${state.ui.panX}px, ${state.ui.panY}px) scale(${state.ui.zoom})`;
    refs.zoomReset.textContent = `${Math.round(state.ui.zoom * 100)}%`;
  }

  function renderConnections(layout) {
    refs.connections.setAttribute("viewBox", `0 0 ${SCENE_WIDTH} ${layout.sceneHeight}`);
    refs.connections.setAttribute("width", String(SCENE_WIDTH));
    refs.connections.setAttribute("height", String(layout.sceneHeight));

    const fragments = [
      `<line class="map-stream-axis" x1="${STREAM_X}" y1="70" x2="${STREAM_X}" y2="${layout.sceneHeight - 70}" />`,
      `<ellipse class="map-stream-glow" cx="${STREAM_X}" cy="${layout.sceneHeight / 2}" rx="52" ry="${Math.max(260, layout.sceneHeight / 2 - 80)}" />`,
    ];

    layout.dateMarkers.forEach((marker) => {
      fragments.push(
        `<line class="map-stream-tick" x1="${STREAM_X - 26}" y1="${marker.y}" x2="${STREAM_X + 26}" y2="${marker.y}" />`,
        `<circle class="map-stream-marker" cx="${STREAM_X}" cy="${marker.y}" r="10" />`,
        `<text class="map-stream-date-label" x="${STREAM_X}" y="${marker.y - 20}" text-anchor="middle">${escapeHtml(marker.dateKey)}</text>`
      );
    });

    layout.placements.forEach((placement) => {
      const laneEdgeX = placement.node.type === "reading" ? placement.x + placement.width : placement.x;
      const streamEdgeX = placement.node.type === "reading" ? STREAM_X - 28 : STREAM_X + 28;
      fragments.push(
        `<line class="map-stream-branch ${placement.node.type}" x1="${laneEdgeX}" y1="${placement.centerY}" x2="${streamEdgeX}" y2="${placement.centerY}" />`
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
      const ctrlOffset = Math.max(110, Math.abs(fromY - toY) * 0.24);

      fragments.push(
        `<path class="map-link-line" d="M ${fromX} ${fromY} C ${STREAM_X + ctrlOffset} ${fromY}, ${STREAM_X - ctrlOffset} ${toY}, ${toX} ${toY}" />`
      );
    });

    refs.connections.innerHTML = fragments.join("");
  }

  function renderMap() {
    const filteredNodes = getFilteredNodes();
    const layout = buildTimeflowLayout(filteredNodes);
    currentLayoutMap = layout.placements;
    refs.scene.style.height = `${layout.sceneHeight}px`;

    const fragment = document.createDocumentFragment();

    filteredNodes.forEach((node) => {
      const placement = layout.placements.get(node.id);
      if (!placement) return;

      const el = document.createElement("article");
      el.className = `map-node ${node.type} status-${node.status}${state.ui.selectedId === node.id ? " is-selected" : ""}`;
      el.dataset.id = node.id;
      el.dataset.type = node.type;
      el.style.left = `${placement.x}px`;
      el.style.top = `${placement.y}px`;

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
          <span class="map-node-flow-tag">時間流節點</span>
        </div>
      `;

      el.addEventListener("pointerdown", handleNodePointerDown);
      el.addEventListener("click", handleNodeClick);
      fragment.appendChild(el);
    });

    refs.canvas.innerHTML = "";
    refs.canvas.appendChild(fragment);
    renderConnections(layout);
  }

  function renderTimeline() {
    const items = getSortedNodes(getFilteredNodes());

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
            <p class="map-node-preview">${escapeHtml(STATUS_LABELS[node.status] || STATUS_LABELS.pending)}</p>
          </article>
        `;
      })
      .join("");
  }

  function renderDetailPanel() {
    const node = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
    const readingOnlyFields = document.querySelectorAll("[data-reading-only]");
    const eventOnlyFields = document.querySelectorAll("[data-event-only]");

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

    const isReading = node.type === "reading";
    readingOnlyFields.forEach((field) => field.classList.toggle("hidden", !isReading));
    eventOnlyFields.forEach((field) => field.classList.toggle("hidden", isReading));

    if (isReading) {
      refs.fieldSubject.value = node.subject || "";
      refs.fieldCards.value = node.cards || "";
      refs.fieldInterpretation.value = node.interpretation || "";
      refs.fieldPredictions.value = node.predictions || "";
    } else {
      renderRelatedReadingOptions(node.relatedReadingId || "");
      refs.fieldEventDescription.value = node.description || "";
    }
  }

  function renderAll() {
    renderCategoryFilterOptions();
    renderStats();
    applySceneTransform();
    renderMap();
    renderDetailPanel();
    renderTimeline();
  }

  function addReading() {
    const node = createReadingNode();
    state.readings.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll();
  }

  function addEvent() {
    const selectedNode = state.ui.selectedId ? getNodeById(state.ui.selectedId) : null;
    const relatedReadingId =
      selectedNode?.type === "reading"
        ? selectedNode.id
        : selectedNode?.type === "event"
        ? selectedNode.relatedReadingId || ""
        : "";

    const node = createEventNode(relatedReadingId);
    state.events.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll();
  }

  function saveDetailForm(event) {
    event.preventDefault();
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

      return {
        ...base,
        description: refs.fieldEventDescription.value.trim(),
        relatedReadingId: refs.fieldRelatedReading.value,
      };
    });

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
    const placement = currentLayoutMap.get(nodeId);
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
        x: clamp(point.x - dragState.pointerOffsetX - dragState.baseX, -190, 190),
        y: clamp(point.y - dragState.pointerOffsetY - dragState.baseY, -90, 90),
      },
      updatedAt: getNowIso(),
    }));

    renderMap();
    renderDetailPanel();
  }

  function handleNodePointerUp() {
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
    renderStats();
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

  function resetData() {
    const confirmed = window.confirm("要清空占卜時間流的所有本機資料嗎？此動作無法復原。");
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
    state.ui.zoom = 0.84;
    state.ui.panX = -110;
    state.ui.panY = 0;
    saveState();
    renderAll();
  }

  function bindEvents() {
    refs.addReading.addEventListener("click", addReading);
    refs.addEvent.addEventListener("click", addEvent);
    refs.detailForm.addEventListener("submit", saveDetailForm);
    refs.deleteNode.addEventListener("click", () => {
      const nodeId = refs.detailId.value;
      if (!nodeId) return;
      const confirmed = window.confirm("確定要刪除此節點嗎？");
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
      addReading: root.querySelector("#map-add-reading"),
      addEvent: root.querySelector("#map-add-event"),
      filterStatus: root.querySelector("#map-filter-status"),
      filterCategory: root.querySelector("#map-filter-category"),
      search: root.querySelector("#map-search"),
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
    if (!root) return;

    cacheRefs(root);
    state = loadState();

    refs.filterStatus.value = state.ui.filterStatus;
    refs.search.value = state.ui.search;

    bindEvents();
    renderAll();
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(input) {
    if (input == null) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
