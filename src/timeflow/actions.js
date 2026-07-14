/**
 * 時間樹 v6｜可閱讀操作原始碼
 *
 * 單筆新增與修改使用既有 Map 索引，時間／空間 O(1)；
 * 連帶刪除時間 O(T+L+N+E)、空間 O(L+N)。
 *
 * 更快替代方案比較：
 * - 讓使用者先選「主題／案例時間線／子時間線」：程式簡單，但把內部模型成本轉嫁給使用者。
 * - 本版依操作位置判斷：未選節點時新增第一階分支，選定節點後建立遞迴子分支。
 */
/*! 時間樹 v6 Actions｜單筆 O(1)；批次刪除 O(T+L+N+E)。 */
(function initTimeflowActions(TF) {
  "use strict";

  const {
    ctx,
    C,
    clamp,
    esc,
    tags,
    createTopic,
    createTimeline,
    createNode,
    save,
    activeTimelines,
    activeNodes,
    descendants,
    isTimelinePrivate,
    deleteNode,
    deleteTimeline,
    deleteTopic,
    restoreBatch,
    normalizeLink,
    nowIso,
    id,
    sortNodes,
    dateRange,
  } = TF;

  const app = TF.app;
  const refs = app.refs;
  const ui = TF.ui;
  const openAccount = () => window.EvanSiteAccount?.open?.();
  const confirmAction = (message, title) => window.EvanDialog?.confirm
    ? window.EvanDialog.confirm(message, title)
    : Promise.resolve(window.confirm(message));
  const alertAction = (message, title) => window.EvanDialog?.alert
    ? window.EvanDialog.alert(message, title)
    : Promise.resolve(window.alert(message));

  function closeModal(modal, value, resolve) {
    modal.remove();
    resolve?.(value);
  }

  /** 分支編輯器：時間／空間 O(P)，P 為可選群組數，通常很小。 */
  function openBranchEditor({
    title,
    description,
    values = {},
    allowDelete = false,
    includeSettings = true,
    privacyLocked = false,
  }) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "map-modal-backdrop";
      modal.innerHTML = `
        <div class="map-modal" role="dialog" aria-modal="true">
          <div class="map-modal-header"><p class="map-form-kicker">Time tree</p><h3>${esc(title)}</h3><p>${esc(description)}</p></div>
          <form class="map-modal-form">
            <label>分支名稱<input name="title" maxlength="80" value="${esc(values.title || "")}" required></label>
            <label>分支說明<textarea name="description" rows="3">${esc(values.description || "")}</textarea></label>
            ${includeSettings ? `
              <label>顯示範圍
                <select name="visibility"${privacyLocked ? " disabled" : ""}>
                  <option value="private"${values.visibility !== "public" ? " selected" : ""}>僅自己可見</option>
                  <option value="public"${values.visibility === "public" ? " selected" : ""}>一般顯示</option>
                </select>
              </label>
              ${privacyLocked ? '<p class="map-inline-help">上層分支僅自己可見，因此這條分支會自動繼承私密狀態。</p>' : '<p class="map-inline-help">僅自己可見的分支在未登入與隱藏私密分支時不顯示，也不計入畫面數量。</p>'}
              <label class="map-modal-checkbox"><input name="collapsed" type="checkbox"${values.collapsed ? " checked" : ""}>收合這條分支底下的所有次級分支</label>
            ` : ""}
            <div class="map-modal-actions">
              ${allowDelete ? '<button type="button" class="btn ghost map-danger-action" data-delete>移到回收區</button>' : ""}
              <button type="button" class="btn ghost" data-cancel>取消</button>
              <button type="submit" class="btn primary">儲存</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);
      const form = modal.querySelector("form");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const branchTitle = String(formData.get("title") || "").trim();
        if (!branchTitle) return;
        closeModal(modal, {
          action: "save",
          title: branchTitle,
          description: String(formData.get("description") || "").trim(),
          visibility: privacyLocked ? "private" : (formData.get("visibility") === "public" ? "public" : "private"),
          collapsed: formData.get("collapsed") === "on",
        }, resolve);
      });
      modal.querySelector("[data-cancel]").addEventListener("click", () => closeModal(modal, null, resolve));
      modal.querySelector("[data-delete]")?.addEventListener("click", () => closeModal(modal, { action: "delete" }, resolve));
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal(modal, null, resolve);
      });
      window.requestAnimationFrame(() => form.elements.title.focus());
    });
  }

  function saveAndRender(fit = false) {
    save();
    ui.render(fit);
  }

  async function chooseDeleteMode(title, description, choices) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "map-modal-backdrop";
      modal.innerHTML = `
        <div class="map-modal" role="dialog" aria-modal="true">
          <div class="map-modal-header"><p class="map-form-kicker">請選擇</p><h3>${esc(title)}</h3><p>${esc(description)}</p></div>
          <div class="map-choice-list">${choices.map((choice) => `<button type="button" class="map-choice-button" data-choice="${esc(choice.value)}"><strong>${esc(choice.label)}</strong><span>${esc(choice.description)}</span></button>`).join("")}</div>
          <div class="map-modal-actions"><button type="button" class="btn ghost" data-cancel>取消</button></div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll("[data-choice]").forEach((button) => {
        button.addEventListener("click", () => closeModal(modal, button.dataset.choice, resolve));
      });
      modal.querySelector("[data-cancel]").addEventListener("click", () => closeModal(modal, "", resolve));
    });
  }

  TF.actions = {
    /** 新增第一階分支：時間／空間 O(1)。 */
    async addRootBranch() {
      if (!app.signedIn) return openAccount();
      const result = await openBranchEditor({
        title: "新增第一階分支",
        description: "這會從全域時空主幹長出一條案例、研究或專案分支。",
        values: { visibility: "private", collapsed: false },
      });
      if (!result || result.action !== "save") return;
      const topic = createTopic(result.title, result.description, ctx.state.topics.length);
      const line = createTimeline(topic.id, result.title, result.description, "", result.visibility);
      line.collapsed = result.collapsed;
      ctx.state.topics.push(topic);
      ctx.state.timelines.push(line);
      ctx.state.ui.activeTopicId = topic.id;
      ctx.state.ui.activeTimelineId = line.id;
      ctx.state.ui.viewMode = "single";
      ctx.state.ui.showPrivate = true;
      ctx.state.ui.selectedId = "";
      saveAndRender(true);
    },

    /** 由所選節點建立遞迴分支：時間／空間 O(1)。 */
    async addChildTimeline() {
      if (!app.signedIn) return openAccount();
      const sourceNode = ui.selected();
      if (!sourceNode) {
        await alertAction("請先選擇一個事件節點，再從該節點建立平行分支。", "尚未選擇來源節點");
        return;
      }
      const parentLine = ctx.timelineIndex.get(sourceNode.timelineId);
      if (!parentLine) return;
      const inheritedPrivate = isTimelinePrivate(parentLine.id);
      const result = await openBranchEditor({
        title: "從此建立平行分支",
        description: `來源節點：${sourceNode.title || C.TYPES[sourceNode.type]}。新分支會保留這個真實父節點。`,
        values: {
          title: `${sourceNode.title || "事件"}｜後續分支`,
          visibility: "private",
          collapsed: false,
        },
        privacyLocked: inheritedPrivate,
      });
      if (!result || result.action !== "save") return;
      const line = createTimeline(parentLine.topicId, result.title, result.description, sourceNode.id, result.visibility);
      line.collapsed = result.collapsed;
      ctx.state.timelines.push(line);
      ctx.state.ui.activeTopicId = line.topicId;
      ctx.state.ui.activeTimelineId = line.id;
      ctx.state.ui.viewMode = "single";
      ctx.state.ui.showPrivate = true;
      ctx.state.ui.selectedId = "";
      saveAndRender(true);
    },

    /** 新增節點：陣列尾端加入 O(1)。 */
    addNode(type) {
      if (!app.signedIn) return openAccount();
      const line = ctx.timelineIndex.get(ctx.state.ui.activeTimelineId) || activeTimelines()[0];
      if (!line) return;
      const node = createNode(line.id, type);
      ctx.state.nodes.push(node);
      ctx.state.ui.selectedId = node.id;
      ui.selectLine(line.id);
      saveAndRender(true);
    },

    /** 管理目前分支：時間 O(L+D)，只在根分支更名／刪除時同步必要群組。 */
    async manageTimeline() {
      if (!app.signedIn) return openAccount();
      const line = ctx.timelineIndex.get(ctx.state.ui.activeTimelineId);
      if (!line) return;
      const parentLineId = ctx.parentTimelineByTimelineId.get(line.id) || "";
      const privacyLocked = parentLineId ? isTimelinePrivate(parentLineId) : false;
      const result = await openBranchEditor({
        title: "管理目前分支",
        description: line.parentNodeId
          ? "修改分支名稱、顯示範圍或收合下層；真實來源節點不會因此改變。"
          : "修改第一階分支；它仍會保留在全域時空主幹之下。",
        values: line,
        allowDelete: activeTimelines().length > 1,
        privacyLocked,
      });
      if (!result) return;
      if (result.action === "delete") {
        if (!(await confirmAction("這條分支、所有下層分支、事件與連結都會一起移到回收區。", "刪除分支"))) return;
        const subtreeIds = descendants(line.id);
        const hasSiblingInTopic = activeTimelines().some(
          (candidate) => candidate.topicId === line.topicId && !subtreeIds.has(candidate.id)
        );
        if (!line.parentNodeId && !hasSiblingInTopic) deleteTopic(line.topicId);
        else deleteTimeline(line.id);
        saveAndRender(true);
        return;
      }

      const topic = ctx.topicIndex.get(line.topicId);
      const generic = /^(第一(?:案例)?時間線|第一條時間線|新案例時間線|第一分支)$/.test(line.title);
      const syncTopicTitle = !line.parentNodeId && topic && (generic || topic.title === line.title);
      line.title = result.title;
      line.description = result.description;
      line.visibility = privacyLocked ? "private" : result.visibility;
      line.collapsed = result.collapsed;
      line.updatedAt = nowIso();
      if (syncTopicTitle) {
        topic.title = result.title;
        topic.description = result.description;
        topic.updatedAt = line.updatedAt;
      }
      saveAndRender(true);
    },

    /** 儲存節點詳細資料：時間／空間 O(1)。 */
    saveDetail(event) {
      event.preventDefault();
      if (!app.signedIn) return openAccount();
      const node = ui.selected();
      if (!node) return;
      node.timelineId = refs.fieldTimeline.value;
      node.type = C.TYPES[refs.fieldType.value] ? refs.fieldType.value : node.type;
      node.role = C.ROLES[refs.fieldRole.value] ? refs.fieldRole.value : "normal";
      node.precision = refs.fieldPrecision.value;
      node.dateValue = node.precision === "day" ? refs.fieldDateDay.value
        : node.precision === "month" ? refs.fieldDateMonth.value
          : node.precision === "year" ? String(refs.fieldDateYear.value || "").trim()
            : "";
      node.title = refs.fieldTitle.value.trim();
      node.category = refs.fieldCategory.value;
      node.subject = refs.fieldSubject.value.trim();
      node.status = refs.fieldStatus.value;
      node.cards = node.type === "reading" ? refs.fieldCards.value.trim() : "";
      node.interpretation = node.type === "reading" ? refs.fieldInterpretation.value.trim() : "";
      node.predictions = node.type === "reading" ? refs.fieldPredictions.value.trim() : "";
      node.description = node.type === "reading" ? "" : refs.fieldDescription.value.trim();
      node.tags = tags(refs.fieldTags.value);
      node.note = refs.fieldNote.value.trim();
      node.updatedAt = nowIso();
      ui.selectLine(node.timelineId);
      saveAndRender(false);
    },

    /** 刪除節點：單筆 O(1)，含子樹時 O(T+L+N+E)。 */
    async deleteSelected() {
      if (!app.signedIn) return openAccount();
      const node = ui.selected();
      if (!node) return;
      let includeChildren = false;
      if (ctx.state.timelines.some((line) => !line.deletedAt && line.parentNodeId === node.id)) {
        const mode = await chooseDeleteMode(
          "刪除節點",
          "這個節點已長出分支，請決定是否連同整個子樹刪除。",
          [
            { value: "node", label: "只刪除此節點", description: "下層分支保留，但來源會顯示為回收區節點。" },
            { value: "tree", label: "刪除節點與整個子樹", description: "連帶移除所有下層分支與事件。" },
          ],
        );
        if (!mode) return;
        includeChildren = mode === "tree";
      } else if (!(await confirmAction("此節點會移到回收區，之後可以復原。", "刪除節點"))) {
        return;
      }
      deleteNode(node.id, includeChildren);
      saveAndRender(true);
    },

    /** 新增虛擬連結：重複檢查 O(E)，空間 O(1)。 */
    addLink() {
      if (!app.signedIn) return openAccount();
      const from = ui.selected();
      const to = ctx.nodeIndex.get(refs.linkTarget.value);
      if (!from || !to || from.id === to.id) return;
      const type = C.LINKS[refs.linkType.value] ? refs.linkType.value : "related";
      const exists = ctx.state.links.some((link) => !link.deletedAt && link.type === type && (
        (link.fromNodeId === from.id && link.toNodeId === to.id)
        || (link.fromNodeId === to.id && link.toNodeId === from.id)
      ));
      if (exists) return;
      ctx.state.links.push(normalizeLink({
        id: id("link"),
        fromNodeId: from.id,
        toNodeId: to.id,
        type,
        note: refs.linkNote.value.trim(),
        createdAt: nowIso(),
      }));
      refs.linkTarget.value = "";
      refs.linkNote.value = "";
      saveAndRender(false);
    },

    removeLink(linkId) {
      if (!app.signedIn) return openAccount();
      const link = ctx.linkIndex.get(linkId);
      if (!link) return;
      link.deletedAt = nowIso();
      link.deletedBatchId = id("trash");
      saveAndRender(false);
    },

    /** 回收區分批索引：時間／空間 O(T+L+N+E)。 */
    trashModal() {
      if (!app.signedIn) return openAccount();
      const deleted = [
        ...ctx.state.topics.map((item) => ({ ...item, kind: "分支群組" })),
        ...ctx.state.timelines.map((item) => ({ ...item, kind: "分支" })),
        ...ctx.state.nodes.map((item) => ({ ...item, kind: C.TYPES[item.type] || "節點" })),
        ...ctx.state.links.map((item) => ({ ...item, kind: "虛擬連結", title: C.LINKS[item.type] })),
      ].filter((item) => item.deletedAt);
      const batches = new Map();
      deleted.forEach((item) => {
        const batchId = item.deletedBatchId || item.id;
        if (!batches.has(batchId)) batches.set(batchId, { id: batchId, at: item.deletedAt, items: [] });
        batches.get(batchId).items.push(item);
      });
      const sorted = [...batches.values()].sort((a, b) => b.at.localeCompare(a.at));
      const modal = document.createElement("div");
      modal.className = "map-modal-backdrop";
      modal.innerHTML = `
        <div class="map-modal"><div class="map-modal-header"><p class="map-form-kicker">Recycle bin</p><h3>回收區</h3><p>同一次連帶刪除會以同一批次復原。</p></div>
        <div class="map-modal-list">${sorted.map((batch) => {
          const first = batch.items[0];
          const extra = batch.items.length - 1;
          return `<div class="map-trash-item"><div><strong>${esc(first.kind)}｜${esc(first.title || first.id)}${extra ? ` ＋${extra} 項` : ""}</strong><span>${esc(batch.at.replace("T", " ").slice(0, 19))}</span></div><button type="button" class="map-trash-restore" data-batch="${esc(batch.id)}">復原此批</button></div>`;
        }).join("") || '<p class="map-inline-help">回收區目前是空的。</p>'}</div>
        <div class="map-modal-actions"><button type="button" class="btn ghost" data-close>關閉</button></div></div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll("[data-batch]").forEach((button) => {
        button.addEventListener("click", () => {
          restoreBatch(button.dataset.batch);
          modal.remove();
          saveAndRender(true);
        });
      });
      modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
    },

    clusterModal(nodes) {
      const modal = document.createElement("div");
      modal.className = "map-modal-backdrop";
      modal.innerHTML = `
        <div class="map-modal"><div class="map-modal-header"><p class="map-form-kicker">事件聚合</p><h3>此區共有 ${nodes.length} 個事件</h3><p>選擇一項查看，或放大畫布讓節點展開。</p></div>
        <div class="map-modal-list">${sortNodes(nodes).map((node) => `<button type="button" class="map-choice-button" data-node="${esc(node.id)}"><strong>${esc(node.title || C.TYPES[node.type])}</strong><span>${esc(dateRange(node).label)}｜${C.TYPES[node.type]}</span></button>`).join("")}</div>
        <div class="map-modal-actions"><button type="button" class="btn ghost" data-close>關閉</button><button type="button" class="btn primary" data-zoom>放大展開</button></div></div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll("[data-node]").forEach((button) => {
        button.addEventListener("click", () => {
          const node = ctx.nodeIndex.get(button.dataset.node);
          if (node) ui.selectNode(node);
          modal.remove();
        });
      });
      modal.querySelector("[data-zoom]").addEventListener("click", () => {
        ctx.state.ui.zoom = clamp(Math.max(ctx.state.ui.zoom + .35, .9), C.MIN_ZOOM, C.MAX_ZOOM);
        save();
        modal.remove();
        ui.render(false);
      });
      modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
    },

    /** 完整私密備份：時間／空間 O(S)，S 為序列化資料大小。 */
    exportJson() {
      if (!app.signedIn) return openAccount();
      const blob = new Blob([JSON.stringify(ctx.state, null, 2)], { type: "application/json;charset=UTF-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `evan-tarot-time-tree-${TF.today()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },

    async reset() {
      if (!app.signedIn) return openAccount();
      if (!(await confirmAction("要清空整棵時間樹嗎？此動作不會進入回收區，請先下載 JSON。", "重設時間樹"))) return;
      ctx.state = TF.initialState();
      saveAndRender(true);
    },
  };
})(window.EvanTimeflowV5 = window.EvanTimeflowV5 || {});
