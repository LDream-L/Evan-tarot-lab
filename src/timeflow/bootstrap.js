/**
 * 主題時間流 v5｜可閱讀啟動原始碼
 *
 * 主要流程：取得 DOM 參照、初始化狀態、串接 UI／Actions／Cloud。
 * 時間／空間複雜度：O(1)（不含資料載入與各模組自身初始化）。
 *
 * 替代方案比較：
 * - 將啟動流程藏在單行壓縮碼中：載入快但無法安全修改。
 * - 本檔：保留原行為並提供可閱讀入口，正式執行檔由建置流程產生。
 */
/*! 主題時間流 v5 Bootstrap｜init/collect: 時間與空間 O(F)；DOM 引用只收集一次。 */
!(function (e) {
  "use strict";
  const {
      ctx: t,
      C: i,
      clamp: a,
      load: n,
      save: d,
      rebuildIndexes: l,
      ensureSelection: o,
      activeTopics: s,
      activeTimelines: r,
      lineTopic: c,
    } = e,
    p = e.app,
    m = p.refs,
    v = e.ui,
    u = e.actions;
  function f(e, t) {
    let i = 0;
    return (...a) => {
      (window.clearTimeout(i), (i = window.setTimeout(() => e(...a), t)));
    };
  }
  function g() {
    (Object.entries({
      addTopic: "map-add-topic",
      addTimeline: "map-add-timeline",
      addReading: "map-add-reading",
      addEvent: "map-add-event",
      addNote: "map-add-note",
      addChildTimeline: "map-add-child-timeline",
      manageTopic: "map-manage-topic",
      manageTimeline: "map-manage-timeline",
      openTrash: "map-open-trash",
      viewMode: "map-view-mode",
      activeTopic: "map-active-topic",
      activeTimeline: "map-active-timeline",
      filterStatus: "map-filter-status",
      filterCategory: "map-filter-category",
      search: "map-search",
      stats: "map-stats",
      zoomOut: "map-zoom-out",
      zoomReset: "map-zoom-reset",
      zoomIn: "map-zoom-in",
      exportJson: "map-export-json",
      resetData: "map-reset-data",
      viewport: "map-viewport",
      scene: "map-scene",
      connections: "map-connections",
      canvas: "map-canvas",
      emptyState: "map-empty-state",
      detailForm: "map-detail-form",
      detailTypeLabel: "map-detail-type-label",
      detailTitle: "map-detail-title",
      selectedId: "map-selected-id",
      detailId: "map-detail-id",
      fieldTimeline: "map-field-timeline",
      fieldType: "map-field-type",
      fieldRole: "map-field-role",
      fieldPrecision: "map-field-precision",
      dateFields: "map-date-fields",
      fieldDateDay: "map-field-date-day",
      fieldDateMonth: "map-field-date-month",
      fieldDateYear: "map-field-date-year",
      fieldTitle: "map-field-title",
      fieldCategory: "map-field-category",
      fieldSubject: "map-field-subject",
      fieldStatus: "map-field-status",
      fieldCards: "map-field-cards",
      fieldInterpretation: "map-field-interpretation",
      fieldPredictions: "map-field-predictions",
      fieldDescription: "map-field-description",
      fieldTags: "map-field-tags",
      fieldNote: "map-field-note",
      linkType: "map-link-type",
      linkTarget: "map-link-target",
      linkNote: "map-link-note",
      addLink: "map-add-link",
      linkList: "map-link-list",
      deleteNode: "map-delete-node",
      timeline: "map-timeline",
    }).forEach(([e, t]) => {
      m[e] = document.getElementById(t);
    }),
      Object.values(m).every(Boolean) &&
        ((t.state = n()),
        l(),
        o(),
        l(),
        (p.signedIn = Boolean(window.EvanGoogleAuth?.isSignedIn?.())),
        (function () {
          (m.addTopic.addEventListener("click", u.addTopic),
            m.addTimeline.addEventListener("click", u.addTimeline),
            m.addReading.addEventListener("click", () => u.addNode("reading")),
            m.addEvent.addEventListener("click", () => u.addNode("event")),
            m.addNote.addEventListener("click", () => u.addNode("note")),
            m.addChildTimeline.addEventListener("click", u.addChildTimeline),
            m.manageTopic.addEventListener("click", u.manageTopic),
            m.manageTimeline.addEventListener("click", u.manageTimeline),
            m.openTrash.addEventListener("click", u.trashModal),
            m.detailForm.addEventListener("submit", u.saveDetail),
            m.deleteNode.addEventListener("click", u.deleteSelected),
            m.addLink.addEventListener("click", u.addLink),
            m.resetData.addEventListener("click", u.reset),
            m.exportJson.addEventListener("click", u.exportJson),
            m.viewMode.addEventListener("change", () => {
              ((t.state.ui.viewMode =
                "all" === m.viewMode.value ? "all" : "single"),
                "single" === t.state.ui.viewMode &&
                  "all" === t.state.ui.activeTopicId &&
                  (t.state.ui.activeTopicId =
                    c(t.state.ui.activeTimelineId) || s()[0]?.id || ""),
                d(),
                v.render(!0));
            }),
            m.activeTopic.addEventListener("change", () => {
              t.state.ui.activeTopicId = m.activeTopic.value;
              const e = r().filter(
                (e) =>
                  "all" === t.state.ui.activeTopicId ||
                  e.topicId === t.state.ui.activeTopicId,
              );
              (e.some((e) => e.id === t.state.ui.activeTimelineId) ||
                (t.state.ui.activeTimelineId = e[0]?.id || ""),
                d(),
                v.render(!0));
            }),
            m.activeTimeline.addEventListener("change", () => {
              (v.selectLine(m.activeTimeline.value), d(), v.render(!0));
            }),
            m.filterStatus.addEventListener("change", () => {
              ((t.state.ui.filterStatus = m.filterStatus.value),
                d(),
                v.render(!0));
            }),
            m.filterCategory.addEventListener("change", () => {
              ((t.state.ui.filterCategory = m.filterCategory.value),
                d(),
                v.render(!0));
            }),
            m.search.addEventListener(
              "input",
              f(() => {
                ((t.state.ui.search = m.search.value), d(), v.render(!0));
              }, 180),
            ),
            m.fieldPrecision.addEventListener("change", () =>
              v.showDateFields(m.fieldPrecision.value),
            ),
            m.fieldType.addEventListener("change", () => {
              const e = "reading" === m.fieldType.value;
              (document
                .querySelectorAll("[data-reading-only]")
                .forEach((t) => t.classList.toggle("hidden", !e)),
                document
                  .querySelectorAll("[data-description-field]")
                  .forEach((t) => t.classList.toggle("hidden", e)));
            }),
            m.zoomOut.addEventListener("click", () => v.zoom(-0.12)),
            m.zoomIn.addEventListener("click", () => v.zoom(0.12)),
            m.zoomReset.addEventListener("click", () => v.fit(!0)),
            m.viewport.addEventListener(
              "wheel",
              (e) => {
                (e.preventDefault(),
                  v.zoom(e.deltaY > 0 ? -0.09 : 0.09, e.clientX, e.clientY));
              },
              { passive: !1 },
            ),
            m.viewport.addEventListener("pointerdown", (e) => {
              0 !== e.button ||
                e.target.closest("button,input,select,textarea,label") ||
                ((p.pan = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  panX: t.state.ui.panX,
                  panY: t.state.ui.panY,
                }),
                m.viewport.setPointerCapture(e.pointerId),
                m.viewport.classList.add("is-panning"));
            }),
            m.viewport.addEventListener("pointermove", (e) => {
              p.pan &&
                p.pan.pointerId === e.pointerId &&
                ((t.state.ui.panX = p.pan.panX + e.clientX - p.pan.startX),
                (t.state.ui.panY = p.pan.panY + e.clientY - p.pan.startY),
                v.applyTransform());
            }));
          const e = (e) => {
            p.pan &&
              p.pan.pointerId === e.pointerId &&
              ((p.pan = null), m.viewport.classList.remove("is-panning"), d());
          };
          (m.viewport.addEventListener("pointerup", e),
            m.viewport.addEventListener("pointercancel", e),
            m.viewport.addEventListener("click", (e) => {
              [m.viewport, m.scene, m.canvas].includes(e.target) &&
                ((t.state.ui.selectedId = ""), d(), v.render(!1));
            }),
            window.addEventListener("evan-google-auth-change", (e) =>
              v.auth(e.detail),
            ),
            window.addEventListener(
              "resize",
              f(() => v.fit(!1), 180),
            ));
        })(),
        v.render(!0),
        window.EvanGoogleAuth?.onChange?.(v.auth)));
  }
  "loading" === document.readyState
    ? document.addEventListener("DOMContentLoaded", g, { once: !0 })
    : g();
})((window.EvanTimeflowV5 = window.EvanTimeflowV5 || {}));
