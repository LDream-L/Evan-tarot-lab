// ==============================
// timeflow-astrology.js
// 時間樹：共用占星背景葉片（掛在唯一主幹，不另畫日期軸）
// ==============================
// 主要函式：
// - collectVisibleEvents：時間 O(Y + E)，空間 O(E)。
// - buildAstroLayout：時間 O(E log E + E*K)，空間 O(E+K)，K 為實際碰撞層數。
// - renderAstrologyLayer：時間 O(E)，空間 O(E)。
//
// 更快替代方案比較：
// - 將天象複製成每條案例節點：查詢直觀，但會重複儲存、增加同步衝突。
// - 本版使用年度唯讀 JSON＋畫面合併：共用資料只載入一次，不污染個人時間流。
// ==============================
(function initTimeflowAstrology(TF) {
  "use strict";

  if (!TF || !TF.ui || !TF.app) {
    window.setTimeout(() => initTimeflowAstrology(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {}), 50);
    return;
  }
  if (TF.astrology?.installed) return;

  const PREF_KEY = "evanTarotAstrologyPrefsV2";
  const DATA_VERSION = "20260708-astro-v1";
  const MIN_YEAR = 2026;
  const MAX_YEAR = 2027;
  const MAX_YEAR_LOAD = 8;

  const TYPE_LABELS = Object.freeze({
    all: "全部事件",
    ingress: "行星換座",
    retrograde: "逆行期間",
    station: "逆／順行站",
    moon_phase: "新月／滿月",
    eclipse: "日月食",
    aspect: "行星相位",
  });

  const PLANET_LABELS = Object.freeze({
    all: "全部行星",
    Sun: "太陽",
    Moon: "月亮",
    Mercury: "水星",
    Venus: "金星",
    Mars: "火星",
    Jupiter: "木星",
    Saturn: "土星",
    Uranus: "天王星",
    Neptune: "海王星",
    Pluto: "冥王星",
  });

  const state = {
    installed: true,
    years: new Map(),
    yearMeta: new Map(),
    loading: new Set(),
    unavailable: new Set(),
    refs: {},
    prefs: loadPrefs(),
    lastVisibleCount: 0,
  };

  TF.astrology = state;

  function loadPrefs() {
    const fallback = { visible: false, mode: "core", planet: "all", type: "all" };
    try {
      const parsed = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return fallback;
      return {
        visible: parsed.visible !== false,
        mode: parsed.mode === "full" ? "full" : "core",
        planet: PLANET_LABELS[parsed.planet] ? parsed.planet : "all",
        type: TYPE_LABELS[parsed.type] ? parsed.type : "all",
      };
    } catch (_error) {
      return fallback;
    }
  }

  function savePrefs() {
    localStorage.setItem(PREF_KEY, JSON.stringify(state.prefs));
  }

  function dateToDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    return TF.dayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  function dayToYear(day) {
    return TF.dayParts(day).year;
  }

  function formatDate(value) {
    return String(value || "").replaceAll("-", "/");
  }

  function formatExact(value) {
    if (!value) return "";
    const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return String(value).replace("T", " ");
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function normalizeEvent(raw, year) {
    if (!raw || typeof raw !== "object") return null;
    const startDate = String(raw.startDate || raw.exactDate || "");
    const endDate = String(raw.endDate || startDate);
    const startDay = dateToDay(startDate);
    const endDay = dateToDay(endDate);
    if (startDay == null || endDay == null || endDay < startDay) return null;

    return {
      id: String(raw.id || `astro-${year}-${startDate}-${Math.random().toString(36).slice(2, 8)}`),
      type: TYPE_LABELS[raw.type] ? raw.type : "aspect",
      subtype: String(raw.subtype || ""),
      title: String(raw.title || "未命名天象"),
      startDate,
      endDate,
      exactDate: String(raw.exactDate || startDate),
      exactTime: String(raw.exactTime || ""),
      endExactTime: String(raw.endExactTime || ""),
      planets: Array.isArray(raw.planets) ? raw.planets.map(String) : [],
      signs: Array.isArray(raw.signs) ? raw.signs.map(String) : [],
      aspect: String(raw.aspect || ""),
      importance: Math.max(1, Math.min(3, Number(raw.importance || 1))),
      level: raw.level === "full" ? "full" : "core",
      description: String(raw.description || `${String(raw.title || "此天象")}，依地心熱帶黃道位置計算。`),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      startDay,
      endDay,
      sourceYear: year,
    };
  }

  async function loadYear(year) {
    if (state.years.has(year) || state.loading.has(year) || state.unavailable.has(year)) return;
    if (year < MIN_YEAR || year > MAX_YEAR) {
      state.unavailable.add(year);
      return;
    }

    state.loading.add(year);
    updateStatus();
    try {
      if (typeof DecompressionStream !== "function") {
        throw new Error("瀏覽器不支援 gzip 解壓縮，請更新瀏覽器版本");
      }
      const response = await fetch(`data/astrology-events-${year}.json.gz.b64?v=${DATA_VERSION}`, {
        cache: "no-cache",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const base64 = (await response.text()).trim();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const data = JSON.parse(await new Response(stream).text());
      if (Number(data?.year) !== year || !Array.isArray(data?.events)) {
        throw new Error("年度占星資料格式不正確");
      }
      const columns = Array.isArray(data.columns) ? data.columns.map(String) : [];
      const expand = (item) => {
        if (!Array.isArray(item)) return item;
        const object = {};
        columns.forEach((column, index) => { object[column] = item[index]; });
        return object;
      };
      const events = data.events.map((item) => normalizeEvent(expand(item), year)).filter(Boolean);
      state.years.set(year, events);
      state.yearMeta.set(year, data.source || {});
    } catch (error) {
      console.error(`[timeflow-astrology] ${year} 年資料讀取失敗：`, error);
      state.unavailable.add(year);
    } finally {
      state.loading.delete(year);
      updateStatus();
      if (TF.ctx?.state) TF.ui.render(false);
    }
  }

  function ensureYears(minDay, maxDay) {
    const minYear = Math.max(MIN_YEAR, dayToYear(minDay));
    const maxYear = Math.min(MAX_YEAR, dayToYear(maxDay));
    if (maxYear < minYear) return;
    let count = 0;
    for (let year = minYear; year <= maxYear && count < MAX_YEAR_LOAD; year += 1, count += 1) {
      loadYear(year);
    }
  }

  /** 時間 O(Y+E)，空間 O(E)。 */
  function collectVisibleEvents(layout) {
    ensureYears(layout.minDay, layout.maxDay);
    const dedupe = new Map();
    for (const events of state.years.values()) {
      for (const event of events) {
        if (event.endDay < layout.minDay || event.startDay > layout.maxDay) continue;
        if (state.prefs.mode === "core" && event.level !== "core") continue;
        if (state.prefs.planet !== "all" && !event.planets.includes(state.prefs.planet)) continue;
        if (state.prefs.type !== "all" && event.type !== state.prefs.type) continue;
        dedupe.set(event.id, event);
      }
    }
    return [...dedupe.values()].sort(
      (a, b) => a.startDay - b.startDay || a.endDay - b.endDay || b.importance - a.importance || a.title.localeCompare(b.title)
    );
  }

  /** 依每層最後終點配置，避免每一項互相比較的 O(E²)。 */
  function allocate(items, startKey, endKey, gap) {
    const levelEnds = [];
    return items.map((item) => {
      let level = 0;
      while (level < levelEnds.length && item[startKey] <= levelEnds[level] + gap) level += 1;
      if (level === levelEnds.length) levelEnds.push(item[endKey]);
      else levelEnds[level] = item[endKey];
      return { ...item, level };
    });
  }

  function groupPoints(points) {
    const threshold = state.prefs.mode === "full" ? 96 : 76;
    const groups = [];
    let current = null;
    for (const item of points.sort((a, b) => a.x - b.x)) {
      if (!current || item.x - current.lastX > threshold) {
        current = { members: [item.event], xTotal: item.x, lastX: item.x };
        groups.push(current);
      } else {
        current.members.push(item.event);
        current.xTotal += item.x;
        current.lastX = item.x;
      }
    }
    return groups.map((group) => ({
      members: group.members,
      x: group.xTotal / group.members.length,
    }));
  }

  /**
   * 將占星事件排在唯一主幹上方；時間 O(E log E + E*K)，空間 O(E+K)。
   * 點事件以反向縮放保持實際字級，期間事件則保留日期跨度。
   */
  function buildAstroLayout(layout, events) {
    const span = Math.max(1, layout.maxDay - layout.minDay);
    const inverseZoom = Number(layout.inverseZoom || 1);
    const xFor = (day) => layout.axisStart + ((day - layout.minDay) / span) * (layout.axisEnd - layout.axisStart);
    const periods = [];
    const points = [];

    events.forEach((event) => {
      if (event.endDay > event.startDay) {
        periods.push({
          event,
          startX: xFor(Math.max(layout.minDay, event.startDay)),
          endX: xFor(Math.min(layout.maxDay, event.endDay)),
        });
      } else {
        points.push({ event, x: xFor(event.startDay) });
      }
    });

    const bands = allocate(
      periods.sort((a, b) => a.startX - b.startX || a.endX - b.endX),
      "startX",
      "endX",
      8 * inverseZoom
    );
    const bandLevels = bands.reduce((max, item) => Math.max(max, item.level + 1), 0);
    const laneTop = 18 * inverseZoom;
    const bandStep = 36 * inverseZoom;
    const pointStart = laneTop + bandLevels * bandStep + (bandLevels ? 12 * inverseZoom : 0);

    const pointIntervals = groupPoints(points).map((group) => {
      const clustered = group.members.length > 1;
      const width = clustered ? 96 : 150;
      const worldWidth = width * inverseZoom;
      return {
        ...group,
        kind: clustered ? "cluster" : "point",
        startX: group.x - worldWidth / 2,
        endX: group.x + worldWidth / 2,
        width,
        worldWidth,
      };
    });
    const pointCards = allocate(pointIntervals, "startX", "endX", 10 * inverseZoom);
    const pointLevels = pointCards.reduce((max, item) => Math.max(max, item.level + 1), 0);
    const pointStep = 58 * inverseZoom;
    const pointWorldHeight = 48 * inverseZoom;
    const bandBottom = bandLevels ? laneTop + (bandLevels - 1) * bandStep + 28 * inverseZoom : laneTop;
    const pointBottom = pointLevels ? pointStart + (pointLevels - 1) * pointStep + pointWorldHeight : laneTop;
    const labelBottom = laneTop + 58 * inverseZoom;
    const laneBottom = Math.max(labelBottom, bandBottom, pointBottom);
    const shift = Math.max(0, laneBottom + 30 * inverseZoom - layout.trunkY);

    return {
      shift,
      inverseZoom,
      bands: bands.map((item) => ({
        ...item,
        x: item.startX,
        y: laneTop + item.level * bandStep,
        width: Math.max(92 * inverseZoom, item.endX - item.startX),
        height: 28 * inverseZoom,
      })),
      points: pointCards.map((item) => ({
        ...item,
        x: item.x - item.worldWidth / 2,
        y: pointStart + item.level * pointStep,
        height: 48,
        worldHeight: pointWorldHeight,
      })),
    };
  }

  function injectStyles() {
    if (document.getElementById("timeflow-astrology-style")) return;
    const style = document.createElement("style");
    style.id = "timeflow-astrology-style";
    style.textContent = `
      .map-toolbar-astro-panel[open]{flex:1 1 100%}.map-toolbar-astrology{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-top:10px;padding:10px 12px;border:1px solid rgba(125,228,255,.18);border-radius:14px;background:rgba(125,228,255,.035)}
      .map-toolbar-astrology label{min-width:142px;color:var(--text-muted);font-size:.78rem}.map-toolbar-astrology select{width:100%;margin-top:4px}
      .map-astro-toggle{display:flex!important;align-items:center;gap:8px;min-width:auto!important;padding:9px 11px;border-radius:999px;border:1px solid rgba(183,148,255,.28);background:rgba(183,148,255,.08);color:var(--text-main)!important;cursor:pointer}
      .map-astro-toggle input{width:auto!important;margin:0!important}.map-astro-status{flex:1 1 230px;align-self:center;color:var(--text-muted);font-size:.75rem;line-height:1.45}
      .map-astro-info{align-self:center;border:0;background:transparent;color:var(--accent-strong);cursor:pointer;font:inherit;font-size:.76rem;padding:6px 0}
      .map-astro-lane-label,.map-astro-band,.map-astro-point,.map-astro-cluster{position:absolute;pointer-events:auto;color:var(--text-main);font:inherit;cursor:pointer}
      .map-astro-lane-label,.map-astro-point,.map-astro-cluster{transform:scale(var(--map-inverse-zoom));transform-origin:top left}
      .map-astro-lane-label{width:205px;min-height:58px;padding:8px 10px;border-radius:12px;border:1px solid rgba(125,228,255,.28);background:linear-gradient(180deg,rgba(16,35,49,.96),rgba(7,14,28,.98));text-align:left}
      .map-astro-lane-label strong,.map-astro-lane-label span{display:block}.map-astro-lane-label strong{font-size:.84rem}.map-astro-lane-label span{margin-top:4px;color:var(--text-muted);font-size:.69rem;line-height:1.35}
      .map-astro-band{height:calc(28px * var(--map-inverse-zoom));padding:calc(5px * var(--map-inverse-zoom)) calc(9px * var(--map-inverse-zoom));border-radius:calc(10px * var(--map-inverse-zoom));border:1px solid rgba(125,228,255,.38);background:linear-gradient(90deg,rgba(125,228,255,.14),rgba(183,148,255,.08));overflow:hidden;text-align:left;box-shadow:inset 0 0 16px rgba(125,228,255,.05)}
      .map-astro-band strong,.map-astro-band span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.map-astro-band strong{font-size:calc(.69rem * var(--map-inverse-zoom))}.map-astro-band span{font-size:calc(.61rem * var(--map-inverse-zoom));color:var(--text-muted)}
      .map-astro-point{height:48px;padding:7px 9px;border-radius:12px;border:1px solid rgba(183,148,255,.38);background:linear-gradient(180deg,rgba(25,24,58,.97),rgba(8,10,29,.99));text-align:left;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.34)}
      .map-astro-point strong,.map-astro-point span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.map-astro-point strong{font-size:.72rem}.map-astro-point span{margin-top:4px;color:var(--text-muted);font-size:.62rem}
      .map-astro-cluster{height:48px;padding:7px 8px;border-radius:14px;border:1px solid rgba(255,211,122,.4);background:radial-gradient(circle at top,rgba(255,211,122,.18),rgba(10,10,31,.98));text-align:center}.map-astro-cluster strong,.map-astro-cluster span{display:block}.map-astro-cluster strong{font-size:.82rem}.map-astro-cluster span{font-size:.61rem;color:var(--text-muted)}
      .map-astro-point.importance-3,.map-astro-band.importance-3{border-color:rgba(255,211,122,.58);box-shadow:0 0 0 1px rgba(255,211,122,.06),0 8px 22px rgba(0,0,0,.36)}
      .map-astro-point:hover,.map-astro-cluster:hover{transform:scale(var(--map-inverse-zoom)) translateY(-1px);filter:brightness(1.08)}.map-astro-band:hover{filter:brightness(1.08)}
      .map-astro-anchor{stroke:rgba(125,228,255,.32);stroke-width:1.4;stroke-dasharray:4 6;vector-effect:non-scaling-stroke}
      .map-stat-pill.map-astro-pill{border-color:rgba(125,228,255,.3);color:#c9f5ff;background:rgba(125,228,255,.08)}
      .map-astro-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px}.map-astro-detail-grid div{padding:9px 10px;border-radius:10px;border:1px solid rgba(139,123,255,.18);background:rgba(8,9,29,.72)}.map-astro-detail-grid span,.map-astro-detail-grid strong{display:block}.map-astro-detail-grid span{color:var(--text-muted);font-size:.68rem}.map-astro-detail-grid strong{margin-top:3px;font-size:.8rem}.map-astro-source-note{margin:14px 0 0;color:var(--text-muted);font-size:.74rem;line-height:1.55}
      @media(max-width:760px){.map-toolbar-astrology label{min-width:calc(50% - 8px);flex:1 1 140px}.map-astro-status{flex-basis:100%}.map-astro-detail-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function updateStatus() {
    const target = state.refs.status;
    if (!target) return;
    if (!state.prefs.visible) {
      target.textContent = "預設關閉；開啟後只會掛在同一條時間主幹，不建立第二日期軸。";
      return;
    }
    if (state.loading.size) {
      target.textContent = `正在載入 ${[...state.loading].sort().join("、")} 年占星資料…`;
      return;
    }
    const loaded = [...state.years.keys()].sort();
    if (loaded.length) {
      target.textContent = `已載入 ${loaded.join("、")} 年｜目前顯示 ${state.lastVisibleCount} 筆；天象不寫入 Google Sheets。`;
      return;
    }
    target.textContent = `目前提供 ${MIN_YEAR}–${MAX_YEAR} 年共用占星資料。`;
  }

  function injectControls() {
    if (document.getElementById("map-astro-controls")) return;
    const toolbar = document.querySelector("#divination-map-app .map-toolbar");
    const management = toolbar?.querySelector(".map-toolbar-management");
    if (!toolbar) return;

    const panel = document.createElement("details");
    panel.id = "map-astro-controls";
    panel.className = "map-toolbar-panel map-toolbar-astro-panel";
    panel.innerHTML = `
      <summary>占星背景（選用）</summary>
      <div class="map-toolbar-group map-toolbar-astrology">
        <label class="map-astro-toggle"><input id="map-astro-visible" type="checkbox">掛到同一主幹</label>
        <label>資料層級<select id="map-astro-mode"><option value="core">核心天象</option><option value="full">完整天象</option></select></label>
        <label>行星篩選<select id="map-astro-planet">${Object.entries(PLANET_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label>事件篩選<select id="map-astro-type">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <span class="map-astro-status" id="map-astro-status"></span>
        <button class="map-astro-info" id="map-astro-info" type="button">資料說明</button>
      </div>`;
    toolbar.insertBefore(panel, management || null);

    state.refs = {
      visible: panel.querySelector("#map-astro-visible"),
      mode: panel.querySelector("#map-astro-mode"),
      planet: panel.querySelector("#map-astro-planet"),
      type: panel.querySelector("#map-astro-type"),
      status: panel.querySelector("#map-astro-status"),
      info: panel.querySelector("#map-astro-info"),
    };

    state.refs.visible.checked = state.prefs.visible;
    state.refs.mode.value = state.prefs.mode;
    state.refs.planet.value = state.prefs.planet;
    state.refs.type.value = state.prefs.type;

    state.refs.visible.addEventListener("change", () => {
      state.prefs.visible = state.refs.visible.checked;
      savePrefs();
      updateStatus();
      TF.ui.render(true);
    });
    state.refs.mode.addEventListener("change", () => {
      state.prefs.mode = state.refs.mode.value === "full" ? "full" : "core";
      savePrefs();
      TF.ui.render(true);
    });
    state.refs.planet.addEventListener("change", () => {
      state.prefs.planet = PLANET_LABELS[state.refs.planet.value] ? state.refs.planet.value : "all";
      savePrefs();
      TF.ui.render(true);
    });
    state.refs.type.addEventListener("change", () => {
      state.prefs.type = TYPE_LABELS[state.refs.type.value] ? state.refs.type.value : "all";
      savePrefs();
      TF.ui.render(true);
    });
    state.refs.info.addEventListener("click", showSourceModal);
    updateStatus();
  }

  function modalShell(title, intro, body) {
    const backdrop = document.createElement("div");
    backdrop.className = "map-modal-backdrop";
    backdrop.innerHTML = `
      <div class="map-modal" role="dialog" aria-modal="true">
        <div class="map-modal-header"><p class="map-form-kicker">Astrology background</p><h3>${TF.esc(title)}</h3><p>${TF.esc(intro)}</p></div>
        ${body}
        <div class="map-modal-actions"><button type="button" class="btn primary" data-close>關閉</button></div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector("[data-close]").addEventListener("click", close);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    return backdrop;
  }

  function showSourceModal() {
    modalShell(
      "占星背景資料說明",
      "它是掛在唯一主幹上的共用時間背景，不是另一條主線，也不會複製到每條分支。",
      `<div class="map-astro-detail-grid">
        <div><span>目前資料年度</span><strong>${MIN_YEAR}–${MAX_YEAR}</strong></div>
        <div><span>時間基準</span><strong>Asia/Taipei</strong></div>
        <div><span>座標</span><strong>地心・熱帶黃道</strong></div>
        <div><span>資料位置</span><strong>GitHub 年度 JSON</strong></div>
      </div>
      <p class="map-astro-source-note">核心天象包含換座、逆行期間、新月／滿月、日月食與外行星主要相位；完整天象再加入逆／順行站與其他主要相位。資料只在畫面層依日期合併，不加入節點數、驗證統計或 Google Sheets 使用者資料。</p>`
    );
  }

  function showEventModal(event) {
    const timeText = event.endDay > event.startDay
      ? `${formatDate(event.startDate)}～${formatDate(event.endDate)}`
      : (formatExact(event.exactTime) || formatDate(event.exactDate));
    const planets = event.planets.map((value) => PLANET_LABELS[value] || value).join("、") || "—";
    const signs = event.signs.join("、") || "—";
    modalShell(
      event.title,
      event.description || "此天象目前沒有補充說明。",
      `<div class="map-astro-detail-grid">
        <div><span>日期／期間</span><strong>${TF.esc(timeText)}</strong></div>
        <div><span>事件類型</span><strong>${TF.esc(TYPE_LABELS[event.type] || event.type)}</strong></div>
        <div><span>行星</span><strong>${TF.esc(planets)}</strong></div>
        <div><span>星座</span><strong>${TF.esc(signs)}</strong></div>
        <div><span>顯示層級</span><strong>${event.level === "core" ? "核心天象" : "完整天象"}</strong></div>
        <div><span>重要度</span><strong>${"●".repeat(event.importance)}${"○".repeat(3 - event.importance)}</strong></div>
      </div>
      <p class="map-astro-source-note">此資料是時間背景參考，不代表天象必然造成個人事件；實際案例仍需分開記錄與驗證。</p>`
    );
  }

  function showClusterModal(events) {
    const backdrop = modalShell(
      `同區共有 ${events.length} 個天象`,
      "時間接近的事件已聚合；選擇其中一項查看內容。",
      `<div class="map-choice-list">${events
        .slice()
        .sort((a, b) => a.startDay - b.startDay || b.importance - a.importance)
        .map((event) => `<button type="button" class="map-choice-button" data-astro-id="${TF.esc(event.id)}"><strong>${TF.esc(event.title)}</strong><span>${TF.esc(formatDate(event.exactDate || event.startDate))}｜${TF.esc(TYPE_LABELS[event.type] || event.type)}</span></button>`)
        .join("")}</div>`
    );
    backdrop.querySelectorAll("[data-astro-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const event = events.find((item) => item.id === button.dataset.astroId);
        backdrop.remove();
        if (event) showEventModal(event);
      });
    });
  }

  function shiftBaseCanvas(layout, shift) {
    const canvas = TF.app.refs.canvas;
    canvas.querySelectorAll(":scope > *").forEach((element) => {
      const top = Number.parseFloat(element.style.top);
      if (Number.isFinite(top)) element.style.top = `${top + shift}px`;
    });

    layout.rows.forEach((row) => {
      row.topY += shift;
      row.axisY += shift;
      row.bottomY += shift;
      row.sourcePoint.y += shift;
    });
    layout.topicHeadings.forEach((item) => { item.y += shift; });
    layout.items.forEach((item) => {
      item.y += shift;
      item.centerY += shift;
      item.axisY += shift;
    });
    layout.trunkY += shift;
    layout.sceneHeight += shift;
    if (layout.bounds) layout.bounds.bottom += shift;
  }

  function renderAstroCanvas(astroLayout, events) {
    const canvas = TF.app.refs.canvas;
    const label = document.createElement("button");
    label.type = "button";
    label.className = "map-astro-lane-label";
    label.style.left = `${18 * astroLayout.inverseZoom}px`;
    label.style.top = `${18 * astroLayout.inverseZoom}px`;
    label.innerHTML = `<strong>占星背景葉片</strong><span>${state.prefs.mode === "core" ? "核心天象" : "完整天象"}・共用唯讀資料<br>與事件共用下方同一條日期主幹</span>`;
    label.addEventListener("click", showSourceModal);
    canvas.appendChild(label);

    astroLayout.bands.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `map-astro-band importance-${item.event.importance}`;
      button.style.left = `${item.x}px`;
      button.style.top = `${item.y}px`;
      button.style.width = `${item.width}px`;
      button.style.height = `${item.height}px`;
      button.innerHTML = `<strong>${TF.esc(TF.truncate(item.event.title, 28))}</strong><span>${TF.esc(`${formatDate(item.event.startDate)}～${formatDate(item.event.endDate)}`)}</span>`;
      button.addEventListener("click", (event) => { event.stopPropagation(); showEventModal(item.event); });
      canvas.appendChild(button);
    });

    astroLayout.points.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.style.left = `${item.x}px`;
      button.style.top = `${item.y}px`;
      button.style.width = `${item.width}px`;
      if (item.kind === "cluster") {
        button.className = "map-astro-cluster";
        button.innerHTML = `<strong>＋${item.members.length}</strong><span>${TF.esc(formatDate(item.members[0]?.exactDate || item.members[0]?.startDate))}</span>`;
        button.addEventListener("click", (event) => { event.stopPropagation(); showClusterModal(item.members); });
      } else {
        const event = item.members[0];
        button.className = `map-astro-point importance-${event.importance}`;
        button.innerHTML = `<strong>${TF.esc(TF.truncate(event.title, 22))}</strong><span>${TF.esc(formatDate(event.exactDate || event.startDate))}｜${TF.esc(TYPE_LABELS[event.type] || event.type)}</span>`;
        button.addEventListener("click", (domEvent) => { domEvent.stopPropagation(); showEventModal(event); });
      }
      canvas.appendChild(button);
    });

    if (events.length) canvas.querySelector(".map-canvas-empty")?.remove();
  }

  function renderAstroSvg(layout, astroLayout) {
    const svg = TF.app.refs.connections;
    const baseSvg = svg.innerHTML;
    const height = layout.sceneHeight;
    svg.setAttribute("viewBox", `0 0 ${layout.sceneWidth} ${height}`);
    svg.setAttribute("height", String(height));

    const lines = [];
    astroLayout.points.forEach((item) => {
      const centerX = item.x + item.worldWidth / 2;
      lines.push(`<line class="map-astro-anchor" x1="${centerX}" y1="${item.y + item.worldHeight}" x2="${centerX}" y2="${layout.trunkY}"/>`);
    });
    astroLayout.bands.forEach((item) => {
      const centerX = item.x + item.width / 2;
      lines.push(`<line class="map-astro-anchor" x1="${centerX}" y1="${item.y + item.height}" x2="${centerX}" y2="${layout.trunkY}"/>`);
    });

    svg.innerHTML = `<g class="map-base-svg" transform="translate(0 ${astroLayout.shift})">${baseSvg}</g>${lines.join("")}`;
  }

  function appendStats(count) {
    const stats = TF.app.refs.stats;
    if (!stats) return;
    const pill = document.createElement("span");
    pill.className = "map-stat-pill map-astro-pill";
    pill.textContent = `占星背景 ${count}`;
    stats.appendChild(pill);
  }

  const originalRender = TF.ui.render.bind(TF.ui);
  const originalFit = TF.ui.fit.bind(TF.ui);

  /** 畫面合併：原時間樹先渲染，再將占星葉片接到同一主幹。 */
  TF.ui.render = function renderWithAstrology(fit = false) {
    originalRender(false);
    injectStyles();
    injectControls();

    const layout = TF.app.layout;
    if (!layout || !state.prefs.visible) {
      state.lastVisibleCount = 0;
      updateStatus();
      if (fit) originalFit(true);
      return;
    }

    const events = collectVisibleEvents(layout);
    state.lastVisibleCount = events.length;
    updateStatus();
    appendStats(events.length);

    if (!events.length) {
      if (fit) originalFit(true);
      return;
    }

    const astroLayout = buildAstroLayout(layout, events);
    shiftBaseCanvas(layout, astroLayout.shift);
    renderAstroCanvas(astroLayout, events);
    renderAstroSvg(layout, astroLayout);
    TF.app.refs.scene.style.minHeight = `${layout.sceneHeight}px`;
    TF.ui.applyTransform();
    if (fit) originalFit(true);
  };

  injectStyles();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectControls();
      if (TF.ctx?.state) TF.ui.render(false);
    }, { once: true });
  } else {
    injectControls();
    if (TF.ctx?.state) TF.ui.render(false);
  }
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
