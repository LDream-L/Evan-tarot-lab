// ==============================
// article-admin.js
// 管理員文章新增、編輯、預覽與發布
// ==============================
//
// 主要函式複雜度：
// - loadArticles / renderArticleList：O(n)
// - selectArticle：O(1)，文章以 Map 依 ID 查表
// - renderPreview：O(L)，L = 正文字元／區塊數
// - saveArticle：O(L)
// 空間複雜度：O(n + L + m)，m = 共用圖片數
//
// 更快替代方案比較：
// - 每次選文章都掃描完整陣列：O(n)。
// - 本實作：載入時建立 Map，後續依 ID 查詢為常數時間；搜尋時才線性篩選。
// ==============================

(function initArticleAdminPage() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 15000;
  const PREVIEW_DEBOUNCE_MS = 180;
  const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
  const STATUS_LABELS = Object.freeze({
    draft: "草稿",
    published: "已發布",
    archived: "已封存",
  });

  let articles = [];
  let articleById = new Map();
  let selectedId = "";
  let authorized = false;
  let busy = false;
  let previewTimer = 0;

  const $ = (id) => document.getElementById(id);

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.articlesApiUrl ||
      window.EVAN_CLOUD_CONFIG?.commentsApiUrl ||
      ""
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
    if (!apiUrl) throw new Error("文章 API 尚未設定。");
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
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("後端沒有回傳可讀的 JSON。", { cause: error });
    }
    if (!payload?.success) throw new Error(payload?.error || "文章管理操作失敗。");
    return payload;
  }

  function setGate(title, message, state = "loading") {
    $("article-admin-gate-title").textContent = title;
    $("article-admin-gate-message").textContent = message;
    $("article-admin-gate").dataset.state = state;
  }

  function setMessage(message, type = "info") {
    const element = $("article-admin-message");
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("hidden", !message);
    element.dataset.type = type;
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    document.querySelectorAll(
      "#article-admin-form button, #article-admin-refresh, #article-admin-new, #article-admin-retry"
    ).forEach((element) => {
      if (element.id === "article-admin-delete" && !selectedId) {
        element.disabled = true;
      } else {
        element.disabled = busy;
      }
    });
  }

  function escapeHtml(input) {
    return String(input ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function toLocalDateTimeInput(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      const normalized = String(value).trim().replace(" ", "T");
      return normalized.slice(0, 16);
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function nowLocalDateTimeInput() {
    return toLocalDateTimeInput(new Date());
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
    return `article-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function normalizeArticle(raw) {
    const content = Array.isArray(raw?.content)
      ? raw.content.join("\n\n")
      : String(raw?.content || "");
    return Object.freeze({
      id: String(raw?.id || "").trim().toLowerCase(),
      status: String(raw?.status || "draft").trim().toLowerCase(),
      publishAt: String(raw?.publishAt || raw?.date || "").trim(),
      updatedAt: String(raw?.updatedAt || "").trim(),
      category: String(raw?.category || "reflection").trim(),
      tag: String(raw?.tag || "文章").trim(),
      title: String(raw?.title || "").trim(),
      excerpt: String(raw?.excerpt || "").trim(),
      content,
      author: String(raw?.author || "Evan").trim(),
      relatedLink: String(raw?.relatedLink || "").trim(),
      relatedLabel: String(raw?.relatedLabel || "").trim(),
      sortOrder: raw?.sortOrder === "" || raw?.sortOrder == null ? "" : Number(raw.sortOrder),
      internalNote: String(raw?.internalNote || "").trim(),
    });
  }

  function rebuildIndex() {
    articleById = new Map(articles.map((article) => [article.id, article]));
  }

  function getFilteredArticles() {
    const query = $("article-admin-search").value.trim().toLowerCase();
    const status = $("article-admin-status-filter").value;
    return articles.filter((article) => {
      if (status !== "all" && article.status !== status) return false;
      if (!query) return true;
      return [article.id, article.title, article.tag, article.category, article.internalNote]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }

  function renderArticleList() {
    const list = $("article-admin-list");
    const filtered = getFilteredArticles();
    if (!filtered.length) {
      list.innerHTML = '<p class="article-admin-empty">目前沒有符合條件的文章。</p>';
      return;
    }

    list.innerHTML = filtered.map((article) => `
      <button class="article-admin-list-item${article.id === selectedId ? " is-active" : ""}" type="button" data-article-id="${escapeHtml(article.id)}">
        <span class="article-admin-status-badge">${escapeHtml(STATUS_LABELS[article.status] || article.status)}</span>
        <strong>${escapeHtml(article.title || "未命名文章")}</strong>
        <span class="article-admin-list-meta">${escapeHtml(article.id)}</span>
        <span class="article-admin-list-meta">${escapeHtml(formatDisplayDate(article.publishAt))}</span>
      </button>
    `).join("");

    list.querySelectorAll("[data-article-id]").forEach((button) => {
      button.addEventListener("click", () => selectArticle(button.dataset.articleId || ""));
    });
  }

  function setField(id, value) {
    const element = $(id);
    if (element) element.value = value == null ? "" : String(value);
  }

  function populateForm(article) {
    const isExisting = Boolean(article?.id && articleById.has(article.id));
    selectedId = isExisting ? article.id : "";
    setField("article-admin-original-id", selectedId);
    setField("article-admin-id", article?.id || makeGeneratedId());
    setField("article-admin-status", article?.status || "draft");
    setField("article-admin-publish-at", toLocalDateTimeInput(article?.publishAt));
    setField("article-admin-sort-order", article?.sortOrder ?? "");
    setField("article-admin-category", article?.category || "case");
    setField("article-admin-tag", article?.tag || "匿名案例");
    setField("article-admin-author", article?.author || "Evan");
    setField("article-admin-title", article?.title || "");
    setField("article-admin-excerpt", article?.excerpt || "");
    setField("article-admin-content", article?.content || "");
    setField("article-admin-related-link", article?.relatedLink || "");
    setField("article-admin-related-label", article?.relatedLabel || "");
    setField("article-admin-internal-note", article?.internalNote || "");

    $("article-admin-id").disabled = isExisting;
    $("article-admin-delete").disabled = !isExisting || busy;
    $("article-admin-editor-title").textContent = isExisting ? "編輯文章" : "新增文章";
    $("article-admin-updated").textContent = isExisting
      ? `最後更新：${formatDisplayDate(article.updatedAt)}`
      : "尚未儲存";
    $("article-admin-open-public").href = isExisting
      ? `article.html?id=${encodeURIComponent(article.id)}`
      : "articles.html";

    updateCounters();
    schedulePreview();
    renderArticleList();
    setMessage("");
  }

  function selectArticle(articleId) {
    const article = articleById.get(articleId);
    if (!article) return;
    populateForm(article);
    window.scrollTo({ top: document.querySelector(".article-admin-section")?.offsetTop || 0, behavior: "smooth" });
  }

  function newArticle() {
    populateForm({
      id: makeGeneratedId(),
      status: "draft",
      category: "case",
      tag: "匿名案例",
      author: "Evan",
    });
    $("article-admin-title")?.focus();
  }

  function formArticle() {
    const sortOrderRaw = $("article-admin-sort-order").value.trim();
    return {
      id: $("article-admin-id").value.trim().toLowerCase(),
      status: $("article-admin-status").value,
      publishAt: $("article-admin-publish-at").value.trim(),
      category: $("article-admin-category").value,
      tag: $("article-admin-tag").value.trim(),
      title: $("article-admin-title").value.trim(),
      excerpt: $("article-admin-excerpt").value.trim(),
      content: $("article-admin-content").value,
      author: $("article-admin-author").value.trim(),
      relatedLink: $("article-admin-related-link").value.trim(),
      relatedLabel: $("article-admin-related-label").value.trim(),
      sortOrder: sortOrderRaw === "" ? "" : Number(sortOrderRaw),
      internalNote: $("article-admin-internal-note").value.trim(),
    };
  }

  function validateArticle(article) {
    if (!VALID_ID_PATTERN.test(article.id)) {
      throw new Error("文章 ID 須為 2～80 字，只能使用小寫英文、數字、連字號與底線。");
    }
    if (!article.title) throw new Error("請填寫文章標題。");
    if (!article.excerpt) throw new Error("請填寫文章摘要。");
    if (!article.content.trim()) throw new Error("請填寫文章正文。");
    if (!article.author) throw new Error("請填寫作者。");
    if (!article.tag) throw new Error("請填寫顯示標籤。");
    if (!Object.hasOwn(STATUS_LABELS, article.status)) throw new Error("文章狀態不正確。");
    if (article.relatedLink && !/^(https?:\/\/|[a-z0-9_-]+\.html(?:[?#].*)?)/i.test(article.relatedLink)) {
      throw new Error("延伸連結須為 http(s) 網址或站內 HTML 頁面。");
    }
    return article;
  }

  async function saveArticle(options = {}) {
    if (!authorized || busy) return false;
    let article = formArticle();
    if (options.status) article.status = options.status;
    if (article.status === "published" && !article.publishAt) {
      article.publishAt = nowLocalDateTimeInput();
      setField("article-admin-publish-at", article.publishAt);
    }

    try {
      validateArticle(article);
    } catch (error) {
      setMessage(error.message, "error");
      return false;
    }

    setBusy(true);
    setMessage(options.status === "published" ? "文章發布中…" : "文章儲存中…");
    try {
      const payload = await requestJson("saveArticle", {
        originalId: $("article-admin-original-id").value.trim(),
        article,
      });
      const saved = normalizeArticle(payload.article || { ...article, updatedAt: new Date().toISOString() });
      const existingIndex = articles.findIndex((item) => item.id === saved.id);
      if (existingIndex >= 0) articles[existingIndex] = saved;
      else articles.unshift(saved);
      articles.sort(compareArticles);
      rebuildIndex();
      populateForm(saved);
      setMessage(saved.status === "published" ? "文章已發布。" : "文章已儲存。", "success");
      return true;
    } catch (error) {
      console.error("[article-admin] 儲存失敗：", error);
      setMessage(error?.name === "AbortError" ? "儲存逾時，請重新讀取文章確認是否已寫入。" : error.message, "error");
      return false;
    } finally {
      setBusy(false);
      $("article-admin-delete").disabled = !selectedId;
    }
  }

  async function deleteArticle() {
    if (!authorized || !selectedId || busy) return;
    const article = articleById.get(selectedId);
    const confirmed = window.confirm(`確定永久刪除「${article?.title || selectedId}」？\n\n這會直接刪除 Google Sheets 中的文章列，無法從網站復原。`);
    if (!confirmed) return;

    setBusy(true);
    setMessage("文章刪除中…");
    try {
      await requestJson("deleteArticle", { articleId: selectedId });
      articles = articles.filter((item) => item.id !== selectedId);
      rebuildIndex();
      newArticle();
      renderArticleList();
      setMessage("文章已永久刪除。", "success");
    } catch (error) {
      console.error("[article-admin] 刪除失敗：", error);
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function compareArticles(a, b) {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.NEGATIVE_INFINITY;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.NEGATIVE_INFINITY;
    if (orderA !== orderB) return orderB - orderA;
    const dateA = new Date(a.publishAt || a.updatedAt || 0).getTime() || 0;
    const dateB = new Date(b.publishAt || b.updatedAt || 0).getTime() || 0;
    return dateB - dateA;
  }

  async function loadArticles(options = {}) {
    if (!authorized || busy) return;
    setBusy(true);
    if (!options.silent) setMessage("正在讀取文章…");
    try {
      const payload = await requestJson("adminArticles");
      articles = (Array.isArray(payload.articles) ? payload.articles : [])
        .map(normalizeArticle)
        .filter((article) => article.id)
        .sort(compareArticles);
      rebuildIndex();
      renderArticleList();

      if (selectedId && articleById.has(selectedId)) {
        populateForm(articleById.get(selectedId));
      } else if (articles.length) {
        selectArticle(articles[0].id);
      } else {
        newArticle();
      }
      if (!options.silent) setMessage(`已讀取 ${articles.length} 篇文章。`, "success");
    } catch (error) {
      console.error("[article-admin] 文章讀取失敗：", error);
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
      $("article-admin-delete").disabled = !selectedId;
    }
  }

  async function verifyAdmin() {
    const authState = window.EvanGoogleAuth?.getState?.() || {};
    authorized = false;
    $("article-admin-workspace").classList.add("hidden");
    $("article-admin-gate").classList.remove("hidden");

    if (!authState.isSignedIn) {
      setGate("請先登入管理員帳戶", "請從右上角登入 Google 帳戶；登入後系統會再次向 Apps Script 驗證管理權限。", "locked");
      return false;
    }

    setGate("正在驗證管理權限", "登入成功，正在確認此 Google 帳戶是否為網站管理員。", "loading");
    try {
      const payload = await requestJson("adminStatus");
      if (!payload.isAdmin) throw new Error("此 Google 帳戶沒有文章管理權限。");
      authorized = true;
      setGate("管理員驗證成功", "已開放文章讀取與修改功能。", "success");
      $("article-admin-gate").classList.add("hidden");
      $("article-admin-workspace").classList.remove("hidden");
      await loadArticles();
      return true;
    } catch (error) {
      console.error("[article-admin] 管理權限驗證失敗：", error);
      setGate("無法進入文章管理", error.message || "管理員驗證失敗。", "error");
      return false;
    }
  }

  function stripMarkup(content) {
    return String(content || "")
      .replace(/\[\[(?:image|flow|note|details):[^\]]+\]\]/gi, " ")
      .replace(/\[\[\/details\]\]/gi, " ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[-*>]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/^\|.*\|$/gm, " ")
      .replace(/\*\*|`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function generateExcerpt() {
    const text = stripMarkup($("article-admin-content").value);
    setField("article-admin-excerpt", Array.from(text).slice(0, 180).join(""));
    updateCounters();
    schedulePreview();
  }

  function updateCounters() {
    const excerpt = $("article-admin-excerpt").value;
    const content = $("article-admin-content").value;
    $("article-admin-excerpt-count").textContent = `${Array.from(excerpt).length} / 600`;
    $("article-admin-content-count").textContent = String(Array.from(content).length);
  }

  function renderPreview() {
    const article = formArticle();
    $("article-admin-preview-tag").textContent = article.tag || "文章";
    $("article-admin-preview-title").textContent = article.title || "尚未輸入標題";
    $("article-admin-preview-meta").textContent = `${article.publishAt ? formatDisplayDate(article.publishAt) : "預覽"} · ${article.author || "Evan"}`;
    window.EvanArticleRenderer?.renderInto?.(
      $("article-admin-preview-content"),
      { content: [article.content], excerpt: article.excerpt },
      { includeToc: true }
    );
  }

  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, PREVIEW_DEBOUNCE_MS);
  }

  function insertAtCursor(textarea, text, options = {}) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const selected = textarea.value.slice(start, end);
    let replacement = text;

    if (options.wrap) {
      replacement = `${options.wrap}${selected || "文字"}${options.wrap}`;
    } else if (options.prefix) {
      const source = selected || "項目";
      replacement = source.split("\n").map((line) => `${options.prefix}${line}`).join("\n");
    }

    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bindMarkupTools() {
    document.querySelectorAll("[data-insert], [data-wrap], [data-prefix]").forEach((button) => {
      button.addEventListener("click", () => {
        insertAtCursor($("article-admin-content"), button.dataset.insert || "", {
          wrap: button.dataset.wrap || "",
          prefix: button.dataset.prefix || "",
        });
      });
    });
  }

  function renderMediaLibrary() {
    const list = $("article-admin-media-list");
    const mediaItems = window.EvanArticleMedia?.list?.() || [];
    if (!mediaItems.length) {
      list.innerHTML = '<p class="article-admin-empty">共用圖片庫目前沒有圖片。</p>';
      return;
    }

    list.innerHTML = mediaItems.map((media) => `
      <article class="article-admin-media-card">
        <img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.alt || "")}" loading="lazy" decoding="async" />
        <div class="article-admin-media-card-body">
          <code>${escapeHtml(media.id)}</code>
          <span>${escapeHtml(media.caption || media.alt || "")}</span>
          <div class="article-admin-media-actions">
            <select aria-label="圖片版型" data-media-variant="${escapeHtml(media.id)}">
              <option value="cover">文章首圖</option>
              <option value="wide" selected>橫幅圖</option>
              <option value="portrait">直式圖</option>
              <option value="inline">窄版圖</option>
            </select>
            <button type="button" data-insert-media="${escapeHtml(media.id)}">插入</button>
          </div>
        </div>
      </article>
    `).join("");

    list.querySelectorAll("[data-insert-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.insertMedia || "";
        const variant = list.querySelector(`[data-media-variant="${CSS.escape(id)}"]`)?.value || "wide";
        insertAtCursor($("article-admin-content"), `[[image:${id}|${variant}]]\n\n`);
        activateTab("preview");
      });
    });
  }

  function activateTab(tabName) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      const active = button.dataset.adminTab === tabName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.adminPanel !== tabName);
    });
  }

  function bindEvents() {
    $("article-admin-retry").addEventListener("click", verifyAdmin);
    $("article-admin-new").addEventListener("click", newArticle);
    $("article-admin-refresh").addEventListener("click", () => loadArticles());
    $("article-admin-search").addEventListener("input", renderArticleList);
    $("article-admin-status-filter").addEventListener("change", renderArticleList);
    $("article-admin-generate-excerpt").addEventListener("click", generateExcerpt);
    $("article-admin-delete").addEventListener("click", deleteArticle);
    $("article-admin-save-draft").addEventListener("click", () => {
      setField("article-admin-status", "draft");
      saveArticle({ status: "draft" });
    });
    $("article-admin-publish").addEventListener("click", () => {
      setField("article-admin-status", "published");
      saveArticle({ status: "published" });
    });
    $("article-admin-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveArticle();
    });

    [
      "article-admin-status",
      "article-admin-publish-at",
      "article-admin-category",
      "article-admin-tag",
      "article-admin-author",
      "article-admin-title",
      "article-admin-excerpt",
      "article-admin-content",
    ].forEach((id) => {
      $(id).addEventListener("input", () => {
        updateCounters();
        schedulePreview();
      });
      $(id).addEventListener("change", schedulePreview);
    });

    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.adminTab || "preview"));
    });

    bindMarkupTools();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    renderMediaLibrary();
    newArticle();

    await window.EvanSiteAccount?.ready;
    await window.EvanGoogleAuth?.init?.();
    window.EvanGoogleAuth?.onChange?.((state) => {
      if (!state.isSignedIn) {
        authorized = false;
        $("article-admin-workspace").classList.add("hidden");
        $("article-admin-gate").classList.remove("hidden");
        setGate("請先登入管理員帳戶", "請從右上角登入 Google 帳戶。", "locked");
        return;
      }
      verifyAdmin();
    });
  });
})();
