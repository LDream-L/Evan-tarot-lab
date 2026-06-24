// ==============================
// article-comments.js
// 單篇文章留言＋單層無限回覆
// ==============================
//
// 資料結構：
// - comment：主留言
// - reply：主留言下的回覆
// - 回覆不提供再次回覆入口，因此固定只有兩層。
//
// 主要函式複雜度：
// - fetchCloudRecords：O(n)
// - buildThreads：O(n)
// - renderThreads：O(n)
// - submitMainComment / submitReply：O(1)（不含網路延遲）
// 空間複雜度：O(n)
//
// 更快替代方案比較：
// - 暴力法：每個主留言再遞迴掃描所有留言找子項，最差 O(n²)。
// - 本實作：先用 Map 建立 threadId 查表，再單次分配回覆，維持 O(n)。
// ==============================

(function initThreadedArticleComments() {
  const LOCAL_STORAGE_KEY = "evanTarotArticleThreadsV2";
  const CLIENT_ID_KEY = "evanTarotCommentClientId";
  const REQUEST_TIMEOUT_MS = 12000;
  const MAX_RECORDS = 300;
  const META_PATTERN = /^\[\[v2;a=([a-zA-Z0-9_-]+);k=([cr]);i=([a-zA-Z0-9_-]+);p=([a-zA-Z0-9_-]*)\]\]([\s\S]*)$/;
  const LEGACY_ARTICLE_PATTERN = /^\[\[article:([a-zA-Z0-9_-]+)\]\]([\s\S]*)$/;

  let currentArticle = null;
  let records = [];
  let openReplyThreadId = "";
  let initialized = false;

  function getApiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.commentsApiUrl || "").trim();
  }

  function isApiConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(getApiUrl());
  }

  function getClientId() {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (clientId) return clientId;

    clientId = window.crypto?.randomUUID?.() ||
      `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    return clientId;
  }

  function createThreadId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 12);
  }

  function encodeMetadata(record) {
    return `[[v2;a=${record.articleId};k=${record.kind === "reply" ? "r" : "c"};i=${record.threadId};p=${record.parentThreadId || ""}]]`;
  }

  function normalizeRecord(raw) {
    const rawTitle = String(raw?.title || "");
    const v2Match = rawTitle.match(META_PATTERN);

    if (v2Match) {
      return {
        id: String(raw?.id || ""),
        articleId: v2Match[1],
        kind: v2Match[2] === "r" ? "reply" : "comment",
        threadId: v2Match[3],
        parentThreadId: v2Match[4],
        name: String(raw?.name || "").trim(),
        text: String(raw?.text ?? raw?.comment ?? "").trim(),
        createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
      };
    }

    const legacyMatch = rawTitle.match(LEGACY_ARTICLE_PATTERN);
    if (legacyMatch) {
      return {
        id: String(raw?.id || ""),
        articleId: legacyMatch[1],
        kind: "comment",
        threadId: String(raw?.id || createThreadId()),
        parentThreadId: "",
        name: String(raw?.name || "").trim(),
        text: String(raw?.text ?? raw?.comment ?? "").trim(),
        createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
      };
    }

    if (raw?.articleId) {
      return {
        id: String(raw?.id || ""),
        articleId: String(raw.articleId),
        kind: raw?.parentThreadId ? "reply" : "comment",
        threadId: String(raw?.threadId || raw?.id || createThreadId()),
        parentThreadId: String(raw?.parentThreadId || ""),
        name: String(raw?.name || "").trim(),
        text: String(raw?.text ?? raw?.comment ?? "").trim(),
        createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
      };
    }

    return null;
  }

  function loadLocalRecords() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map(normalizeRecord).filter(Boolean)
        : [];
    } catch (error) {
      console.warn("[article-comments] 本機備援讀取失敗：", error);
      return [];
    }
  }

  function saveLocalRecords(items) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
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

  async function fetchCloudRecords() {
    const url = new URL(getApiUrl());
    url.searchParams.set("action", "list");
    url.searchParams.set("limit", String(MAX_RECORDS));
    url.searchParams.set("_", String(Date.now()));

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (!payload?.success || !Array.isArray(payload.comments)) {
      throw new Error(payload?.error || "雲端留言格式不正確");
    }

    return payload.comments
      .map(normalizeRecord)
      .filter((record) => record && record.text);
  }

  async function postCloudRecord(record) {
    const payload = {
      action: "create",
      name: record.name,
      title: encodeMetadata(record),
      text: record.text,
      createdAt: record.createdAt,
      clientId: getClientId(),
      website: "",
    };

    await fetchWithTimeout(getApiUrl(), {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }

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

  function buildThreads(articleRecords) {
    const topLevel = [];
    const threadMap = new Map();

    articleRecords.forEach((record) => {
      if (record.kind !== "comment") return;
      const thread = { ...record, replies: [] };
      topLevel.push(thread);
      threadMap.set(record.threadId, thread);
    });

    articleRecords.forEach((record) => {
      if (record.kind !== "reply") return;
      const parent = threadMap.get(record.parentThreadId);
      if (parent) parent.replies.push(record);
    });

    topLevel.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    topLevel.forEach((thread) => {
      thread.replies.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
    });

    return topLevel;
  }

  function createReplyForm(threadId) {
    const form = document.createElement("form");
    form.className = "reply-form";
    form.dataset.threadId = threadId;

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "暱稱（可留空）";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 40;
    nameInput.placeholder = "例如：Evan、路人甲、匿名";
    nameInput.name = "replyName";
    nameLabel.appendChild(nameInput);

    const textLabel = document.createElement("label");
    textLabel.textContent = "回覆內容";
    const textInput = document.createElement("textarea");
    textInput.rows = 3;
    textInput.maxLength = 1000;
    textInput.required = true;
    textInput.placeholder = "回覆這則留言。";
    textInput.name = "replyText";
    textLabel.appendChild(textInput);

    const actions = document.createElement("div");
    actions.className = "reply-form-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn ghost";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", () => {
      openReplyThreadId = "";
      renderThreads();
    });

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className = "btn primary";
    submitButton.textContent = "送出回覆";

    actions.append(cancelButton, submitButton);
    form.append(nameLabel, textLabel, actions);
    form.addEventListener("submit", submitReply);
    return form;
  }

  function createReplyItem(reply) {
    const item = document.createElement("article");
    item.className = "comment-reply-item";

    const meta = document.createElement("p");
    meta.className = "comment-meta";
    meta.textContent = `${reply.name || "匿名"} ／ ${formatTaipeiDate(reply.createdAt)}`;

    const text = document.createElement("p");
    text.className = "comment-text";
    text.textContent = reply.text;

    item.append(meta, text);
    return item;
  }

  function createThreadItem(thread) {
    const item = document.createElement("article");
    item.className = "comment-thread-item";

    const main = document.createElement("div");
    main.className = "comment-thread-main";

    const meta = document.createElement("p");
    meta.className = "comment-meta";
    meta.textContent = `${thread.name || "匿名"} ／ ${formatTaipeiDate(thread.createdAt)}`;

    const text = document.createElement("p");
    text.className = "comment-text";
    text.textContent = thread.text;

    const actions = document.createElement("div");
    actions.className = "comment-thread-actions";

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "comment-reply-button";
    replyButton.textContent = thread.replies.length
      ? `回覆（${thread.replies.length}）`
      : "回覆";
    replyButton.addEventListener("click", () => {
      openReplyThreadId = openReplyThreadId === thread.threadId ? "" : thread.threadId;
      renderThreads();
    });

    actions.appendChild(replyButton);
    main.append(meta, text, actions);
    item.appendChild(main);

    if (thread.replies.length) {
      const replies = document.createElement("div");
      replies.className = "comment-replies";
      thread.replies.forEach((reply) => replies.appendChild(createReplyItem(reply)));
      item.appendChild(replies);
    }

    if (openReplyThreadId === thread.threadId) {
      item.appendChild(createReplyForm(thread.threadId));
    }

    return item;
  }

  function updateCount(articleRecords, threads) {
    const replyCount = articleRecords.filter((record) => record.kind === "reply").length;
    const element = document.getElementById("comment-count");
    if (element) element.textContent = `${threads.length} 則留言 · ${replyCount} 則回覆`;
  }

  function renderThreads() {
    const container = document.getElementById("comment-list");
    if (!container || !currentArticle) return;

    const articleRecords = records.filter((record) => record.articleId === currentArticle.id);
    const threads = buildThreads(articleRecords);
    updateCount(articleRecords, threads);

    if (!threads.length) {
      const empty = document.createElement("p");
      empty.className = "comment-empty";
      empty.textContent = "這篇文章目前還沒有留言，可以成為第一個留言的人。";
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    threads.forEach((thread) => fragment.appendChild(createThreadItem(thread)));
    container.replaceChildren(fragment);

    if (openReplyThreadId) {
      container.querySelector(`.reply-form[data-thread-id="${openReplyThreadId}"] textarea`)?.focus();
    }
  }

  async function reloadRecords() {
    try {
      records = isApiConfigured()
        ? await fetchCloudRecords()
        : loadLocalRecords();
    } catch (error) {
      console.error("[article-comments] 雲端留言載入失敗：", error);
      records = loadLocalRecords();
      showMessage("目前無法連上留言雲端，暫時顯示本機備援資料。", "is-error");
    }

    renderThreads();
  }

  async function persistRecord(record) {
    if (isApiConfigured()) {
      await postCloudRecord(record);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      await reloadRecords();
      return;
    }

    const localRecords = loadLocalRecords();
    localRecords.push(record);
    saveLocalRecords(localRecords);
    records = localRecords;
    renderThreads();
  }

  async function submitMainComment(event) {
    event.preventDefault();
    clearMessage();

    const form = event.currentTarget;
    const name = document.getElementById("comment-name")?.value.trim() || "";
    const text = document.getElementById("comment-text")?.value.trim() || "";

    if (!text) {
      showMessage("請先輸入留言內容。", "is-error");
      document.getElementById("comment-text")?.focus();
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    showMessage("留言送出中…");

    const record = {
      articleId: currentArticle.id,
      kind: "comment",
      threadId: createThreadId(),
      parentThreadId: "",
      name: name.slice(0, 40),
      text: text.slice(0, 1000),
      createdAt: window.nowTaipeiISO?.() || new Date().toISOString(),
    };

    try {
      await persistRecord(record);
      form.reset();
      showMessage("留言已送出。", "is-success");
    } catch (error) {
      console.error("[article-comments] 留言送出失敗：", error);
      showMessage("留言送出失敗，請稍後再試。", "is-error");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function submitReply(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const parentThreadId = form.dataset.threadId || "";
    const name = form.elements.replyName.value.trim();
    const text = form.elements.replyText.value.trim();

    if (!text) {
      form.elements.replyText.focus();
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const record = {
      articleId: currentArticle.id,
      kind: "reply",
      threadId: createThreadId(),
      parentThreadId,
      name: name.slice(0, 40),
      text: text.slice(0, 1000),
      createdAt: window.nowTaipeiISO?.() || new Date().toISOString(),
    };

    try {
      await persistRecord(record);
      openReplyThreadId = "";
      renderThreads();
    } catch (error) {
      console.error("[article-comments] 回覆送出失敗：", error);
      submitButton.disabled = false;
      window.EvanDialog?.alert?.("回覆送出失敗，請稍後再試。", "送出失敗");
    }
  }

  async function init(article) {
    if (initialized || !article) return;
    initialized = true;
    currentArticle = article;

    const form = document.getElementById("comment-form");
    if (!form) return;

    form.addEventListener("submit", submitMainComment);

    const container = document.getElementById("comment-list");
    if (container) {
      const loading = document.createElement("p");
      loading.className = "comment-empty";
      loading.textContent = "留言載入中…";
      container.replaceChildren(loading);
    }

    await reloadRecords();
  }

  window.EvanArticleComments = Object.freeze({ init });
})();
