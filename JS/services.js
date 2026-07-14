// ==============================
// services.js
// 公開服務資料載入器：只接受正式雲端資料，不顯示虛擬服務
// ==============================
//
// 主要函式複雜度：
// - normalizePlan：時間／空間 O(m)，m = 單筆方案文字總長度
// - normalizeService：時間／空間 O(p × m)，p = 單一服務方案數
// - setServices：時間 O(n log n + n × p)，空間 O(n × p)
// - loadServices：時間 O(n log n + n × p)，空間 O(n × p)（不含網路等待）
//
// 替代方案比較：
// - 先畫內建示例再換成雲端資料：看似較快，但會短暫公開不存在的服務。
// - 本實作：載入期間只呈現中性狀態；失敗時顯示重試，不以假資料冒充正式內容。
// ==============================

(function initPublicServiceData() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 12000;
  const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;

  let services = [];
  let serviceById = new Map();
  let dataSource = "loading";
  let lastError = null;

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

  function compareBySortOrder(left, right) {
    if (left.sortOrder !== right.sortOrder) return right.sortOrder - left.sortOrder;
    return left.title.localeCompare(right.title, "zh-Hant");
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
      priceLabel: String(raw?.priceLabel || "").trim(),
      durationLabel: String(raw?.durationLabel || "").trim(),
      deliveryLabel: String(raw?.deliveryLabel || "").trim(),
      followUpLabel: String(raw?.followUpLabel || "").trim(),
      policyNote: String(raw?.policyNote || "").trim(),
      bookingTopic: String(raw?.bookingTopic || id).trim() || id,
      sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0,
      updatedAt: String(raw?.updatedAt || "").trim(),
      plans: Object.freeze(plans),
    });
  }

  function setServices(nextServices, source) {
    services = (Array.isArray(nextServices) ? nextServices : [])
      .map(normalizeService)
      .filter(Boolean)
      .sort(compareBySortOrder);
    serviceById = new Map(services.map((service) => [service.id, service]));
    dataSource = services.length ? source : source === "cloud" ? "empty" : source;
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
    dataSource = "loading";
    lastError = null;

    if (!apiUrl) {
      lastError = new Error("服務 API 尚未設定。");
      return setServices([], "unavailable");
    }

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
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn("[services] 雲端服務讀取失敗，不顯示虛擬備援：", lastError);
      return setServices([], "unavailable");
    }
  }

  const ready = loadServices();

  window.EvanServices = Object.freeze({
    ready,
    reload: loadServices,
    getData: () => services.slice(),
    getById: (id) => serviceById.get(String(id || "")) || null,
    getSource: () => dataSource,
    getError: () => lastError,
  });
})();
