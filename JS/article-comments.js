// ==============================
// article-comments.js
// Google 登入＋暱稱限定：單篇文章留言與單層回覆
// ==============================
//
// 主要函式複雜度：
// - fetchCloudRecords：O(n)
// - buildThreads：O(n)
// - renderThreads：O(n)
// - submitMainComment / submitReply：O(n)（送出後核對一次資料）
// 空間複雜度：O(n)
//
// 更快替代方案比較：
// - no-cors 寫入後固定等待再查詢：無法讀取後端結果，延遲固定且錯誤不透明。
// - 本實作：直接讀取 JSON 成功結果；遇到逾時時只查詢既有紀錄，不自動重送，
//   以 threadId／requestId 核對是否其實已完成，避免重複留言。
// ==============================

(function initThreadedArticleComments() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 12000;
  const MAX_RECORDS = 300;
  const META_PATTERN = /^\[\[v2;a=([a-zA-Z0-9_-]+);k=([cr]);i=([a-zA-Z0-9_-]+);p=([a-zA-Z0-9_-]*)\]\]([\s\S]*)$/;
  const LEGACY_ARTICLE_PATTERN = /^\[\[article:([a-zA-Z0-9_-]+)\]\]([\s\S]*)$/;

  let currentArticle = null;
  let records = [];
  let openReplyThreadId = "";
  let initialized = false;
  let lastNickname = "";

  function getApiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.commentsApiUrl || "").trim();
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
        name: String(raw?.name || "Google 訪客").trim(),
        text: String(raw?.text ?? raw?.comment ?? "").trim(),
        createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
      };
    }

    const legacyMatch = rawTitle.match(LEGACY_ARTICLE_PATTERN);
    if (!legacyMatch) return null;

    return {
      id: String(raw?.id || ""),
      articleId: legacyMatch[1],
      kind: "comment",
      threadId: String(raw?.id || createThreadId()),
      parentThreadId: "",
      name: String(raw?.name || "舊留言").trim(),
      text: String(raw?.text ?? raw?.comment ?? "").trim(),
      createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
    };
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
    const credential = window.EvanGoogleAuth?.getCredential?.() || "";
    if (!credential) throw new Error("GOOGLE_LOGIN_REQUIRED");

    const response = await fetchWithTimeout(getApiUrl(), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        action: "create",
        credential,
        requestId: record.threadId,
        title: encodeMetadata(record),
        text: record.text,
        createdAt: record.createdAt,
        website: "",
      }),
      keepalive: true,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.success) throw new Error(payload?.error || "留言儲存失敗");
    return payload;
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

  function openAccountPanel(focusNickname) {
    window.EvanSiteAccount?.open?.({ focusNickname: Boolean(focusNickname) });
  }

  function requireCommentIdentity() {
    if (!window.EvanGoogleAuth?.isSignedIn?.()) {
      openAccountPanel(false);
      showMessage("請先使用右上角的 Google 帳戶入口登入。", "is-error");
      return false;
    }

    if (!window.EvanGoogleAuth?.hasNickname?.()) {
      openAccountPanel(true);
      showMessage("請先在右上角帳戶視窗設定公開暱稱。", "is-error");
      return false;
    }

    return true;
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
    form.append(textLabel, actions);
    form.addEventListener("submit", submitReply);
    return form;
  }

  function createReplyItem(reply) {
    const item = document.createElement("article");
    item.className = "comment-reply-item";

    const meta = document.createElement("p");
    meta.className = "comment-meta";
    meta.textContent = `${reply.name} ／ ${formatTaipeiDate(reply.createdAt)}`;

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
    meta.textContent = `${thread.name} ／ ${formatTaipeiDate(thread.createdAt)}`;

    const text = document.createElement("p");
    text.className = "comment-text";
    text.textContent = thread.text;

    const actions = document.createElement("div");
    actions.className = "comment-thread-actions";

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "comment-reply-button";
    replyButton.textContent = thread.replies.length ? `回覆（${thread.replies.length}）` : "回覆";
    replyButton.addEventListener("click", () => {
      if (!requireCommentIdentity()) return;
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

    if (openReplyThreadId === thread.threadId && window.EvanGoogleAuth?.hasNickname?.()) {
      item.appendChild(createReplyForm(thread.threadId));
    }

    return item;
  }

  function renderThreads() {
    const container = document.getElementById("comment-list");
    if (!container || !currentArticle) return;

    const articleRecords = records.filter((record) => record.articleId === currentArticle.id);
    const threads = buildThreads(articleRecords);
    const replyCount = articleRecords.filter((record) => record.kind === "reply").length;
    const count = document.getElementById("comment-count");
    if (count) count.textContent = `${threads.length} 則留言 · ${replyCount} 則回覆`;

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
  }

  async function reloadRecords() {
    records = await fetchCloudRecords();
    renderThreads();
  }

  function hasSavedRecord(threadId) {
    return records.some((item) => item.threadId === threadId);
  }

  async function persistRecord(record) {
    try {
      await postCloudRecord(record);
    } catch (error) {
      try {
        await reloadRecords();
      } catch (reloadError) {
        console.error("[article-comments] 送出失敗後核對留言也失敗：", reloadError);
      }

      if (hasSavedRecord(record.threadId)) return;
      throw error;
    }

    await reloadRecords();
    if (!hasSavedRecord(record.threadId)) {
      throw new Error("後端回報成功，但重新讀取後找不到本次留言。");
    }
  }

  async function submitMainComment(event) {
    event.preventDefault();
    clearMessage();
    if (!requireCommentIdentity()) return;

    const form = event.currentTarget;
    const text = document.getElementById("comment-text")?.value.trim() || "";
    if (!text) return;

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    showMessage("留言送出中…");

    const record = {
      articleId: currentArticle.id,
      kind: "comment",
      threadId: createThreadId(),
      parentThreadId: "",
      text: text.slice(0, 1000),
      createdAt: window.nowTaipeiISO?.() || new Date().toISOString(),
    };

    try {
      await persistRecord(record);
      form.reset();
      showMessage("留言已送出。", "is-success");
    } catch (error) {
      console.error("[article-comments] 留言送出失敗：", error);
      showMessage(
        error?.name === "AbortError"
          ? "送出逾時；系統已核對既有留言且未找到本筆，請稍後再試。"
          : error?.message || "登入、暱稱或雲端儲存狀態異常，請重新確認後再試。",
        "is-error"
      );
    } finally {
      submitButton.disabled = !window.EvanGoogleAuth?.hasNickname?.();
    }
  }

  async function submitReply(event) {
    event.preventDefault();
    if (!requireCommentIdentity()) return;

    const form = event.currentTarget;
    const text = form.elements.replyText.value.trim();
    if (!text) return;

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const record = {
      articleId: currentArticle.id,
      kind: "reply",
      threadId: createThreadId(),
      parentThreadId: form.dataset.threadId || "",
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
      window.EvanDialog?.alert?.(
        error?.message || "登入、暱稱或雲端儲存狀態異常，請重新確認後再試。",
        "送出失敗"
      );
    }
  }

  async function init(article) {
    if (initialized || !article) return;
    initialized = true;
    currentArticle = article;

    document.getElementById("comment-form")?.addEventListener("submit", submitMainComment);
    window.EvanGoogleAuth?.onChange?.((state) => {
      if (!state.isSignedIn || !state.hasNickname) openReplyThreadId = "";

      const nicknameChanged = state.nickname && state.nickname !== lastNickname;
      lastNickname = state.nickname || "";

      if (nicknameChanged) {
        reloadRecords().catch((error) => {
          console.error("[article-comments] 暱稱更新後重新載入留言失敗：", error);
        });
      } else {
        renderThreads();
      }
    });

    const container = document.getElementById("comment-list");
    if (container) container.textContent = "留言載入中…";

    try {
      await reloadRecords();
    } catch (error) {
      console.error("[article-comments] 雲端留言載入失敗：", error);
      if (container) container.textContent = "目前無法載入留言，請稍後再試。";
    }
  }

  window.EvanArticleComments = Object.freeze({ init });
})();
