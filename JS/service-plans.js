// ==============================
// service-plans.js
// 公開方案精簡卡片、預約選項與雲端載入狀態
// ==============================
//
// 主要函式複雜度：
// - normalizeService：時間／空間 O(p × m)，p = 方案數、m = 文字長度
// - rebuildPlanIndex：時間／空間 O(n × p)，n = 服務數
// - renderServices：時間／空間 O(n × p × m)
// - selectPlanForBooking：查表 O(1)，表單更新 O(1)
//
// 替代方案比較：
// - 在卡片內先建立完整詳情再用 CSS／另一支程式隱藏：初始化失敗時會整份外露。
// - 本實作：卡片 DOM 只建立摘要；完整欄位保留在資料索引，點「查看詳情」才寫入視窗。
// ==============================

(function initPublicServicePlans() {
  "use strict";

  const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
  const DELIVERY_MODE_LABELS = Object.freeze({
    text: "文字",
    voice: "語音／通話",
    flexible: "文字或語音皆可",
    custom: "依方案說明",
  });
  const SERVICE_SUMMARY_LIMIT = 220;
  const PLAN_SUMMARY_LIMIT = 130;

  let services = [];
  let planByBookingValue = new Map();
  let dataSource = "loading";
  let interactionsBound = false;

  function normalizeTextList(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n|、|,/);
    return source
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function compareBySortOrder(left, right) {
    if (left.sortOrder !== right.sortOrder) return right.sortOrder - left.sortOrder;
    return left.title.localeCompare(right.title, "zh-Hant");
  }

  function normalizePlan(raw, serviceId) {
    const id = String(raw?.id || "").trim().toLowerCase();
    const title = String(raw?.title || "").trim();
    if (!VALID_ID_PATTERN.test(id) || !title) return null;

    return Object.freeze({
      id,
      status: String(raw?.status || "published").trim().toLowerCase(),
      title,
      description: String(raw?.description || "").trim(),
      priceLabel: String(raw?.priceLabel || "").trim(),
      durationLabel: String(raw?.durationLabel || "").trim(),
      deliveryMode: String(raw?.deliveryMode || "custom").trim().toLowerCase(),
      deliveryLabel: String(raw?.deliveryLabel || "").trim(),
      followUpLabel: String(raw?.followUpLabel || "").trim(),
      calculationLabel: String(raw?.calculationLabel || "").trim(),
      sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0,
      bookingValue: String(raw?.bookingValue || `${serviceId}--${id}`).trim(),
    });
  }

  function normalizeService(raw) {
    const id = String(raw?.id || "").trim().toLowerCase();
    const title = String(raw?.title || "").trim();
    if (!VALID_ID_PATTERN.test(id) || !title) return null;

    const plans = (Array.isArray(raw?.plans) ? raw.plans : [])
      .map((plan) => normalizePlan(plan, id))
      .filter((plan) => plan && plan.status === "published")
      .sort(compareBySortOrder);

    return Object.freeze({
      id,
      title,
      summary: String(raw?.summary || "").trim(),
      suitableFor: normalizeTextList(raw?.suitableFor),
      focus: normalizeTextList(raw?.focus),
      policyNote: String(raw?.policyNote || "").trim(),
      bookingTopic: String(raw?.bookingTopic || id).trim() || id,
      sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0,
      plans: Object.freeze(plans),
    });
  }

  function summarizeText(value, limit) {
    const firstParagraph = String(value || "")
      .split(/\n\s*\n/)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (firstParagraph.length <= limit) return firstParagraph;
    return `${firstParagraph.slice(0, limit - 1).trim()}…`;
  }

  function summarizeDuration(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized.match(/\d+\s*[～~–—-]\s*\d+\s*個?工作天|\d+\s*個?工作天/)?.[0] || "";
  }

  function rebuildPlanIndex() {
    planByBookingValue = new Map();
    services.forEach((service) => {
      service.plans.forEach((plan) => {
        planByBookingValue.set(plan.bookingValue, { service, plan });
      });
    });
  }

  function syncFromServiceData() {
    services = (window.EvanServices?.getData?.() || [])
      .map(normalizeService)
      .filter(Boolean)
      .sort(compareBySortOrder);
    dataSource = String(window.EvanServices?.getSource?.() || "unavailable");
    rebuildPlanIndex();
    return services;
  }

  function createStatus(message, options = {}) {
    const status = document.createElement("div");
    status.className = `service-load-state ${options.error ? "is-error" : "is-loading"}`;
    status.setAttribute("role", options.error ? "alert" : "status");

    if (!options.error) {
      const indicator = document.createElement("span");
      indicator.className = "service-load-indicator";
      indicator.setAttribute("aria-hidden", "true");
      status.appendChild(indicator);
    }

    const text = document.createElement("p");
    text.textContent = message;
    status.appendChild(text);

    if (options.retry) {
      const retry = document.createElement("button");
      retry.className = "btn ghost service-load-retry";
      retry.type = "button";
      retry.dataset.serviceRetry = "true";
      retry.textContent = "重新載入方案";
      status.appendChild(retry);
    }
    return status;
  }

  function createQuickFacts(plan) {
    const facts = document.createElement("div");
    facts.className = "service-plan-quick-facts";
    [
      DELIVERY_MODE_LABELS[plan.deliveryMode] || "",
      summarizeDuration(plan.durationLabel),
    ].filter(Boolean).forEach((value) => {
      const item = document.createElement("span");
      item.textContent = value;
      facts.appendChild(item);
    });
    return facts;
  }

  function createPlanCard(service, plan) {
    const card = document.createElement("article");
    card.className = "service-plan-card is-details-enhanced";
    card.dataset.serviceId = service.id;
    card.dataset.planId = plan.id;
    card.dataset.detailsEnhanced = "true";

    const heading = document.createElement("div");
    heading.className = "service-plan-card-heading";
    const title = document.createElement("h4");
    title.textContent = plan.title;
    title.title = plan.title;
    const price = document.createElement("strong");
    price.textContent = plan.priceLabel || "價格另確認";
    heading.append(title, price);
    card.appendChild(heading);

    const summaryText = summarizeText(plan.description, PLAN_SUMMARY_LIMIT);
    if (summaryText) {
      const summary = document.createElement("p");
      summary.className = "service-plan-description";
      summary.textContent = summaryText;
      card.appendChild(summary);
    }

    const quickFacts = createQuickFacts(plan);
    if (quickFacts.children.length) card.appendChild(quickFacts);

    const actions = document.createElement("div");
    actions.className = "service-plan-actions";
    const details = document.createElement("button");
    details.className = "btn ghost service-plan-details-button";
    details.type = "button";
    details.dataset.servicePlanDetails = plan.bookingValue;
    details.textContent = "查看詳情";
    const booking = document.createElement("button");
    booking.className = "btn primary service-plan-booking-button";
    booking.type = "button";
    booking.dataset.servicePlanBooking = plan.bookingValue;
    booking.textContent = "選擇此方案";
    actions.append(details, booking);
    card.appendChild(actions);
    return card;
  }

  function createServiceCard(service) {
    const card = document.createElement("article");
    card.className = "card service-card service-category-card";
    card.dataset.serviceId = service.id;

    const title = document.createElement("h3");
    title.textContent = service.title;
    card.appendChild(title);

    const summaryText = summarizeText(service.summary, SERVICE_SUMMARY_LIMIT);
    if (summaryText) {
      const summary = document.createElement("p");
      summary.className = "service-category-summary";
      summary.textContent = summaryText;
      card.appendChild(summary);
    }

    if (service.plans.length) {
      const label = document.createElement("p");
      label.className = "service-list-label service-plan-section-label";
      label.textContent = "可選方案";
      const list = document.createElement("div");
      list.className = "service-plan-list";
      service.plans.forEach((plan) => list.appendChild(createPlanCard(service, plan)));
      card.append(label, list);
    } else {
      const empty = document.createElement("p");
      empty.className = "service-category-empty";
      empty.textContent = "這項服務目前沒有公開方案，可先提出需求確認。";
      const booking = document.createElement("button");
      booking.className = "btn ghost service-booking-button";
      booking.type = "button";
      booking.dataset.serviceCategoryBooking = service.bookingTopic;
      booking.textContent = "先提出需求";
      card.append(empty, booking);
    }

    if (service.policyNote) {
      const policy = document.createElement("p");
      policy.className = "service-policy-note";
      policy.textContent = service.policyNote;
      card.appendChild(policy);
    }
    return card;
  }

  function renderLoading() {
    const list = document.getElementById("service-list");
    if (!list) return;
    list.replaceChildren(createStatus("正在載入目前公開的方案…"));
    list.dataset.source = "loading";
    list.setAttribute("aria-busy", "true");
  }

  function renderServices() {
    const list = document.getElementById("service-list");
    if (!list) return;

    if (!services.length) {
      const emptyMessage = dataSource === "empty"
        ? "目前沒有已公開的方案。"
        : "目前無法載入公開方案，頁面不會顯示虛擬內容。";
      list.replaceChildren(createStatus(emptyMessage, {
        error: dataSource !== "empty",
        retry: dataSource !== "empty",
      }));
      list.dataset.source = dataSource;
      list.setAttribute("aria-busy", "false");
      return;
    }

    const fragment = document.createDocumentFragment();
    services.forEach((service) => fragment.appendChild(createServiceCard(service)));
    list.replaceChildren(fragment);
    list.dataset.source = dataSource;
    list.setAttribute("aria-busy", "false");
  }

  function syncBookingOptions() {
    const select = document.querySelector('#booking-form select[name="topic"]');
    const group = document.getElementById("service-topic-options");
    if (!select || !group) return;

    const currentValue = select.value;
    const fragment = document.createDocumentFragment();
    services.forEach((service) => {
      if (service.plans.length) {
        service.plans.forEach((plan) => {
          const option = document.createElement("option");
          option.value = plan.bookingValue;
          option.dataset.serviceId = service.id;
          option.dataset.planId = plan.id;
          option.dataset.deliveryMode = plan.deliveryMode;
          option.textContent = `${service.title}｜${plan.title}｜${plan.priceLabel || "價格另確認"}`;
          fragment.appendChild(option);
        });
        return;
      }

      const option = document.createElement("option");
      option.value = service.bookingTopic;
      option.dataset.serviceId = service.id;
      option.textContent = `${service.title}｜規格待確認`;
      fragment.appendChild(option);
    });

    if (!fragment.childNodes.length) {
      const unavailable = document.createElement("option");
      unavailable.disabled = true;
      unavailable.textContent = dataSource === "loading" ? "公開方案載入中…" : "目前沒有可選的公開方案";
      fragment.appendChild(unavailable);
    }

    group.replaceChildren(fragment);
    if (Array.from(select.options).some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }
  }

  function ensureBookingSummary() {
    const form = document.getElementById("booking-form");
    const firstRow = form?.querySelector(".form-row");
    if (!form || !firstRow) return null;
    let summary = document.getElementById("booking-selected-plan");
    if (!summary) {
      summary = document.createElement("p");
      summary.id = "booking-selected-plan";
      summary.className = "booking-selected-plan";
      summary.hidden = true;
      firstRow.insertAdjacentElement("afterend", summary);
    }
    return summary;
  }

  function updateSelectedPlanSummary(bookingValue) {
    const entry = planByBookingValue.get(String(bookingValue || ""));
    const mode = document.querySelector('#booking-form select[name="mode"]');
    const summary = ensureBookingSummary();
    if (!entry) {
      if (summary) summary.hidden = true;
      return;
    }

    if (mode && ["text", "voice", "flexible"].includes(entry.plan.deliveryMode)) {
      mode.value = entry.plan.deliveryMode;
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (summary) {
      const meta = [entry.plan.priceLabel, entry.plan.durationLabel, entry.plan.deliveryLabel]
        .filter(Boolean)
        .join("／");
      summary.textContent = `已選：${entry.service.title}｜${entry.plan.title}${meta ? `（${meta}）` : ""}`;
      summary.hidden = false;
    }
  }

  function selectForBooking(value) {
    const select = document.querySelector('#booking-form select[name="topic"]');
    const booking = document.getElementById("booking");
    if (!select || !booking) return false;
    const optionExists = Array.from(select.options).some((option) => option.value === value);
    if (!optionExists) return false;

    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    updateSelectedPlanSummary(value);
    booking.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => select.focus({ preventScroll: true }), 350);
    return true;
  }

  async function reload() {
    renderLoading();
    dataSource = "loading";
    syncBookingOptions();
    await window.EvanServices?.reload?.();
    syncFromServiceData();
    renderServices();
    syncBookingOptions();
    updateSelectedPlanSummary(document.querySelector('#booking-form select[name="topic"]')?.value || "");
    window.EvanServicePlanDetails?.refresh?.();
    return services.slice();
  }

  function bindInteractions() {
    if (interactionsBound) return;
    interactionsBound = true;
    document.getElementById("service-list")?.addEventListener("click", (event) => {
      const retry = event.target.closest?.("[data-service-retry]");
      if (retry) {
        reload();
        return;
      }
      const plan = event.target.closest?.("[data-service-plan-booking]");
      if (plan) {
        selectForBooking(plan.dataset.servicePlanBooking || "");
        return;
      }
      const category = event.target.closest?.("[data-service-category-booking]");
      if (category) selectForBooking(category.dataset.serviceCategoryBooking || "");
    });
    document.querySelector('#booking-form select[name="topic"]')?.addEventListener("change", (event) => {
      updateSelectedPlanSummary(event.currentTarget.value);
    });
  }

  const ready = (async () => {
    await window.EvanServices?.ready;
    return syncFromServiceData();
  })();

  async function start() {
    bindInteractions();
    renderLoading();
    syncBookingOptions();
    await ready;
    renderServices();
    syncBookingOptions();
    updateSelectedPlanSummary(document.querySelector('#booking-form select[name="topic"]')?.value || "");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.EvanServicePlans = Object.freeze({
    ready,
    reload,
    render: renderServices,
    getData: () => services.slice(),
    getSource: () => dataSource,
    getPlanByBookingValue: (value) => planByBookingValue.get(String(value || "")) || null,
    selectForBooking,
  });
})();
