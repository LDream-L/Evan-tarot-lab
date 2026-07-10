/**
 * 主題時間流 v5｜可閱讀 UI 原始碼
 *
 * 主要流程：render／畫布／側欄／時間順序清單。
 * 時間複雜度：O(N log N + L log L)；空間複雜度：O(N + L)。
 *
 * 替代方案比較：
 * - 單行壓縮檔：瀏覽器載入較小，但無法有效審查與維護。
 * - 本檔：保留完全相同行為與符號，只做結構化格式化，作為後續命名重構的正式 source。
 */
/*! 主題時間流 v5 UI｜render: 時間 O(N log N + L log L)、空間 O(N+L)；Map 查表與單次 layout 取代重複掃描。 */
!(function (e) {
  "use strict";
  const {
      ctx: t,
      C: n,
      clamp: i,
      esc: a,
      truncate: s,
      rgba: o,
      save: l,
      rebuildIndexes: d,
      ensureSelection: c,
      activeTopics: p,
      activeTimelines: r,
      activeNodes: u,
      topicTitle: m,
      topicColor: $,
      lineTitle: h,
      lineTopic: g,
      dateRange: v,
      sortNodes: f,
      visibleData: y,
      buildLayout: x,
      orderTimelines: I,
    } = e,
    T = (e.app = e.app || { refs: {}, signedIn: !1, pan: null, layout: null }),
    E = T.refs,
    b = (e) =>
      "reading" === e.type
        ? e.interpretation || e.cards || e.predictions || "尚未填入解讀"
        : e.description || e.note || "尚未填入內容",
    M = () => t.nodeIndex.get(t.state.ui.selectedId);
  function w(e) {
    if (((t.state.ui.activeTimelineId = e), "single" === t.state.ui.viewMode)) {
      const n = g(e);
      n && (t.state.ui.activeTopicId = n);
    }
  }
  function L(e) {
    const n = [t.state.topics, t.state.timelines, t.state.nodes, t.state.links]
      .flat()
      .filter((e) => e.deletedAt).length;
    E.stats.innerHTML = [
      `<span class="map-stat-pill">主題 ${p().length}</span>`,
      `<span class="map-stat-pill">案例時間線 ${r().length}</span>`,
      `<span class="map-stat-pill">節點 ${u().length}</span>`,
      `<span class="map-stat-pill">目前顯示 ${e.nodes.length}</span>`,
      n ? `<span class="map-stat-pill is-warning">回收區 ${n}</span>` : "",
      '<span class="map-stat-pill map-storage-pill">Google Sheets＋本機快取</span>',
      `<span class="map-stat-pill ${T.signedIn ? "map-auth-ok" : "map-auth-readonly"}">${T.signedIn ? "已登入・可編輯" : "訪客唯讀"}</span>`,
    ]
      .filter(Boolean)
      .join("");
  }
  function S() {
    const e = T.layout;
    e &&
      ((E.scene.style.width = `${e.sceneWidth}px`),
      (E.scene.style.minHeight = `${e.sceneHeight}px`),
      (E.scene.style.transform = `translate(${t.state.ui.panX}px,${t.state.ui.panY}px) scale(${t.state.ui.zoom})`),
      (E.zoomReset.textContent = `${Math.round(100 * t.state.ui.zoom)}%`));
  }
  function k(e) {
    ((t.state.ui.selectedId = e.id), w(e.timelineId), l(), X(!1));
  }
  function C(i) {
    T.layout = x(i);
    const d = T.layout;
    E.canvas.replaceChildren();
    const c = document.createElement("div");
    ((c.className = "map-unknown-zone"),
      (c.style.left = `${d.unknownX}px`),
      (c.style.top = "54px"),
      (c.style.height = `${Math.max(200, d.sceneHeight - 80)}px`),
      E.canvas.appendChild(c));
    const p = document.createElement("div");
    if (
      ((p.className = "map-unknown-zone-label"),
      (p.style.left = `${d.unknownX + 16}px`),
      (p.style.top = "24px"),
      (p.textContent = "日期不詳"),
      E.canvas.appendChild(p),
      d.topicHeadings.forEach(({ topic: e, y: t }) => {
        const n = document.createElement("div");
        ((n.className = "map-topic-heading"),
          (n.style.top = `${t}px`),
          (n.textContent = `${e.title}${e.description ? `｜${e.description}` : ""}`),
          E.canvas.appendChild(n));
      }),
      d.rows.forEach((e) => {
        const n = document.createElement("button");
        ((n.type = "button"),
          (n.className = "map-timeline-label-button"),
          (n.style.left = 18 + 14 * e.depth + "px"),
          (n.style.top = e.axisY - 30 + "px"));
        const i = e.line.parentNodeId
          ? t.nodeIndex.get(e.line.parentNodeId)
          : null;
        ((n.innerHTML = `<strong>${a(e.line.title)}</strong><span>${a(i ? `來源：${i.deletedAt ? "節點在回收區" : i.title || "未命名節點"}` : `${e.nodeCount} 個節點`)}${"all" === t.state.ui.viewMode ? "・雙擊聚焦" : ""}</span>`),
          n.addEventListener("click", (t) => {
            (t.stopPropagation(), w(e.line.id), l(), X(!1));
          }),
          n.addEventListener("dblclick", (n) => {
            (n.stopPropagation(),
              (t.state.ui.viewMode = "single"),
              (t.state.ui.activeTopicId = e.line.topicId),
              (t.state.ui.activeTimelineId = e.line.id),
              l(),
              X(!0));
          }),
          E.canvas.appendChild(n));
      }),
      d.items.forEach((i) => {
        E.canvas.appendChild(
          "cluster" === i.kind
            ? (function (t) {
                const i = document.createElement("button");
                return (
                  (i.type = "button"),
                  (i.className = "map-node-cluster"),
                  (i.style.left = `${t.x}px`),
                  (i.style.top = `${t.y}px`),
                  (i.innerHTML = `<strong>＋${t.members.length}</strong><span>${a(s(t.members.map((e) => e.title || n.TYPES[e.type]).join("、"), 22))}</span>`),
                  i.addEventListener("click", (n) => {
                    (n.stopPropagation(), e.actions?.clusterModal(t.members));
                  }),
                  i
                );
              })(i)
            : "band" === i.kind
              ? (function (e) {
                  const i = e.node,
                    s = document.createElement("button");
                  return (
                    (s.type = "button"),
                    (s.className = `map-period-band role-${i.role}${t.state.ui.selectedId === i.id ? " is-selected" : ""}`),
                    (s.style.left = `${e.x}px`),
                    (s.style.top = `${e.y}px`),
                    (s.style.width = `${e.width}px`),
                    (s.innerHTML = `<span class="map-period-band-title">${a(i.title || n.TYPES[i.type])}</span><span class="map-period-band-date">${a(e.range.label)}</span>`),
                    s.addEventListener("click", (e) => {
                      (e.stopPropagation(), k(i));
                    }),
                    s
                  );
                })(i)
              : (function (e) {
                  const i = e.node,
                    o = t.timelineIndex.get(i.timelineId),
                    l = document.createElement("button");
                  return (
                    (l.type = "button"),
                    (l.className = `map-node ${i.type} role-${i.role} status-${i.status}${t.state.ui.selectedId === i.id ? " is-selected" : ""}`),
                    (l.style.left = `${e.x}px`),
                    (l.style.top = `${e.y}px`),
                    l.style.setProperty("--theme-color", $(o?.topicId)),
                    (l.innerHTML = `
      <span class="map-node-header">
        <span class="map-node-type">${n.TYPES[i.type]}</span>
        ${"normal" !== i.role ? `<span class="map-node-role${"background" === i.role ? " is-background" : ""}">${n.ROLES[i.role]}</span>` : ""}
      </span>
      <span class="map-node-title">${a(i.title || "未命名節點")}</span>
      <span class="map-node-meta">${a(n.CATEGORIES[i.category] || "其他")}${i.subject ? `・${a(i.subject)}` : ""}</span>
      <span class="map-node-preview">${a(s(b(i), 62))}</span>
      <span class="map-node-footer">
        <span class="map-node-status">${n.STATUSES[i.status]}</span>
        <span class="map-date-precision-pill">${a(v(i).label)}</span>
      </span>`),
                    l.addEventListener("click", (e) => {
                      (e.stopPropagation(), k(i));
                    }),
                    l
                  );
                })(i),
        );
      }),
      !i.lines.length || !i.nodes.length)
    ) {
      const e = document.createElement("div");
      ((e.className = "map-canvas-empty"),
        (e.textContent = i.lines.length
          ? "目前篩選條件下沒有節點。"
          : "目前沒有可顯示的案例時間線。"),
        E.canvas.appendChild(e));
    }
    !(function () {
      const e = T.layout;
      (E.connections.setAttribute(
        "viewBox",
        `0 0 ${e.sceneWidth} ${e.sceneHeight}`,
      ),
        E.connections.setAttribute("width", String(e.sceneWidth)),
        E.connections.setAttribute("height", String(e.sceneHeight)));
      const n = [];
      (e.ticks.forEach((t) =>
        n.push(
          `<line class="map-time-grid" x1="${t.x}" y1="42" x2="${t.x}" y2="${e.sceneHeight - 24}"/>`,
          `<line class="map-time-tick" x1="${t.x}" y1="42" x2="${t.x}" y2="54"/>`,
          `<text class="map-time-label" x="${t.x}" y="28" text-anchor="middle">${a(t.label)}</text>`,
        ),
      ),
        n.push(
          `<line class="map-time-axis" x1="${e.axisStart}" y1="48" x2="${e.axisEnd}" y2="48"/>`,
        ),
        e.rows.forEach((t) => {
          if (
            (n.push(
              `<line class="map-timeline-axis" x1="${e.axisStart}" y1="${t.axisY}" x2="${e.axisEnd}" y2="${t.axisY}" style="stroke:${o($(t.line.topicId), 0.7)}"/>`,
            ),
            !t.line.parentNodeId)
          )
            return;
          const i = e.placements.get(t.line.parentNodeId);
          if (!i) return;
          const a = i.centerX + 0.48 * (e.axisStart - i.centerX);
          n.push(
            `<path class="map-timeline-source-line" d="M ${i.centerX} ${i.centerY} C ${a} ${i.centerY},${a} ${t.axisY},${e.axisStart} ${t.axisY}"/>`,
          );
        }));
      const i = new Set();
      e.items.forEach((e) => {
        const t =
          "cluster" === e.kind
            ? e.members.map((e) => e.id).join(",")
            : e.node.id;
        if (i.has(t)) return;
        i.add(t);
        const a = "cluster" !== e.kind && "background" === e.node.role,
          s = e.centerY < e.axisY ? e.y + e.height : e.y;
        n.push(
          `<path class="map-node-anchor-line${a ? " is-background" : ""}" d="M ${e.centerX} ${s} C ${e.centerX} ${(s + e.axisY) / 2},${e.centerX} ${(s + e.axisY) / 2},${e.centerX} ${e.axisY}"/>`,
        );
      });
      const s = new Set();
      (t.state.links.forEach((t) => {
        if (t.deletedAt) return;
        const i = e.placements.get(t.fromNodeId),
          o = e.placements.get(t.toNodeId);
        if (!i || !o || i === o) return;
        const l = [t.fromNodeId, t.toNodeId, t.type].sort().join(":");
        if (s.has(l)) return;
        s.add(l);
        const d = Math.max(42, 0.22 * Math.abs(o.centerX - i.centerX));
        n.push(
          `<path class="map-virtual-link ${a(t.type)}" d="M ${i.centerX} ${i.centerY} C ${i.centerX + d} ${i.centerY},${o.centerX - d} ${o.centerY},${o.centerX} ${o.centerY}"/>`,
        );
      }),
        (E.connections.innerHTML = n.join("")));
    })();
  }
  function N(e) {
    E.dateFields.querySelectorAll("[data-date-field]").forEach((t) => {
      t.classList.toggle("hidden", t.dataset.dateField !== e);
    });
  }
  function Y() {
    const i = M();
    if (!i || i.deletedAt)
      return (
        E.emptyState.classList.remove("hidden"),
        void E.detailForm.classList.add("hidden")
      );
    (E.emptyState.classList.add("hidden"),
      E.detailForm.classList.remove("hidden"),
      (E.detailId.value = i.id),
      (E.selectedId.textContent = i.id),
      (E.detailTypeLabel.textContent = n.TYPES[i.type]),
      (E.detailTitle.textContent = i.title || "未命名節點"),
      (E.fieldTimeline.value = i.timelineId),
      (E.fieldType.value = i.type),
      (E.fieldRole.value = i.role),
      (E.fieldPrecision.value = i.precision),
      (E.fieldDateDay.value = "day" === i.precision ? i.dateValue : ""),
      (E.fieldDateMonth.value = "month" === i.precision ? i.dateValue : ""),
      (E.fieldDateYear.value = "year" === i.precision ? i.dateValue : ""),
      (E.fieldTitle.value = i.title),
      (E.fieldCategory.value = i.category),
      (E.fieldSubject.value = i.subject),
      (E.fieldStatus.value = i.status),
      (E.fieldCards.value = i.cards),
      (E.fieldInterpretation.value = i.interpretation),
      (E.fieldPredictions.value = i.predictions),
      (E.fieldDescription.value = i.description),
      (E.fieldTags.value = i.tags.join(", ")),
      (E.fieldNote.value = i.note),
      N(i.precision));
    const s = "reading" === i.type;
    (document
      .querySelectorAll("[data-reading-only]")
      .forEach((e) => e.classList.toggle("hidden", !s)),
      document
        .querySelectorAll("[data-description-field]")
        .forEach((e) => e.classList.toggle("hidden", s)),
      (function (i) {
        const s = u().filter((e) => e.id !== i.id);
        E.linkTarget.innerHTML = `<option value="">選擇節點</option>${s.map((e) => `<option value="${a(e.id)}">${a(m(g(e.timelineId)))}｜${a(h(e.timelineId))}｜${a(e.title || n.TYPES[e.type])}</option>`).join("")}`;
        const o = t.state.links.filter(
          (e) => !e.deletedAt && (e.fromNodeId === i.id || e.toNodeId === i.id),
        );
        ((E.linkList.innerHTML = o.length
          ? o
              .map((e) => {
                const s = e.fromNodeId === i.id ? e.toNodeId : e.fromNodeId,
                  o = t.nodeIndex.get(s);
                return `<div class="map-link-item"><p><strong>${n.LINKS[e.type]}</strong>｜${a(o?.title || "節點已刪除")}${e.note ? `<br>${a(e.note)}` : ""}</p><button type="button" class="map-link-remove" data-remove-link="${a(e.id)}">移除</button></div>`;
              })
              .join("")
          : '<p class="map-inline-help">尚未建立虛擬連結。</p>'),
          E.linkList.querySelectorAll("[data-remove-link]").forEach((t) => {
            t.addEventListener("click", () =>
              e.actions?.removeLink(t.dataset.removeLink),
            );
          }));
      })(i));
  }
  function H(e) {
    ((T.signedIn = Boolean(e)),
      [
        E.addTopic,
        E.addTimeline,
        E.addReading,
        E.addEvent,
        E.addNote,
        E.addChildTimeline,
        E.manageTopic,
        E.manageTimeline,
        E.openTrash,
        E.deleteNode,
        E.addLink,
        E.resetData,
      ].forEach((e) => {
        ((e.disabled = !T.signedIn),
          (e.title = T.signedIn ? "" : "請先從右上角登入 Google 帳號"));
      }),
      E.detailForm
        .querySelectorAll("input,select,textarea,button")
        .forEach((e) => {
          "map-detail-id" !== e.id && (e.disabled = !T.signedIn);
        }),
      E.detailForm.classList.toggle("is-auth-readonly", !T.signedIn));
  }
  function A(e = !0) {
    const a = E.viewport.clientWidth,
      s = E.viewport.clientHeight,
      o = T.layout;
    if (!a || !s || !o) return;
    const d = i(
      Math.min(
        (a - 108) / Math.max(320, o.sceneWidth),
        (s - 108) / Math.max(260, o.sceneHeight),
        0.92,
      ),
      n.MIN_ZOOM,
      n.MAX_ZOOM,
    );
    ((t.state.ui.zoom = d),
      (t.state.ui.panX = (a - o.sceneWidth * d) / 2),
      (t.state.ui.panY = (s - o.sceneHeight * d) / 2),
      S(),
      e && l());
  }
  function X(e = !1) {
    (d(),
      c(),
      d(),
      (E.viewMode.value = t.state.ui.viewMode),
      (E.filterStatus.value = t.state.ui.filterStatus),
      (E.search.value = t.state.ui.search),
      (function () {
        const e = p(),
          i =
            "all" === t.state.ui.viewMode
              ? ['<option value="all">全部主題</option>']
              : [];
        (i.push(
          ...e.map((e) => `<option value="${a(e.id)}">${a(e.title)}</option>`),
        ),
          (E.activeTopic.innerHTML = i.join("")),
          (E.activeTopic.value = t.state.ui.activeTopicId));
        const s = r().filter(
            (e) =>
              "all" === t.state.ui.activeTopicId ||
              e.topicId === t.state.ui.activeTopicId,
          ),
          o = new Map();
        s.forEach((e) => {
          (o.has(e.topicId) || o.set(e.topicId, []), o.get(e.topicId).push(e));
        });
        const l = [];
        (e.forEach((e) => {
          I(o.get(e.id) || []).forEach((e) => l.push(e));
        }),
          (E.activeTimeline.innerHTML = l
            .map(
              ({ line: e, depth: n }) =>
                `<option value="${a(e.id)}">${"　".repeat(n)}${"all" === t.state.ui.activeTopicId ? `${a(m(e.topicId))}｜` : ""}${a(e.title)}</option>`,
            )
            .join("")),
          (E.activeTimeline.value = t.state.ui.activeTimelineId),
          (E.fieldTimeline.innerHTML = r()
            .map(
              (e) =>
                `<option value="${a(e.id)}">${a(m(e.topicId))}｜${a(e.title)}</option>`,
            )
            .join("")));
        const d = new Set(u().map((e) => e.category));
        ((E.filterCategory.innerHTML = [
          '<option value="all">全部分類</option>',
          ...Object.entries(n.CATEGORIES)
            .filter(([e]) => d.has(e) || t.state.ui.filterCategory === e)
            .map(([e, t]) => `<option value="${e}">${t}</option>`),
        ].join("")),
          (E.filterCategory.value = t.state.ui.filterCategory));
      })());
    const i = y();
    (L(i),
      C(i),
      Y(),
      (function (e) {
        if (!e.lines.length)
          return void (E.timeline.innerHTML =
            '<p class="map-timeline-empty">目前沒有符合條件的時間線。</p>');
        const i = new Map(e.lines.map((e) => [e.id, []]));
        (e.nodes.forEach((e) => i.get(e.timelineId)?.push(e)),
          (E.timeline.innerHTML = e.lines
            .map(
              (e) => `
      <section class="map-timeline-group">
        <div class="map-timeline-group-header"><h5>${a(m(e.topicId))}｜${a(e.title)}</h5><p>${a(e.description || "未填案例說明")}</p></div>
        ${
          f(i.get(e.id) || [])
            .map(
              (e) => `
          <article class="map-timeline-item ${e.type} role-${e.role}">
            <div class="map-timeline-top"><span class="map-node-type">${n.TYPES[e.type]}${"normal" !== e.role ? `・${n.ROLES[e.role]}` : ""}</span><span class="map-timeline-date">${a(v(e).label)}</span></div>
            <h5>${a(e.title || "未命名節點")}</h5><p>${a(s(b(e), 145))}</p>
            <div class="map-timeline-footer"><span class="map-theme-pill">${a(n.CATEGORIES[e.category])}</span><button type="button" class="map-timeline-open" data-open-node="${a(e.id)}">查看內容</button></div>
          </article>`,
            )
            .join("") ||
          '<p class="map-timeline-empty">此時間線目前沒有符合篩選條件的節點。</p>'
        }
      </section>`,
            )
            .join("")),
          E.timeline.querySelectorAll("[data-open-node]").forEach((e) => {
            e.addEventListener("click", () => {
              const n = t.nodeIndex.get(e.dataset.openNode);
              n &&
                (k(n),
                E.detailForm.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                }));
            });
          }));
      })(i),
      H(T.signedIn),
      S(),
      e && window.requestAnimationFrame(() => A(!0)));
  }
  e.ui = {
    preview: b,
    selected: M,
    selectLine: w,
    selectNode: k,
    showDateFields: N,
    renderStats: L,
    applyTransform: S,
    setEditing: H,
    fit: A,
    render: X,
    zoom: function (e, a, s) {
      const o = t.state.ui.zoom,
        d = i(o + e, n.MIN_ZOOM, n.MAX_ZOOM);
      if (d === o) return;
      const c = E.viewport.getBoundingClientRect(),
        p = null == a ? c.width / 2 : a - c.left,
        r = null == s ? c.height / 2 : s - c.top,
        u = (p - t.state.ui.panX) / o,
        m = (r - t.state.ui.panY) / o;
      ((t.state.ui.zoom = d),
        (t.state.ui.panX = p - u * d),
        (t.state.ui.panY = r - m * d),
        l(),
        X(!1));
    },
    auth: function (e) {
      ((T.signedIn = Boolean(
        e?.isSignedIn || window.EvanGoogleAuth?.isSignedIn?.(),
      )),
        H(T.signedIn),
        L(y()));
      const t = document.getElementById("map-auth-hint");
      t &&
        !T.signedIn &&
        ((t.textContent =
          "訪客僅能瀏覽；登入 Google 帳號後讀取與同步雲端資料。"),
        t.classList.remove("is-signed-in"));
    },
  };
})((window.EvanTimeflowV5 = window.EvanTimeflowV5 || {}));
