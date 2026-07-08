// ==============================
// articles.js
// 從私人 Google Sheets／Apps Script 讀取已發布文章
// ==============================
//
// 主要函式複雜度：
// - normalizeArticle：時間 O(m)，空間 O(m)，m = 單篇文章文字長度
// - rebuildArticleIndexes：時間 O(n + c)，空間 O(n + c)
// - getArticleById：時間 O(1)，空間 O(1)
// - renderArticleCategories：時間 O(c)，空間 O(c)
// - renderArticles：全部分類為 O(n + c)，單一分類為 O(k)
//   n = 文章總數、c = 分類數、k = 該分類文章數
//
// 更快替代方案比較：
// - 暴力法：渲染每個分類時都重新掃描完整文章陣列，成本為 O(c × n)。
// - 本實作：文章載入後先建立分類 Map 與文章 ID Map，分類查詢與單篇查詢直接查表；
//   「全部」頁只依索引取每類前 3 篇，避免重複篩選與重複運算。
// ==============================

(function initArticleData() {
  "use strict";

  const REQUEST_TIMEOUT_MS = 12000;
  const ARTICLE_SECTION_LIMIT = 3;
  const ARTICLE_CATEGORIES = Object.freeze([
    Object.freeze({
      id: "all",
      label: "全部",
      description: "依分類瀏覽所有已發布文章。",
    }),
    Object.freeze({
      id: "system",
      label: "系統思維",
      description: "占卜方法、判讀框架與底層邏輯。",
    }),
    Object.freeze({
      id: "experiment",
      label: "實驗紀錄",
      description: "實際測試、後續驗證與復盤紀錄。",
    }),
    Object.freeze({
      id: "case",
      label: "匿名案例",
      description: "保留問題結構與判讀過程的真實案例。",
    }),
    Object.freeze({
      id: "guide",
      label: "占卜教學",
      description: "從入門觀念到實際操作的方法整理。",
    }),
    Object.freeze({
      id: "reflection",
      label: "思考短文",
      description: "從塔羅延伸到選擇、生活與自我觀察。",
    }),
  ]);
  const ARTICLE_CATEGORY_IDS = new Set(
    ARTICLE_CATEGORIES.map((category) => category.id)
  );

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
  let articleData = FALLBACK_ARTICLES.map(normalizeArticle).filter(Boolean);
  let articleById = new Map();
  let articlesByCategory = new Map();
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

  function normalizeCaseCode(input) {
    return String(input || "").replace(/\bp-(\d{4})\b/gi, "P-$1");
  }

  function normalizeArticle(raw) {
    const id = String(raw?.id || "").trim().toLowerCase();
    const title = normalizeCaseCode(String(raw?.title || "").trim());
    const excerpt = String(raw?.excerpt || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) || !title) return null;

    const rawCategory = String(raw?.category || "reflection").trim();
    const category =
      rawCategory !== "all" && ARTICLE_CATEGORY_IDS.has(rawCategory)
        ? rawCategory
        : "reflection";
    const content = Array.isArray(raw?.content)
      ? raw.content
          .map((paragraph) => String(paragraph || "").trim())
          .filter(Boolean)
      : [String(raw?.content || excerpt).trim()].filter(Boolean);

    return Object.freeze({
      id,
      category,
      tag: String(raw?.tag || getCategoryLabel(category)).trim(),
      title,
      date: String(raw?.date || "").trim(),
      author: String(raw?.author || "Evan").trim(),
      excerpt: excerpt || content[0] || "",
      content,
      relatedLink: String(raw?.relatedLink || "").trim(),
      relatedLabel: String(raw?.relatedLabel || "").trim(),
    });
  }

  function rebuildArticleIndexes() {
    articleById = new Map();
    articlesByCategory = new Map(
      ARTICLE_CATEGORIES.filter((category) => category.id !== "all").map(
        (category) => [category.id, []]
      )
    );

    for (const article of articleData) {
      articleById.set(article.id, article);
      articlesByCategory.get(article.category)?.push(article);
    }
  }

  function setArticleData(nextArticles, nextSource) {
    articleData = nextArticles.map(normalizeArticle).filter(Boolean);
    dataSource = nextSource;
    rebuildArticleIndexes();
    return articleData;
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

      return setArticleData(payload.articles, "cloud");
    } catch (error) {
      console.warn("[articles] 雲端文章讀取失敗，使用內建備援：", error);
      return setArticleData(FALLBACK_ARTICLES, "fallback");
    }
  }

  function getArticleById(articleId) {
    return articleById.get(String(articleId || "").trim().toLowerCase()) || null;
  }

  function getCategory(categoryId) {
    return (
      ARTICLE_CATEGORIES.find((category) => category.id === categoryId) || null
    );
  }

  function getCategoryLabel(categoryId) {
    return getCategory(categoryId)?.label || "其他";
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
          aria-pressed="${isActive}"
        >
          ${escapeHtml(category.label)}
        </button>
      `;
    }).join("");
  }

  function renderArticleCard(article) {
    const detailUrl = `article.html?id=${encodeURIComponent(article.id)}`;
    return `
      <article class="card article-card article-card-horizontal" data-article-id="${escapeHtml(article.id)}" data-category="${escapeHtml(article.category)}">
        <div class="article-card-copy">
          <div class="article-card-eyebrow">
            <span class="article-tag">${escapeHtml(article.tag || getCategoryLabel(article.category))}</span>
            <span class="article-meta">${escapeHtml(article.date)} · ${escapeHtml(article.author)}</span>
          </div>
          <h3><a class="article-title-link" href="${detailUrl}">${escapeHtml(article.title)}</a></h3>
          <p class="article-excerpt">${escapeHtml(article.excerpt)}</p>
        </div>
        <div class="article-card-action">
          <a class="btn ghost article-open-button" href="${detailUrl}">閱讀文章與留言 <span aria-hidden="true">→</span></a>
        </div>
      </article>
    `;
  }

  function renderCategorySection(category, articles, isOverview) {
    const visibleArticles = isOverview
      ? articles.slice(0, ARTICLE_SECTION_LIMIT)
      : articles;
    const hiddenCount = Math.max(articles.length - visibleArticles.length, 0);
    const actionCategory = isOverview ? category.id : "all";
    const actionLabel = isOverview ? "查看全部" : "返回全部分類";
    const cardsHtml = visibleArticles.length
      ? visibleArticles.map(renderArticleCard).join("")
      : '<p class="article-empty">此分類目前沒有已發布文章。</p>';

    return `
      <section class="article-category-section" data-category-section="${escapeHtml(category.id)}">
        <header class="article-category-section-header">
          <div class="article-category-heading">
            <div class="article-category-title-row">
              <h3>${escapeHtml(category.label)}</h3>
              <span class="article-category-count">${articles.length} 篇</span>
            </div>
            <p>${escapeHtml(category.description || "")}</p>
          </div>
          <button class="article-section-action" type="button" data-view-category="${escapeHtml(actionCategory)}">
            ${escapeHtml(actionLabel)} <span aria-hidden="true">→</span>
          </button>
        </header>
        <div class="article-section-list">${cardsHtml}</div>
        ${
          hiddenCount
            ? `<p class="article-section-more">尚有 ${hiddenCount} 篇文章，點選「查看全部」展開此分類。</p>`
            : ""
        }
      </section>
    `;
  }

  function renderOverview() {
    const sections = ARTICLE_CATEGORIES.filter(
      (category) => category.id !== "all"
    )
      .map((category) => {
        const articles = articlesByCategory.get(category.id) || [];
        return articles.length
          ? renderCategorySection(category, articles, true)
          : "";
      })
      .join("");

    return (
      sections || '<p class="article-empty">目前沒有已發布文章。</p>'
    );
  }

  function renderArticles() {
    const list = document.getElementById("article-list");
    if (!list) return;

    const selectedCategory = getCategory(activeCategory) || getCategory("all");
    list.classList.toggle("is-category-overview", activeCategory === "all");
    list.classList.toggle("is-single-category", activeCategory !== "all");
    list.setAttribute("aria-busy", "false");

    if (activeCategory === "all") {
      list.innerHTML = renderOverview();
      return;
    }

    const articles = articlesByCategory.get(activeCategory) || [];
    list.innerHTML = renderCategorySection(
      selectedCategory,
      articles,
      false
    );
  }

  function selectCategory(categoryId, shouldScrollToFilters) {
    const nextCategory = ARTICLE_CATEGORY_IDS.has(categoryId)
      ? categoryId
      : "all";
    activeCategory = nextCategory;
    renderArticleCategories();
    renderArticles();

    if (shouldScrollToFilters) {
      document
        .getElementById("article-category-bar")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function bindArticleInteractions() {
    const bar = document.getElementById("article-category-bar");
    const list = document.getElementById("article-list");

    bar?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button || !bar.contains(button)) return;
      selectCategory(button.dataset.category || "all", false);
    });

    list?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view-category]");
      if (!button || !list.contains(button)) return;
      selectCategory(button.dataset.viewCategory || "all", true);
    });
  }

  rebuildArticleIndexes();
  const ready = loadArticles();

  document.addEventListener("DOMContentLoaded", async () => {
    bindArticleInteractions();
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
