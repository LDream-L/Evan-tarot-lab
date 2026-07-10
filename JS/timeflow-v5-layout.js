// ==============================
// timeflow-v5-layout.js
// 主題時間流 v5：共用絕對時間、單線縮放與事件卡碰撞避讓
// ==============================
// 主要函式複雜度：
// - allocate：時間 O(n log k)，空間 O(k)，k 為同時重疊層數
// - buildLayout：時間 O(N log N + L log L)，空間 O(N+L)
//
// 更快替代方案比較：
// - 暴力法：每個項目由第 0 層開始逐層找空位，最壞 O(n²)。
// - 本實作：active min-heap 釋放已結束層級，available min-heap 重用最低層級，降為 O(n log k)。
// - 只提高 z-index 不會消除遮擋；固定卡片高度搭配一次排版，可避免二次 DOM 量測。
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
    clamp,
  } = TF;

  const G = Object.freeze({
    LEFT: 250,
    TOP: 76,
    UNKNOWN: 220,
    RIGHT: 70,
    CARD_W: 224,
    CARD_H: 148,
    CARD_LEVEL_GAP: 18,
    CLUSTER_W: 86,
    CLUSTER_H: 68,
    BAND_H: 42,
    TOPIC_GAP: 42,
    ROW_GAP: 26,
  });

  TF.geometry = G;

  /**
   * 將卡片視覺高度鎖定為排版引擎使用的 CARD_H。
   * 時間／空間複雜度 O(1)。
   */
  function injectCollisionStyles() {
    if (document.getElementById("timeflow-collision-layout-style")) return;

    const style = document.createElement("style");
    style.id = "timeflow-collision-layout-style";
    style.textContent = `
      .map-node {
        box-sizing: border-box;
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

      .map-node-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .map-node-preview {
        display: -webkit-box;
        min-height: 0;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
      }

      .map-node-footer {
        align-self: end;
      }
    `;
    document.head.appendChild(style);
  }

  function orderTimelines(lines) {
    const ids = new Set(lines.map((value) => value.id));
    const children = new Map();
    const roots = [];
    const sorted = lines
      .slice()
      .sort(
        (a, b) =>
          String(a.createdAt).localeCompare(String(b.createdAt)) ||
          a.title.localeCompare(b.title)
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

  /** 篩選：時間 O(T+L+N)，空間 O(L+N)。 */
  function visibleData() {
    const state = ctx.state;
    const keyword = state.ui.search.trim().toLowerCase();
    const lines = activeTimelines().filter(
      (line) => state.ui.activeTopicId === "all" || line.topicId === state.ui.activeTopicId
    );
    const visibleLines =
      state.ui.viewMode === "single"
        ? lines.filter((line) => line.id === state.ui.activeTimelineId)
        : lines;
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });

    return { lines: visibleLines, nodes };
  }

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
      const today = dayNumber(year, month, day);
      return { min: today - 15, max: today + 15 };
    }

    const pad = Math.max(5, Math.ceil(Math.max(1, max - min) * 0.045));
    return { min: min - pad, max: max + pad };
  }

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
        if (day >= min && day <= max) {
          output.push({ day, label: month === 1 ? `${year}/01` : `${month}月` });
        }
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
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

  /**
   * 依區間開始位置配置重疊層級。
   * 前提：items 已依 startKey 由小到大排序。
   * 時間複雜度 O(n log k)，空間複雜度 O(k)，k 為同時重疊層數。
   */
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

      const level = availableLevels.length
        ? heapPop(availableLevels, levelCompare)
        : nextLevel++;

      heapPush(active, { end, level }, activeCompare);
      output.push({ ...item, level });
    });

    return output;
  }

  function clusters(items) {
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    if (ctx.state.ui.zoom >= 0.78) {
      return sorted.map((item) => ({ members: [item], x: item.x }));
    }

    const threshold = 112 / Math.max(ctx.state.ui.zoom, C.MIN_ZOOM);
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

  /** 共用時間軸排版：時間 O(N log N + L log L)，空間 O(N+L)。 */
  function buildLayout(data) {
    const state = ctx.state;
    const dateDomain = domain(data.nodes);
    const span = Math.max(1, dateDomain.max - dateDomain.min);
    const width = clamp(span * (state.ui.viewMode === "single" ? 18 : 9), 980, 4200);
    const axisStart = G.LEFT;
    const axisEnd = axisStart + width;
    const unknownX = axisEnd + 74;
    const sceneWidth = unknownX + G.UNKNOWN + G.RIGHT;
    const cardStep = G.CARD_H + G.CARD_LEVEL_GAP;
    const xFor = (day) => axisStart + ((day - dateDomain.min) / span) * width;

    const nodesByLine = new Map(data.lines.map((line) => [line.id, []]));
    data.nodes.forEach((node) => {
      if (!nodesByLine.has(node.timelineId)) nodesByLine.set(node.timelineId, []);
      nodesByLine.get(node.timelineId).push(node);
    });

    const byTopic = new Map();
    data.lines.forEach((line) => {
      if (!byTopic.has(line.topicId)) byTopic.set(line.topicId, []);
      byTopic.get(line.topicId).push(line);
    });

    const rows = [];
    const topicHeadings = [];
    const items = [];
    const placements = new Map();
    let y = G.TOP;

    activeTopics()
      .filter((topic) => byTopic.has(topic.id))
      .forEach((topic) => {
        if (state.ui.viewMode === "all") {
          topicHeadings.push({ topic, y });
          y += G.TOPIC_GAP;
        }

        orderTimelines(byTopic.get(topic.id)).forEach(({ line, depth }) => {
          const exact = [];
          const periods = [];
          const unknown = [];

          (nodesByLine.get(line.id) || []).forEach((node) => {
            const range = dateRange(node);
            if (range.start == null) {
              unknown.push(node);
            } else if (node.precision === "day") {
              exact.push({ node, x: xFor(range.start), range });
            } else {
              periods.push({
                node,
                startX: xFor(range.start),
                endX: xFor(range.end),
                range,
              });
            }
          });

          const bands = allocate(
            periods.sort((a, b) => a.startX - b.startX),
            "startX",
            "endX",
            10
          );
          const bandLevels = bands.reduce(
            (maxLevel, item) => Math.max(maxLevel, item.level + 1),
            0
          );
          const axisY = y + 34 + bandLevels * 48;
          const grouped = clusters(exact);
          const singles = [];
          const groupedMany = [];

          grouped.forEach((group) =>
            (group.members.length > 1 ? groupedMany : singles).push(
              group.members.length > 1 ? group : group.members[0]
            )
          );

          const intervals = [
            ...singles.map((item) => ({
              ...item,
              startX: item.x - G.CARD_W / 2,
              endX: item.x + G.CARD_W / 2,
              kind: "node",
            })),
            ...groupedMany.map((item) => ({
              ...item,
              startX: item.x - G.CLUSTER_W / 2,
              endX: item.x + G.CLUSTER_W / 2,
              kind: "cluster",
            })),
          ].sort((a, b) => a.startX - b.startX);

          const cards = allocate(intervals, "startX", "endX", 14);
          const levels = cards.reduce(
            (maxLevel, item) => Math.max(maxLevel, item.level + 1),
            0
          );
          const lowerLevels = Math.max(levels, unknown.length, 1);
          const rowHeight = 34 + bandLevels * 48 + 54 + lowerLevels * cardStep;
          const row = {
            line,
            topic,
            depth,
            topY: y,
            axisY,
            bottomY: y + rowHeight,
            nodeCount: (nodesByLine.get(line.id) || []).length,
          };
          rows.push(row);

          bands.forEach((item) => {
            const itemWidth = Math.max(88, item.endX - item.startX);
            const placement = {
              kind: "band",
              node: item.node,
              x: item.startX,
              y: y + item.level * 48,
              width: itemWidth,
              height: G.BAND_H,
              centerX: item.startX + itemWidth / 2,
              centerY: y + item.level * 48 + G.BAND_H / 2,
              axisY,
              range: item.range,
            };
            items.push(placement);
            placements.set(item.node.id, placement);
          });

          cards.forEach((item) => {
            const itemY = axisY + 34 + item.level * cardStep;
            if (item.kind === "cluster") {
              const placement = {
                kind: "cluster",
                members: item.members.map((member) => member.node),
                x: item.x - G.CLUSTER_W / 2,
                y: itemY,
                width: G.CLUSTER_W,
                height: G.CLUSTER_H,
                centerX: item.x,
                centerY: itemY + G.CLUSTER_H / 2,
                axisY,
              };
              items.push(placement);
              placement.members.forEach((node) => placements.set(node.id, placement));
            } else {
              const placement = {
                kind: "node",
                node: item.node,
                x: item.x - G.CARD_W / 2,
                y: itemY,
                width: G.CARD_W,
                height: G.CARD_H,
                centerX: item.x,
                centerY: itemY + G.CARD_H / 2,
                axisY,
                range: item.range,
              };
              items.push(placement);
              placements.set(item.node.id, placement);
            }
          });

          unknown.forEach((node, index) => {
            const itemY = axisY + 34 + index * cardStep;
            const placement = {
              kind: "node",
              node,
              x: unknownX + 18,
              y: itemY,
              width: G.CARD_W,
              height: G.CARD_H,
              centerX: unknownX + 18 + G.CARD_W / 2,
              centerY: itemY + G.CARD_H / 2,
              axisY,
              range: dateRange(node),
            };
            items.push(placement);
            placements.set(node.id, placement);
          });

          y += rowHeight + G.ROW_GAP;
        });
      });

    const sceneHeight = Math.max(820, (rows.length ? y : 700) + 40);
    return {
      sceneWidth,
      sceneHeight,
      axisStart,
      axisEnd,
      unknownX,
      minDay: dateDomain.min,
      maxDay: dateDomain.max,
      ticks: ticks(dateDomain.min, dateDomain.max).map((tick) => ({
        ...tick,
        x: xFor(tick.day),
      })),
      rows,
      topicHeadings,
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
