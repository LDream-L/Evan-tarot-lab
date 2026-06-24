// ==============================
// article-comments.js
// 文章專屬留言：依 articleId 分流顯示與保存
// ==============================
//
// 主要函式複雜度：
// - normalizeComment：O(1)
// - fetchCloudComments：O(n)
// - renderActiveComments：O(n)
// - updateArticleButtonCounts：O(n + a)
// - handleArticleCommentForm：O(1)（不含網路延遲）
// 空間複雜度：O(n + a)
//
// 更快替代方案比較：
// - 暴力法：每篇文章各自建立一套留言表單與網路請求，DOM 與 API 請求會隨文章數增加。
// - 本實作：共用一套表單與留言快取，再以 articleId 做 O(n) 單次篩選；避免重複請求與重複 DOM。
// ==============================

(function initArticleCommentsModule() {
  const LOCAL_STORAGE_KEY = "evanTarotComments";
  const CLIENT_ID_KEY = "evanTarotCommentClientId";
  const LEGACY_ARTICLE_ID = "__legacy__";
  const MAX_DISPLAY = 300;
  const REQUEST_TIMEOUT_MS = 12000;
  const ARTICLE_MARKER_PATTERN = /^\[\[article:([a-zA-Z0-9_-]+)\]\]([\s\S]*)$/;

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
  let activeArticleId = "";
  let initialized = false;
  let articleObserver = null;

  /**
   * 取得文章資料。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function getArticles() {
    return Array.isArray(window.EvanArticles?.data) ? window.EvanArticles.data : [];
  }

  /**
   * 依 ID 找文章。
   * 時間複雜度：O(a)
   * 空間複雜度：O(1)
   */
  function getArticleById(articleId) {
    return getArticles().find((article) => article.id === articleId) || null;
  }

  /**
   * 解析相容舊版 Apps Script 的文章標記。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function parseStoredTitle(value) {
    const rawTitle = String(value || "");
    const match = rawTitle.match(ARTICLE_MARKER_PATTERN);

    if (!match) {
      return {
        articleId: "",
        userTitle: rawTitle.trim(),
      };
    }

    return {
      articleId: match[1],
      userTitle: String(match[2] || "").trim(),
    };
  }

  /**
   * 將文章 ID 暫存於既有 title 欄位，讓尚未升級的 Apps Script 也能分篇。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function encodeStoredTitle(articleId, userTitle) {
    if (!articleId || articleId === LEGACY_ARTICLE_ID) return String(userTitle || "").trim();
    return `[[article:${articleId}]]${String(userTitle || "").trim()}`;
  }

  /**
   * 正規化雲端與本機留言。
   * 時間複雜度：O(a)（文章標題回填）
   * 空間複雜度：O(1)
   */
  function normalizeComment(raw) {
    const parsedTitle = parseStoredTitle(raw?.title);
    const articleId = String(raw?.articleId || parsedTitle.articleId || LEGACY_ARTICLE_ID).trim();
    const article = getArticleById(articleId);

    return {
      id: String(raw?.id || ""),
      articleId,
      articleTitle: String(
        raw?.articleTitle ||
        article?.title ||
        (articleId === LEGACY_ARTICLE_ID ? "舊留言（未指定文章）" : articleId)
      ).trim(),
      name: String(raw?.name || "").trim(),
      title: parsedTitle.userTitle,
      text: String(raw?.text ?? raw?.comment ?? "").trim(),
      createdAt: raw?.createdAt || raw?.timestamp || new Date().toISOString(),
    };
  }

  /**
   * 取得 API URL。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function getApiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.commentsApiUrl || "").trim();
  }

  function isApiConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(getApiUrl());
  }

  /**
   * 取得匿名瀏覽器識別碼。
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
   * 讀取本機留言備援。
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
      console.warn("[article-comments] 本機留言讀取失敗：", error);
      return [];
    }
  }

  /**
   * 寫入本機留言備援。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  function saveLocalComments(comments) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(comments));
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
   * 讀取全部雲端留言，再由前端依文章分流。
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
   * 送出文章留言。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  async function postCloudComment(comment) {
    const payload = {
      action: "create",
      articleId: comment.articleId,
      articleTitle: comment.articleTitle,
      name: comment.name,
      title: encodeStoredTitle(comment.articleId, comment.title),
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
   * 既有 Google Form 備援。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function postGoogleFormBackup(comment) {
    const formData = new FormData();
    const fields = FEEDBACK_GOOGLE_FORM.fields;
    const backupTitle = `【${comment.articleTitle}】${comment.title || "文章留言"}`;

    formData.append(fields.type, "article_comment");
    formData.append(fields.name, comment.name || "");
    formData.append(fields.title, backupTitle);
    formData.append(fields.text, comment.text || "");
    formData.append(fields.createdAt, comment.createdAt || new Date().toISOString());
    formData.append("submit", "Submit");

    return fetch(FEEDBACK_GOOGLE_FORM.url, {
      method: "POST",
      mode: "no-cors",
      body: formData,
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

  /**
   * 建立文章選擇欄位與留言標題區。
   * 時間複雜度：O(a)
   * 空間複雜度：O(a)
   */
  function ensureCommentInterface() {
    const block = document.querySelector(".comments-block");
    const form = document.getElementById("comment-form");
    const list = document.getElementById("comment-list");
    if (!block || !form || !list) return false;

    block.id = "article-comments";

    const heading = block.querySelector("h3");
    if (heading) {
      heading.id = "comments-heading";
      heading.textContent = "文章留言";
    }

    const note = block.querySelector(".comments-note");
    if (note) {
      note.id = "comment-context";
      note.textContent = "選擇一篇文章後，這裡只會顯示該篇文章的留言。";
    }

    let articleSelect = document.getElementById("comment-article");
    if (!articleSelect) {
      const label = document.createElement("label");
      label.className = "comment-article-field";
      label.textContent = "留言文章";

      articleSelect = document.createElement("select");
      articleSelect.id = "comment-article";
      articleSelect.name = "articleId";
      articleSelect.required = true;
      label.appendChild(articleSelect);
      form.insertBefore(label, form.firstElementChild);
    }

    populateArticleOptions(articleSelect);

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.textContent = "送出這篇文章的留言";

    const disclaimer = form.querySelector(".comments-disclaimer");
    if (disclaimer) {
      disclaimer.textContent = "留言會依文章分開保存到雲端；舊版尚未指定文章的留言仍會保留為「舊留言」。";
    }

    if (!document.getElementById("comment-list-title")) {
      const header = document.createElement("div");
      header.className = "article-comment-list-header";

      const title = document.createElement("h4");
      title.id = "comment-list-title";
      title.textContent = "目前留言";

      const count = document.createElement("span");
      count.id = "comment-count";
      count.className = "article-comment-count";
      count.textContent = "0 則";

      header.append(title, count);
      list.before(header);
    }

    articleSelect.addEventListener("change", () => {
      selectArticle(articleSelect.value || getArticles()[0]?.id || "");
    });

    return true;
  }

  /**
   * 產生文章選項；舊留言只在確實存在時出現。
   * 時間複雜度：O(a + n)
   * 空間複雜度：O(a)
   */
  function populateArticleOptions(select) {
    const previousValue = select.value || activeArticleId;
    const fragment = document.createDocumentFragment();

    getArticles().forEach((article) => {
      const option = document.createElement("option");
      option.value = article.id;
      option.textContent = article.title;
      fragment.appendChild(option);
    });

    if (cachedComments.some((comment) => comment.articleId === LEGACY_ARTICLE_ID)) {
      const option = document.createElement("option");
      option.value = LEGACY_ARTICLE_ID;
      option.textContent = "舊留言（未指定文章，僅查看）";
      fragment.appendChild(option);
    }

    select.replaceChildren(fragment);

    const validIds = new Set([
      ...getArticles().map((article) => article.id),
      ...(cachedComments.some((comment) => comment.articleId === LEGACY_ARTICLE_ID)
        ? [LEGACY_ARTICLE_ID]
        : []),
    ]);

    const firstArticleId = getArticles()[0]?.id || "";
    select.value = validIds.has(previousValue) ? previousValue : firstArticleId;
    activeArticleId = select.value;
  }

  /**
   * 為每張文章卡片補上留言入口。
   * 時間複雜度：O(a)
   * 空間複雜度：O(1)
   */
  function decorateArticleCards() {
    document.querySelectorAll(".article-card[data-article-id]").forEach((card) => {
      if (card.querySelector(".article-comment-button")) return;

      const articleId = card.dataset.articleId || "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn ghost article-comment-button";
      button.dataset.articleId = articleId;
      button.addEventListener("click", () => {
        selectArticle(articleId, { scroll: true });
      });

      const actions = document.createElement("div");
      actions.className = "article-comment-actions";
      actions.appendChild(button);
      card.appendChild(actions);
    });

    updateArticleButtonCounts();
  }

  /**
   * 以查表計算每篇文章留言數，避免每張卡片重複掃描全部留言。
   * 時間複雜度：O(n + a)
   * 空間複雜度：O(a)
   */
  function updateArticleButtonCounts() {
    const counts = new Map();
    cachedComments.forEach((comment) => {
      counts.set(comment.articleId, (counts.get(comment.articleId) || 0) + 1);
    });

    document.querySelectorAll(".article-comment-button[data-article-id]").forEach((button) => {
      const count = counts.get(button.dataset.articleId) || 0;
      button.textContent = count > 0 ? `查看留言（${count}）` : "留言這篇文章";
    });
  }

  function observeArticleList() {
    const articleList = document.getElementById("article-list");
    if (!articleList || articleObserver) return;

    articleObserver = new MutationObserver(() => decorateArticleCards());
    articleObserver.observe(articleList, { childList: true });
  }

  /**
   * 切換目前文章。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  function selectArticle(articleId, options = {}) {
    const validArticle = getArticleById(articleId);
    const hasLegacy = articleId === LEGACY_ARTICLE_ID &&
      cachedComments.some((comment) => comment.articleId === LEGACY_ARTICLE_ID);

    activeArticleId = validArticle ? validArticle.id : hasLegacy
      ? LEGACY_ARTICLE_ID
      : getArticles()[0]?.id || "";

    const select = document.getElementById("comment-article");
    if (select && select.value !== activeArticleId) select.value = activeArticleId;

    renderActiveComments();

    if (options.scroll) {
      document.getElementById("article-comments")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }

  /**
   * 渲染當前文章留言。
   * 時間複雜度：O(n)
   * 空間複雜度：O(n)
   */
  function renderActiveComments() {
    const container = document.getElementById("comment-list");
    if (!container) return;

    const comments = cachedComments.filter((comment) => comment.articleId === activeArticleId);
    const article = getArticleById(activeArticleId);
    const isLegacy = activeArticleId === LEGACY_ARTICLE_ID;
    const displayTitle = isLegacy
      ? "舊留言（未指定文章）"
      : article?.title || "請選擇文章";

    const context = document.getElementById("comment-context");
    if (context) {
      context.textContent = isLegacy
        ? "這些是舊版留言，當時尚未記錄所屬文章，因此僅供查看。"
        : `目前顯示「${displayTitle}」的留言。`;
    }

    const listTitle = document.getElementById("comment-list-title");
    if (listTitle) listTitle.textContent = displayTitle;

    const count = document.getElementById("comment-count");
    if (count) count.textContent = `${comments.length} 則`;

    const submitButton = document.querySelector('#comment-form button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = isLegacy || !article;
      submitButton.textContent = isLegacy
        ? "舊留言僅供查看"
        : "送出這篇文章的留言";
    }

    if (!comments.length) {
      const empty = document.createElement("p");
      empty.className = "comment-empty";
      empty.textContent = isLegacy
        ? "目前沒有舊留言。"
        : "這篇文章目前還沒有留言，可以成為第一個留言的人。";
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
   * 載入留言並按文章顯示。
   * 時間複雜度：O(n + a)
   * 空間複雜度：O(n + a)
   */
  async function renderArticleComments() {
    const container = document.getElementById("comment-list");
    if (!container) return false;

    const loading = document.createElement("p");
    loading.className = "comment-empty";
    loading.textContent = "文章留言載入中…";
    container.replaceChildren(loading);

    try {
      cachedComments = isApiConfigured()
        ? await fetchCloudComments()
        : loadLocalComments().slice().reverse();
    } catch (error) {
      console.error("[article-comments] 雲端留言載入失敗：", error);
      cachedComments = loadLocalComments().slice().reverse();
      showMessage("目前無法連上留言雲端，暫時顯示本機備援留言。", "is-error");
    }

    const select = document.getElementById("comment-article");
    if (select) populateArticleOptions(select);

    const requestedArticleId = new URLSearchParams(window.location.search).get("article");
    if (requestedArticleId && getArticleById(requestedArticleId)) {
      activeArticleId = requestedArticleId;
      if (select) select.value = requestedArticleId;
    }

    if (!activeArticleId) activeArticleId = getArticles()[0]?.id || "";

    decorateArticleCards();
    renderActiveComments();
    return true;
  }

  /**
   * 文章留言送出。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  async function handleArticleCommentForm(event) {
    event.preventDefault();
    clearMessage();

    const form = event.currentTarget;
    const selectedArticleId = document.getElementById("comment-article")?.value || "";
    const article = getArticleById(selectedArticleId);

    if (!article) {
      showMessage("請先選擇要留言的文章。", "is-error");
      document.getElementById("comment-article")?.focus();
      return;
    }

    const name = document.getElementById("comment-name")?.value.trim() || "";
    const title = document.getElementById("comment-title")?.value.trim() || "";
    const text = document.getElementById("comment-text")?.value.trim() || "";

    if (!text) {
      showMessage("請先輸入留言內容。", "is-error");
      document.getElementById("comment-text")?.focus();
      return;
    }

    const comment = normalizeComment({
      articleId: article.id,
      articleTitle: article.title,
      name: name.slice(0, 40),
      title: title.slice(0, 80),
      text: text.slice(0, 1000),
      createdAt: window.nowTaipeiISO?.() || new Date().toISOString(),
    });

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton?.setAttribute("disabled", "disabled");
    showMessage(isApiConfigured() ? "留言送出中…" : "留言暫存中…");

    activeArticleId = article.id;
    cachedComments = [comment, ...cachedComments].slice(0, MAX_DISPLAY);
    renderActiveComments();
    updateArticleButtonCounts();

    try {
      if (isApiConfigured()) {
        await postCloudComment(comment);
        form.reset();
        document.getElementById("comment-article").value = article.id;
        showMessage("留言已保存到這篇文章的雲端留言區。", "is-success");
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        await renderArticleComments();
      } else {
        const localComments = loadLocalComments();
        localComments.push(comment);
        saveLocalComments(localComments);

        postGoogleFormBackup(comment).catch((error) => {
          console.warn("[article-comments] Google Form 備份失敗：", error);
        });

        form.reset();
        document.getElementById("comment-article").value = article.id;
        showMessage("留言已暫存在這篇文章；雲端恢復後可再同步。", "is-success");
      }
    } catch (error) {
      console.error("[article-comments] 留言送出失敗：", error);
      cachedComments = cachedComments.filter((item) => item !== comment);
      renderActiveComments();
      updateArticleButtonCounts();
      showMessage("留言送出失敗，請檢查網路後再試。", "is-error");
    } finally {
      submitButton?.removeAttribute("disabled");
      renderActiveComments();
    }
  }

  /**
   * 初始化文章留言。
   * 時間複雜度：O(n + a)
   * 空間複雜度：O(n + a)
   */
  async function init() {
    if (initialized) return;
    initialized = true;

    if (!ensureCommentInterface()) return;

    activeArticleId = getArticles()[0]?.id || "";
    decorateArticleCards();
    observeArticleList();
    await renderArticleComments();
  }

  window.EvanArticleComments = Object.freeze({
    init,
    selectArticle,
    renderArticleComments,
    handleArticleCommentForm,
  });
})();
