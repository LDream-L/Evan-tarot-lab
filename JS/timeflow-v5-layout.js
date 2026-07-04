// ==============================
// timeflow-v5-layout.js
// 主題時間流 v5：共用絕對時間與單線縮放排版
// ==============================
// buildLayout：時間 O(N log N + L log L)，空間 O(N+L)。
// 快速方案：依日期排序後以「每層最後終點」配置，避免逐節點碰撞檢查 O(N²)。
(function initTimeflowLayout(TF) {
  "use strict";
  const { ctx, C, activeTopics, activeTimelines, activeNodes, dateRange, dayNumber, dayParts, parentLineId, clamp } = TF;
  const G = Object.freeze({ LEFT: 250, TOP: 76, UNKNOWN: 220, RIGHT: 70, CARD_W: 224, CARD_H: 108, CLUSTER_W: 86, CLUSTER_H: 68, BAND_H: 42, TOPIC_GAP: 42, ROW_GAP: 26 });
  TF.geometry = G;

  function orderTimelines(lines) {
    const ids = new Set(lines.map((v) => v.id)), children = new Map(), roots = [];
    const sorted = lines.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.title.localeCompare(b.title));
    sorted.forEach((line) => {
      const parent = parentLineId(line);
      if (parent && ids.has(parent) && parent !== line.id) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(line); }
      else roots.push(line);
    });
    const result = [], seen = new Set();
    const visit = (line, depth) => { if (seen.has(line.id)) return; seen.add(line.id); result.push({ line, depth }); (children.get(line.id) || []).forEach((v) => visit(v, depth + 1)); };
    roots.forEach((v) => visit(v, 0)); sorted.forEach((v) => visit(v, 0));
    return result;
  }

  /** 篩選：時間 O(T+L+N)，空間 O(L+N)。 */
  function visibleData() {
    const s = ctx.state, keyword = s.ui.search.trim().toLowerCase();
    const lines = activeTimelines().filter((line) => s.ui.activeTopicId === "all" || line.topicId === s.ui.activeTopicId);
    const visibleLines = s.ui.viewMode === "single" ? lines.filter((line) => line.id === s.ui.activeTimelineId) : lines;
    const lineIds = new Set(visibleLines.map((v) => v.id));
    const nodes = activeNodes().filter((node) => {
      if (!lineIds.has(node.timelineId)) return false;
      if (s.ui.filterStatus !== "all" && node.status !== s.ui.filterStatus) return false;
      if (s.ui.filterCategory !== "all" && node.category !== s.ui.filterCategory) return false;
      if (!keyword) return true;
      const line = ctx.timelineIndex.get(node.timelineId), topic = ctx.topicIndex.get(line?.topicId);
      return [node.title, node.subject, node.cards, node.interpretation, node.predictions, node.description, node.note, node.tags.join(" "), node.dateValue, line?.title, topic?.title].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
    return { lines: visibleLines, nodes };
  }

  function domain(nodes) {
    let min = Infinity, max = -Infinity;
    nodes.forEach((node) => { const r = dateRange(node); if (r.start == null) return; min = Math.min(min, r.start); max = Math.max(max, r.end); });
    if (!Number.isFinite(min)) { const [y, m, d] = TF.today().split("-").map(Number), n = dayNumber(y, m, d); return { min: n - 15, max: n + 15 }; }
    const pad = Math.max(5, Math.ceil(Math.max(1, max - min) * .045)); return { min: min - pad, max: max + pad };
  }

  function ticks(min, max) {
    const span = Math.max(1, max - min), start = dayParts(min), end = dayParts(max), out = [];
    if (span <= 95) { for (let n = min - (min % 7); n <= max; n += 7) { const p = dayParts(n); out.push({ day: n, label: `${p.month}/${p.day}` }); } return out; }
    if (span <= 900) {
      let y = start.year, m = start.month;
      while (y < end.year || (y === end.year && m <= end.month)) { const n = dayNumber(y, m, 1); if (n >= min && n <= max) out.push({ day: n, label: m === 1 ? `${y}/01` : `${m}月` }); if (++m > 12) { m = 1; y += 1; } }
      return out;
    }
    for (let y = start.year; y <= end.year; y += 1) { const n = dayNumber(y, 1, 1); if (n >= min && n <= max) out.push({ day: n, label: String(y) }); }
    return out;
  }

  function allocate(items, startKey, endKey, gap) {
    const ends = [];
    return items.map((item) => { let level = 0; while (level < ends.length && item[startKey] <= ends[level] + gap) level += 1; if (level === ends.length) ends.push(item[endKey]); else ends[level] = item[endKey]; return { ...item, level }; });
  }

  function clusters(items) {
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    if (ctx.state.ui.zoom >= .78) return sorted.map((v) => ({ members: [v], x: v.x }));
    const threshold = 112 / Math.max(ctx.state.ui.zoom, C.MIN_ZOOM), groups = [];
    let current = null;
    sorted.forEach((item) => { if (!current || item.x - current.last > threshold) { current = { members: [item], last: item.x }; groups.push(current); } else { current.members.push(item); current.last = item.x; } });
    return groups.map((g) => ({ members: g.members, x: g.members.reduce((sum, v) => sum + v.x, 0) / g.members.length }));
  }

  /** 共用時間軸排版：時間 O(N log N + L log L)，空間 O(N+L)。 */
  function buildLayout(data) {
    const s = ctx.state, d = domain(data.nodes), span = Math.max(1, d.max - d.min);
    const width = clamp(span * (s.ui.viewMode === "single" ? 18 : 9), 980, 4200);
    const axisStart = G.LEFT, axisEnd = axisStart + width, unknownX = axisEnd + 74, sceneWidth = unknownX + G.UNKNOWN + G.RIGHT;
    const xFor = (n) => axisStart + ((n - d.min) / span) * width;
    const nodesByLine = new Map(data.lines.map((line) => [line.id, []]));
    data.nodes.forEach((node) => { if (!nodesByLine.has(node.timelineId)) nodesByLine.set(node.timelineId, []); nodesByLine.get(node.timelineId).push(node); });
    const byTopic = new Map(); data.lines.forEach((line) => { if (!byTopic.has(line.topicId)) byTopic.set(line.topicId, []); byTopic.get(line.topicId).push(line); });
    const rows = [], topicHeadings = [], items = [], placements = new Map(); let y = G.TOP;
    activeTopics().filter((topic) => byTopic.has(topic.id)).forEach((topic) => {
      if (s.ui.viewMode === "all") { topicHeadings.push({ topic, y }); y += G.TOPIC_GAP; }
      orderTimelines(byTopic.get(topic.id)).forEach(({ line, depth }) => {
        const exact = [], periods = [], unknown = [];
        (nodesByLine.get(line.id) || []).forEach((node) => { const r = dateRange(node); if (r.start == null) unknown.push(node); else if (node.precision === "day") exact.push({ node, x: xFor(r.start), range: r }); else periods.push({ node, startX: xFor(r.start), endX: xFor(r.end), range: r }); });
        const bands = allocate(periods.sort((a, b) => a.startX - b.startX), "startX", "endX", 10), bandLevels = bands.reduce((m, v) => Math.max(m, v.level + 1), 0);
        const axisY = y + 34 + bandLevels * 48, grouped = clusters(exact), singles = [], groupedMany = [];
        grouped.forEach((g) => (g.members.length > 1 ? groupedMany : singles).push(g.members.length > 1 ? g : g.members[0]));
        const intervals = [...singles.map((v) => ({ ...v, startX: v.x - G.CARD_W / 2, endX: v.x + G.CARD_W / 2, kind: "node" })), ...groupedMany.map((v) => ({ ...v, startX: v.x - G.CLUSTER_W / 2, endX: v.x + G.CLUSTER_W / 2, kind: "cluster" }))].sort((a, b) => a.startX - b.startX);
        const cards = allocate(intervals, "startX", "endX", 14), levels = cards.reduce((m, v) => Math.max(m, v.level + 1), 0), lower = Math.max(levels, unknown.length, 1);
        const rowHeight = 34 + bandLevels * 48 + 54 + lower * 118;
        const row = { line, topic, depth, topY: y, axisY, bottomY: y + rowHeight, nodeCount: (nodesByLine.get(line.id) || []).length }; rows.push(row);
        bands.forEach((v) => { const w = Math.max(88, v.endX - v.startX), p = { kind: "band", node: v.node, x: v.startX, y: y + v.level * 48, width: w, height: G.BAND_H, centerX: v.startX + w / 2, centerY: y + v.level * 48 + G.BAND_H / 2, axisY, range: v.range }; items.push(p); placements.set(v.node.id, p); });
        cards.forEach((v) => {
          if (v.kind === "cluster") { const p = { kind: "cluster", members: v.members.map((m) => m.node), x: v.x - G.CLUSTER_W / 2, y: axisY + 34 + v.level * 118, width: G.CLUSTER_W, height: G.CLUSTER_H, centerX: v.x, centerY: axisY + 34 + v.level * 118 + G.CLUSTER_H / 2, axisY }; items.push(p); p.members.forEach((n) => placements.set(n.id, p)); }
          else { const p = { kind: "node", node: v.node, x: v.x - G.CARD_W / 2, y: axisY + 34 + v.level * 118, width: G.CARD_W, height: G.CARD_H, centerX: v.x, centerY: axisY + 34 + v.level * 118 + G.CARD_H / 2, axisY, range: v.range }; items.push(p); placements.set(v.node.id, p); }
        });
        unknown.forEach((node, i) => { const p = { kind: "node", node, x: unknownX + 18, y: axisY + 34 + i * 118, width: G.CARD_W, height: G.CARD_H, centerX: unknownX + 18 + G.CARD_W / 2, centerY: axisY + 34 + i * 118 + G.CARD_H / 2, axisY, range: dateRange(node) }; items.push(p); placements.set(node.id, p); });
        y += rowHeight + G.ROW_GAP;
      });
    });
    const sceneHeight = Math.max(820, (rows.length ? y : 700) + 40);
    return { sceneWidth, sceneHeight, axisStart, axisEnd, unknownX, minDay: d.min, maxDay: d.max, ticks: ticks(d.min, d.max).map((v) => ({ ...v, x: xFor(v.day) })), rows, topicHeadings, items, placements, visibleLineIds: new Set(data.lines.map((v) => v.id)), bounds: { left: 0, top: 0, right: sceneWidth, bottom: sceneHeight } };
  }

  Object.assign(TF, { orderTimelines, visibleData, buildLayout });
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
