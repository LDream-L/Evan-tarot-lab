// ==============================
// articles/article-fallback.js
// 雲端文章完成前先顯示內建內容
// ==============================
//
// 主要函式複雜度：
// - render：時間 O(c + n)，空間 O(c)，c = 分類數、n = 文章數
//
// 更快替代方案比較：
// - 等雲端完成才渲染：網路慢或後端故障時會長時間空白。
// - 本實作：只在容器為空時建立分類與內建文章，避免重複 DOM 工作。
// ==============================

(function defineArticleFallback() {
  "use strict";

  if (window.EvanArticleFallback) return;

  function render() {
    const api = window.EvanArticles;
    const bar = document.getElementById("article-category-bar");
    const list = document.getElementById("article-list");
    if (!api || !bar || !list) return false;

    if (!bar.children.length) {
      const fragment = document.createDocumentFragment();
      api.categories.forEach((category) => {
        const button = document.createElement("button");
        button.className = `article-category-pill${category.id === "all" ? " is-active" : ""}`;
        button.type = "button";
        button.dataset.category = category.id;
        button.setAttribute("aria-pressed", String(category.id === "all"));
        button.textContent = category.label;
        fragment.appendChild(button);
      });
      bar.replaceChildren(fragment);
    }

    if (!list.children.length) api.renderArticles?.();
    return true;
  }

  window.EvanArticleFallback = Object.freeze({ render });
})();
