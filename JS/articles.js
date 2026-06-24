// ==============================
// articles.js
// 從私人 Google Sheets／Apps Script 讀取已發布文章
// ==============================
//
// 主要函式複雜度：
// - loadArticles：O(n)
// - getArticleById：O(n)
// - filterArticles：O(n)
// - renderArticles：O(n)
// - renderArticleCategories：O(c)
// 空間複雜度：O(n + c)
//
// 更快替代方案比較：
// - 暴力法：每篇文章直接寫入 GitHub，新增與修改都要重新部署網站。
// - 本實作：公開頁只讀取 Apps Script 回傳的已發布文章；GitHub 內建資料僅作後端未部署時的備援。
// ==============================

(function initArticleData() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 12000;
  const ARTICLE_CATEGORIES = Object.freeze([
    { id: "all", label: "全部" },
    { id: "experiment", label: "實驗紀錄" },
    { id: "system", label: "系統思維" },
    { id: "case", label: "匿名案例" },
    { id: "guide", label: "占卜教學" },
    { id: "reflection", label: "思考短文" },
  ]);

  const FALLBACK_ARTICLES = Object.freeze([
    {
      id: "tarot-as-system",
      category: "system",
      tag: "系統思維",
      title: "把塔羅當成「系統」，而不是單次答案",
      date: "2025-12-06",
      author: "Evan",
      excerpt:
        "大部分人用塔羅的方式是：遇到問題 → 抽一次牌 → 拿到一個答案。但如果把每一次占卜都當成「當下狀態的快照」，並持續紀錄與回顧，塔羅就會變成一個可以追蹤自己選擇與變化的系統，而不是神秘黑盒子。",
      content: [
        "大部分人用塔羅的方式是：遇到問題 → 抽一次牌 → 拿到一個答案。但如果把每一次占卜都當成「當下狀態的快照」，並持續紀錄與回顧，塔羅就會變成一個可以追蹤自己選擇與變化的系統，而不是神秘黑盒子。",
      ],
      relatedLink: "",
      relatedLabel: "",
    },
    {
      id: "timeflow-experiment",
      category: "experiment",
      tag: "實驗紀錄",
      title: "占卜時間流：從問題到事件，再到驗證",
      date: "2026-05-05",
      author: "Evan",
      excerpt:
        "把占卜案例與後續事件接在同一條主題流上，可以避免只記得準的部分，也能看見牌面、選擇與現實事件之間的關聯。",
      content: [
        "把占卜案例與後續事件接在同一條主題流上，可以避免只記得準的部分，也能看見牌面、選擇與現實事件之間的關聯。",
      ],
      relatedLink: "timeflow.html",
      relatedLabel: "前往占卜時間流工具",
    },
    {
      id: "lost-item-tool-note",
      category: "guide",
      tag: "占卜教學",
      title: "失物占卜不是 GPS，而是搜尋場域收斂工具",
      date: "2026-05-05",
      author: "Evan",
      excerpt:
        "尋物占卜的價值不在於精準定位，而是把混亂的搜尋範圍拆成狀態、場域與行動建議，讓你先找最有機會的地方。",
      content: [
        "尋物占卜的價值不在於精準定位，而是把混亂的搜尋範圍拆成狀態、場域與行動建議，讓你先找最有機會的地方。",
      ],
      relatedLink: "lost-item.html",
      relatedLabel: "前往失物占卜工具",
    },
    {
      id: "anonymous-case-template",
      category: "case",
      tag: "匿名案例",
      title: "匿名案例可以怎麼公開：保留結構，移除個資",
      date: "2026-05-05",
      author: "Evan",
      excerpt:
        "公開案例時，不需要公開個人細節。真正有價值的是問題結構、牌面重點、當時解讀，以及後續事件如何驗證或修正判斷。",
      content: [
        "公開案例時，不需要公開個人細節。真正有價值的是問題結構、牌面重點、當時解讀，以及後續事件如何驗證或修正判斷。",
      ],
      relatedLink: "",
      relatedLabel: "",
    },
  ]);

  let activeCategory = "all";
  let articleData = FALLBACK_ARTICLES.slice();
  let dataSource = "fallback";

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.articlesApiUrl ||
      window.EVAN_CLOUD_CONFIG?.commentsApiUrl ||
      ""
    ).trim();
  }

  function escapeHtml(input) {
    if (input == null) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeArticle(raw) {
    const id = String(raw?.id || "").trim().toLowerCase();
    const title = String(raw?.title || "").trim();
    const excerpt = String(raw?.excerpt || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) || !title) return null;

    const content = Array.isArray(raw?.content)
      ? raw.content.map((paragraph) => String(paragraph || "").trim()).filter(Boolean)
      : [String(raw?.content || excerpt).trim()].filter(Boolean);

    return Object.freeze({
      id,
      category: String(raw?.category || "reflection").trim(),
      tag: String(raw?.tag || "文章").trim(),
      title,
      date: String(raw?.date || "").trim(),
      author: String(raw?.author || "Evan").trim(),
      excerpt: excerpt || content[0] || "",
      content,
      relatedLink: String(raw?.relatedLink || "").trim(),
      relatedLabel: String(raw?.relatedLabel || "").trim(),
    });
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

  async function loadArticles() {
    const apiUrl = getApiUrl();
    if (!apiUrl) return articleData;

    try {
      const url = new URL(apiUrl);
      url.searchParams.set("action", "articles");
      url.searchParams.set("limit", "200");
      url.searchParams.set("_", String(Date.now()));

      const response = await fetchWithTimeout(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      if (!payload?.success || !Array.isArray(payload.articles)) {
        throw new Error(payload?.error || "文章 API 格式不正確");
      }

      articleData = payload.articles.map(normalizeArticle).filter(Boolean);
      dataSource = "cloud";
      return articleData;
    } catch (error) {
      console.warn("[articles] 雲端文章讀取失敗，使用內建備援：", error);
      articleData = FALLBACK_ARTICLES.slice();
      dataSource = "fallback";
      return articleData;
    }
  }

  const ready = loadArticles();

  function getArticleById(articleId) {
    return articleData.find((article) => article.id === articleId) || null;
  }

  function getCategoryLabel(categoryId) {
    const category = ARTICLE_CATEGORIES.find((item) => item.id === categoryId);
    return category ? category.label : "其他";
  }

  function filterArticles() {
    if (activeCategory === "all") return articleData;
    return articleData.filter((article) => article.category === activeCategory);
  }

  function renderArticleCategories() {
    const bar = document.getElementById("article-category-bar");
    if (!bar) return;

    bar.innerHTML = ARTICLE_CATEGORIES.map((category) => {
      const isActive = category.id === activeCategory;
      return `
        <button
          class="article-category-pill${isActive ? " is-active" : ""}"
          type="button"
          data-category="${escapeHtml(category.id)}"
        >
          ${escapeHtml(category.label)}
        </button>
      `;
    }).join("");

    bar.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        activeCategory = button.dataset.category || "all";
        renderArticleCategories();
        renderArticles();
      });
    });
  }

  function renderArticles() {
    const list = document.getElementById("article-list");
    if (!list) return;

    const articles = filterArticles();
    if (!articles.length) {
      list.innerHTML = '<p class="article-empty">此分類目前沒有已發布文章。</p>';
      return;
    }

    list.innerHTML = articles.map((article) => {
      const detailUrl = `article.html?id=${encodeURIComponent(article.id)}`;
      return `
        <article class="card article-card" data-article-id="${escapeHtml(article.id)}" data-category="${escapeHtml(article.category)}">
          <span class="article-tag">${escapeHtml(article.tag || getCategoryLabel(article.category))}</span>
          <h3><a class="article-title-link" href="${detailUrl}">${escapeHtml(article.title)}</a></h3>
          <p class="article-meta">${escapeHtml(article.date)} · ${escapeHtml(article.author)}</p>
          <p class="article-excerpt">${escapeHtml(article.excerpt)}</p>
          <a class="btn ghost article-open-button" href="${detailUrl}">閱讀文章與留言</a>
        </article>
      `;
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await ready;
    renderArticleCategories();
    renderArticles();
  });

  window.EvanArticles = Object.freeze({
    categories: ARTICLE_CATEGORIES,
    ready,
    getById: getArticleById,
    getData: () => articleData.slice(),
    getSource: () => dataSource,
    reload: loadArticles,
    renderArticles,
  });
})();
