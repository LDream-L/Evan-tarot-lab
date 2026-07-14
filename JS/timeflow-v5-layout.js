// ==============================
// timeflow-v5-layout.js
// 時間樹 v6：全域單一主幹、遞迴分支與聚焦視角
// ==============================
// 主要函式複雜度：
// - visibleData：時間 O(L + N + L·H)，空間 O(L + N)，H 為實際祖先深度
// - allocate：時間 O(n log k)，空間 O(k)，k 為同時重疊層數
// - buildLayout：時間 O(N log N + L log L)，空間 O(N + L)
//
// 更快替代方案比較：
// - 舊排版替每個案例畫一條全寬主軸，雖易實作，卻重複日期尺並浪費畫布。
// - 本版只保留一條全域主幹；每條分支由來源節點開始，線段只延伸到必要日期。
// - 暴力碰撞避讓最壞 O(n²)；本版以兩個 min-heap 重用層級，降為 O(n log k)。
// ==============================
(function initTimeflowLayout(TF) {
  "use strict";

  const {
    ctx,
    C,
    activeTopics,
    activeTimelines,
    activeNodes,
    dateRange,
    dayNumber,
    dayParts,
    parentLineId,
    descendants,
    isTimelinePrivate,
    clamp,
  } = TF;

  const G = Object.freeze({
    LEFT: 250,
    TOP: 104,
    UNKNOWN: 220,
    RIGHT: 70,
    CARD_W: 224,
    CARD_H: 148,
    CARD_LEVEL_GAP: 18,
    CLUSTER_W: 132,
    CLUSTER_H: 88,
    BAND_H: 42,
    BAND_GAP: 8,
    LABEL_W: 238,
    LABEL_H: 70,
    ROOT_BRANCH_OFFSET: 112,
    ROW_GAP: 26,
  });

  TF.geometry = G;

  /** 固定卡片內部高度；時間／空間 O(1)。 */
  function injectCollisionStyles() {
    if (document.getElementById("timeflow-collision-layout-style")) return;
    const style = document.createElement("style");
    style.id = "timeflow-collision-layout-style";
    style.textContent = `
      .map-node {
        box-sizing: border-box;
        width: ${G.CARD_W}px;
        height: ${G.CARD_H}px;
        min-height: ${G.CARD_H}px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto auto minmax(0, 1fr) auto;
        align-content: stretch;
      }
      .map-node-title {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }
      .map-node-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .map-node-preview {
        display: -webkit-box;
        min-height: 0;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
      }
      .map-node-footer { align-self: end; }
    `;
    document.head.appendChild(style);
  }

  /** 分支拓樸排序；時間 O(L log L)，空間 O(L)。 */
  function orderTimelines(lines) {
    const ids = new Set(lines.map((value) => value.id));
    const children = new Map();
    const roots = [];
    const sorted = lines.slice().sort(
      (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.title.localeCompare(b.title)
    );

    sorted.forEach((line) => {
      const parent = parentLineId(line);
      if (parent && ids.has(parent) && parent !== line.id) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(line);
      } else {
        roots.push(line);
      }
    });

    const result = [];
    const seen = new Set();
    const visit = (line, depth) => {
      if (seen.has(line.id)) return;
      seen.add(line.id);
      result.push({ line, depth });
      (children.get(line.id) || []).forEach((child) => visit(child, depth + 1));
    };

    roots.forEach((line) => visit(line, 0));
    sorted.forEach((line) => visit(line, 0));
    return result;
  }

  /** 判斷是否被祖先的「收合下層」隱藏；時間 O(H)，空間 O(H)。 */
  function hiddenByCollapsedAncestor(lineId, candidateIds) {
    const seen = new Set();
    let cursor = ctx.parentTimelineByTimelineId.get(lineId) || "";
    while (cursor && candidateIds.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      if (ctx.timelineIndex.get(cursor)?.collapsed) return true;
      cursor = ctx.parentTimelineByTimelineId.get(cursor) || "";
    }
    return false;
  }

  /** 篩選目前視角；時間 O(L + N + L·H)，空間 O(L + N)。 */
  function visibleData() {
    const state = ctx.state;
    const keyword = state.ui.search.trim().toLowerCase();
    const ownerCanSeePrivate = Boolean(TF.app?.signedIn) && state.ui.showPrivate !== false;
    const topicScoped = state.ui.viewMode === "all" || state.ui.activeTopicId === "all"
      ? activeTimelines()
      : activeTimelines().filter((line) => line.topicId === state.ui.activeTopicId);
    const privacyScoped = topicScoped.filter(
      (line) => ownerCanSeePrivate || !isTimelinePrivate(line.id)
    );
    const focusIds = state.ui.viewMode === "single"
      ? descendants(state.ui.activeTimelineId)
      : null;
    const candidates = focusIds
      ? privacyScoped.filter((line) => focusIds.has(line.id))
      : privacyScoped;
    const candidateIds = new Set(candidates.map((line) => line.id));
    const visibleLines = candidates.filter(
      (line) => !hiddenByCollapsedAncestor(line.id, candidateIds)
    );
    const lineIds = new Set(visibleLines.map((line) => line.id));

    const nodes = activeNodes().filter((node) => {
      if (!lineIds.has(node.timelineId)) return false;
      if (state.ui.filterStatus !== "all" && node.status !== state.ui.filterStatus) return false;
      if (state.ui.filterCategory !== "all" && node.category !== state.ui.filterCategory) return false;
      if (!keyword) return true;
      const line = ctx.timelineIndex.get(node.timelineId);
      const topic = ctx.topicIndex.get(line?.topicId);
      return [
        node.title,
        node.subject,
        node.cards,
        node.interpretation,
        node.predictions,
        node.description,
        node.note,
        node.tags.join(" "),
        node.dateValue,
        line?.title,
        topic?.title,
      ].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });

    const collapsedCounts = new Map();
    visibleLines.forEach((line) => {
      if (!line.collapsed) return;
      let count = 0;
      descendants(line.id).forEach((childId) => {
        if (childId !== line.id && candidateIds.has(childId)) count += 1;
      });
      collapsedCounts.set(line.id, count);
    });

    return {
      lines: visibleLines,
      nodes,
      lineIds,
      collapsedCounts,
      hiddenPrivateCount: Boolean(TF.app?.signedIn) && !ownerCanSeePrivate
        ? topicScoped.filter((line) => isTimelinePrivate(line.id)).length
        : 0,
    };
  }

  /** 日期範圍：時間 O(N)，空間 O(1)。 */
  function domain(nodes) {
    let min = Infinity;
    let max = -Infinity;
    nodes.forEach((node) => {
      const range = dateRange(node);
      if (range.start == null) return;
      min = Math.min(min, range.start);
      max = Math.max(max, range.end);
    });

    if (!Number.isFinite(min)) {
      const [year, month, day] = TF.today().split("-").map(Number);
      const current = dayNumber(year, month, day);
      return { min: current - 15, max: current + 15 };
    }
    const pad = Math.max(5, Math.ceil(Math.max(1, max - min) * 0.045));
    return { min: min - pad, max: max + pad };
  }

  /** 日期刻度：時間 O(K)，空間 O(K)。 */
  function ticks(min, max) {
    const span = Math.max(1, max - min);
    const start = dayParts(min);
    const end = dayParts(max);
    const output = [];
    if (span <= 95) {
      for (let day = min - (min % 7); day <= max; day += 7) {
        const parts = dayParts(day);
        output.push({ day, label: `${parts.month}/${parts.day}` });
      }
      return output;
    }
    if (span <= 900) {
      let year = start.year;
      let month = start.month;
      while (year < end.year || (year === end.year && month <= end.month)) {
        const day = dayNumber(year, month, 1);
        if (day >= min && day <= max) output.push({ day, label: month === 1 ? `${year}/01` : `${month}月` });
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      return output;
    }
    for (let year = start.year; year <= end.year; year += 1) {
      const day = dayNumber(year, 1, 1);
      if (day >= min && day <= max) output.push({ day, label: String(year) });
    }
    return output;
  }

  /** 二元 min-heap push：時間 O(log n)，空間 O(1)。 */
  function heapPush(heap, value, compare) {
    heap.push(value);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[parent], value) <= 0) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = value;
  }

  /** 二元 min-heap pop：時間 O(log n)，空間 O(1)。 */
  function heapPop(heap, compare) {
    if (!heap.length) return undefined;
    const first = heap[0];
    const last = heap.pop();
    if (!heap.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      let child = left;
      if (right < heap.length && compare(heap[right], heap[left]) < 0) child = right;
      if (compare(heap[child], last) >= 0) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  }

  /** 區間層級配置：時間 O(n log k)，空間 O(k)。 */
  function allocate(items, startKey, endKey, gap) {
    const active = [];
    const availableLevels = [];
    const activeCompare = (a, b) => a.end - b.end || a.level - b.level;
    const levelCompare = (a, b) => a - b;
    const output = [];
    let nextLevel = 0;
    items.forEach((item) => {
      const start = Number(item[startKey]);
      const end = Number(item[endKey]);
      while (active.length && start > active[0].end + gap) {
        const released = heapPop(active, activeCompare);
        heapPush(availableLevels, released.level, levelCompare);
      }
      const level = availableLevels.length ? heapPop(availableLevels, levelCompare) : nextLevel++;
      heapPush(active, { end, level }, activeCompare);
      output.push({ ...item, level });
    });
    return output;
  }

  /** 縮放聚合：時間 O(N log N)，空間 O(N)。 */
  function clusters(items, inverseZoom) {
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    if (ctx.state.ui.zoom >= 0.82) return sorted.map((item) => ({ members: [item], x: item.x }));
    const threshold = (G.CARD_W + 20) * inverseZoom;
    const groups = [];
    let current = null;
    sorted.forEach((item) => {
      if (!current || item.x - current.last > threshold) {
        current = { members: [item], last: item.x };
        groups.push(current);
      } else {
        current.members.push(item);
        current.last = item.x;
      }
    });
    return groups.map((group) => ({
      members: group.members,
      x: group.members.reduce((sum, item) => sum + item.x, 0) / group.members.length,
    }));
  }

  /** 單一主幹排版：時間 O(N log N + L log L)，空間 O(N + L)。 */
  function buildLayout(data) {
    const state = ctx.state;
    const inverseZoom = 1 / clamp(state.ui.zoom || .85, C.MIN_ZOOM, C.MAX_ZOOM);
    const dateDomain = domain(data.nodes);
    const span = Math.max(1, dateDomain.max - dateDomain.min);
    const width = clamp(span * (state.ui.viewMode === "single" ? 18 : 10), 980, 4400);
    const axisStart = Math.max(G.LEFT, (G.LABEL_W + 52) * inverseZoom);
    const axisEnd = axisStart + width;
    const hasUnknown = data.nodes.some((node) => dateRange(node).start == null);
    const unknownX = hasUnknown ? axisEnd + 74 * inverseZoom : axisEnd;
    const datedRightPadding = Math.max(G.RIGHT, G.CARD_W / 2 + 28);
    const sceneWidth = hasUnknown
      ? unknownX + (G.UNKNOWN + G.RIGHT) * inverseZoom
      : axisEnd + datedRightPadding * inverseZoom;
    const xFor = (day) => axisStart + ((day - dateDomain.min) / span) * width;
    const trunkY = G.TOP * inverseZoom;

    const nodesByLine = new Map(data.lines.map((line) => [line.id, []]));
    data.nodes.forEach((node) => {
      if (!nodesByLine.has(node.timelineId)) nodesByLine.set(node.timelineId, []);
      nodesByLine.get(node.timelineId).push(node);
    });

    const rows = [];
    const items = [];
    const placements = new Map();
    const ordered = orderTimelines(data.lines);
    const visualTrunkLineId = state.ui.viewMode === "single" && data.lines.some((line) => line.id === state.ui.activeTimelineId)
      ? state.ui.activeTimelineId
      : "";
    let nextAxisY = visualTrunkLineId ? trunkY : trunkY + G.ROOT_BRANCH_OFFSET * inverseZoom;

    ordered.forEach(({ line, depth }, orderIndex) => {
      const rowItemStart = items.length;
      const isVisualTrunk = line.id === visualTrunkLineId && orderIndex === 0;
      const axisY = isVisualTrunk ? trunkY : nextAxisY;
      const exact = [];
      const periods = [];
      const unknown = [];
      const lineNodes = nodesByLine.get(line.id) || [];

      lineNodes.forEach((node) => {
        const range = dateRange(node);
        if (range.start == null) unknown.push(node);
        else if (node.precision === "day") exact.push({ node, x: xFor(range.start), range });
        else periods.push({ node, startX: xFor(range.start), endX: xFor(range.end), range });
      });

      const bandMinWidth = 88 * inverseZoom;
      const bands = allocate(
        periods.map((item) => ({ ...item, endX: Math.max(item.endX, item.startX + bandMinWidth) }))
          .sort((a, b) => a.startX - b.startX),
        "startX",
        "endX",
        10 * inverseZoom
      );
      const bandLevels = bands.reduce((max, item) => Math.max(max, item.level + 1), 0);
      const grouped = clusters(exact, inverseZoom);
      const cardWorldW = G.CARD_W * inverseZoom;
      const cardWorldH = G.CARD_H * inverseZoom;
      const clusterWorldW = G.CLUSTER_W * inverseZoom;
      const clusterWorldH = G.CLUSTER_H * inverseZoom;
      const intervals = grouped.map((group) => {
        const multiple = group.members.length > 1;
        const itemWidth = multiple ? clusterWorldW : cardWorldW;
        return {
          ...group,
          kind: multiple ? "cluster" : "node",
          startX: group.x - itemWidth / 2,
          endX: group.x + itemWidth / 2,
        };
      }).sort((a, b) => a.startX - b.startX);
      const cards = allocate(intervals, "startX", "endX", 14 * inverseZoom);
      const cardLevels = cards.reduce((max, item) => Math.max(max, item.level + 1), 0);
      const contentStart = axisY + 28 * inverseZoom;
      const bandStep = (G.BAND_H + G.BAND_GAP) * inverseZoom;
      const cardStart = contentStart + bandLevels * bandStep + (bandLevels ? 12 * inverseZoom : 0);
      const cardStep = (G.CARD_H + G.CARD_LEVEL_GAP) * inverseZoom;

      bands.forEach((item) => {
        const placement = {
          kind: "band",
          node: item.node,
          x: item.startX,
          y: contentStart + item.level * bandStep,
          width: Math.max(bandMinWidth, item.endX - item.startX),
          height: G.BAND_H * inverseZoom,
          centerX: item.startX + Math.max(bandMinWidth, item.endX - item.startX) / 2,
          centerY: contentStart + item.level * bandStep + G.BAND_H * inverseZoom / 2,
          axisY,
          range: item.range,
        };
        items.push(placement);
        placements.set(item.node.id, placement);
      });

      cards.forEach((item) => {
        const itemY = cardStart + item.level * cardStep;
        if (item.kind === "cluster") {
          const placement = {
            kind: "cluster",
            members: item.members.map((member) => member.node),
            x: item.x - clusterWorldW / 2,
            y: itemY,
            width: clusterWorldW,
            height: clusterWorldH,
            centerX: item.x,
            centerY: itemY + clusterWorldH / 2,
            axisY,
          };
          items.push(placement);
          placement.members.forEach((node) => placements.set(node.id, placement));
        } else {
          const source = item.members[0];
          const placement = {
            kind: "node",
            node: source.node,
            x: item.x - cardWorldW / 2,
            y: itemY,
            width: cardWorldW,
            height: cardWorldH,
            centerX: item.x,
            centerY: itemY + cardWorldH / 2,
            axisY,
            range: source.range,
          };
          items.push(placement);
          placements.set(source.node.id, placement);
        }
      });

      unknown.forEach((node, index) => {
        const itemY = cardStart + index * cardStep;
        const placement = {
          kind: "node",
          node,
          x: unknownX + 18 * inverseZoom,
          y: itemY,
          width: cardWorldW,
          height: cardWorldH,
          centerX: unknownX + 18 * inverseZoom + cardWorldW / 2,
          centerY: itemY + cardWorldH / 2,
          axisY,
          range: dateRange(node),
        };
        items.push(placement);
        placements.set(node.id, placement);
      });

      let sourceX = axisStart;
      let sourceY = trunkY;
      if (!isVisualTrunk && line.parentNodeId) {
        const parentPlacement = placements.get(line.parentNodeId);
        const parentNode = ctx.nodeIndex.get(line.parentNodeId);
        const parentRange = parentNode ? dateRange(parentNode) : null;
        sourceX = parentPlacement?.centerX
          ?? (parentRange?.start == null ? axisStart : xFor(parentRange.start));
        sourceY = parentPlacement ? parentPlacement.y + parentPlacement.height : trunkY;
      } else if (!isVisualTrunk) {
        let earliestStart = Infinity;
        lineNodes.forEach((node) => {
          const start = dateRange(node).start;
          if (Number.isFinite(start) && start < earliestStart) earliestStart = start;
        });
        sourceX = Number.isFinite(earliestStart)
          ? xFor(earliestStart)
          : axisStart + 44 * inverseZoom;
        sourceY = trunkY;
      }

      let earliestCenter = sourceX;
      let latestCenter = sourceX;
      lineNodes.forEach((node) => {
        if (!Number.isFinite(dateRange(node).start)) return;
        const centerX = placements.get(node.id)?.centerX;
        if (!Number.isFinite(centerX)) return;
        earliestCenter = Math.min(earliestCenter, centerX);
        latestCenter = Math.max(latestCenter, centerX);
      });
      const branchMinX = isVisualTrunk
        ? axisStart
        : earliestCenter;
      const branchEndX = isVisualTrunk
        ? axisEnd
        : Math.min(axisEnd, Math.max(sourceX + 150 * inverseZoom, latestCenter));
      let rowBottom = axisY + 86 * inverseZoom;
      for (let index = rowItemStart; index < items.length; index += 1) {
        rowBottom = Math.max(rowBottom, items[index].y + items[index].height);
      }

      rows.push({
        line,
        depth,
        axisY,
        topY: axisY - G.LABEL_H * inverseZoom,
        bottomY: rowBottom,
        nodeCount: lineNodes.length,
        collapsedCount: data.collapsedCounts?.get(line.id) || 0,
        isVisualTrunk,
        branchStartX: branchMinX,
        branchOriginX: sourceX,
        branchEndX,
        sourcePoint: { x: sourceX, y: sourceY },
      });
      nextAxisY = rowBottom + (G.ROW_GAP + G.LABEL_H) * inverseZoom;
    });

    const sceneHeight = Math.max(620 * inverseZoom, (rows.length ? nextAxisY : trunkY + 420 * inverseZoom));
    return {
      sceneWidth,
      sceneHeight,
      axisStart,
      axisEnd,
      unknownX,
      hasUnknown,
      trunkY,
      visualTrunkLineId,
      inverseZoom,
      minDay: dateDomain.min,
      maxDay: dateDomain.max,
      ticks: ticks(dateDomain.min, dateDomain.max).map((tick) => ({ ...tick, x: xFor(tick.day) })),
      rows,
      topicHeadings: [],
      items,
      placements,
      visibleLineIds: new Set(data.lines.map((line) => line.id)),
      bounds: { left: 0, top: 0, right: sceneWidth, bottom: sceneHeight },
    };
  }

  injectCollisionStyles();
  Object.assign(TF, {
    orderTimelines,
    visibleData,
    buildLayout,
    allocateLevels: allocate,
    heapPush,
    heapPop,
  });
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
