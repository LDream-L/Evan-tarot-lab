// ==============================
// service-plan-details.js
// 公開方案卡精簡摘要＋完整詳情視窗
// ==============================
//
// 主要函式複雜度：
// - summarizeDescription / summarizeDuration：時間／空間 O(m)，m = 欄位文字長度
// - enhancePlanCard：時間／空間 O(m)
// - enhancePlanCards：時間 O(p × m)，空間 O(m)，p = 目前公開方案數
// - populatePlanDialog：時間／空間 O(m)
// - init：時間 O(p × m)，空間 O(p + m)
//
// 更快替代方案比較：
// - 每張卡直接攤開完整說明：不需互動，但會讓卡片過長並迫使字級縮小。
// - 本實作：卡片只保留摘要與快速資訊，完整內容共用單一 dialog；
//   不為每個方案建立一份隱藏詳情 DOM，減少重複節點並維持正常閱讀字級。
// ==============================

(function defineServicePlanDetails() {
  "use strict";

  if (window.EvanServicePlanDetails) return;

  const DELIVERY_MODE_LABELS = Object.freeze({
    text: "文字",
    voice: "語音／通話",
    flexible: "文字或語音皆可",
    custom: "依方案說明",
  });
  const DESCRIPTION_PREVIEW_LIMIT = 150;

  let initialized = false;
  let activeBookingValue = "";
  let returnFocus = null;
  let listObserver = null;

  const getElement = (id) => document.getElementById(id);

  /** 將完整範圍濃縮為卡片首段摘要。時間／空間 O(m)。 */
  function summarizeDescription(value) {
    const firstParagraph = String(value || "")
      .split(/\n\s*\n/)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (firstParagraph.length <= DESCRIPTION_PREVIEW_LIMIT) return firstParagraph;
    return `${firstParagraph.slice(0, DESCRIPTION_PREVIEW_LIMIT - 1).trim()}…`;
  }

  /** 從工期文字擷取最有辨識度的工作天範圍。時間 O(m)，空間 O(1)。 */
  function summarizeDuration(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized.match(/\d+\s*[～~–—-]\s*\d+\s*個?工作天|\d+\s*個?工作天/)?.[0] || "";
  }

  /** 建立方案卡快速資訊標籤。時間／空間 O(m)。 */
  function createQuickFacts(plan) {
    const facts = document.createElement("div");
    facts.className = "service-plan-quick-facts";
    const values = [
      DELIVERY_MODE_LABELS[plan.deliveryMode] || "",
      summarizeDuration(plan.durationLabel),
    ].filter(Boolean);

    values.forEach((value) => {
      const item = document.createElement("span");
      item.textContent = value;
      facts.appendChild(item);
    });
    return facts;
  }

  /** 將單張既有方案卡改為摘要卡，不改動方案資料。時間／空間 O(m)。 */
  function enhancePlanCard(card) {
    if (!(card instanceof HTMLElement) || card.dataset.detailsEnhanced === "true") return;
    const bookingButton = card.querySelector("[data-service-plan-booking]");
    const bookingValue = bookingButton?.dataset.servicePlanBooking || "";
    const entry = window.EvanServicePlans?.getPlanByBookingValue?.(bookingValue);
    if (!bookingButton || !entry?.plan) return;

    const title = card.querySelector("h4");
    const description = card.querySelector(".service-plan-description");
    if (title) title.title = entry.plan.title;
    if (description) description.textContent = summarizeDescription(entry.plan.description);

    const quickFacts = createQuickFacts(entry.plan);
    if (quickFacts.children.length) bookingButton.insertAdjacentElement("beforebegin", quickFacts);

    const actions = document.createElement("div");
    actions.className = "service-plan-actions";

    const detailsButton = document.createElement("button");
    detailsButton.className = "btn ghost service-plan-details-button";
    detailsButton.type = "button";
    detailsButton.dataset.servicePlanDetails = bookingValue;
    detailsButton.textContent = "查看詳情";

    bookingButton.classList.replace("ghost", "primary");
    actions.append(detailsButton, bookingButton);
    card.appendChild(actions);
    card.classList.add("is-details-enhanced");
    card.dataset.detailsEnhanced = "true";
  }

  /** 批次補強目前方案卡。時間 O(p × m)，空間 O(m)。 */
  function enhancePlanCards(root = document) {
    const cards = root instanceof Element && root.matches(".service-plan-card")
      ? [root]
      : Array.from(root.querySelectorAll?.(".service-plan-card") || []);
    cards.forEach(enhancePlanCard);
  }

  /** 建立詳情列。時間／空間 O(m)。 */
  function appendDialogDetail(list, label, value) {
    const text = String(value || "").trim();
    if (!text) return;
    const row = document.createElement("div");
    row.className = "service-plan-dialog-row";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = text;
    row.append(term, description);
    list.appendChild(row);
  }

  /** 組合交付模式與完整交付內容。時間／空間 O(m)。 */
  function buildDeliveryText(plan) {
    const mode = DELIVERY_MODE_LABELS[plan.deliveryMode] || "";
    const detail = String(plan.deliveryLabel || "").trim();
    if (!detail) return mode;
    if (!mode || detail.includes(mode)) return detail;
    return `${mode}｜${detail}`;
  }

  /** 將服務層級的適合情境／整理重點寫入詳情視窗。時間／空間 O(k)。 */
  function populateDialogList(sectionId, listId, values) {
    const section = getElement(sectionId);
    const list = getElement(listId);
    const items = (Array.isArray(values) ? values : []).filter(Boolean);
    list.replaceChildren();
    items.forEach((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      list.appendChild(item);
    });
    section.hidden = !items.length;
    return items.length;
  }

  /** 將指定方案寫入共用詳情視窗。時間／空間 O(m)。 */
  function populatePlanDialog(entry) {
    const { service, plan } = entry;
    getElement("service-plan-dialog-service").textContent = service.title;
    getElement("service-plan-dialog-title").textContent = plan.title;
    getElement("service-plan-dialog-price").textContent = plan.priceLabel || "價格另確認";
    getElement("service-plan-dialog-description").textContent = plan.description || "尚未提供方案範圍說明。";

    const contextCount = populateDialogList(
      "service-plan-dialog-suitable-section",
      "service-plan-dialog-suitable",
      service.suitableFor
    ) + populateDialogList(
      "service-plan-dialog-focus-section",
      "service-plan-dialog-focus",
      service.focus
    );
    getElement("service-plan-dialog-context").hidden = contextCount === 0;

    const details = getElement("service-plan-dialog-details");
    details.replaceChildren();
    appendDialogDetail(details, "時間", plan.durationLabel);
    appendDialogDetail(details, "交付", buildDeliveryText(plan));
    appendDialogDetail(details, "計算／工作量", plan.calculationLabel);
    appendDialogDetail(details, "追問", plan.followUpLabel);

    const policy = getElement("service-plan-dialog-policy");
    policy.textContent = service.policyNote || "";
    policy.hidden = !service.policyNote;
  }

  /** 開啟指定方案詳情。查表 O(1)，內容寫入時間／空間 O(m)。 */
  function openPlanDialog(bookingValue, trigger) {
    const entry = window.EvanServicePlans?.getPlanByBookingValue?.(bookingValue);
    const dialog = getElement("service-plan-dialog");
    if (!entry || !(dialog instanceof HTMLDialogElement)) return false;

    if (dialog.open) dialog.close();
    activeBookingValue = String(bookingValue || "");
    returnFocus = trigger instanceof HTMLElement ? trigger : null;
    populatePlanDialog(entry);
    document.body.classList.add("service-plan-dialog-open");
    dialog.showModal();
    return true;
  }

  /** 關閉詳情視窗。時間／空間 O(1)。 */
  function closePlanDialog() {
    const dialog = getElement("service-plan-dialog");
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  }

  /** 選取目前詳情對應方案，沿用既有預約流程。時間 O(p)，空間 O(1)。 */
  function selectActivePlan() {
    const bookingValue = activeBookingValue;
    closePlanDialog();
    window.setTimeout(() => {
      if (window.EvanServicePlans?.selectForBooking?.(bookingValue)) return;
      const bookingButton = Array.from(document.querySelectorAll("[data-service-plan-booking]"))
        .find((button) => button.dataset.servicePlanBooking === bookingValue);
      bookingButton?.click();
    }, 0);
  }

  /** 綁定共用詳情視窗事件。時間／空間 O(1)。 */
  function bindDialog(dialog) {
    dialog.querySelectorAll("[data-service-plan-dialog-close]").forEach((button) => {
      button.addEventListener("click", closePlanDialog);
    });
    getElement("service-plan-dialog-select").addEventListener("click", selectActivePlan);

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closePlanDialog();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const panel = dialog.querySelector(".service-plan-dialog-panel");
      const bounds = panel.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) closePlanDialog();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("service-plan-dialog-open");
      activeBookingValue = "";
      const focusTarget = returnFocus;
      returnFocus = null;
      focusTarget?.focus?.({ preventScroll: true });
    });
  }

  /** 初始化摘要卡、詳情視窗與重繪監看。時間 O(p × m)，空間 O(p + m)。 */
  async function init() {
    if (initialized) return true;
    const list = getElement("service-list");
    const dialog = getElement("service-plan-dialog");
    if (!list || !(dialog instanceof HTMLDialogElement)) return false;

    await window.EvanServicePlans?.ready;
    initialized = true;
    bindDialog(dialog);
    enhancePlanCards(list);
    list.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-service-plan-details]");
      if (button) openPlanDialog(button.dataset.servicePlanDetails || "", button);
    });

    listObserver = new MutationObserver(() => enhancePlanCards(list));
    listObserver.observe(list, { childList: true, subtree: true });
    return true;
  }

  const ready = new Promise((resolve) => {
    const start = () => init().then(resolve).catch((error) => {
      console.error("[service-plan-details] 初始化失敗：", error);
      resolve(false);
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  });

  window.EvanServicePlanDetails = Object.freeze({
    ready,
    init,
    open: openPlanDialog,
    close: closePlanDialog,
    refresh: () => enhancePlanCards(getElement("service-list") || document),
  });
})();
