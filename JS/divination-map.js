// ==============================
// divination-map.js
// 占卜時間流：主題流 / 占卜案例 / 事件 / 曲線連接
// ==============================
//
// 主要函式複雜度：
// - initDivinationMap：O(n)
// - renderMap：O(n + e)
// - buildLayout：O(n log n)
// - renderConnections：O(n + e)
// - renderNodes：O(n)
// 空間複雜度：O(n + e)
//
// 更快替代方案比較：
// - 暴力法：每次操作都重新掃描 DOM、逐筆查詢關聯節點，容易變成 O(n²)。
// - 本實作：先用 Map 建立 id -> node 查表，關聯線查詢為 O(1)，整體維持 O(n + e)。
// ==============================

(function initDivinationMapModule() {
  const STORAGE_KEY = "evanDivinationMapData_v4";
  const LEGACY_KEYS = ["evanDivinationMapData_v3", "evanDivinationMapData", "evanTarotDivinationMap"];
  const ADMIN_KEY = "evanDivinationMapAdminUnlocked";
  const ADMIN_PASSWORD = "EVAN";

  const THEME_COLORS = [
    "#b794ff",
    "#71e8ff",
    "#f9a8ff",
    "#7fe3b2",
    "#ffd37a",
    "#f07181",
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

  const NODE_TYPE_LABELS = {
    reading: "占卜案例",
    event: "事件",
  };

  const state = {
    data: null,
    selectedId: "",
    zoom: 1,
    panX: 0,
    panY: 0,
    draggingNode: null,
    panning: null,
    latestLayout: null,
    adminUnlocked: false,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function todayISODate() {
    const now = new Date();
    const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return taipei.toISOString().slice(0, 10);
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex || "#b794ff").replace("#", "");
    const value = clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function defaultData() {
    const themeId = makeId("theme");
    const readingId = makeId("reading");
    const eventId = makeId("event");
    const today = todayISODate();

    return {
      themes: [
        {
          id: themeId,
          title: "A 關係驗證",
          category: "relationship",
          color: THEME_COLORS[0],
          createdAt: today,
        },
      ],
      nodes: [
        {
          id: readingId,
          type: "reading",
          themeId,
          date: today,
          title: "範例：這段關係接下來的互動走向",
          category: "relationship",
          subject: "A",
          status: "pending",
          cards: "權杖六｜現況\n寶劍侍者｜對方狀態",
          interpretation: "這是一筆範例資料，可直接刪除或覆蓋。",
          predictions: "觀察是否有主動靠近、訊息或邀約。",
          note: "",
          xOffset: 0,
          yOffset: 0,
        },
        {
          id: eventId,
          type: "event",
          themeId,
          date: today,
          title: "範例：後續事件紀錄",
          category: "relationship",
          relatedReadingId: readingId,
          status: "partial",
          eventDescription: "把實際發生的事件記在這裡，系統會用曲線接回主題流。",
          note: "這筆也可刪除。",
          xOffset: 0,
          yOffset: 0,
        },
      ],
      viewMode: "single",
      activeThemeId: themeId,
      filterStatus: "all",
      filterCategory: "all",
      search: "",
    };
  }

  function normalizeData(raw) {
    const data = raw && typeof raw === "object" ? raw : defaultData();
    const themes = Array.isArray(data.themes) ? data.themes : [];
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];

    if (!themes.length) {
      return defaultData();
    }

    themes.forEach((theme, index) => {
      theme.id = theme.id || makeId("theme");
      theme.title = theme.title || `主題流 ${index + 1}`;
      theme.category = theme.category || "other";
      theme.color = theme.color || THEME_COLORS[index % THEME_COLORS.length];
      theme.createdAt = theme.createdAt || todayISODate();
    });

    nodes.forEach((node) => {
      node.id = node.id || makeId(node.type === "event" ? "event" : "reading");
      node.type = node.type === "event" ? "event" : "reading";
      node.themeId = node.themeId || themes[0].id;
      node.date = node.date || todayISODate();
      node.title = node.title || (node.type === "event" ? "未命名事件" : "未命名占卜案例");
      node.category = node.category || getThemeById(node.themeId)?.category || "other";
      node.status = node.status || "pending";
      node.xOffset = Number(node.xOffset || 0);
      node.yOffset = Number(node.yOffset || 0);
    });

    return {
      themes,
      nodes,
      viewMode: data.viewMode === "parallel" ? "parallel" : "single",
      activeThemeId: data.activeThemeId || themes[0].id,
      filterStatus: data.filterStatus || "all",
      filterCategory: data.filterCategory || "all",
      search: data.search || "",
    };
  }

  function loadData() {
    const primary = localStorage.getItem(STORAGE_KEY);
    if (primary) {
      try { return normalizeData(JSON.parse(primary)); } catch (e) {}
    }

    for (const key of LEGACY_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const data = normalizeData(JSON.parse(raw));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return data;
      } catch (e) {}
    }

    const data = defaultData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function getThemeById(themeId) {
    return state.data?.themes.find((theme) => theme.id === themeId) || null;
  }

  function getThemeColor(themeId) {
    return getThemeById(themeId)?.color || THEME_COLORS[0];
  }

  function getVisibleNodes() {
    const data = state.data;
    const keyword = String(data.search || "").trim().toLowerCase();

    return data.nodes.filter((node) => {
      const theme = getThemeById(node.themeId);
      const targetTheme = data.activeThemeId !== "all" ? data.activeThemeId : null;

      if (data.viewMode === "single" && data.activeThemeId !== "all" && node.themeId !== data.activeThemeId) return false;
      if (data.viewMode === "parallel" && targetTheme && node.themeId !== targetTheme) return false;
      if (data.filterStatus !== "all" && node.status !== data.filterStatus) return false;
      if (data.filterCategory !== "all" && node.category !== data.filterCategory && theme?.category !== data.filterCategory) return false;

      if (!keyword) return true;

      const haystack = [
        node.title,
        node.subject,
        node.cards,
        node.interpretation,
        node.predictions,
        node.eventDescription,
        node.note,
        theme?.title,
        CATEGORY_LABELS[node.category],
        STATUS_LABELS[node.status],
      ].join(" ").toLowerCase();

      return haystack.includes(keyword);
    });
  }

  function buildLayout() {
    const visibleNodes = getVisibleNodes().slice().sort((a, b) => {
      const dateCmp = String(a.date).localeCompare(String(b.date));
      if (dateCmp !== 0) return dateCmp;
      if (a.type !== b.type) return a.type === "reading" ? -1 : 1;
      return String(a.title).localeCompare(String(b.title));
    });

    const themeIds = state.data.viewMode === "parallel"
      ? state.data.themes.map((theme) => theme.id).filter((id) => state.data.activeThemeId === "all" || id === state.data.activeThemeId)
      : [state.data.activeThemeId === "all" ? state.data.themes[0].id : state.data.activeThemeId];

    const safeThemeIds = themeIds.length ? themeIds : [state.data.themes[0].id];
    const streamXs = new Map();
    const sceneWidth = Math.max(1680, 620 * safeThemeIds.length + 420);
    const baseGap = sceneWidth / (safeThemeIds.length + 1);

    safeThemeIds.forEach((themeId, index) => {
      streamXs.set(themeId, Math.round(baseGap * (index + 1)));
    });

    const counters = new Map();
    const placements = visibleNodes.map((node) => {
      const themeId = streamXs.has(node.themeId) ? node.themeId : safeThemeIds[0];
      const themeIndex = counters.get(themeId) || 0;
      counters.set(themeId, themeIndex + 1);

      const streamX = streamXs.get(themeId);
      const isReading = node.type === "reading";
      const width = isReading ? 272 : 248;
      const height = isReading ? 154 : 136;
      const side = isReading ? -1 : 1;
      const distance = state.data.viewMode === "parallel" ? 170 : 230;
      const x = streamX + side * distance - (isReading ? width : 0) + Number(node.xOffset || 0);
      const y = 110 + themeIndex * 210 + Number(node.yOffset || 0);

      return {
        node,
        x,
        y,
        width,
        height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        streamX,
      };
    });

    const maxY = Math.max(900, ...placements.map((p) => p.y + p.height + 180));

    return {
      sceneWidth,
      sceneHeight: maxY,
      streamXs,
      themeIds: safeThemeIds,
      placements,
      placementById: new Map(placements.map((p) => [p.node.id, p])),
    };
  }

  function curvePath(x1, y1, x2, y2) {
    const gap = Math.abs(x2 - x1);
    const curve = Math.min(140, Math.max(44, gap * 0.45));
    const sign = x2 >= x1 ? 1 : -1;
    return `M ${x1} ${y1} C ${x1 + curve * sign} ${y1}, ${x2 - curve * sign} ${y2}, ${x2} ${y2}`;
  }

  function renderConnections(layout) {
    const fragments = [];

    layout.themeIds.forEach((themeId) => {
      const theme = getThemeById(themeId);
      const x = layout.streamXs.get(themeId);
      const color = getThemeColor(themeId);
      const title = escapeHtml(theme?.title || "主題流");

      fragments.push(`<path class="map-stream-glow" d="M ${x - 26} 70 C ${x + 42} 240, ${x - 42} 520, ${x + 20} ${layout.sceneHeight - 80} L ${x - 20} ${layout.sceneHeight - 80} C ${x - 42} 520, ${x + 42} 240, ${x - 26} 70 Z" fill="${hexToRgba(color, 0.08)}" />`);
      fragments.push(`<line class="map-stream-axis" x1="${x}" y1="78" x2="${x}" y2="${layout.sceneHeight - 70}" stroke="${hexToRgba(color, 0.62)}" />`);
      fragments.push(`<text class="map-stream-title" x="${x + 18}" y="58">${title}</text>`);
    });

    layout.placements.forEach((placement) => {
      const { node } = placement;
      const startX = node.type === "reading" ? placement.x + placement.width : placement.x;
      const startY = placement.centerY;
      const endX = placement.streamX;
      const endY = placement.centerY;
      const color = getThemeColor(node.themeId);
      const d = curvePath(startX, startY, endX, endY);

      fragments.push(`<path class="map-stream-branch ${node.type}" d="${d}" fill="none" stroke="${hexToRgba(color, node.type === "reading" ? 0.55 : 0.45)}" stroke-width="2.8" />`);
      fragments.push(`<circle class="map-stream-marker" cx="${endX}" cy="${endY}" r="6" fill="${hexToRgba(color, 0.96)}" stroke="${hexToRgba(color, 0.28)}" />`);
    });

    layout.placements.forEach((placement) => {
      const node = placement.node;
      if (node.type !== "event" || !node.relatedReadingId) return;
      const target = layout.placementById.get(node.relatedReadingId);
      if (!target) return;

      const x1 = placement.x;
      const y1 = placement.centerY;
      const x2 = target.x + target.width;
      const y2 = target.centerY;
      const d = curvePath(x1, y1, x2, y2);
      fragments.push(`<path class="map-link-line" d="${d}" />`);
    });

    els.connections.setAttribute("viewBox", `0 0 ${layout.sceneWidth} ${layout.sceneHeight}`);
    els.connections.innerHTML = fragments.join("");
  }

  function previewText(node) {
    if (node.type === "event") return node.eventDescription || node.note || "尚未填寫事件描述。";
    return node.predictions || node.interpretation || node.cards || "尚未填寫解讀。";
  }

  function renderNodes(layout) {
    const html = layout.placements.map((placement) => {
      const node = placement.node;
      const theme = getThemeById(node.themeId);
      const color = getThemeColor(node.themeId);
      const selected = node.id === state.selectedId ? " is-selected" : "";
      const style = [
        `left:${placement.x}px`,
        `top:${placement.y}px`,
        `--theme-color:${color}`,
        `--theme-color-soft:${hexToRgba(color, 0.15)}`,
      ].join(";");

      return `
        <article class="map-node ${node.type} status-${node.status}${selected}" data-node-id="${node.id}" style="${style}">
          <div class="map-node-header">
            <span class="map-node-type">${NODE_TYPE_LABELS[node.type]}</span>
            <span class="map-node-date-badge">${escapeHtml(node.date)}</span>
          </div>
          <h5>${escapeHtml(node.title)}</h5>
          <p class="map-node-meta">${escapeHtml(theme?.title || "未分流")} · ${escapeHtml(CATEGORY_LABELS[node.category] || "其他")}</p>
          <p class="map-node-preview">${escapeHtml(previewText(node)).slice(0, 96)}</p>
          <div class="map-node-footer">
            <span class="map-node-status">${STATUS_LABELS[node.status] || "尚未驗證"}</span>
            <span class="map-node-flow-tag">${node.type === "event" && node.relatedReadingId ? "已連案例" : "主軸連接"}</span>
          </div>
        </article>`;
    }).join("");

    els.canvas.innerHTML = html || `<p class="map-timeline-empty" style="padding:20px;">目前沒有符合條件的節點。</p>`;
  }

  function renderStats(visibleCount) {
    const readings = state.data.nodes.filter((n) => n.type === "reading").length;
    const events = state.data.nodes.filter((n) => n.type === "event").length;
    els.stats.innerHTML = `
      <span class="map-stat-pill">主題 ${state.data.themes.length}</span>
      <span class="map-stat-pill">占卜 ${readings}</span>
      <span class="map-stat-pill">事件 ${events}</span>
      <span class="map-stat-pill">目前顯示 ${visibleCount}</span>
    `;
  }

  function renderTimeline() {
    const nodes = getVisibleNodes().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!nodes.length) {
      els.timeline.innerHTML = `<p class="map-timeline-empty">目前沒有符合條件的時間軸項目。</p>`;
      return;
    }

    els.timeline.innerHTML = nodes.map((node) => {
      const theme = getThemeById(node.themeId);
      return `
        <article class="map-timeline-item ${node.type}" data-timeline-id="${node.id}">
          <div class="map-timeline-top">
            <span class="map-timeline-date">${escapeHtml(node.date)}</span>
            <span class="map-node-status">${STATUS_LABELS[node.status] || "尚未驗證"}</span>
          </div>
          <h5>${escapeHtml(node.title)}</h5>
          <p>${escapeHtml(theme?.title || "未分流")}｜${NODE_TYPE_LABELS[node.type]}｜${escapeHtml(previewText(node)).slice(0, 120)}</p>
        </article>`;
    }).join("");
  }

  function renderSelectors() {
    const themeOptions = state.data.themes.map((theme) => `<option value="${theme.id}">${escapeHtml(theme.title)}</option>`).join("");
    const activeOptions = `<option value="all">全部主題</option>${themeOptions}`;
    const categories = Object.entries(CATEGORY_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");

    els.activeTheme.innerHTML = activeOptions;
    els.fieldTheme.innerHTML = themeOptions;
    els.filterCategory.innerHTML = `<option value="all">全部主題分類</option>${categories}`;

    els.viewMode.value = state.data.viewMode;
    els.activeTheme.value = state.data.activeThemeId;
    els.filterStatus.value = state.data.filterStatus;
    els.filterCategory.value = state.data.filterCategory;
    els.search.value = state.data.search;
  }

  function renderRelatedReadingOptions() {
    const selectedNode = getSelectedNode();
    const currentTheme = selectedNode?.themeId || els.fieldTheme.value || state.data.themes[0]?.id;
    const readings = state.data.nodes.filter((node) => node.type === "reading" && node.themeId === currentTheme);
    els.fieldRelatedReading.innerHTML = `<option value="">未連結</option>` + readings.map((node) => `<option value="${node.id}">${escapeHtml(node.date)}｜${escapeHtml(node.title)}</option>`).join("");
  }

  function applySceneTransform() {
    els.scene.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    els.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderMap() {
    renderSelectors();
    const layout = buildLayout();
    state.latestLayout = layout;

    els.scene.style.width = `${layout.sceneWidth}px`;
    els.scene.style.minHeight = `${layout.sceneHeight}px`;
    els.connections.style.width = `${layout.sceneWidth}px`;
    els.connections.style.height = `${layout.sceneHeight}px`;
    els.canvas.style.width = `${layout.sceneWidth}px`;
    els.canvas.style.height = `${layout.sceneHeight}px`;

    renderConnections(layout);
    renderNodes(layout);
    renderStats(layout.placements.length);
    renderTimeline();
    renderDetailForm();
    applySceneTransform();
  }

  function getSelectedNode() {
    return state.data.nodes.find((node) => node.id === state.selectedId) || null;
  }

  function setFieldVisibility(type) {
    document.querySelectorAll("[data-reading-only]").forEach((el) => el.classList.toggle("hidden", type !== "reading"));
    document.querySelectorAll("[data-event-only]").forEach((el) => el.classList.toggle("hidden", type !== "event"));
  }

  function renderDetailForm() {
    const node = getSelectedNode();
    const locked = !state.adminUnlocked;

    els.emptyState.classList.toggle("hidden", !!node);
    els.detailForm.classList.toggle("hidden", !node);
    els.detailForm.classList.toggle("is-admin-locked", locked);

    if (!node) return;

    setFieldVisibility(node.type);
    renderRelatedReadingOptions();

    els.detailTypeLabel.textContent = NODE_TYPE_LABELS[node.type];
    els.detailTitle.textContent = node.title || "節點內容";
    els.selectedId.textContent = node.id;
    els.detailId.value = node.id;
    els.fieldTheme.value = node.themeId;
    els.fieldDate.value = node.date;
    els.fieldTitle.value = node.title || "";
    els.fieldCategory.value = node.category || "other";
    els.fieldSubject.value = node.subject || "";
    els.fieldStatus.value = node.status || "pending";
    els.fieldCards.value = node.cards || "";
    els.fieldInterpretation.value = node.interpretation || "";
    els.fieldPredictions.value = node.predictions || "";
    els.fieldEventDescription.value = node.eventDescription || "";
    els.fieldRelatedReading.value = node.relatedReadingId || "";
    els.fieldNote.value = node.note || "";
    els.detailThemeHint.textContent = locked ? "目前是訪客瀏覽模式，請先解鎖管理員才能修改。" : "變更主題流後，節點會重新掛到對應主軸。";

    els.detailForm.querySelectorAll("input, select, textarea, button[type='submit']").forEach((input) => {
      input.disabled = locked;
    });
    els.deleteNode.disabled = locked;
  }

  function requireAdmin() {
    if (state.adminUnlocked) return true;
    showAdminModal();
    return false;
  }

  function addTheme() {
    if (!requireAdmin()) return;
    const title = window.prompt("新增主題流名稱：", "新的主題流");
    if (!title || !title.trim()) return;
    const id = makeId("theme");
    const index = state.data.themes.length;
    state.data.themes.push({
      id,
      title: title.trim(),
      category: "other",
      color: THEME_COLORS[index % THEME_COLORS.length],
      createdAt: todayISODate(),
    });
    state.data.activeThemeId = id;
    saveData();
    renderMap();
  }

  function addNode(type) {
    if (!requireAdmin()) return;
    const themeId = state.data.activeThemeId !== "all" ? state.data.activeThemeId : state.data.themes[0].id;
    const theme = getThemeById(themeId) || state.data.themes[0];
    const node = {
      id: makeId(type),
      type,
      themeId: theme.id,
      date: todayISODate(),
      title: type === "reading" ? "新的占卜案例" : "新的事件",
      category: theme.category || "other",
      subject: "",
      status: "pending",
      cards: "",
      interpretation: "",
      predictions: "",
      eventDescription: "",
      relatedReadingId: "",
      note: "",
      xOffset: 0,
      yOffset: 0,
    };
    state.data.nodes.push(node);
    state.selectedId = node.id;
    saveData();
    renderMap();
  }

  function saveSelectedNode(event) {
    event.preventDefault();
    if (!requireAdmin()) return;
    const node = getSelectedNode();
    if (!node) return;

    node.themeId = els.fieldTheme.value;
    node.date = els.fieldDate.value || todayISODate();
    node.title = els.fieldTitle.value.trim() || (node.type === "event" ? "未命名事件" : "未命名占卜案例");
    node.category = els.fieldCategory.value || "other";
    node.subject = els.fieldSubject.value.trim();
    node.status = els.fieldStatus.value || "pending";
    node.cards = els.fieldCards.value.trim();
    node.interpretation = els.fieldInterpretation.value.trim();
    node.predictions = els.fieldPredictions.value.trim();
    node.eventDescription = els.fieldEventDescription.value.trim();
    node.relatedReadingId = els.fieldRelatedReading.value;
    node.note = els.fieldNote.value.trim();

    saveData();
    renderMap();
  }

  function deleteSelectedNode() {
    if (!requireAdmin()) return;
    const node = getSelectedNode();
    if (!node) return;
    const ok = window.confirm(`確定刪除「${node.title}」？`);
    if (!ok) return;

    state.data.nodes = state.data.nodes.filter((item) => item.id !== node.id);
    state.data.nodes.forEach((item) => {
      if (item.relatedReadingId === node.id) item.relatedReadingId = "";
    });
    state.selectedId = "";
    saveData();
    renderMap();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evan-timeflow-${todayISODate()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function resetData() {
    if (!requireAdmin()) return;
    const ok = window.confirm("確定清空時間流資料？這會重設成本機預設範例。建議先下載 JSON 備份。");
    if (!ok) return;
    state.data = defaultData();
    state.selectedId = "";
    saveData();
    renderMap();
  }

  function updateAdminUI() {
    if (!els.adminToggle) return;
    els.adminToggle.textContent = state.adminUnlocked ? "管理員已解鎖" : "管理員登入";
    els.adminToggle.classList.toggle("is-unlocked", state.adminUnlocked);
    [els.addTheme, els.addReading, els.addEvent, els.deleteNode].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("is-locked", !state.adminUnlocked);
    });
  }

  function showAdminModal() {
    const old = document.querySelector(".map-modal-backdrop");
    old?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "map-modal-backdrop";
    backdrop.innerHTML = `
      <div class="map-modal" role="dialog" aria-modal="true" aria-label="管理員登入">
        <div class="map-modal-orb" aria-hidden="true"></div>
        <div class="map-modal-header">
          <p class="map-form-kicker">Admin Lock</p>
          <h3>管理員登入</h3>
          <p>目前時間流是訪客瀏覽模式。輸入管理密碼後才可新增、修改與刪除。</p>
        </div>
        <form class="map-modal-form" id="map-admin-form">
          <label>管理密碼
            <input id="map-admin-password" type="password" autocomplete="current-password" placeholder="輸入管理密碼" />
          </label>
          <p class="map-modal-message hidden" id="map-admin-message"></p>
          <div class="map-modal-actions">
            <button type="button" class="btn ghost" id="map-admin-cancel">取消</button>
            <button type="submit" class="btn primary">解鎖</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const passwordInput = backdrop.querySelector("#map-admin-password");
    const message = backdrop.querySelector("#map-admin-message");
    passwordInput.focus();

    backdrop.querySelector("#map-admin-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) backdrop.remove();
    });
    backdrop.querySelector("#map-admin-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = passwordInput.value.trim();
      if (value !== ADMIN_PASSWORD) {
        message.textContent = "密碼錯誤。預設密碼目前是 EVAN，可之後再改成你自己的。";
        message.classList.add("is-error");
        message.classList.remove("hidden");
        passwordInput.select();
        return;
      }
      state.adminUnlocked = true;
      sessionStorage.setItem(ADMIN_KEY, "1");
      backdrop.remove();
      updateAdminUI();
      renderDetailForm();
    });
  }

  function handleCanvasPointerDown(event) {
    const nodeEl = event.target.closest(".map-node");
    if (nodeEl) {
      const nodeId = nodeEl.dataset.nodeId;
      state.selectedId = nodeId;
      renderMap();

      if (!state.adminUnlocked) return;
      const placement = state.latestLayout?.placementById.get(nodeId);
      const node = getSelectedNode();
      if (!placement || !node) return;
      event.preventDefault();
      state.draggingNode = {
        id: nodeId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startXOffset: Number(node.xOffset || 0),
        startYOffset: Number(node.yOffset || 0),
      };
      return;
    }

    event.preventDefault();
    els.viewport.classList.add("is-panning");
    state.panning = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: state.panX,
      startPanY: state.panY,
    };
  }

  function handlePointerMove(event) {
    if (state.draggingNode) {
      const node = state.data.nodes.find((item) => item.id === state.draggingNode.id);
      if (!node) return;
      node.xOffset = state.draggingNode.startXOffset + (event.clientX - state.draggingNode.startClientX) / state.zoom;
      node.yOffset = state.draggingNode.startYOffset + (event.clientY - state.draggingNode.startClientY) / state.zoom;
      renderMap();
      return;
    }

    if (state.panning) {
      state.panX = state.panning.startPanX + (event.clientX - state.panning.startClientX);
      state.panY = state.panning.startPanY + (event.clientY - state.panning.startClientY);
      applySceneTransform();
    }
  }

  function handlePointerUp() {
    if (state.draggingNode) {
      saveData();
      state.draggingNode = null;
    }
    state.panning = null;
    els.viewport?.classList.remove("is-panning");
  }

  function handleWheel(event) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    state.zoom = Math.min(1.7, Math.max(0.55, state.zoom + delta));
    applySceneTransform();
  }

  function bindEvents() {
    els.addTheme.addEventListener("click", addTheme);
    els.addReading.addEventListener("click", () => addNode("reading"));
    els.addEvent.addEventListener("click", () => addNode("event"));
    els.detailForm.addEventListener("submit", saveSelectedNode);
    els.deleteNode.addEventListener("click", deleteSelectedNode);
    els.exportJson.addEventListener("click", exportJson);
    els.resetData.addEventListener("click", resetData);

    els.viewMode.addEventListener("change", () => { state.data.viewMode = els.viewMode.value; saveData(); renderMap(); });
    els.activeTheme.addEventListener("change", () => { state.data.activeThemeId = els.activeTheme.value; saveData(); renderMap(); });
    els.filterStatus.addEventListener("change", () => { state.data.filterStatus = els.filterStatus.value; saveData(); renderMap(); });
    els.filterCategory.addEventListener("change", () => { state.data.filterCategory = els.filterCategory.value; saveData(); renderMap(); });
    els.search.addEventListener("input", () => { state.data.search = els.search.value; saveData(); renderMap(); });
    els.fieldTheme.addEventListener("change", renderRelatedReadingOptions);

    els.zoomOut.addEventListener("click", () => { state.zoom = Math.max(0.55, state.zoom - 0.1); applySceneTransform(); });
    els.zoomIn.addEventListener("click", () => { state.zoom = Math.min(1.7, state.zoom + 0.1); applySceneTransform(); });
    els.zoomReset.addEventListener("click", () => { state.zoom = 1; state.panX = 0; state.panY = 0; applySceneTransform(); });

    els.viewport.addEventListener("pointerdown", handleCanvasPointerDown);
    els.viewport.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    els.timeline.addEventListener("click", (event) => {
      const item = event.target.closest(".map-timeline-item");
      if (!item) return;
      state.selectedId = item.dataset.timelineId;
      renderMap();
    });

    els.adminToggle?.addEventListener("click", () => {
      if (state.adminUnlocked) {
        state.adminUnlocked = false;
        sessionStorage.removeItem(ADMIN_KEY);
        updateAdminUI();
        renderDetailForm();
        return;
      }
      showAdminModal();
    });
  }

  function createAdminButtonIfMissing() {
    const controls = document.querySelector(".map-view-controls");
    if (!controls || $("map-admin-toggle")) return;
    const button = document.createElement("button");
    button.className = "map-icon-btn map-text-btn map-admin-toggle";
    button.id = "map-admin-toggle";
    button.type = "button";
    button.textContent = "管理員登入";
    controls.prepend(button);
  }

  window.initDivinationMap = function initDivinationMap() {
    const app = $("divination-map-app");
    if (!app) return;

    createAdminButtonIfMissing();

    Object.assign(els, {
      app,
      addTheme: $("map-add-theme"),
      addReading: $("map-add-reading"),
      addEvent: $("map-add-event"),
      viewMode: $("map-view-mode"),
      activeTheme: $("map-active-theme"),
      filterStatus: $("map-filter-status"),
      filterCategory: $("map-filter-category"),
      search: $("map-search"),
      stats: $("map-stats"),
      viewport: $("map-viewport"),
      scene: $("map-scene"),
      connections: $("map-connections"),
      canvas: $("map-canvas"),
      timeline: $("map-timeline"),
      zoomOut: $("map-zoom-out"),
      zoomReset: $("map-zoom-reset"),
      zoomIn: $("map-zoom-in"),
      exportJson: $("map-export-json"),
      resetData: $("map-reset-data"),
      emptyState: $("map-empty-state"),
      detailForm: $("map-detail-form"),
      detailTypeLabel: $("map-detail-type-label"),
      detailTitle: $("map-detail-title"),
      selectedId: $("map-selected-id"),
      detailId: $("map-detail-id"),
      fieldTheme: $("map-field-theme"),
      fieldDate: $("map-field-date"),
      detailThemeHint: $("map-detail-theme-hint"),
      fieldTitle: $("map-field-title"),
      fieldCategory: $("map-field-category"),
      fieldSubject: $("map-field-subject"),
      fieldRelatedReading: $("map-field-related-reading"),
      fieldStatus: $("map-field-status"),
      fieldCards: $("map-field-cards"),
      fieldInterpretation: $("map-field-interpretation"),
      fieldPredictions: $("map-field-predictions"),
      fieldEventDescription: $("map-field-event-description"),
      fieldNote: $("map-field-note"),
      deleteNode: $("map-delete-node"),
      adminToggle: $("map-admin-toggle"),
    });

    const missing = Object.entries(els).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      console.warn("[divination-map] 缺少必要元素：", missing);
      return;
    }

    state.data = loadData();
    state.adminUnlocked = sessionStorage.getItem(ADMIN_KEY) === "1";

    bindEvents();
    updateAdminUI();
    renderMap();
  };
})();
