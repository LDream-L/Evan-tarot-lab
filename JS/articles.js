// ==============================
// articles.js
// 文章列表分類渲染
// ==============================
//
// 主要函式複雜度：
// - renderArticleCategories：O(c)，c = 分類數
// - renderArticles：O(n)，n = 文章數
// - filterArticles：O(n)
//
// 更快的替代方案比較：
// - 暴力法：每新增一篇文章就手動複製一整段 <article> HTML，容易漏 class、格式不一致。
// - 本實作：文章只集中寫在 ARTICLE_DATA 陣列，畫面由 JS 自動渲染；分類篩選只掃一次文章清單。
// ==============================

(function initArticlePage() {
  const ARTICLE_CATEGORIES = [
    { id: "all", label: "全部" },
    { id: "experiment", label: "實驗紀錄" },
    { id: "system", label: "系統思維" },
    { id: "case", label: "匿名案例" },
    { id: "guide", label: "占卜教學" },
    { id: "reflection", label: "思考短文" },
  ];

  // ✅ 之後要新增文章，只要在這裡新增一筆物件即可。
  const ARTICLE_DATA = [
    {
      id: "tarot-as-system",
      category: "system",
      tag: "系統思維",
      title: "把塔羅當成「系統」，而不是單次答案",
      date: "2025-12-06",
      author: "Evan",
      excerpt:
        "大部分人用塔羅的方式是：遇到問題 → 抽一次牌 → 拿到一個答案。但如果把每一次占卜都當成「當下狀態的快照」，並持續紀錄與回顧，塔羅就會變成一個可以追蹤自己選擇與變化的系統，而不是神秘黑盒子。",
      link: "",
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
      link: "timeflow.html",
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
      link: "lost-item.html",
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
      link: "",
    },
  ];

  let activeCategory = "all";

  function escapeHtml(input) {
    if (input == null) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCategoryLabel(categoryId) {
    const category = ARTICLE_CATEGORIES.find((item) => item.id === categoryId);
    return category ? category.label : "其他";
  }

  function filterArticles() {
    if (activeCategory === "all") return ARTICLE_DATA;
    return ARTICLE_DATA.filter((article) => article.category === activeCategory);
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
      list.innerHTML = `<p class="article-empty">此分類目前還沒有文章。</p>`;
      return;
    }

    list.innerHTML = articles.map((article) => {
      const linkHtml = article.link
        ? `<a class="article-read-more" href="${escapeHtml(article.link)}">閱讀相關頁面</a>`
        : `<p class="article-link-tip">之後可以改成連去 Dcard / IG / 部落格的「閱讀全文」連結。</p>`;

      return `
        <article class="card article-card" data-article-id="${escapeHtml(article.id)}" data-category="${escapeHtml(article.category)}">
          <span class="article-tag">${escapeHtml(article.tag || getCategoryLabel(article.category))}</span>
          <h3>${escapeHtml(article.title)}</h3>
          <p class="article-meta">${escapeHtml(article.date)} · ${escapeHtml(article.author)}</p>
          <p class="article-excerpt">${escapeHtml(article.excerpt)}</p>
          ${linkHtml}
        </article>
      `;
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderArticleCategories();
    renderArticles();
  });

  window.EvanArticles = {
    data: ARTICLE_DATA,
    categories: ARTICLE_CATEGORIES,
    renderArticles,
  };
})();
