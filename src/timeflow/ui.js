/**
 * 時間樹 v6｜可閱讀 UI 原始碼
 *
 * 主要流程：單一主幹畫布、分支導覽、側欄與時間順序清單。
 * 時間複雜度：O(N log N + L log L)；空間複雜度：O(N + L)。
 *
 * 更快替代方案比較：
 * - 每個案例各畫一條全寬時間軸：實作直接，但重複日期與主軸，畫布高度隨 L 線性浪費。
 * - 本版：日期尺只畫一次，分支線段只覆蓋必要範圍；Map 查表避免重複搜尋父節點。
 */
/*! 時間樹 v6 UI｜render: 時間 O(N log N + L log L)、空間 O(N+L)。 */
(function initTimeflowUi(TF) {
  "use strict";

  const {
    ctx,
    C,
    clamp,
    esc,
    truncate,
    rgba,
    save,
    rebuildIndexes,
    ensureSelection,
    activeTopics,
    activeTimelines,
    activeNodes,
    topicTitle,
    topicColor,
    lineTitle,
    lineTopic,
    dateRange,
    sortNodes,
    visibleData,
    buildLayout,
    orderTimelines,
    timelinePath,
    isTimelinePrivate,
  } = TF;

  const app = TF.app = TF.app || { refs: {}, signedIn: false, pan: null, layout: null };
  const refs = app.refs;

  const preview = (node) => node.type === "reading"
    ? node.interpretation || node.cards || node.predictions || "尚未填入解讀"
    : node.description || node.note || "尚未填入內容";

  const selected = () => ctx.nodeIndex.get(ctx.state.ui.selectedId);

  function branchName(line) {
    if (!line) return "未命名分支";
    const topic = topicTitle(line.topicId);
    const generic = /^(第一(?:案例)?時間線|第一條時間線|新案例時間線|第一分支)$/.test(line.title);
    if (generic || line.title === topic) return topic || line.title || "未命名分支";
    return line.parentNodeId ? line.title : `${topic}｜${line.title}`;
  }

  /** 選擇分支：時間／空間 O(1)。 */
  function selectLine(lineId) {
    ctx.state.ui.activeTimelineId = lineId;
    if (ctx.state.ui.viewMode === "single") {
      const topicId = lineTopic(lineId);
      if (topicId) ctx.state.ui.activeTopicId = topicId;
    }
  }

  /** 修正為目前權限下可見的分支，避免名稱或節點從側欄洩漏；時間 O(L)，空間 O(L)。 */
  function ensureVisibleActiveLine() {
    if (ctx.state.ui.viewMode === "all") ctx.state.ui.activeTopicId = "all";
    const includePrivate = app.signedIn && ctx.state.ui.showPrivate !== false;
    const viewable = activeTimelines().filter((line) => includePrivate || !isTimelinePrivate(line.id));
    let scoped = ctx.state.ui.activeTopicId === "all"
      ? viewable
      : viewable.filter((line) => line.topicId === ctx.state.ui.activeTopicId);

    if (!scoped.length && viewable.length) {
      ctx.state.ui.activeTopicId = viewable[0].topicId;
      scoped = viewable.filter((line) => line.topicId === ctx.state.ui.activeTopicId);
    }
    if (!scoped.some((line) => line.id === ctx.state.ui.activeTimelineId)) {
      ctx.state.ui.activeTimelineId = scoped[0]?.id || "";
    }
  }

  /** 選擇節點：索引查找 O(1)，其後重繪由 render 負責。 */
  function selectNode(node) {
    ctx.state.ui.selectedId = node.id;
    selectLine(node.timelineId);
    save();
    render(false);
  }

  /** 統計列只呈現目前判讀所需資訊；時間 O(T+L+N+E)，額外空間 O(1)。 */
  function renderStats(data) {
    let deletedCount = 0;
    if (app.signedIn) {
      [ctx.state.topics, ctx.state.timelines, ctx.state.nodes, ctx.state.links].forEach((collection) => {
        collection.forEach((item) => { if (item.deletedAt) deletedCount += 1; });
      });
    }
    refs.stats.innerHTML = [
      `<span><strong>${data.nodes.length}</strong> 個事件</span>`,
      `<span><strong>${data.lines.length}</strong> 條分支</span>`,
      data.hiddenPrivateCount ? "<span>私密分支已隱藏</span>" : "",
      deletedCount ? `<span>回收區 ${deletedCount}</span>` : "",
    ].filter(Boolean).join('<span class="map-stats-separator" aria-hidden="true">・</span>');
  }

  /** 套用平移縮放：時間／空間 O(1)。文字與卡片使用反向比例維持清晰。 */
  function applyTransform() {
    const layout = app.layout;
    if (!layout) return;
    const zoom = clamp(Number(ctx.state.ui.zoom || .85), C.MIN_ZOOM, C.MAX_ZOOM);
    ctx.state.ui.zoom = zoom;
    const panX = Math.round(ctx.state.ui.panX * 2) / 2;
    const panY = Math.round(ctx.state.ui.panY * 2) / 2;
    refs.scene.style.width = `${layout.sceneWidth}px`;
    refs.scene.style.minHeight = `${layout.sceneHeight}px`;
    refs.scene.style.setProperty("--map-zoom", String(zoom));
    refs.scene.style.setProperty("--map-inverse-zoom", String(1 / zoom));
    refs.scene.style.transform = `translate3d(${panX}px,${panY}px,0) scale(${zoom})`;
    refs.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    refs.viewport.dataset.zoomBand = zoom < .76 ? "compact" : "normal";
    refs.zoomOut.disabled = zoom <= C.MIN_ZOOM + .001;
    refs.zoomIn.disabled = zoom >= C.MAX_ZOOM - .001;
  }

  /** 分支來源路徑：時間／空間 O(H)。 */
  function renderBreadcrumb() {
    if (ctx.state.ui.viewMode === "all") {
      refs.breadcrumb.innerHTML = '<span class="map-breadcrumb-current">全域時空主幹</span>';
      return;
    }
    const path = timelinePath(ctx.state.ui.activeTimelineId);
    refs.breadcrumb.innerHTML = [
      '<button type="button" data-global-tree>全域主幹</button>',
      ...path.map((line, index) => `${index || path.length ? '<span aria-hidden="true">›</span>' : ""}<button type="button" data-focus-branch="${esc(line.id)}"${index === path.length - 1 ? ' aria-current="page"' : ""}>${esc(branchName(line))}</button>`),
    ].join("");
    refs.breadcrumb.querySelector("[data-global-tree]")?.addEventListener("click", () => {
      ctx.state.ui.viewMode = "all";
      ctx.state.ui.activeTopicId = "all";
      save();
      render(true);
    });
    refs.breadcrumb.querySelectorAll("[data-focus-branch]").forEach((button) => {
      button.addEventListener("click", () => {
        const lineId = button.dataset.focusBranch;
        ctx.state.ui.viewMode = "single";
        selectLine(lineId);
        save();
        render(true);
      });
    });
  }

  function createClusterElement(placement) {
    const button = document.createElement("button");
    const line = ctx.timelineIndex.get(placement.members[0]?.timelineId);
    button.type = "button";
    button.className = "map-node-cluster";
    button.style.left = `${placement.x}px`;
    button.style.top = `${placement.y}px`;
    button.style.setProperty("--theme-color", topicColor(line?.topicId));
    button.innerHTML = `<strong>${placement.members.length} 個事件</strong><span>${esc(truncate(placement.members.map((node) => node.title || C.TYPES[node.type]).join("、"), 28))}</span>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      TF.actions?.clusterModal(placement.members);
    });
    return button;
  }

  function createBandElement(placement) {
    const node = placement.node;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-period-band role-${node.role}${ctx.state.ui.selectedId === node.id ? " is-selected" : ""}`;
    button.style.left = `${placement.x}px`;
    button.style.top = `${placement.y}px`;
    button.style.width = `${placement.width}px`;
    button.style.height = `${placement.height}px`;
    button.innerHTML = `<span class="map-period-band-title">${esc(node.title || C.TYPES[node.type])}</span><span class="map-period-band-date">${esc(placement.range.label)}</span>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node);
    });
    return button;
  }

  function createNodeElement(placement) {
    const node = placement.node;
    const line = ctx.timelineIndex.get(node.timelineId);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.nodeId = node.id;
    button.className = `map-node ${node.type} role-${node.role} status-${node.status}${ctx.state.ui.selectedId === node.id ? " is-selected" : ""}`;
    button.style.left = `${placement.x}px`;
    button.style.top = `${placement.y}px`;
    button.style.setProperty("--theme-color", topicColor(line?.topicId));
    button.innerHTML = `
      <span class="map-node-header">
        <span class="map-node-type">${C.TYPES[node.type]}</span>
        ${node.role !== "normal" ? `<span class="map-node-role${node.role === "background" ? " is-background" : ""}">${C.ROLES[node.role]}</span>` : ""}
      </span>
      <span class="map-node-title">${esc(node.title || "未命名節點")}</span>
      <span class="map-node-meta">${esc(C.CATEGORIES[node.category] || "其他")}${node.subject ? `・${esc(node.subject)}` : ""}</span>
      <span class="map-node-preview">${esc(truncate(preview(node), 62))}</span>
      <span class="map-node-footer">
        <span class="map-node-status">${C.STATUSES[node.status]}</span>
        <span class="map-date-precision-pill">${esc(dateRange(node).label)}</span>
      </span>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node);
    });
    return button;
  }

  function renderBranchLabels(layout) {
    layout.rows.forEach((row) => {
      const button = document.createElement("button");
      const privateBranch = isTimelinePrivate(row.line.id);
      button.type = "button";
      button.dataset.branchId = row.line.id;
      button.className = `map-timeline-label-button${row.isVisualTrunk ? " is-visual-trunk" : ""}${privateBranch ? " is-private" : ""}`;
      button.style.setProperty("--branch-color", topicColor(row.line.topicId));
      const preferredLeft = row.branchOriginX + 14 * layout.inverseZoom;
      const maximumLeft = layout.sceneWidth - (TF.geometry.LABEL_W + 18) * layout.inverseZoom;
      button.style.left = `${Math.max(18 * layout.inverseZoom, Math.min(preferredLeft, maximumLeft))}px`;
      button.style.top = `${row.axisY - (TF.geometry.LABEL_H + 12) * layout.inverseZoom}px`;
      const sourceNode = row.line.parentNodeId ? ctx.nodeIndex.get(row.line.parentNodeId) : null;
      const sourceText = row.isVisualTrunk
        ? "目前的觀看主軸"
        : sourceNode
          ? `由「${sourceNode.title || "未命名節點"}」分出`
          : "由全域主幹分出";
      button.innerHTML = `<strong>${privateBranch ? '<span aria-label="僅自己可見">🔒</span> ' : ""}${esc(branchName(row.line))}</strong><span>${esc(sourceText)}・${row.nodeCount} 個事件${row.collapsedCount ? `・已收合 ${row.collapsedCount} 條下層分支` : ""}</span>`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectLine(row.line.id);
        save();
        render(false);
      });
      button.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        ctx.state.ui.viewMode = "single";
        selectLine(row.line.id);
        save();
        render(true);
      });
      refs.canvas.appendChild(button);
    });
  }

  /** SVG 關係線：時間 O(N + L + E)，空間 O(N + L + E)。 */
  function renderConnections(layout) {
    refs.connections.setAttribute("viewBox", `0 0 ${layout.sceneWidth} ${layout.sceneHeight}`);
    refs.connections.setAttribute("width", String(layout.sceneWidth));
    refs.connections.setAttribute("height", String(layout.sceneHeight));
    const svg = [];
    const labelY = layout.trunkY - 28 * layout.inverseZoom;
    layout.ticks.forEach((tick) => svg.push(
      `<line class="map-time-grid" x1="${tick.x}" y1="${layout.trunkY}" x2="${tick.x}" y2="${layout.sceneHeight - 24 * layout.inverseZoom}"/>`,
      `<line class="map-time-tick" x1="${tick.x}" y1="${layout.trunkY - 7 * layout.inverseZoom}" x2="${tick.x}" y2="${layout.trunkY + 7 * layout.inverseZoom}"/>`,
      `<text class="map-time-label" x="${tick.x}" y="${labelY}" text-anchor="middle">${esc(tick.label)}</text>`,
    ));
    svg.push(`<line class="map-global-trunk${layout.visualTrunkLineId ? " map-visual-trunk" : ""}" x1="${layout.axisStart}" y1="${layout.trunkY}" x2="${layout.axisEnd}" y2="${layout.trunkY}"/>`);

    layout.rows.forEach((row) => {
      if (row.isVisualTrunk) return;
      const color = rgba(topicColor(row.line.topicId), .78);
      svg.push(`<line class="map-branch-axis" x1="${row.branchStartX}" y1="${row.axisY}" x2="${row.branchEndX}" y2="${row.axisY}" style="stroke:${color}"/>`);
      if (row.branchStartX < row.branchOriginX) {
        svg.push(`<line class="map-branch-history" x1="${row.branchStartX}" y1="${row.axisY}" x2="${row.branchOriginX}" y2="${row.axisY}"/>`);
      }
      const midY = row.sourcePoint.y + (row.axisY - row.sourcePoint.y) * .54;
      svg.push(
        `<path class="map-branch-source" d="M ${row.sourcePoint.x} ${row.sourcePoint.y} C ${row.sourcePoint.x} ${midY},${row.branchOriginX} ${midY},${row.branchOriginX} ${row.axisY}"/>`,
        `<circle class="map-branch-origin" cx="${row.branchOriginX}" cy="${row.axisY}" r="${4.5 * layout.inverseZoom}"/>`,
      );
    });

    const anchored = new Set();
    layout.items.forEach((item) => {
      const key = item.kind === "cluster" ? item.members.map((node) => node.id).join(",") : item.node.id;
      if (anchored.has(key)) return;
      anchored.add(key);
      const background = item.kind !== "cluster" && item.node.role === "background";
      const endY = item.centerY < item.axisY ? item.y + item.height : item.y;
      svg.push(`<path class="map-node-anchor-line${background ? " is-background" : ""}" d="M ${item.centerX} ${endY} C ${item.centerX} ${(endY + item.axisY) / 2},${item.centerX} ${(endY + item.axisY) / 2},${item.centerX} ${item.axisY}"/>`);
    });

    const renderedLinks = new Set();
    ctx.state.links.forEach((link) => {
      if (link.deletedAt) return;
      const from = layout.placements.get(link.fromNodeId);
      const to = layout.placements.get(link.toNodeId);
      if (!from || !to || from === to) return;
      const key = [link.fromNodeId, link.toNodeId, link.type].sort().join(":");
      if (renderedLinks.has(key)) return;
      renderedLinks.add(key);
      const strength = Math.max(42 * layout.inverseZoom, .22 * Math.abs(to.centerX - from.centerX));
      svg.push(`<path class="map-virtual-link ${esc(link.type)}" d="M ${from.centerX} ${from.centerY} C ${from.centerX + strength} ${from.centerY},${to.centerX - strength} ${to.centerY},${to.centerX} ${to.centerY}"/>`);
    });
    refs.connections.innerHTML = svg.join("");
  }

  /** 畫布：時間 O(N + L + E)，空間 O(N + L + E)。 */
  function renderCanvas(data) {
    app.layout = buildLayout(data);
    const layout = app.layout;
    refs.canvas.replaceChildren();

    if (layout.hasUnknown) {
      const unknownZone = document.createElement("div");
      unknownZone.className = "map-unknown-zone";
      unknownZone.style.left = `${layout.unknownX}px`;
      unknownZone.style.top = `${layout.trunkY + 24 * layout.inverseZoom}px`;
      unknownZone.style.height = `${Math.max(200 * layout.inverseZoom, layout.sceneHeight - layout.trunkY - 60 * layout.inverseZoom)}px`;
      refs.canvas.appendChild(unknownZone);
      const unknownLabel = document.createElement("div");
      unknownLabel.className = "map-unknown-zone-label";
      unknownLabel.style.left = `${layout.unknownX + 16 * layout.inverseZoom}px`;
      unknownLabel.style.top = `${layout.trunkY - 28 * layout.inverseZoom}px`;
      unknownLabel.textContent = "日期不詳";
      refs.canvas.appendChild(unknownLabel);
    }

    renderBranchLabels(layout);
    layout.items.forEach((item) => {
      refs.canvas.appendChild(
        item.kind === "cluster" ? createClusterElement(item)
          : item.kind === "band" ? createBandElement(item)
            : createNodeElement(item)
      );
    });

    if (!data.lines.length || !data.nodes.length) {
      const empty = document.createElement("div");
      empty.className = "map-canvas-empty";
      empty.textContent = data.lines.length
        ? "目前篩選條件下沒有事件。"
        : app.signedIn
          ? "目前沒有可顯示的分支；若已隱藏私密分支，可從「篩選與檢視」重新顯示。"
          : "訪客不會取得僅自己可見的時間樹；請登入後查看。";
      refs.canvas.appendChild(empty);
    }
    renderConnections(layout);
  }

  function showDateFields(precision) {
    refs.dateFields.querySelectorAll("[data-date-field]").forEach((element) => {
      element.classList.toggle("hidden", element.dataset.dateField !== precision);
    });
  }

  /** 詳細資料：節點與連結查詢 O(N + E)，空間 O(N + E)。 */
  function renderDetails(data) {
    const node = selected();
    if (!node || node.deletedAt) {
      refs.emptyState.classList.remove("hidden");
      refs.detailForm.classList.add("hidden");
      return;
    }
    refs.emptyState.classList.add("hidden");
    refs.detailForm.classList.remove("hidden");
    refs.detailId.value = node.id;
    refs.selectedId.textContent = node.id;
    refs.detailTypeLabel.textContent = C.TYPES[node.type];
    refs.detailTitle.textContent = node.title || "未命名節點";
    refs.fieldTimeline.value = node.timelineId;
    refs.fieldType.value = node.type;
    refs.fieldRole.value = node.role;
    refs.fieldPrecision.value = node.precision;
    refs.fieldDateDay.value = node.precision === "day" ? node.dateValue : "";
    refs.fieldDateMonth.value = node.precision === "month" ? node.dateValue : "";
    refs.fieldDateYear.value = node.precision === "year" ? node.dateValue : "";
    refs.fieldTitle.value = node.title;
    refs.fieldCategory.value = node.category;
    refs.fieldSubject.value = node.subject;
    refs.fieldStatus.value = node.status;
    refs.fieldCards.value = node.cards;
    refs.fieldInterpretation.value = node.interpretation;
    refs.fieldPredictions.value = node.predictions;
    refs.fieldDescription.value = node.description;
    refs.fieldTags.value = node.tags.join(", ");
    refs.fieldNote.value = node.note;
    showDateFields(node.precision);
    const reading = node.type === "reading";
    document.querySelectorAll("[data-reading-only]").forEach((element) => element.classList.toggle("hidden", !reading));
    document.querySelectorAll("[data-description-field]").forEach((element) => element.classList.toggle("hidden", reading));

    const targets = activeNodes().filter(
      (item) => item.id !== node.id && data.lineIds.has(item.timelineId)
    );
    refs.linkTarget.innerHTML = `<option value="">選擇節點</option>${targets.map((item) => `<option value="${esc(item.id)}">${esc(branchName(ctx.timelineIndex.get(item.timelineId)))}｜${esc(item.title || C.TYPES[item.type])}</option>`).join("")}`;
    const links = ctx.state.links.filter((link) => {
      if (link.deletedAt || (link.fromNodeId !== node.id && link.toNodeId !== node.id)) return false;
      const targetId = link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId;
      const target = ctx.nodeIndex.get(targetId);
      return Boolean(target && data.lineIds.has(target.timelineId));
    });
    refs.linkList.innerHTML = links.length ? links.map((link) => {
      const targetId = link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId;
      const target = ctx.nodeIndex.get(targetId);
      return `<div class="map-link-item"><p><strong>${C.LINKS[link.type]}</strong>｜${esc(target?.title || "節點已刪除")}${link.note ? `<br>${esc(link.note)}` : ""}</p><button type="button" class="map-link-remove" data-remove-link="${esc(link.id)}">移除</button></div>`;
    }).join("") : '<p class="map-inline-help">尚未建立虛擬連結。</p>';
    refs.linkList.querySelectorAll("[data-remove-link]").forEach((button) => {
      button.addEventListener("click", () => TF.actions?.removeLink(button.dataset.removeLink));
    });
  }

  /** 編輯權限：時間 O(F)，空間 O(1)，F 為固定欄位數。 */
  function setEditing(signedIn) {
    app.signedIn = Boolean(signedIn);
    [
      refs.addRootBranch,
      refs.addReading,
      refs.addEvent,
      refs.addNote,
      refs.addChildTimeline,
      refs.manageTimeline,
      refs.openTrash,
      refs.exportJson,
      refs.deleteNode,
      refs.addLink,
      refs.resetData,
    ].forEach((element) => {
      element.disabled = !app.signedIn;
      element.title = app.signedIn ? "" : "請先從右上角登入 Google 帳號";
    });
    refs.showPrivate.disabled = !app.signedIn;
    refs.detailForm.querySelectorAll("input,select,textarea,button").forEach((element) => {
      if (element.id !== "map-detail-id") element.disabled = !app.signedIn;
    });
    refs.detailForm.classList.toggle("is-auth-readonly", !app.signedIn);
  }

  /** 可讀全景：時間 O(N log N + L log L)，空間 O(N + L)。必要時重排一次以維持卡片間距。 */
  function fit(persist = true) {
    const width = refs.viewport.clientWidth;
    const height = refs.viewport.clientHeight;
    let layout = app.layout;
    if (!width || !height || !layout) return;
    const target = clamp(Math.min(
      (width - 84) / Math.max(320, layout.sceneWidth),
      (height - 84) / Math.max(260, layout.sceneHeight),
      .96,
    ), C.MIN_ZOOM, C.MAX_ZOOM);
    const zoomChanged = Math.abs(target - ctx.state.ui.zoom) > .001;
    ctx.state.ui.zoom = target;
    if (zoomChanged) {
      TF.ui.render(false);
      layout = app.layout;
    }
    ctx.state.ui.panX = (width - layout.sceneWidth * target) / 2;
    ctx.state.ui.panY = (height - layout.sceneHeight * target) / 2;
    applyTransform();
    if (persist) save();
  }

  /** 控制項選單：時間 O(T + L + N)，空間 O(T + L + N)。 */
  function renderControls() {
    refs.viewMode.value = ctx.state.ui.viewMode;
    const focused = ctx.state.ui.viewMode === "single";
    refs.activeTimelineField.hidden = !focused;
    refs.activeTimeline.disabled = !focused;
    refs.filterStatus.value = ctx.state.ui.filterStatus;
    refs.search.value = ctx.state.ui.search;
    refs.showPrivate.checked = app.signedIn && ctx.state.ui.showPrivate !== false;

    const includePrivate = app.signedIn && ctx.state.ui.showPrivate !== false;
    const availableLines = activeTimelines().filter((line) => includePrivate || !isTimelinePrivate(line.id));
    const availableTopicIds = new Set(availableLines.map((line) => line.topicId));
    const topics = activeTopics().filter((topic) => availableTopicIds.has(topic.id));
    refs.activeTopic.innerHTML = [
      '<option value="all">全部分支群組</option>',
      ...topics.map((topic) => `<option value="${esc(topic.id)}">${esc(topic.title)}</option>`),
    ].join("");
    refs.activeTopic.value = ctx.state.ui.activeTopicId === "all" || availableTopicIds.has(ctx.state.ui.activeTopicId)
      ? ctx.state.ui.activeTopicId
      : "all";

    const ordered = orderTimelines(availableLines);
    refs.activeTimeline.innerHTML = ordered.map(({ line, depth }) => `<option value="${esc(line.id)}">${"　".repeat(depth)}${isTimelinePrivate(line.id) ? "🔒 " : ""}${esc(branchName(line))}</option>`).join("");
    refs.activeTimeline.value = ctx.state.ui.activeTimelineId;
    refs.fieldTimeline.innerHTML = ordered.map(({ line, depth }) => `<option value="${esc(line.id)}">${"　".repeat(depth)}${esc(branchName(line))}</option>`).join("");

    const usedCategories = new Set(activeNodes().map((node) => node.category));
    refs.filterCategory.innerHTML = [
      '<option value="all">全部分類</option>',
      ...Object.entries(C.CATEGORIES)
        .filter(([key]) => usedCategories.has(key) || ctx.state.ui.filterCategory === key)
        .map(([key, label]) => `<option value="${key}">${label}</option>`),
    ].join("");
    refs.filterCategory.value = ctx.state.ui.filterCategory;
  }

  /** 時間順序清單：時間 O(N log N + L)，空間 O(N + L)。 */
  function renderTimelineList(data) {
    if (!data.lines.length) {
      refs.timeline.innerHTML = '<p class="map-timeline-empty">目前沒有符合條件的分支。</p>';
      return;
    }
    const nodesByLine = new Map(data.lines.map((line) => [line.id, []]));
    data.nodes.forEach((node) => nodesByLine.get(node.timelineId)?.push(node));
    refs.timeline.innerHTML = data.lines.map((line) => `
      <section class="map-timeline-group">
        <div class="map-timeline-group-header"><h5>${isTimelinePrivate(line.id) ? "🔒 " : ""}${esc(branchName(line))}</h5><p>${esc(line.description || "未填分支說明")}</p></div>
        ${sortNodes(nodesByLine.get(line.id) || []).map((node) => `
          <article class="map-timeline-item ${node.type} role-${node.role}">
            <div class="map-timeline-top"><span class="map-node-type">${C.TYPES[node.type]}${node.role !== "normal" ? `・${C.ROLES[node.role]}` : ""}</span><span class="map-timeline-date">${esc(dateRange(node).label)}</span></div>
            <h5>${esc(node.title || "未命名節點")}</h5><p>${esc(truncate(preview(node), 145))}</p>
            <div class="map-timeline-footer"><span class="map-theme-pill">${esc(C.CATEGORIES[node.category])}</span><button type="button" class="map-timeline-open" data-open-node="${esc(node.id)}">查看內容</button></div>
          </article>`).join("") || '<p class="map-timeline-empty">此分支目前沒有符合篩選條件的事件。</p>'}
      </section>`).join("");
    refs.timeline.querySelectorAll("[data-open-node]").forEach((button) => {
      button.addEventListener("click", () => {
        const node = ctx.nodeIndex.get(button.dataset.openNode);
        if (!node) return;
        selectNode(node);
        refs.detailForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }

  /** 完整重繪：時間 O(N log N + L log L)，空間 O(N + L)。 */
  function render(shouldFit = false) {
    rebuildIndexes();
    ensureSelection();
    rebuildIndexes();
    ensureVisibleActiveLine();
    renderControls();
    const data = visibleData();
    const selectedNode = selected();
    if (selectedNode && !data.lineIds.has(selectedNode.timelineId)) ctx.state.ui.selectedId = "";
    renderStats(data);
    renderBreadcrumb();
    renderCanvas(data);
    renderDetails(data);
    renderTimelineList(data);
    setEditing(app.signedIn);
    applyTransform();
    if (shouldFit) window.requestAnimationFrame(() => fit(true));
  }

  TF.ui = {
    preview,
    selected,
    branchName,
    selectLine,
    ensureVisibleActiveLine,
    selectNode,
    showDateFields,
    renderStats,
    applyTransform,
    setEditing,
    fit,
    render,
    zoom(delta, clientX, clientY) {
      const oldZoom = ctx.state.ui.zoom;
      const nextZoom = clamp(oldZoom + delta, C.MIN_ZOOM, C.MAX_ZOOM);
      if (nextZoom === oldZoom) return;
      const rect = refs.viewport.getBoundingClientRect();
      const pointerX = clientX == null ? rect.width / 2 : clientX - rect.left;
      const pointerY = clientY == null ? rect.height / 2 : clientY - rect.top;
      const worldX = (pointerX - ctx.state.ui.panX) / oldZoom;
      const worldY = (pointerY - ctx.state.ui.panY) / oldZoom;
      ctx.state.ui.zoom = nextZoom;
      ctx.state.ui.panX = pointerX - worldX * nextZoom;
      ctx.state.ui.panY = pointerY - worldY * nextZoom;
      save();
      render(false);
    },
    auth(authState) {
      app.signedIn = Boolean(authState?.isSignedIn || window.EvanGoogleAuth?.isSignedIn?.());
      setEditing(app.signedIn);
      render(false);
      const hint = document.getElementById("map-auth-hint");
      if (!hint) return;
      if (app.signedIn) {
        hint.classList.add("is-signed-in");
      } else {
        hint.textContent = "訪客僅能瀏覽一般分支；登入 Google 帳號後讀取僅自己可見的資料。";
        hint.classList.remove("is-signed-in");
      }
    },
  };
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
