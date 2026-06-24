// ==============================
// comments.js
// 文章留言區：雲端優先 + 本機安全備援
// ==============================
//
// 主要函式複雜度：
// - loadLocalComments：O(n)
// - fetchCloudComments：O(n)
// - renderCommentList：O(n)
// - handleCommentForm：O(1)（不含網路延遲）
// - migrateLegacyLocalComments：O(n)
// 空間複雜度：O(n)
//
// 暴力法：只用 localStorage，換裝置、清快取或重建環境後資料無法同步。
// 優化法（本實作）：雲端 API 設定完成後，以 Google Sheets 為主資料源；
//                  API 尚未啟用或暫時故障時，保留 localStorage + Google Form 備援，避免功能中斷。
// ==============================

(function initCloudComments() {
  const LOCAL_STORAGE_KEY = "evanTarotComments";
  const MIGRATION_FLAG_KEY = "evanTarotCommentsCloudMigratedV1";
  const CLIENT_ID_KEY = "evanTarotCommentClientId";
  const MAX_DISPLAY = 100;
  const REQUEST_TIMEOUT_MS = 12000;

  const FEEDBACK_GOOGLE_FORM = Object.freeze({
    url: "https://docs.google.com/forms/d/e/1FAIpQLScdDR6CrMrs_G7HVMAbQYo95s4AaH5b3KDupUZ9TlD5e5yKLQ/formResponse",
    fields: {
      type: "entry.1980954123",
      name: "entry.1821676998",
      title: "entry.2042241666",
      text: "entry.243999010",
      createdAt: "entry.1203451900",
    },
  });

  let cachedComments = [];
  let isLoading = false;

  /**
   * 取得雲端留言 API 網址。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function getApiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.commentsApiUrl || "").trim();
  }

  /**
   * API 是否已設定為 Apps Script Web App /exec 網址。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function isApiConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(getApiUrl());
  }

  /**
   * 建立匿名瀏覽器識別碼，只用於避免舊留言重複匯入。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function getClientId() {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (clientId) return clientId;

    clientId =
      window.crypto?.randomUUID?.() ||
      `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    return clientId;
  }

  /**
   * 正規化雲端或舊本機留言格式。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function normalizeComment(raw) {
    return {
      id: String(raw?.id || ""),
      name: String(raw?.name || "").trim(),
      title: String(raw?.title || "").trim(),
      text: String(raw?.text ?? raw?.comment ?? "").trim(),
      createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
    };
  }

  /**
   * 讀取本機備援留言。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  function loadLocalComments() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data)
        ? data.map(normalizeComment).filter((comment) => comment.text)
        : [];
    } catch (error) {
      console.warn("[comments] 本機留言讀取失敗：", error);
      return [];
    }
  }

  /**
   * 儲存本機備援留言。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  function saveLocalComments(comments) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(comments));
  }

  /**
   * 顯示留言表單狀態。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function showMessage(message, type = "") {
    const element = document.getElementById("comment-message");
    if (!element) return;

    element.textContent = message;
    element.classList.remove("hidden", "is-error", "is-success");
    if (type) element.classList.add(type);
  }

  function clearMessage() {
    const element = document.getElementById("comment-message");
    if (!element) return;

    element.textContent = "";
    element.classList.add("hidden");
    element.classList.remove("is-error", "is-success");
  }

  /**
   * 將日期顯示成台北時間。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function formatTaipeiDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "時間未記錄";

    return date.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /**
   * 渲染留言清單。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)（DocumentFragment）
   */
  function renderCommentList(comments, emptyMessage = "目前還沒有留言，可以當第一個留下紀錄的人。") {
    const container = document.getElementById("comment-list");
    if (!container) return;

    if (!comments.length) {
      const empty = document.createElement("p");
      empty.className = "comment-empty";
      empty.textContent = emptyMessage;
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    comments.forEach((comment) => {
      const item = document.createElement("article");
      item.className = "comment-item";

      const title = document.createElement("h4");
      title.textContent = comment.title || "（無標題）";

      const meta = document.createElement("div");
      meta.className = "comment-meta";
      meta.textContent = `${comment.name || "匿名"} ／ ${formatTaipeiDate(comment.createdAt)}`;

      const body = document.createElement("p");
      body.className = "comment-text";
      body.textContent = comment.text;

      item.append(title, meta, body);
      fragment.appendChild(item);
    });

    container.replaceChildren(fragment);
  }

  /**
   * 帶逾時的 fetch。
   * 時間複雜度：O(1)（不含回傳資料解析）
   * 空間複雜度：O(1)
   */
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

  /**
   * 讀取雲端留言。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  async function fetchCloudComments() {
    const url = new URL(getApiUrl());
    url.searchParams.set("action", "list");
    url.searchParams.set("limit", String(MAX_DISPLAY));
    url.searchParams.set("_", String(Date.now()));

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`讀取留言失敗：HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.success || !Array.isArray(payload.comments)) {
      throw new Error(payload?.error || "API 回傳格式不正確");
    }

    return payload.comments
      .map(normalizeComment)
      .filter((comment) => comment.text)
      .slice(0, MAX_DISPLAY);
  }

  /**
   * 將留言送到 Apps Script。
   * 使用 text/plain + no-cors 避免瀏覽器預檢阻擋；送出後再重新 GET 同步。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  async function postCloudComment(comment) {
    const payload = {
      action: "create",
      name: comment.name,
      title: comment.title,
      text: comment.text,
      createdAt: comment.createdAt,
      clientId: getClientId(),
      website: "",
    };

    await fetchWithTimeout(getApiUrl(), {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }

  /**
   * 將留言備份到既有 Google Form。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function postGoogleFormBackup(comment) {
    const formData = new FormData();
    const fields = FEEDBACK_GOOGLE_FORM.fields;

    formData.append(fields.type, "comment");
    formData.append(fields.name, comment.name || "");
    formData.append(fields.title, comment.title || "");
    formData.append(fields.text, comment.text || "");
    formData.append(fields.createdAt, comment.createdAt || new Date().toISOString());
    formData.append("submit", "Submit");

    return fetch(FEEDBACK_GOOGLE_FORM.url, {
      method: "POST",
      mode: "no-cors",
      body: formData,
    });
  }

  /**
   * 載入並渲染留言；供 main.js 呼叫。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  async function renderComments() {
    if (isLoading) return false;
    isLoading = true;

    const container = document.getElementById("comment-list");
    if (!container) {
      isLoading = false;
      return false;
    }

    renderCommentList([], "留言載入中…");

    try {
      if (!isApiConfigured()) {
        cachedComments = loadLocalComments().slice().reverse();
        renderCommentList(cachedComments);
        return false;
      }

      cachedComments = await fetchCloudComments();
      renderCommentList(cachedComments);
      return true;
    } catch (error) {
      console.error("[comments] 雲端留言載入失敗：", error);
      cachedComments = loadLocalComments().slice().reverse();
      renderCommentList(cachedComments, "目前無法連上留言雲端，請稍後再重新整理。");
      showMessage("目前無法連上留言雲端；本機備援留言仍會暫時顯示。", "is-error");
      return false;
    } finally {
      isLoading = false;
    }
  }

  /**
   * 一次性把舊 localStorage 留言匯入雲端。
   * 必須逐筆送出，避免平行大量寫入造成 Apps Script 競爭。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  async function migrateLegacyLocalComments() {
    if (!isApiConfigured()) {
      throw new Error("留言雲端 API 尚未設定。");
    }

    if (localStorage.getItem(MIGRATION_FLAG_KEY) === "true") {
      return { migrated: 0, skipped: true };
    }

    const legacyComments = loadLocalComments();
    let migrated = 0;

    for (const comment of legacyComments) {
      await postCloudComment({
        ...comment,
        createdAt: comment.createdAt || new Date().toISOString(),
      });
      migrated += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }

    localStorage.setItem(MIGRATION_FLAG_KEY, "true");
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    await renderComments();
    return { migrated, skipped: false };
  }

  window.renderComments = renderComments;

  /**
   * 留言表單 submit。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  window.handleCommentForm = async function handleCommentForm(event) {
    event.preventDefault();
    clearMessage();

    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const name = document.getElementById("comment-name")?.value.trim() || "";
    const title = document.getElementById("comment-title")?.value.trim() || "";
    const text = document.getElementById("comment-text")?.value.trim() || "";

    if (!text) {
      showMessage("請先輸入想說的話。", "is-error");
      document.getElementById("comment-text")?.focus();
      return;
    }

    const comment = {
      name: name.slice(0, 40),
      title: title.slice(0, 80),
      text: text.slice(0, 1000),
      createdAt: window.nowTaipeiISO?.() || new Date().toISOString(),
    };

    submitButton?.setAttribute("disabled", "disabled");
    showMessage(isApiConfigured() ? "留言送出中…" : "留言暫存中…");

    const optimisticComments = [normalizeComment(comment), ...cachedComments].slice(0, MAX_DISPLAY);
    renderCommentList(optimisticComments);

    try {
      if (isApiConfigured()) {
        await postCloudComment(comment);
        form.reset();
        showMessage("留言已送出並保存到雲端。", "is-success");
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        await renderComments();
      } else {
        const localComments = loadLocalComments();
        localComments.push(comment);
        saveLocalComments(localComments);
        cachedComments = localComments.slice().reverse();

        postGoogleFormBackup(comment).catch((error) => {
          console.warn("[comments] Google Form 備份失敗：", error);
        });

        form.reset();
        renderCommentList(cachedComments);
        showMessage("留言已暫存；雲端留言 API 啟用後可一次匯入。", "is-success");
      }
    } catch (error) {
      console.error("[comments] 留言送出失敗：", error);
      renderCommentList(cachedComments);
      showMessage("留言送出失敗，請檢查網路後再試。", "is-error");
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  };

  window.EvanCloudComments = Object.freeze({
    renderComments,
    migrateLegacyLocalComments,
    isApiConfigured,
  });
})();
