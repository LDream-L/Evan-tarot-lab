// ==============================
// service-admin.js
// 管理員服務新增、編輯、預覽與發布
// ==============================
//
// 主要函式複雜度：
// - loadServices / renderServiceList：時間 O(n)，空間 O(n)
// - selectService：時間 O(1)，服務以 Map 依 ID 查表
// - renderPreview：時間／空間 O(m)，m = 單筆服務文字總長度
// - saveService：時間／空間 O(m)（不含網路等待）
//
// 更快替代方案比較：
// - 暴力法：每次選擇服務都掃描完整陣列，查詢為 O(n)。
// - 本實作：載入後建立 id Map，選取服務直接查表；只有搜尋與重繪清單才線性掃描。
// ==============================

(function initServiceAdminPage() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 15000;
  const PREVIEW_DEBOUNCE_MS = 150;
  const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
  const STATUS_LABELS = Object.freeze({
    draft: "草稿",
    published: "已發布",
    archived: "已封存",
  });

  let services = [];
  let serviceById = new Map();
  let selectedId = "";
  let authorized = false;
  let busy = false;
  let previewTimer = 0;

  const $ = (id) => document.getElementById(id);

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.servicesApiUrl
      || window.EVAN_CLOUD_CONFIG?.articlesApiUrl
      || window.EVAN_CLOUD_CONFIG?.commentsApiUrl
      || ""
    ).trim();
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function requestJson(action, extra = {}) {
    const apiUrl = getApiUrl();
    const credential = window.EvanGoogleAuth?.getCredential?.() || "";
    if (!apiUrl) throw new Error("服務 API 尚未設定。");
    if (!credential) throw new Error("請先登入 Google 帳戶。");

    const response = await fetchWithTimeout(apiUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        action,
        credential,
        requestId: window.crypto?.randomUUID?.() || `${action}_${Date.now().toString(36)}`,
        website: "",
        ...extra,
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch((error) => {
      throw new Error("後端沒有回傳可讀的 JSON。", { cause: error });
    });
    if (!payload?.success) throw new Error(payload?.error || "服務管理操作失敗。");
    return payload;
  }

  function setGate(title, message, state = "loading") {
    $("service-admin-gate-title").textContent = title;
    $("service-admin-gate-message").textContent = message;
    $("service-admin-gate").dataset.state = state;
  }

  function setMessage(message, type = "info") {
    const element = $("service-admin-message");
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("hidden", !message);
    element.dataset.type = type;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    document.querySelectorAll(
      "#service-admin-form button, #service-admin-refresh, #service-admin-new, #service-admin-retry"
    ).forEach((element) => {
      if (element.id === "service-admin-delete" && !selectedId) element.disabled = true;
      else element.disabled = busy;
    });
  }

  function normalizeLines(value) {
    return (Array.isArray(value) ? value : String(value || "").split(/\r?\n/))
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function normalizeService(raw) {
    return Object.freeze({
      id: String(raw?.id || "").trim().toLowerCase(),
      status: String(raw?.status || "draft").trim().toLowerCase(),
      updatedAt: String(raw?.updatedAt || "").trim(),
      title: String(raw?.title || "").trim(),
      summary: String(raw?.summary || "").trim(),
      suitableFor: normalizeLines(raw?.suitableFor),
      focus: normalizeLines(raw?.focus),
      priceLabel: String(raw?.priceLabel || "").trim(),
      durationLabel: String(raw?.durationLabel || "").trim(),
      deliveryLabel: String(raw?.deliveryLabel || "").trim(),
      followUpLabel: String(raw?.followUpLabel || "").trim(),
      policyNote: String(raw?.policyNote || "").trim(),
      bookingTopic: String(raw?.bookingTopic || raw?.id || "").trim(),
      sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0,
      internalNote: String(raw?.internalNote || "").trim(),
    });
  }

  function compareServices(left, right) {
    if (left.sortOrder !== right.sortOrder) return right.sortOrder - left.sortOrder;
    return left.title.localeCompare(right.title, "zh-Hant");
  }

  function rebuildIndex() {
    serviceById = new Map(services.map((service) => [service.id, service]));
  }

  function formatDisplayDate(value) {
    if (!value) return "未設定";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
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

  function makeGeneratedId() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `service-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function getFilteredServices() {
    const query = $("service-admin-search").value.trim().toLowerCase();
    const status = $("service-admin-status-filter").value;
    return services.filter((service) => {
      if (status !== "all" && service.status !== status) return false;
      if (!query) return true;
      return [
        service.id,
        service.title,
        service.priceLabel,
        service.summary,
        service.internalNote,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }

  function renderServiceList() {
    const list = $("service-admin-list");
    const filtered = getFilteredServices();
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "article-admin-empty";
      empty.textContent = "目前沒有符合條件的服務。";
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((service) => {
      const button = document.createElement("button");
      button.className = `article-admin-list-item${service.id === selectedId ? " is-active" : ""}`;
      button.type = "button";
      button.dataset.serviceId = service.id;

      const status = document.createElement("span");
      status.className = "article-admin-status-badge";
      status.textContent = STATUS_LABELS[service.status] || service.status;
      const title = document.createElement("strong");
      title.textContent = service.title || "未命名服務";
      const id = document.createElement("span");
      id.className = "article-admin-list-meta";
      id.textContent = service.id;
      const price = document.createElement("span");
      price.className = "article-admin-list-meta";
      price.textContent = service.priceLabel || "未設定費用";
      button.append(status, title, id, price);
      button.addEventListener("click", () => selectService(service.id));
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }

  function setField(id, value) {
    const element = $(id);
    if (element) element.value = value == null ? "" : String(value);
  }

  function populateForm(service) {
    const isExisting = Boolean(service?.id && serviceById.has(service.id));
    selectedId = isExisting ? service.id : "";
    setField("service-admin-original-id", selectedId);
    setField("service-admin-id", service?.id || makeGeneratedId());
    setField("service-admin-status", service?.status || "draft");
    setField("service-admin-sort-order", service?.sortOrder ?? 0);
    setField("service-admin-title", service?.title || "");
    setField("service-admin-summary", service?.summary || "");
    setField("service-admin-suitable-for", normalizeLines(service?.suitableFor).join("\n"));
    setField("service-admin-focus", normalizeLines(service?.focus).join("\n"));
    setField("service-admin-price", service?.priceLabel || "");
    setField("service-admin-duration", service?.durationLabel || "");
    setField("service-admin-delivery", service?.deliveryLabel || "");
    setField("service-admin-follow-up", service?.followUpLabel || "");
    setField("service-admin-policy", service?.policyNote || "");
    setField("service-admin-booking-topic", service?.bookingTopic || service?.id || "");
    setField("service-admin-internal-note", service?.internalNote || "");

    $("service-admin-id").disabled = isExisting;
    $("service-admin-delete").disabled = !isExisting || busy;
    $("service-admin-editor-title").textContent = isExisting ? "編輯服務" : "新增服務";
    $("service-admin-updated").textContent = isExisting
      ? `最後更新：${formatDisplayDate(service.updatedAt)}`
      : "尚未儲存";

    schedulePreview();
    renderServiceList();
    setMessage("");
  }

  function selectService(serviceId) {
    const service = serviceById.get(serviceId);
    if (!service) return;
    populateForm(service);
    window.scrollTo({
      top: document.querySelector(".article-admin-section")?.offsetTop || 0,
      behavior: "smooth",
    });
  }

  function newService() {
    populateForm({ id: makeGeneratedId(), status: "draft", sortOrder: 0 });
    $("service-admin-title")?.focus();
  }

  function formService() {
    const id = $("service-admin-id").value.trim().toLowerCase();
    const sortOrderRaw = $("service-admin-sort-order").value.trim();
    return {
      id,
      status: $("service-admin-status").value,
      title: $("service-admin-title").value.trim(),
      summary: $("service-admin-summary").value.trim(),
      suitableFor: normalizeLines($("service-admin-suitable-for").value),
      focus: normalizeLines($("service-admin-focus").value),
      priceLabel: $("service-admin-price").value.trim(),
      durationLabel: $("service-admin-duration").value.trim(),
      deliveryLabel: $("service-admin-delivery").value.trim(),
      followUpLabel: $("service-admin-follow-up").value.trim(),
      policyNote: $("service-admin-policy").value.trim(),
      bookingTopic: $("service-admin-booking-topic").value.trim() || id,
      sortOrder: sortOrderRaw === "" ? 0 : Number(sortOrderRaw),
      internalNote: $("service-admin-internal-note").value.trim(),
    };
  }

  function validateService(service) {
    if (!VALID_ID_PATTERN.test(service.id)) {
      throw new Error("服務 ID 須為 2～80 字，只能使用小寫英文、數字、連字號與底線。");
    }
    if (!Object.hasOwn(STATUS_LABELS, service.status)) throw new Error("服務狀態不正確。");
    if (!service.title) throw new Error("請填寫服務名稱。");
    if (!service.summary) throw new Error("請填寫服務簡介。");
    if (!Number.isFinite(service.sortOrder)) throw new Error("排序值必須是數字。");
    if (!VALID_ID_PATTERN.test(service.bookingTopic)) {
      throw new Error("預約表單值只能使用小寫英文、數字、連字號與底線。");
    }
    return service;
  }

  async function saveService(options = {}) {
    if (!authorized || busy) return false;
    const service = formService();
    if (options.status) service.status = options.status;

    try {
      validateService(service);
    } catch (error) {
      setMessage(error.message, "error");
      return false;
    }

    setBusy(true);
    setMessage(service.status === "published" ? "服務發布中…" : "服務儲存中…");
    try {
      const payload = await requestJson("saveService", {
        originalId: $("service-admin-original-id").value.trim(),
        service,
      });
      const saved = normalizeService(payload.service || { ...service, updatedAt: new Date().toISOString() });
      const existingIndex = services.findIndex((item) => item.id === saved.id);
      if (existingIndex >= 0) services[existingIndex] = saved;
      else services.unshift(saved);
      services.sort(compareServices);
      rebuildIndex();
      populateForm(saved);
      setMessage(saved.status === "published" ? "服務已發布。" : "服務已儲存。", "success");
      return true;
    } catch (error) {
      console.error("[service-admin] 儲存失敗：", error);
      setMessage(error?.name === "AbortError" ? "儲存逾時，請重新讀取確認是否已寫入。" : error.message, "error");
      return false;
    } finally {
      setBusy(false);
      $("service-admin-delete").disabled = !selectedId;
    }
  }

  async function deleteService() {
    if (!authorized || !selectedId || busy) return;
    const service = serviceById.get(selectedId);
    const message = `確定永久刪除「${service?.title || selectedId}」？\n\n這會直接刪除 Google Sheets 中的服務列，無法從網站復原。`;
    const confirmed = window.EvanDialog?.confirm
      ? await window.EvanDialog.confirm(message, "永久刪除服務")
      : window.confirm(message);
    if (!confirmed) return;

    setBusy(true);
    setMessage("服務刪除中…");
    try {
      await requestJson("deleteService", { serviceId: selectedId });
      services = services.filter((item) => item.id !== selectedId);
      rebuildIndex();
      newService();
      renderServiceList();
      setMessage("服務已永久刪除。", "success");
    } catch (error) {
      console.error("[service-admin] 刪除失敗：", error);
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadServices(options = {}) {
    if (!authorized || busy) return;
    setBusy(true);
    if (!options.silent) setMessage("正在讀取服務…");
    try {
      const payload = await requestJson("adminServices");
      services = (Array.isArray(payload.services) ? payload.services : [])
        .map(normalizeService)
        .filter((service) => service.id)
        .sort(compareServices);
      rebuildIndex();
      renderServiceList();
      if (selectedId && serviceById.has(selectedId)) populateForm(serviceById.get(selectedId));
      else if (services.length) selectService(services[0].id);
      else newService();
      if (!options.silent) setMessage(`已讀取 ${services.length} 個服務項目。`, "success");
    } catch (error) {
      console.error("[service-admin] 服務讀取失敗：", error);
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
      $("service-admin-delete").disabled = !selectedId;
    }
  }

  async function verifyAdmin() {
    const authState = window.EvanGoogleAuth?.getState?.() || {};
    authorized = false;
    $("service-admin-workspace").classList.add("hidden");
    $("service-admin-gate").classList.remove("hidden");

    if (!authState.isSignedIn) {
      setGate("請先登入管理員帳戶", "請從右上角登入 Google 帳戶；登入後系統會再次向 Apps Script 驗證管理權限。", "locked");
      return false;
    }

    setGate("正在驗證管理權限", "登入成功，正在確認此 Google 帳戶是否為網站管理員。", "loading");
    try {
      const payload = await requestJson("adminStatus");
      if (!payload.isAdmin) throw new Error("此 Google 帳戶沒有服務管理權限。");
      authorized = true;
      setGate("管理員驗證成功", "已開放服務讀取與修改功能。", "success");
      $("service-admin-gate").classList.add("hidden");
      $("service-admin-workspace").classList.remove("hidden");
      await loadServices();
      return true;
    } catch (error) {
      console.error("[service-admin] 管理權限驗證失敗：", error);
      setGate("無法進入服務管理", error.message || "管理員驗證失敗。", "error");
      return false;
    }
  }

  function renderTextList(target, values) {
    target.replaceChildren();
    const fragment = document.createDocumentFragment();
    (values.length ? values : ["尚未設定"]).forEach((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      fragment.appendChild(item);
    });
    target.appendChild(fragment);
  }

  function appendPreviewDetail(target, label, value) {
    if (!value) return;
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    target.appendChild(row);
  }

  function renderPreview() {
    const service = formService();
    $("service-admin-preview-title").textContent = service.title || "尚未輸入服務名稱";
    $("service-admin-preview-summary").textContent = service.summary || "服務簡介會顯示在這裡。";
    renderTextList($("service-admin-preview-suitable"), service.suitableFor);
    renderTextList($("service-admin-preview-focus"), service.focus);

    const details = $("service-admin-preview-details");
    details.replaceChildren();
    appendPreviewDetail(details, "費用", service.priceLabel);
    appendPreviewDetail(details, "時間", service.durationLabel);
    appendPreviewDetail(details, "交付", service.deliveryLabel);
    appendPreviewDetail(details, "追問", service.followUpLabel);
    if (!details.children.length) appendPreviewDetail(details, "資訊", "尚未設定");

    const policy = $("service-admin-preview-policy");
    policy.textContent = service.policyNote || "服務與取消說明會顯示在這裡。";
  }

  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, PREVIEW_DEBOUNCE_MS);
  }

  function bindEvents() {
    $("service-admin-retry").addEventListener("click", verifyAdmin);
    $("service-admin-new").addEventListener("click", newService);
    $("service-admin-refresh").addEventListener("click", () => loadServices());
    $("service-admin-search").addEventListener("input", renderServiceList);
    $("service-admin-status-filter").addEventListener("change", renderServiceList);
    $("service-admin-delete").addEventListener("click", deleteService);
    $("service-admin-save-draft").addEventListener("click", () => {
      setField("service-admin-status", "draft");
      saveService({ status: "draft" });
    });
    $("service-admin-publish").addEventListener("click", () => {
      setField("service-admin-status", "published");
      saveService({ status: "published" });
    });
    $("service-admin-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveService();
    });

    document.querySelectorAll("#service-admin-form input, #service-admin-form textarea, #service-admin-form select")
      .forEach((element) => {
        element.addEventListener("input", schedulePreview);
        element.addEventListener("change", schedulePreview);
      });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    newService();
    await window.EvanSiteAccount?.ready;
    await window.EvanGoogleAuth?.init?.();
    window.EvanGoogleAuth?.onChange?.((state) => {
      if (!state.isSignedIn) {
        authorized = false;
        $("service-admin-workspace").classList.add("hidden");
        $("service-admin-gate").classList.remove("hidden");
        setGate("請先登入管理員帳戶", "請從右上角登入 Google 帳戶。", "locked");
        return;
      }
      verifyAdmin();
    });
  });
})();
