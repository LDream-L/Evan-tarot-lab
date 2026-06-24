// ==============================
// lost-item.js
// 塔羅尋物 v4.7：私人 Apps Script 後端運算＋Google Form 回饋
// ==============================
// 主要函式複雜度：
// - handleLostItemForm：O(1)（固定欄位，不含網路延遲）
// - renderLostItemResult：O(c + a + e)，c <= 3、a <= 5、e <= 6
// - handleLostItemFeedbackForm：O(1)
// 空間複雜度：O(c + a + e)
//
// 暴力法：將 78 張牌與全部權重公開在 GitHub，前端自行掃描計分。
// 優化法：前端只送固定輸入並渲染本次結果；完整資料與計分留在
// Google Sheets／Apps Script 後端，降低公開資料量與前端維護成本。
// ==============================

(function initLostItemV47() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 18000;
  const CLIENT_ID_KEY = "evanLostItemClientIdV47";
  const FEEDBACK_FORM = Object.freeze({
    url: "https://docs.google.com/forms/d/e/1FAIpQLScdDR6CrMrs_G7HVMAbQYo95s4AaH5b3KDupUZ9TlD5e5yKLQ/formResponse",
    fields: {
      type: "entry.1980954123",
      title: "entry.2042241666",
      note: "entry.243999010",
      lastLocation: "entry.1220725361",
      status: "entry.2036025518",
      feedbackAt: "entry.1203451900",
    },
  });

  window.lastLostItemContext = null;

  function readValue(id) {
    return String(document.getElementById(id)?.value || "").trim();
  }

  function getApiUrl() {
    const config = window.EVAN_CLOUD_CONFIG || {};
    return String(config.lostItemApiUrl || config.commentsApiUrl || "").trim();
  }

  function isApiConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(getApiUrl());
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function getClientId() {
    let value = localStorage.getItem(CLIENT_ID_KEY);
    if (value) return value;
    value = window.crypto?.randomUUID?.() ||
      `lost_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(CLIENT_ID_KEY, value);
    return value;
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: "follow",
        cache: "no-store",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function setMessage(text, type = "") {
    const element = document.getElementById("lost-item-message");
    if (!element) return;
    element.textContent = text;
    element.classList.remove("hidden", "is-error", "is-success");
    if (type) element.classList.add(type);
  }

  function clearMessage() {
    const element = document.getElementById("lost-item-message");
    if (!element) return;
    element.textContent = "";
    element.classList.add("hidden");
    element.classList.remove("is-error", "is-success");
  }

  function buildRequestPayload() {
    return {
      action: "lostitem",
      itemName: readValue("item-name"),
      cardCount: Number(readValue("card-count") || 3),
      itemType: readValue("item-type"),
      lastAction: readValue("last-action"),
      scene: readValue("scene"),
      roughSearched: readValue("rough-searched"),
      lostDuration: readValue("lost-duration"),
      touchedByOther: readValue("touched-by-other"),
      clientId: getClientId(),
    };
  }

  async function requestByPost(payload) {
    const response = await fetchWithTimeout(getApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`後端回應失敗：HTTP ${response.status}`);
    return response.json();
  }

  async function requestByGet(payload) {
    const url = new URL(getApiUrl());
    Object.entries(payload).forEach(([key, value]) => {
      url.searchParams.set(key, String(value == null ? "" : value));
    });
    url.searchParams.set("_", String(Date.now()));
    const response = await fetchWithTimeout(url.toString(), { method: "GET" });
    if (!response.ok) throw new Error(`後端備援回應失敗：HTTP ${response.status}`);
    return response.json();
  }

  async function requestLostItem(payload) {
    try {
      return await requestByPost(payload);
    } catch (error) {
      console.warn("[lost-item] POST 失敗，改用 GET：", error);
      return requestByGet(payload);
    }
  }

  function addSummary(container, label, value) {
    if (!value) return;
    const item = document.createElement("div");
    item.className = "lost-v47-summary-item";
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(small, strong);
    container.appendChild(item);
  }

  /** 時間複雜度 O(c)，c <= 3；空間複雜度 O(c)。 */
  function renderCards(cards) {
    const container = document.getElementById("lost-item-cards");
    if (!container) return;
    const fragment = document.createDocumentFragment();

    (cards || []).forEach((card, index) => {
      const article = document.createElement("article");
      article.className = "lost-v47-card";

      const title = document.createElement("h5");
      title.textContent = `第 ${index + 1} 張｜${card.name || card.code || "未命名牌"}`;

      const orientation = document.createElement("span");
      orientation.className = `lost-v47-orientation${card.orientation === "逆位" ? " is-reversed" : ""}`;
      orientation.textContent = card.orientation || "正位";
      title.appendChild(orientation);

      const status = document.createElement("p");
      status.textContent = `狀態：${card.statusHint || "—"}`;
      const location = document.createElement("p");
      location.textContent = `場域：${card.areaHint || card.primaryArea || "—"}`;
      const action = document.createElement("p");
      action.textContent = `牌面建議：${card.actionHint || "—"}`;

      article.append(title, status, location, action);
      fragment.appendChild(article);
    });
    container.replaceChildren(fragment);
  }

  /** 時間複雜度 O(a)，a <= 5；空間複雜度 O(a)。 */
  function renderRanking(areas) {
    const body = document.getElementById("lost-item-ranking-body");
    if (!body) return;
    const fragment = document.createDocumentFragment();

    (areas || []).forEach((area, index) => {
      const row = document.createElement("tr");
      [
        index + 1,
        area.area || "—",
        area.score ?? "—",
        area.confidence || "—",
        area.reason || "—",
        area.firstAction || "—",
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      });
      fragment.appendChild(row);
    });
    body.replaceChildren(fragment);
  }

  /** 時間複雜度 O(e)，e <= 6；空間複雜度 O(e)。 */
  function renderEvents(events) {
    const section = document.getElementById("lost-item-events-section");
    const container = document.getElementById("lost-item-events");
    if (!section || !container) return;

    if (!Array.isArray(events) || events.length === 0) {
      container.replaceChildren();
      section.classList.add("hidden");
      return;
    }

    const fragment = document.createDocumentFragment();
    events.forEach((event) => {
      const article = document.createElement("article");
      article.className = "lost-v47-event";
      const title = document.createElement("h5");
      title.textContent = event.name || "事件核對";
      const state = document.createElement("p");
      state.textContent = event.state || "";
      const check = document.createElement("p");
      check.textContent = event.check || "";
      article.append(title, state, check);
      if (event.common) {
        const common = document.createElement("p");
        common.textContent = `常見對應：${event.common}`;
        article.appendChild(common);
      }
      fragment.appendChild(article);
    });
    container.replaceChildren(fragment);
    section.classList.remove("hidden");
  }

  function renderLostItemResult(payload) {
    const result = document.getElementById("lost-item-result");
    const title = document.getElementById("lost-item-result-title");
    const zeroStep = document.getElementById("lost-item-zero-step");
    const summary = document.getElementById("lost-item-summary");
    if (!result || !summary) return;

    title.textContent = `占卜結果｜關於「${payload.itemName || "這個物品"}」`;
    summary.replaceChildren();
    addSummary(summary, "模型", payload.model);
    addSummary(summary, "聚焦程度", payload.focusLevel);
    addSummary(summary, "判讀模式", payload.readingMode);
    addSummary(summary, "先搜順序", payload.searchOrder);

    if (payload.zeroStep) {
      zeroStep.textContent = payload.zeroStep;
      zeroStep.classList.remove("hidden");
    } else {
      zeroStep.textContent = "";
      zeroStep.classList.add("hidden");
    }

    renderCards(payload.cards);
    renderRanking(payload.topAreas);
    renderEvents(payload.events);

    window.lastLostItemContext = {
      itemName: payload.itemName || readValue("item-name"),
      itemNotes: readValue("item-notes"),
      cards: payload.cards || [],
      topAreas: payload.topAreas || [],
      createdAt: payload.createdAt || new Date().toISOString(),
    };

    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.handleLostItemForm = async function handleLostItemForm(event) {
    event.preventDefault();
    const itemNameInput = document.getElementById("item-name");
    const submit = document.getElementById("lost-item-submit");
    const payload = buildRequestPayload();

    if (!payload.itemName) {
      itemNameInput?.focus();
      setMessage("請先輸入要找的物品。", "is-error");
      return;
    }
    if (!isApiConfigured()) {
      setMessage("尋物後端尚未完成設定，請稍後再試。", "is-error");
      return;
    }

    clearMessage();
    if (submit) {
      submit.disabled = true;
      submit.textContent = "後端抽牌與計算中…";
    }

    try {
      const response = await requestLostItem(payload);
      if (!response?.success) throw new Error(response?.error || "後端回傳格式不正確。");
      renderLostItemResult(response);
      setMessage("已完成 v4.7 搜尋排序。", "is-success");
    } catch (error) {
      console.error("[lost-item] 尋物失敗：", error);
      setMessage(error?.message || "尋物計算失敗，請稍後再試。", "is-error");
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "抽牌並產生 Top 5 搜尋順序";
      }
    }
  };

  function nowTaipeiStamp() {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  function buildFeedbackFormData(record) {
    const data = new FormData();
    const fields = FEEDBACK_FORM.fields;
    data.append(fields.type, "lost_item");
    data.append(fields.title, record.itemName || "");
    data.append(fields.note, record.note || "");
    data.append(fields.lastLocation, record.itemNotes || "");
    data.append(fields.status, record.status || "");
    data.append(fields.feedbackAt, record.feedbackAt || nowTaipeiStamp());
    data.append("submit", "Submit");
    return data;
  }

  window.handleLostItemFeedbackForm = function handleLostItemFeedbackForm(event) {
    event.preventDefault();
    const form = event.target;
    const status = String(form.querySelector('input[name="found-status"]:checked')?.value || "");
    const context = window.lastLostItemContext;
    const message = document.getElementById("lost-item-feedback-message");

    if (!context?.itemName) {
      if (message) {
        message.textContent = "請先抽牌產生結果後再回饋。";
        message.classList.remove("hidden");
      }
      return;
    }
    if (!status) return;

    const cards = (context.cards || [])
      .map((card) => `${card.name || card.code || "牌"}${card.orientation ? `（${card.orientation}）` : ""}`)
      .join("、");
    const order = (context.topAreas || []).map((area) => area.area).filter(Boolean).join(" → ");
    const userNote = readValue("found-notes");
    const note = [userNote, cards ? `抽牌：${cards}` : "", order ? `搜尋順序：${order}` : ""]
      .filter(Boolean)
      .join("\n");

    const data = buildFeedbackFormData({
      itemName: context.itemName,
      itemNotes: context.itemNotes,
      status,
      note,
      feedbackAt: nowTaipeiStamp(),
    });

    fetch(FEEDBACK_FORM.url, { method: "POST", mode: "no-cors", body: data })
      .catch((error) => console.warn("[lost-item] 回饋送出失敗：", error));

    form.reset();
    if (message) {
      message.textContent = "感謝你的回饋。";
      message.classList.remove("hidden");
    }
  };
})();
