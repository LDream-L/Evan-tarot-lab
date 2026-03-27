// ==============================
// divination-map.js
// 占卜驗證圖譜 Beta
// ==============================
//
// 核心設計：
// 1. 一份 state 同時驅動畫布、側邊欄、時間軸。
// 2. reading / event 使用同一個節點渲染流程，減少重複邏輯。
// 3. 連線改為「事件 -> 占卜案例」單一關聯，先把資料流跑順，再往多重關聯擴充。
//
// 關鍵函式複雜度：
// - initDivinationMap：O(n + m) / O(n + m)
// - renderMap：O(n + m) / O(n)
// - renderTimeline：O(k log k) / O(k)
// - updateNodeById：O(n) / O(1)
//
// 更快的替代方案比較：
// - 暴力法：每次拖曳都整張圖 كامل 重建與重新排序。
// - 本版優化：拖曳時只更新單一節點位置與連線；完整重繪留在狀態真正變更後執行。
// ==============================

(function initDivinationMapModule() {
  const STORAGE_KEY = "evanTarotDivinationMapV1";
  const SCENE_WIDTH = 2400;
  const SCENE_HEIGHT = 1600;
  const NODE_SIZES = {
    reading: { width: 230, height: 128 },
    event: { width: 208, height: 108 },
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
    event: "事件節點",
  };

  let state = null;
  let refs = {};
  let dragState = null;
  let panState = null;

  /**
   * 建立預設 state。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function createInitialState() {
    return {
      version: 1,
      readings: [],
      events: [],
      ui: {
        zoom: 0.72,
        panX: -420,
        panY: -260,
        selectedId: null,
        filterStatus: "all",
        filterCategory: "all",
        search: "",
      },
    };
  }

  /**
   * 台北今日 yyyy-mm-dd。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function getTodayTaipeiDate() {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return formatter.format(new Date());
  }

  /**
   * 建立簡單唯一 id。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function createNodeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * 讀取 localStorage。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n + m)
   */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createInitialState();

      const parsed = JSON.parse(raw);
      const initial = createInitialState();

      return {
        ...initial,
        ...parsed,
        readings: Array.isArray(parsed.readings) ? parsed.readings : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        ui: {
          ...initial.ui,
          ...(parsed.ui || {}),
        },
      };
    } catch (error) {
      console.warn("占卜驗證圖譜資料損壞，已重置。", error);
      localStorage.removeItem(STORAGE_KEY);
      return createInitialState();
    }
  }

  /**
   * 寫回 localStorage。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n + m)
   */
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /**
   * 取得所有節點。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n + m)
   */
  function getAllNodes() {
    return [...state.readings, ...state.events];
  }

  /**
   * 建立 reading 節點。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function createReadingNode() {
    const totalCount = state.readings.length;
    const row = Math.floor(totalCount / 3);
    const col = totalCount % 3;

    return {
      id: createNodeId("reading"),
      type: "reading",
      title: `新占卜案例 ${totalCount + 1}`,
      category: "relationship",
      subject: "",
      date: getTodayTaipeiDate(),
      cards: "",
      interpretation: "",
      predictions: "",
      note: "",
      status: "pending",
      position: {
        x: 160 + col * 280,
        y: 140 + row * 180,
      },
      createdAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
      updatedAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
    };
  }

  /**
   * 建立 event 節點。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function createEventNode(relatedReadingId) {
    const totalCount = state.events.length;
    const anchorReading = relatedReadingId
      ? state.readings.find((reading) => reading.id === relatedReadingId)
      : null;

    const fallbackX = 520 + (totalCount % 3) * 240;
    const fallbackY = 340 + Math.floor(totalCount / 3) * 160;

    return {
      id: createNodeId("event"),
      type: "event",
      title: `新事件 ${totalCount + 1}`,
      category: anchorReading?.category || "other",
      date: getTodayTaipeiDate(),
      description: "",
      relatedReadingId: relatedReadingId || "",
      note: "",
      status: "pending",
      position: {
        x: anchorReading ? anchorReading.position.x + 300 : fallbackX,
        y: anchorReading ? anchorReading.position.y + 90 : fallbackY,
      },
      createdAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
      updatedAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
    };
  }

  /**
   * 依 id 取節點。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(1)
   */
  function getNodeById(nodeId) {
    return getAllNodes().find((node) => node.id === nodeId) || null;
  }

  /**
   * 只更新單一節點，避免整份資料重建。
   * 時間複雜度：O(n) 或 O(m)
   * 空間複雜度：O(1)
   *
   * 暴力法：每次都重組所有節點陣列。
   * 本實作：先判斷類型，僅 map 對應陣列。
   */
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

  /**
   * 刪除節點，並清理 event 對 reading 的關聯。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(m)
   */
  function deleteNodeById(nodeId) {
    const isReading = state.readings.some((node) => node.id === nodeId);

    if (isReading) {
      state.readings = state.readings.filter((node) => node.id !== nodeId);
      state.events = state.events.map((eventNode) => {
        if (eventNode.relatedReadingId !== nodeId) return eventNode;
        return {
          ...eventNode,
          relatedReadingId: "",
          updatedAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
        };
      });
    } else {
      state.events = state.events.filter((node) => node.id !== nodeId);
    }

    if (state.ui.selectedId === nodeId) {
      state.ui.selectedId = null;
    }
  }

  /**
   * 關鍵字 + 類別 + 狀態篩選。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n + m)
   */
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

  /**
   * 更新分類下拉選單。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(c)
   */
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

  /**
   * 更新右側關聯 reading 下拉。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
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

  /**
   * 渲染上方統計。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(1)
   */
  function renderStats() {
    const filteredCount = getFilteredNodes().length;
    refs.stats.innerHTML = [
      `<span class="map-stat-pill">案例 ${state.readings.length}</span>`,
      `<span class="map-stat-pill">事件 ${state.events.length}</span>`,
      `<span class="map-stat-pill">畫布縮放 ${Math.round(state.ui.zoom * 100)}%</span>`,
      `<span class="map-stat-pill">目前顯示 ${filteredCount}</span>`,
    ].join("");
  }

  /**
   * 套用畫布 transform。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   *
   * 暴力法：逐一改每個節點位置乘上 zoom。
   * 本實作：整個 scene 一次性 transform，DOM 更新量最低。
   */
  function applySceneTransform() {
    refs.scene.style.transform = `translate(${state.ui.panX}px, ${state.ui.panY}px) scale(${state.ui.zoom})`;
    refs.zoomReset.textContent = `${Math.round(state.ui.zoom * 100)}%`;
  }

  /**
   * 只更新連線，不重建整張圖。
   * 時間複雜度：O(m)
   * 空間複雜度：O(m)
   */
  function renderConnections(visibleMap) {
    const fragments = [];
    state.events.forEach((eventNode) => {
      if (!eventNode.relatedReadingId) return;

      const eventVisible = visibleMap.get(eventNode.id);
      const readingVisible = visibleMap.get(eventNode.relatedReadingId);
      if (!eventVisible || !readingVisible) return;

      const eventSize = NODE_SIZES.event;
      const readingSize = NODE_SIZES.reading;

      const fromX = eventNode.position.x + eventSize.width / 2;
      const fromY = eventNode.position.y + eventSize.height / 2;
      const toX = readingVisible.position.x + readingSize.width / 2;
      const toY = readingVisible.position.y + readingSize.height / 2;
      const ctrlOffset = Math.max(90, Math.abs(fromX - toX) * 0.26);

      fragments.push(
        `<path class="map-link-line" d="M ${fromX} ${fromY} C ${fromX - ctrlOffset} ${fromY}, ${toX + ctrlOffset} ${toY}, ${toX} ${toY}" />`,
        `<circle class="map-link-dot" cx="${toX}" cy="${toY}" r="3.2" />`
      );
    });

    refs.connections.innerHTML = fragments.join("");
  }

  /**
   * 畫布節點渲染。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n)
   */
  function renderMap() {
    const visibleNodes = getFilteredNodes();
    const visibleMap = new Map(visibleNodes.map((node) => [node.id, node]));
    const fragment = document.createDocumentFragment();

    visibleNodes.forEach((node) => {
      const el = document.createElement("article");
      el.className = `map-node ${node.type} status-${node.status}${state.ui.selectedId === node.id ? " is-selected" : ""}`;
      el.dataset.id = node.id;
      el.dataset.type = node.type;
      el.style.left = `${node.position.x}px`;
      el.style.top = `${node.position.y}px`;

      const metaText =
        node.type === "reading"
          ? `${CATEGORY_LABELS[node.category] || CATEGORY_LABELS.other} · ${node.subject || "未填對象"}`
          : `${CATEGORY_LABELS[node.category] || CATEGORY_LABELS.other}${node.relatedReadingId ? " · 已連結" : " · 未連結"}`;

      const previewText =
        node.type === "reading"
          ? node.interpretation || node.cards || "尚未填入解讀"
          : node.description || node.note || "尚未填入事件描述";

      el.innerHTML = `
        <div class="map-node-header">
          <span class="map-node-type">${TYPE_LABELS[node.type]}</span>
          <span class="map-timeline-date">${escapeHtml(node.date || "未填日期")}</span>
        </div>
        <h5>${escapeHtml(node.title || "未命名節點")}</h5>
        <p class="map-node-meta">${escapeHtml(metaText)}</p>
        <p class="map-node-preview">${escapeHtml(previewText).replace(/\n/g, "<br />")}</p>
        <span class="map-node-status">${STATUS_LABELS[node.status] || STATUS_LABELS.pending}</span>
      `;

      el.addEventListener("pointerdown", handleNodePointerDown);
      el.addEventListener("click", handleNodeClick);

      fragment.appendChild(el);
    });

    refs.canvas.innerHTML = "";
    refs.canvas.appendChild(fragment);
    renderConnections(visibleMap);
  }

  /**
   * 時間軸渲染。
   * 時間複雜度：O(k log k)
   * 空間複雜度：O(k)
   *
   * 暴力法：每新增一筆就手動插入對應位置。
   * 本實作：總量尚小，直接合併後排序，邏輯更穩。
   */
  function renderTimeline() {
    const items = getFilteredNodes()
      .slice()
      .sort((a, b) => {
        const left = a.date || "";
        const right = b.date || "";
        if (left === right) return a.createdAt.localeCompare(b.createdAt);
        return left.localeCompare(right);
      });

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
          <article class="map-timeline-item">
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

  /**
   * 同步右側表單顯示。
   * 時間複雜度：O(n)
   * 空間複雜度：O(1)
   */
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

  /**
   * 整體重繪入口。
   * 時間複雜度：O(k log k)
   * 空間複雜度：O(k)
   */
  function renderAll() {
    renderCategoryFilterOptions();
    renderStats();
    applySceneTransform();
    renderMap();
    renderDetailPanel();
    renderTimeline();
  }

  /**
   * 新增 reading。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function addReading() {
    const node = createReadingNode();
    state.readings.push(node);
    state.ui.selectedId = node.id;
    saveState();
    renderAll();
  }

  /**
   * 新增 event；若目前選到 reading，預設連結它。
   * 時間複雜度：O(n)
   * 空間複雜度：O(1)
   */
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

  /**
   * 依目前表單內容更新節點。
   * 時間複雜度：O(n) 或 O(m)
   * 空間複雜度：O(1)
   */
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
        updatedAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
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

  /**
   * node click：選取節點。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function handleNodeClick(event) {
    const nodeId = event.currentTarget.dataset.id;
    state.ui.selectedId = nodeId;
    renderAll();
  }

  /**
   * 將 viewport 座標換成 scene 座標。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function screenToScene(clientX, clientY) {
    const rect = refs.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.ui.panX) / state.ui.zoom,
      y: (clientY - rect.top - state.ui.panY) / state.ui.zoom,
    };
  }

  /**
   * 節點拖曳起點。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function handleNodePointerDown(event) {
    event.stopPropagation();
    const nodeId = event.currentTarget.dataset.id;
    const node = getNodeById(nodeId);
    if (!node) return;

    state.ui.selectedId = nodeId;
    const point = screenToScene(event.clientX, event.clientY);

    dragState = {
      nodeId,
      offsetX: point.x - node.position.x,
      offsetY: point.y - node.position.y,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", handleNodePointerMove);
    window.addEventListener("pointerup", handleNodePointerUp, { once: true });

    renderAll();
  }

  /**
   * 拖曳中只更新單一節點，降低 repaint 成本。
   * 時間複雜度：O(n) 或 O(m)
   * 空間複雜度：O(1)
   */
  function handleNodePointerMove(event) {
    if (!dragState) return;
    const point = screenToScene(event.clientX, event.clientY);

    updateNodeById(dragState.nodeId, (node) => ({
      ...node,
      position: {
        x: clamp(point.x - dragState.offsetX, 24, SCENE_WIDTH - 280),
        y: clamp(point.y - dragState.offsetY, 24, SCENE_HEIGHT - 160),
      },
      updatedAt: window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString(),
    }));

    renderMap();
    renderConnections(new Map(getFilteredNodes().map((node) => [node.id, node])));
    renderDetailPanel();
  }

  /**
   * 拖曳結束後正式儲存。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function handleNodePointerUp() {
    window.removeEventListener("pointermove", handleNodePointerMove);
    dragState = null;
    saveState();
    renderAll();
  }

  /**
   * 畫布平移起點。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
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

  /**
   * 畫布平移。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function handleViewportPointerMove(event) {
    if (!panState) return;

    state.ui.panX = panState.originPanX + (event.clientX - panState.startX);
    state.ui.panY = panState.originPanY + (event.clientY - panState.startY);
    applySceneTransform();
    renderStats();
  }

  /**
   * 平移結束。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function handleViewportPointerUp() {
    refs.viewport.classList.remove("is-panning");
    window.removeEventListener("pointermove", handleViewportPointerMove);
    panState = null;
    saveState();
  }

  /**
   * 滾輪縮放。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function handleViewportWheel(event) {
    event.preventDefault();

    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    const nextZoom = clamp(Number((state.ui.zoom + delta).toFixed(2)), 0.4, 1.8);

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

  /**
   * 清空整份資料。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function resetData() {
    const confirmed = window.confirm("要清空占卜驗證圖譜的所有本機資料嗎？此動作無法復原。");
    if (!confirmed) return;

    state = createInitialState();
    saveState();
    renderAll();
  }

  /**
   * 輸出 JSON 備份。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n + m)
   */
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `evan-tarot-map-${getTodayTaipeiDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 縮放快捷。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function adjustZoom(delta) {
    state.ui.zoom = clamp(Number((state.ui.zoom + delta).toFixed(2)), 0.4, 1.8);
    saveState();
    renderAll();
  }

  /**
   * 重設視圖。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function resetView() {
    state.ui.zoom = 0.72;
    state.ui.panX = -420;
    state.ui.panY = -260;
    saveState();
    renderAll();
  }

  /**
   * 綁定 DOM 事件。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
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

  /**
   * DOM 快取。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
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

  /**
   * 初始化入口。
   * 時間複雜度：O(n + m)
   * 空間複雜度：O(n + m)
   */
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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
