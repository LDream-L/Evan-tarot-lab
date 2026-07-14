/**
 * 時間樹 v6｜啟動原始碼
 *
 * DOM 參照只收集一次，初始化時間／空間 O(F)，F 為固定欄位數。
 * 相較於每次事件重新查 DOM，集中 refs 可避免重複查詢並讓事件責任清楚。
 */
/*! 時間樹 v6 Bootstrap｜init/collect: 時間與空間 O(F)。 */
(function initTimeflowBootstrap(TF) {
  "use strict";

  const {
    ctx,
    load,
    save,
    rebuildIndexes,
    ensureSelection,
    lineTopic,
  } = TF;
  const app = TF.app;
  const refs = app.refs;
  const ui = TF.ui;
  const actions = TF.actions;

  function debounce(callback, delay) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  function collectRefs() {
    Object.entries({
      addRootBranch: "map-add-topic",
      addReading: "map-add-reading",
      addEvent: "map-add-event",
      addNote: "map-add-note",
      addChildTimeline: "map-add-child-timeline",
      manageTimeline: "map-manage-timeline",
      openTrash: "map-open-trash",
      viewMode: "map-view-mode",
      activeTopic: "map-active-topic",
      activeTimeline: "map-active-timeline",
      showPrivate: "map-show-private",
      filterStatus: "map-filter-status",
      filterCategory: "map-filter-category",
      search: "map-search",
      stats: "map-stats",
      breadcrumb: "map-breadcrumb",
      zoomOut: "map-zoom-out",
      zoomReset: "map-zoom-reset",
      zoomIn: "map-zoom-in",
      zoomLevel: "map-zoom-level",
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
    }).forEach(([key, id]) => {
      refs[key] = document.getElementById(id);
    });
    return Object.values(refs).every(Boolean);
  }

  function bindEvents() {
    refs.addRootBranch.addEventListener("click", actions.addRootBranch);
    refs.addReading.addEventListener("click", () => actions.addNode("reading"));
    refs.addEvent.addEventListener("click", () => actions.addNode("event"));
    refs.addNote.addEventListener("click", () => actions.addNode("note"));
    refs.addChildTimeline.addEventListener("click", actions.addChildTimeline);
    refs.manageTimeline.addEventListener("click", actions.manageTimeline);
    refs.openTrash.addEventListener("click", actions.trashModal);
    refs.detailForm.addEventListener("submit", actions.saveDetail);
    refs.deleteNode.addEventListener("click", actions.deleteSelected);
    refs.addLink.addEventListener("click", actions.addLink);
    refs.resetData.addEventListener("click", actions.reset);
    refs.exportJson.addEventListener("click", actions.exportJson);

    refs.viewMode.addEventListener("change", () => {
      ctx.state.ui.viewMode = refs.viewMode.value === "single" ? "single" : "all";
      if (ctx.state.ui.viewMode === "single" && ctx.state.ui.activeTopicId === "all") {
        ctx.state.ui.activeTopicId = lineTopic(ctx.state.ui.activeTimelineId) || "all";
      }
      save();
      ui.render(true);
    });

    refs.activeTopic.addEventListener("change", () => {
      ctx.state.ui.activeTopicId = refs.activeTopic.value;
      ui.ensureVisibleActiveLine();
      save();
      ui.render(true);
    });

    refs.activeTimeline.addEventListener("change", () => {
      ui.selectLine(refs.activeTimeline.value);
      save();
      ui.render(true);
    });

    refs.showPrivate.addEventListener("change", () => {
      ctx.state.ui.showPrivate = app.signedIn && refs.showPrivate.checked;
      ui.ensureVisibleActiveLine();
      save();
      ui.render(true);
    });

    refs.filterStatus.addEventListener("change", () => {
      ctx.state.ui.filterStatus = refs.filterStatus.value;
      save();
      ui.render(true);
    });
    refs.filterCategory.addEventListener("change", () => {
      ctx.state.ui.filterCategory = refs.filterCategory.value;
      save();
      ui.render(true);
    });
    refs.search.addEventListener("input", debounce(() => {
      ctx.state.ui.search = refs.search.value;
      save();
      ui.render(true);
    }, 180));

    refs.fieldPrecision.addEventListener("change", () => ui.showDateFields(refs.fieldPrecision.value));
    refs.fieldType.addEventListener("change", () => {
      const reading = refs.fieldType.value === "reading";
      document.querySelectorAll("[data-reading-only]").forEach((element) => element.classList.toggle("hidden", !reading));
      document.querySelectorAll("[data-description-field]").forEach((element) => element.classList.toggle("hidden", reading));
    });

    refs.zoomOut.addEventListener("click", () => ui.zoom(-.12));
    refs.zoomIn.addEventListener("click", () => ui.zoom(.12));
    refs.zoomReset.addEventListener("click", () => ui.fit(true));
    refs.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      ui.zoom(event.deltaY > 0 ? -.09 : .09, event.clientX, event.clientY);
    }, { passive: false });

    refs.viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button,input,select,textarea,label,summary")) return;
      app.pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panX: ctx.state.ui.panX,
        panY: ctx.state.ui.panY,
      };
      refs.viewport.setPointerCapture(event.pointerId);
      refs.viewport.classList.add("is-panning");
    });
    refs.viewport.addEventListener("pointermove", (event) => {
      if (!app.pan || app.pan.pointerId !== event.pointerId) return;
      ctx.state.ui.panX = app.pan.panX + event.clientX - app.pan.startX;
      ctx.state.ui.panY = app.pan.panY + event.clientY - app.pan.startY;
      ui.applyTransform();
    });
    const stopPanning = (event) => {
      if (!app.pan || app.pan.pointerId !== event.pointerId) return;
      app.pan = null;
      refs.viewport.classList.remove("is-panning");
      save();
    };
    refs.viewport.addEventListener("pointerup", stopPanning);
    refs.viewport.addEventListener("pointercancel", stopPanning);
    refs.viewport.addEventListener("click", (event) => {
      if (![refs.viewport, refs.scene, refs.canvas].includes(event.target)) return;
      ctx.state.ui.selectedId = "";
      save();
      ui.render(false);
    });

    window.addEventListener("evan-google-auth-change", (event) => ui.auth(event.detail));
    window.addEventListener("resize", debounce(() => ui.fit(false), 180));
  }

  function init() {
    if (!collectRefs()) return;
    ctx.state = load();
    rebuildIndexes();
    ensureSelection();
    rebuildIndexes();
    app.signedIn = Boolean(window.EvanGoogleAuth?.isSignedIn?.());
    bindEvents();
    ui.render(true);
    window.EvanGoogleAuth?.onChange?.(ui.auth);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
