/**
 * 主題時間流 v5｜可閱讀操作原始碼
 *
 * 主要流程：新增、編輯、刪除、復原、連結、匯出與互動事件。
 * 各操作依既有 Map／Set 索引執行；批次刪除只走必要資料集合。
 *
 * 替代方案比較：
 * - 直接維護單行執行檔：差異難以檢查，錯誤風險高。
 * - 本檔：先以無行為變更的格式化建立可審查基線，再逐步改善命名。
 */
/*! 主題時間流 v5 Actions｜單筆 O(1)；連帶刪除 O(T+L+N+E)、空間 O(L+N)；僅在批次操作掃描集合。 */
!(function (e) {
  "use strict";
  const {
      ctx: t,
      C: i,
      clamp: a,
      esc: n,
      tags: d,
      createTopic: o,
      createTimeline: l,
      createNode: s,
      save: c,
      activeTopics: r,
      activeTimelines: p,
      activeNodes: u,
      lineTopic: m,
      descendants: v,
      deleteNode: f,
      deleteTimeline: I,
      deleteTopic: g,
      restoreBatch: b,
      normalizeLink: h,
      nowIso: y,
      id: T,
      sortNodes: k,
      dateRange: w,
    } = e,
    E = e.app,
    $ = E.refs,
    S = e.ui,
    N = () => window.EvanSiteAccount?.open?.(),
    L = (e, t) =>
      window.EvanDialog?.confirm
        ? window.EvanDialog.confirm(e, t)
        : Promise.resolve(window.confirm(e));
  function M(e, t, i) {
    (e.remove(), i?.(t));
  }
  function A({
    title: e,
    description: t,
    values: i = {},
    topics: a = null,
    allowDelete: d = !1,
  }) {
    return new Promise((o) => {
      const l = document.createElement("div");
      ((l.className = "map-modal-backdrop"),
        (l.innerHTML = `
        <div class="map-modal" role="dialog" aria-modal="true">
          <div class="map-modal-header"><p class="map-form-kicker">Timeflow</p><h3>${n(e)}</h3><p>${n(t)}</p></div>
          <form class="map-modal-form">
            ${a ? `<label>所屬主題<select name="topicId">${a.map((e) => `<option value="${n(e.id)}"${e.id === i.topicId ? " selected" : ""}>${n(e.title)}</option>`).join("")}</select></label>` : ""}
            <label>名稱<input name="title" maxlength="80" value="${n(i.title || "")}" required></label>
            <label>說明<textarea name="description" rows="3">${n(i.description || "")}</textarea></label>
            <div class="map-modal-actions">
              ${d ? '<button type="button" class="btn ghost map-danger-action" data-delete>移到回收區</button>' : ""}
              <button type="button" class="btn ghost" data-cancel>取消</button>
              <button type="submit" class="btn primary">儲存</button>
            </div>
          </form>
        </div>`),
        document.body.appendChild(l));
      const s = l.querySelector("form");
      (s.addEventListener("submit", (e) => {
        e.preventDefault();
        const t = new FormData(s),
          a = String(t.get("title") || "").trim();
        a &&
          M(
            l,
            {
              action: "save",
              title: a,
              description: String(t.get("description") || "").trim(),
              topicId: String(t.get("topicId") || i.topicId || ""),
            },
            o,
          );
      }),
        l
          .querySelector("[data-cancel]")
          .addEventListener("click", () => M(l, null, o)),
        l
          .querySelector("[data-delete]")
          ?.addEventListener("click", () => M(l, { action: "delete" }, o)),
        l.addEventListener("click", (e) => {
          e.target === l && M(l, null, o);
        }),
        window.requestAnimationFrame(() => s.elements.title.focus()));
    });
  }
  e.actions = {
    addTopic: async function () {
      if (!E.signedIn) return N();
      const e = await A({
        title: "新增主題",
        description:
          "主題可以是人物、關係、足球 × 塔羅、研究、專案或任何事物。",
      });
      if (!e || "save" !== e.action) return;
      const i = o(e.title, e.description, t.state.topics.length),
        a = l(i.id, "第一案例時間線", "");
      (t.state.topics.push(i),
        t.state.timelines.push(a),
        (t.state.ui.activeTopicId = i.id),
        (t.state.ui.activeTimelineId = a.id),
        (t.state.ui.viewMode = "single"),
        (t.state.ui.selectedId = ""),
        c(),
        S.render(!0));
    },
    addTimeline: async function () {
      if (!E.signedIn) return N();
      const e =
          "all" === t.state.ui.activeTopicId
            ? m(t.state.ui.activeTimelineId)
            : t.state.ui.activeTopicId,
        i = await A({
          title: "新增案例時間線",
          description:
            "同一案例脈絡中的占卜、事件、結果與補充應留在同一條時間線。",
          values: { topicId: e },
          topics: r(),
        });
      if (!i || "save" !== i.action) return;
      const a = l(i.topicId, i.title, i.description);
      (t.state.timelines.push(a),
        (t.state.ui.activeTopicId = i.topicId),
        (t.state.ui.activeTimelineId = a.id),
        (t.state.ui.viewMode = "single"),
        (t.state.ui.selectedId = ""),
        c(),
        S.render(!0));
    },
    addChildTimeline: async function () {
      if (!E.signedIn) return N();
      const e = S.selected();
      if (!e)
        return L(
          "請先選擇一個節點，再由該節點建立子時間線。",
          "尚未選擇來源節點",
        );
      const a = t.timelineIndex.get(e.timelineId),
        n = await A({
          title: "由節點建立子時間線",
          description: `來源節點：${e.title || i.TYPES[e.type]}。只有形成獨立可追蹤事件鏈時才建議建立。`,
          values: {
            title: `${e.title || "節點"}｜後續發展`,
            topicId: a.topicId,
          },
        });
      if (!n || "save" !== n.action) return;
      const d = l(a.topicId, n.title, n.description, e.id);
      (t.state.timelines.push(d),
        (t.state.ui.activeTopicId = d.topicId),
        (t.state.ui.activeTimelineId = d.id),
        (t.state.ui.viewMode = "single"),
        (t.state.ui.selectedId = ""),
        c(),
        S.render(!0));
    },
    addNode: function (e) {
      if (!E.signedIn) return N();
      const i = t.timelineIndex.get(t.state.ui.activeTimelineId) || p()[0];
      if (!i) return;
      const a = s(i.id, e);
      (t.state.nodes.push(a),
        (t.state.ui.selectedId = a.id),
        S.selectLine(i.id),
        c(),
        S.render(!0));
    },
    manageTopic: async function () {
      if (!E.signedIn) return N();
      const e =
          "all" === t.state.ui.activeTopicId
            ? m(t.state.ui.activeTimelineId)
            : t.state.ui.activeTopicId,
        i = t.topicIndex.get(e);
      if (!i) return;
      const a = await A({
        title: "管理主題",
        description: "修改主題名稱與說明，或將整個主題移到回收區。",
        values: i,
        allowDelete: r().length > 1,
      });
      if (a) {
        if ("delete" === a.action) {
          if (
            !(await L(
              "此主題下的時間線、節點與連結會一起移到回收區。",
              "刪除主題",
            ))
          )
            return;
          g(i.id);
        } else
          ((i.title = a.title),
            (i.description = a.description),
            (i.updatedAt = y()));
        (c(), S.render(!0));
      }
    },
    manageTimeline: async function () {
      if (!E.signedIn) return N();
      const e = t.timelineIndex.get(t.state.ui.activeTimelineId);
      if (!e) return;
      const i = await A({
        title: "管理案例時間線",
        description: e.parentNodeId
          ? "子時間線的主題跟隨來源，只能修改名稱與說明。"
          : "修改名稱、說明或所屬主題。",
        values: e,
        topics: e.parentNodeId ? null : r(),
        allowDelete: p().filter((t) => t.topicId === e.topicId).length > 1,
      });
      if (i) {
        if ("delete" === i.action) {
          if (
            !(await L(
              "此時間線、子時間線、節點與連結會一起移到回收區。",
              "刪除時間線",
            ))
          )
            return;
          I(e.id);
        } else {
          ((e.title = i.title), (e.description = i.description));
          const a = e.parentNodeId ? e.topicId : i.topicId || e.topicId;
          if (a !== e.topicId) {
            const i = v(e.id);
            t.state.timelines.forEach((e) => {
              i.has(e.id) && (e.topicId = a);
            });
          }
          ((e.topicId = a),
            (e.updatedAt = y()),
            "single" === t.state.ui.viewMode && (t.state.ui.activeTopicId = a));
        }
        (c(), S.render(!0));
      }
    },
    saveDetail: function (e) {
      if ((e.preventDefault(), !E.signedIn)) return N();
      const t = S.selected();
      var a;
      t &&
        ((t.timelineId = $.fieldTimeline.value),
        (t.type = i.TYPES[$.fieldType.value] ? $.fieldType.value : t.type),
        (t.role = i.ROLES[$.fieldRole.value] ? $.fieldRole.value : "normal"),
        (t.precision = $.fieldPrecision.value),
        (t.dateValue =
          "day" === (a = t.precision)
            ? $.fieldDateDay.value
            : "month" === a
              ? $.fieldDateMonth.value
              : "year" === a
                ? String($.fieldDateYear.value || "").trim()
                : ""),
        (t.title = $.fieldTitle.value.trim()),
        (t.category = $.fieldCategory.value),
        (t.subject = $.fieldSubject.value.trim()),
        (t.status = $.fieldStatus.value),
        (t.cards = "reading" === t.type ? $.fieldCards.value.trim() : ""),
        (t.interpretation =
          "reading" === t.type ? $.fieldInterpretation.value.trim() : ""),
        (t.predictions =
          "reading" === t.type ? $.fieldPredictions.value.trim() : ""),
        (t.description =
          "reading" === t.type ? "" : $.fieldDescription.value.trim()),
        (t.tags = d($.fieldTags.value)),
        (t.note = $.fieldNote.value.trim()),
        (t.updatedAt = y()),
        S.selectLine(t.timelineId),
        c(),
        S.render(!1));
    },
    deleteSelected: async function () {
      if (!E.signedIn) return N();
      const e = S.selected();
      if (!e) return;
      let i = !1;
      if (
        t.state.timelines.some((t) => !t.deletedAt && t.parentNodeId === e.id)
      ) {
        const e = await ((a = "刪除節點"),
        (d = "此節點已延伸出子時間線，請選擇處理方式。"),
        (o = [
          {
            value: "node",
            label: "只刪除此節點",
            description: "子時間線保留，但來源會顯示在回收區。",
          },
          {
            value: "tree",
            label: "刪除此節點與衍生時間線",
            description: "連帶移除所有子時間線與其節點。",
          },
        ]),
        new Promise((e) => {
          const t = document.createElement("div");
          ((t.className = "map-modal-backdrop"),
            (t.innerHTML = `
        <div class="map-modal" role="dialog" aria-modal="true">
          <div class="map-modal-header"><p class="map-form-kicker">請選擇</p><h3>${n(a)}</h3><p>${n(d)}</p></div>
          <div class="map-choice-list">${o.map((e) => `<button type="button" class="map-choice-button" data-choice="${n(e.value)}"><strong>${n(e.label)}</strong><span>${n(e.description)}</span></button>`).join("")}</div>
          <div class="map-modal-actions"><button type="button" class="btn ghost" data-cancel>取消</button></div>
        </div>`),
            document.body.appendChild(t),
            t.querySelectorAll("[data-choice]").forEach((i) => {
              i.addEventListener("click", () => M(t, i.dataset.choice, e));
            }),
            t
              .querySelector("[data-cancel]")
              .addEventListener("click", () => M(t, "", e)));
        }));
        if (!e) return;
        i = "tree" === e;
      } else if (!(await L("此節點會移到回收區，之後可以復原。", "刪除節點")))
        return;
      var a, d, o;
      (f(e.id, i), c(), S.render(!0));
    },
    addLink: function () {
      if (!E.signedIn) return N();
      const e = S.selected(),
        a = t.nodeIndex.get($.linkTarget.value);
      if (!e || !a || e.id === a.id) return;
      const n = i.LINKS[$.linkType.value] ? $.linkType.value : "related";
      t.state.links.some(
        (t) =>
          !t.deletedAt &&
          t.type === n &&
          ((t.fromNodeId === e.id && t.toNodeId === a.id) ||
            (t.fromNodeId === a.id && t.toNodeId === e.id)),
      ) ||
        (t.state.links.push(
          h({
            id: T("link"),
            fromNodeId: e.id,
            toNodeId: a.id,
            type: n,
            note: $.linkNote.value.trim(),
            createdAt: y(),
          }),
        ),
        ($.linkTarget.value = ""),
        ($.linkNote.value = ""),
        c(),
        S.render(!1));
    },
    removeLink: function (e) {
      if (!E.signedIn) return N();
      const i = t.linkIndex.get(e);
      i &&
        ((i.deletedAt = y()),
        (i.deletedBatchId = T("trash")),
        c(),
        S.render(!1));
    },
    trashModal: function () {
      if (!E.signedIn) return N();
      const e = [
          ...t.state.topics.map((e) => ({ ...e, kind: "主題" })),
          ...t.state.timelines.map((e) => ({ ...e, kind: "案例時間線" })),
          ...t.state.nodes.map((e) => ({
            ...e,
            kind: i.TYPES[e.type] || "節點",
          })),
          ...t.state.links.map((e) => ({
            ...e,
            kind: "虛擬連結",
            title: i.LINKS[e.type],
          })),
        ].filter((e) => e.deletedAt),
        a = new Map();
      e.forEach((e) => {
        const t = e.deletedBatchId || e.id;
        (a.has(t) || a.set(t, { id: t, at: e.deletedAt, items: [] }),
          a.get(t).items.push(e));
      });
      const d = [...a.values()].sort((e, t) => t.at.localeCompare(e.at)),
        o = document.createElement("div");
      ((o.className = "map-modal-backdrop"),
        (o.innerHTML = `
      <div class="map-modal"><div class="map-modal-header"><p class="map-form-kicker">Recycle bin</p><h3>回收區</h3><p>同一次連帶刪除會以同一批次復原。</p></div>
      <div class="map-modal-list">${
        d
          .map((e) => {
            const t = e.items[0],
              i = e.items.length - 1;
            return `<div class="map-trash-item"><div><strong>${n(t.kind)}｜${n(t.title || t.id)}${i ? ` ＋${i} 項` : ""}</strong><span>${n(e.at.replace("T", " ").slice(0, 19))}</span></div><button type="button" class="map-trash-restore" data-batch="${n(e.id)}">復原此批</button></div>`;
          })
          .join("") || '<p class="map-inline-help">回收區目前是空的。</p>'
      }</div>
      <div class="map-modal-actions"><button type="button" class="btn ghost" data-close>關閉</button></div></div>`),
        document.body.appendChild(o),
        o.querySelectorAll("[data-batch]").forEach((e) => {
          e.addEventListener("click", () => {
            (b(e.dataset.batch), c(), o.remove(), S.render(!0));
          });
        }),
        o
          .querySelector("[data-close]")
          .addEventListener("click", () => o.remove()));
    },
    clusterModal: function (e) {
      const d = document.createElement("div");
      ((d.className = "map-modal-backdrop"),
        (d.innerHTML = `
      <div class="map-modal"><div class="map-modal-header"><p class="map-form-kicker">節點聚合</p><h3>此區共有 ${e.length} 個節點</h3><p>放大後會自動垂直展開。</p></div>
      <div class="map-modal-list">${k(e)
        .map(
          (e) =>
            `<button type="button" class="map-choice-button" data-node="${n(e.id)}"><strong>${n(e.title || i.TYPES[e.type])}</strong><span>${n(w(e).label)}｜${i.TYPES[e.type]}</span></button>`,
        )
        .join("")}</div>
      <div class="map-modal-actions"><button type="button" class="btn ghost" data-close>關閉</button><button type="button" class="btn primary" data-zoom>放大展開</button></div></div>`),
        document.body.appendChild(d),
        d.querySelectorAll("[data-node]").forEach((e) => {
          e.addEventListener("click", () => {
            const i = t.nodeIndex.get(e.dataset.node);
            (i && S.selectNode(i), d.remove());
          });
        }),
        d.querySelector("[data-zoom]").addEventListener("click", () => {
          ((t.state.ui.zoom = a(
            Math.max(t.state.ui.zoom + 0.35, 0.9),
            i.MIN_ZOOM,
            i.MAX_ZOOM,
          )),
            c(),
            d.remove(),
            S.render(!1));
        }),
        d
          .querySelector("[data-close]")
          .addEventListener("click", () => d.remove()));
    },
    exportJson: function () {
      const i = new Blob([JSON.stringify(t.state, null, 2)], {
          type: "application/json;charset=UTF-8",
        }),
        a = URL.createObjectURL(i),
        n = document.createElement("a");
      ((n.href = a),
        (n.download = `evan-tarot-timeflow-${e.today()}.json`),
        document.body.appendChild(n),
        n.click(),
        n.remove(),
        URL.revokeObjectURL(a));
    },
    reset: async function () {
      if (!E.signedIn) return N();
      (await L(
        "要清空全部主題時間流嗎？此動作不會進入回收區，請先下載 JSON。",
        "重設時間流",
      )) && ((t.state = e.initialState()), c(), S.render(!0));
    },
  };
})((window.EvanTimeflowV5 = window.EvanTimeflowV5 || {}));
