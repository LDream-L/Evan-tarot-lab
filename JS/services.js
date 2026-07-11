// ==============================
// services.js
// 公開占卜服務讀取、呈現與預約選項同步
// ==============================
//
// 主要函式複雜度：
// - normalizeService：時間／空間 O(m)，m = 單筆服務文字總長度
// - renderServices：時間／空間 O(n)，n = 已發布服務數
// - syncBookingOptions：時間／空間 O(n)
// - loadServices：時間 O(n log n)，空間 O(n)（不含網路等待）
//
// 更快替代方案比較：
// - 暴力法：每次畫面更新都重新解析所有欄位並掃描 DOM 尋找對應服務。
// - 本實作：載入後一次正規化、排序並建立 id Map；預約按鈕依 id 直接查表，避免重複查詢。
// ==============================

(function initPublicServices() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 12000;
  const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
  const FALLBACK_SERVICES = Object.freeze([
    Object.freeze({
      id: "relationship",
      title: "人際 / 感情動態占卜",
      summary: "釐清你與某個對象的互動狀態，整理目前適合前進、暫停，或把重心拉回自己的方向。",
      suitableFor: ["曖昧", "忽冷忽熱", "斷聯", "合作對象"],
      focus: ["雙方狀態", "現在能做什麼", "不該做什麼"],
      priceLabel: "費用於確認承接時說明",
      durationLabel: "依問題範圍確認",
      deliveryLabel: "文字或語音",
      followUpLabel: "追問範圍於預約前確認",
      policyNote: "送出需求不代表預約成立。",
      bookingTopic: "relationship",
      sortOrder: 30,
    }),
    Object.freeze({
      id: "career",
      title: "工作 / 職涯路線占卜",
      summary: "整理工作場域氛圍、你在其中的位置，以及跳槽、續留或轉向的風險與機會。",
      suitableFor: ["轉職前後", "升遷機會", "團隊磨合"],
      focus: ["階段性課題", "決策方向", "現實限制"],
      priceLabel: "費用於確認承接時說明",
      durationLabel: "依問題範圍確認",
      deliveryLabel: "文字或語音",
      followUpLabel: "追問範圍於預約前確認",
      policyNote: "不取代職涯、法律或財務專業意見。",
      bookingTopic: "career",
      sortOrder: 20,
    }),
    Object.freeze({
      id: "deep-topic",
      title: "主題深度占卜",
      summary: "針對目前最在意的一個核心主題，進行較完整的牌陣與路線整理，可合併人際、工作與自我。",
      suitableFor: ["卡很久的大問題", "不知道從哪裡切入", "多個面向互相影響"],
      focus: ["問題結構", "可能路線", "後續追蹤"],
      priceLabel: "費用於確認承接時說明",
      durationLabel: "依問題範圍確認",
      deliveryLabel: "文字或語音",
      followUpLabel: "追問範圍於預約前確認",
      policyNote: "複雜主題會先確認是否適合承接。",
      bookingTopic: "deep-topic",
      sortOrder: 10,
    }),
  ]);

  let services = [];
  let serviceById = new Map();
  let dataSource = "fallback";

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.servicesApiUrl
      || window.EVAN_CLOUD_CONFIG?.articlesApiUrl
      || window.EVAN_CLOUD_CONFIG?.commentsApiUrl
      || ""
    ).trim();
  }

  function normalizeTextList(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n|、|,/);
    return source
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function normalizeService(raw) {
    const id = String(raw?.id || "").trim().toLowerCase();
    const title = String(raw?.title || "").trim();
    if (!VALID_ID_PATTERN.test(id) || !title) return null;

    return Object.freeze({
      id,
      title,
      summary: String(raw?.summary || "").trim(),
      suitableFor: normalizeTextList(raw?.suitableFor),
      focus: normalizeTextList(raw?.focus),
      priceLabel: String(raw?.priceLabel || "").trim(),
      durationLabel: String(raw?.durationLabel || "").trim(),
      deliveryLabel: String(raw?.deliveryLabel || "").trim(),
      followUpLabel: String(raw?.followUpLabel || "").trim(),
      policyNote: String(raw?.policyNote || "").trim(),
      bookingTopic: String(raw?.bookingTopic || id).trim() || id,
      sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0,
      updatedAt: String(raw?.updatedAt || "").trim(),
    });
  }

  function compareServices(left, right) {
    if (left.sortOrder !== right.sortOrder) return right.sortOrder - left.sortOrder;
    return left.title.localeCompare(right.title, "zh-Hant");
  }

  function setServices(nextServices, source) {
    services = nextServices.map(normalizeService).filter(Boolean).sort(compareServices);
    if (!services.length) {
      services = FALLBACK_SERVICES.map(normalizeService).filter(Boolean).sort(compareServices);
      dataSource = "fallback";
    } else {
      dataSource = source;
    }
    serviceById = new Map(services.map((service) => [service.id, service]));
    return services;
  }

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        redirect: "follow",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadServices() {
    const apiUrl = getApiUrl();
    if (!apiUrl) return setServices(FALLBACK_SERVICES, "fallback");

    try {
      const url = new URL(apiUrl);
      url.searchParams.set("action", "services");
      url.searchParams.set("_", String(Date.now()));
      const response = await fetchWithTimeout(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.success || !Array.isArray(payload.services)) {
        throw new Error(payload?.error || "服務 API 格式不正確");
      }
      return setServices(payload.services, "cloud");
    } catch (error) {
      console.warn("[services] 雲端服務讀取失敗，使用內建備援：", error);
      return setServices(FALLBACK_SERVICES, "fallback");
    }
  }

  function appendDetail(container, label, value) {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "service-detail-row";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    container.appendChild(row);
  }

  function appendListSection(card, label, items) {
    if (!items.length) return;
    const heading = document.createElement("p");
    heading.className = "service-list-label";
    heading.textContent = label;
    const list = document.createElement("ul");
    list.className = "card-list service-card-list";
    items.forEach((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      list.appendChild(listItem);
    });
    card.append(heading, list);
  }

  function createServiceCard(service) {
    const card = document.createElement("article");
    card.className = "card service-card";
    card.dataset.serviceId = service.id;

    const title = document.createElement("h3");
    title.textContent = service.title;
    const summary = document.createElement("p");
    summary.textContent = service.summary;
    card.append(title, summary);

    appendListSection(card, "適合情境", service.suitableFor);
    appendListSection(card, "整理重點", service.focus);

    const details = document.createElement("dl");
    details.className = "service-details";
    appendDetail(details, "費用", service.priceLabel);
    appendDetail(details, "時間", service.durationLabel);
    appendDetail(details, "交付", service.deliveryLabel);
    appendDetail(details, "追問", service.followUpLabel);
    if (details.children.length) card.appendChild(details);

    if (service.policyNote) {
      const note = document.createElement("p");
      note.className = "service-policy-note";
      note.textContent = service.policyNote;
      card.appendChild(note);
    }

    const action = document.createElement("button");
    action.className = "btn ghost service-booking-button";
    action.type = "button";
    action.dataset.serviceBooking = service.id;
    action.textContent = "選擇這個項目";
    card.appendChild(action);
    return card;
  }

  function renderServices() {
    const list = document.getElementById("service-list");
    if (!list) return;
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
      const option = document.createElement("option");
      option.value = service.bookingTopic;
      option.dataset.serviceId = service.id;
      option.textContent = service.title;
      fragment.appendChild(option);
    });
    group.replaceChildren(fragment);
    if (Array.from(select.options).some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }
  }

  function selectServiceForBooking(serviceId) {
    const service = serviceById.get(String(serviceId || ""));
    const select = document.querySelector('#booking-form select[name="topic"]');
    const booking = document.getElementById("booking");
    if (!service || !select || !booking) return;
    select.value = service.bookingTopic;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    booking.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => select.focus({ preventScroll: true }), 350);
  }

  function bindInteractions() {
    document.getElementById("service-list")?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-service-booking]");
      if (!button) return;
      selectServiceForBooking(button.dataset.serviceBooking || "");
    });
  }

  setServices(FALLBACK_SERVICES, "fallback");
  const ready = loadServices();

  document.addEventListener("DOMContentLoaded", async () => {
    bindInteractions();
    renderServices();
    syncBookingOptions();
    await ready;
    renderServices();
    syncBookingOptions();
  });

  window.EvanServices = Object.freeze({
    ready,
    getData: () => services.slice(),
    getById: (id) => serviceById.get(String(id || "")) || null,
    getSource: () => dataSource,
    reload: loadServices,
    render: renderServices,
  });
})();
