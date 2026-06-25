// ==============================
// lost-item-v50.js
// 塔羅尋物 v5.0.0：私人 Apps Script 後端運算＋Google Form 回饋
// ==============================
// 主要函式複雜度：
// - handleLostItemForm：O(1)（固定欄位，不含網路延遲）
// - renderLostItemResult：O(c + a + e)，c <= 3、a <= 5、e <= 8
// - handleLostItemFeedbackForm：O(1)
// 空間複雜度：O(c + a + e)
//
// 暴力法：前端公開 78 張牌與全部區域資料並自行計分。
// 優化法：前端只送固定輸入並渲染結果；完整牌面資料與大型區域反查留在
// Google Sheets／Apps Script 後端，避免公開模型資料並降低前端維護成本。
// ==============================

(function initLostItemV50() {
  "use strict";

  const EXPECTED_VERSION = "5.0.0";
  const REQUEST_TIMEOUT_MS = 18000;
  const CLIENT_ID_KEY = "evanLostItemClientIdV50";
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
      notes: readValue("item-notes"),
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
      console.warn("[lost-item-v5] POST 失敗，改用 GET：", error);
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

      const area = document.createElement("p");
      const highestAreas = Array.isArray(card.highestAreas) ? card.highestAreas.filter(Boolean) : [];
      area.textContent = `最高大型區域：${highestAreas.join("／") || "無明確大型區域"}`;

      const status = document.createElement("p");
      status.textContent = `狀態提示：${card.statusHint || "—"}`;

      const orientationNote = document.createElement("p");
      orientationNote.className = "lost-v50-muted";
      orientationNote.textContent = card.orientation === "逆位"
        ? "逆位只作內化／受阻提示，不改大型區域與空間分數。"
        : "正位依原始牌面資料判讀。";

      article.append(title, area, status, orientationNote);
      fragment.appendChild(article);
    });
    container.replaceChildren(fragment);
  }

  /** 時間複雜度 O(c)，c <= 3；空間複雜度 O(c)。 */
  function renderSpatial(cards) {
    const container = document.getElementById("lost-item-spatial-cards");
    if (!container) return;
    const fragment = document.createDocumentFragment();

    (cards || []).forEach((card, index) => {
      const spatial = card.spatial || {};
      const article = document.createElement("article");
      article.className = "lost-v50-spatial-card";

      const title = document.createElement("h5");
      title.textContent = `第 ${index + 1} 張｜${card.name || card.code || "未命名牌"}`;

      const list = document.createElement("dl");
      [
        ["垂直高度", spatial.verticalHeight],
        ["放置關係", spatial.placementRelation],
        ["可視狀態", spatial.visibility],
        ["動態狀態", spatial.motion],
        ["牌面依據", spatial.basis],
      ].forEach(([label, value]) => {
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value || "—";
        list.append(term, detail);
      });

      article.append(title, list);
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
      const confidence = `${area.confidence || "—"}${area.tied ? "（並列）" : ""}`;
      [
        index + 1,
        area.area || "—",
        area.score ?? "—",
        confidence,
        area.cardEvidence || area.reason || "—",
        area.subAreas || "—",
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

  /** 時間複雜度 O(e)，e <= 8；空間複雜度 O(e)。 */
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

      if (event.triggeredCards) {
        const trigger = document.createElement("p");
        trigger.textContent = `觸發牌面：${event.triggeredCards}`;
        article.appendChild(trigger);
      }
      if (event.common) {
        const basis = document.createElement("p");
        basis.textContent = `直接圖像基準：${event.common}`;
        article.appendChild(basis);
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
    const areaNotice = document.getElementById("lost-item-area-notice");
    if (!result || !summary) return;

    title.textContent = `占卜結果｜關於「${payload.itemName || "這個物品"}」`;
    summary.replaceChildren();
    addSummary(summary, "模型", payload.model);
    addSummary(summary, "大型區域聚焦", payload.focusLevel);
    addSummary(summary, "判讀模式", payload.readingMode);
    addSummary(summary, "搜尋順序", payload.searchOrder);

    if (areaNotice) areaNotice.textContent = payload.areaNotice || "";

    if (payload.zeroStep) {
      zeroStep.textContent = payload.zeroStep;
      zeroStep.classList.remove("hidden");
    } else {
      zeroStep.textContent = "";
      zeroStep.classList.add("hidden");
    }

    renderCards(payload.cards);
    renderRanking(payload.topAreas);
    renderSpatial(payload.cards);
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
      submit.textContent = "後端抽牌與大型區域反查中…";
    }

    try {
      const response = await requestLostItem(payload);
      if (!response?.success) throw new Error(response?.error || "後端回傳格式不正確。");
      if (String(response.version || "") !== EXPECTED_VERSION) {
        throw new Error(`網站已更新至 v${EXPECTED_VERSION}，但 Apps Script 後端仍是 v${response.version || "未知"}；請先部署新版後端。`);
      }
      renderLostItemResult(response);
      setMessage("已完成 v5.0.0 大型區域反查。", "is-success");
    } catch (error) {
      console.error("[lost-item-v5] 尋物失敗：", error);
      setMessage(error?.message || "尋物計算失敗，請稍後再試。", "is-error");
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "抽牌並產生大型區域搜尋順序";
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
    data.append(fields.type, "lost_item_v5");
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
    const note = [
      userNote,
      cards ? `抽牌：${cards}` : "",
      order ? `大型區域順序：${order}` : "",
      "此回饋只作結果紀錄，不回寫牌面分數或區域權重。",
    ].filter(Boolean).join("\n");

    const data = buildFeedbackFormData({
      itemName: context.itemName,
      itemNotes: context.itemNotes,
      status,
      note,
      feedbackAt: nowTaipeiStamp(),
    });

    fetch(FEEDBACK_FORM.url, { method: "POST", mode: "no-cors", body: data })
      .catch((error) => console.warn("[lost-item-v5] 回饋送出失敗：", error));

    form.reset();
    if (message) {
      message.textContent = "感謝你的回饋；本筆只作紀錄，不會改變牌面權重。";
      message.classList.remove("hidden");
    }
  };
})();
