// ==============================
// article-detail.js
// 獨立文章頁渲染
// ==============================
//
// 主要函式複雜度：O(n + p)
// - n = 文章數（依 ID 尋找）
// - p = 文章段落數
// 空間複雜度：O(p)
// ==============================

(function initArticleDetailPage() {
  "use strict";

  function normalizeLabNavigation() {
    const nav = document.querySelector(".nav");
    if (!nav) return;

    const labLink = nav.querySelector('a[href="articles.html"]');
    const lostItemLink = nav.querySelector('a[href="lost-item.html"]');
    if (labLink) {
      labLink.textContent = "實驗室";
      labLink.setAttribute("aria-current", "page");
    }
    lostItemLink?.remove();

    const backLink = document.querySelector(".article-back-link");
    if (backLink) backLink.textContent = "← 回塔羅實驗室";
  }

  function createParagraph(text) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }

  function renderNotFound(container) {
    container.className = "article-detail-card article-not-found";

    const title = document.createElement("h1");
    title.textContent = "找不到這篇文章";

    const text = document.createElement("p");
    text.textContent = "文章可能尚未發布、已封存，或網址中的文章 ID 不正確。";

    const link = document.createElement("a");
    link.className = "btn primary";
    link.href = "articles.html";
    link.textContent = "回塔羅實驗室";

    container.replaceChildren(title, text, link);
    document.getElementById("article-discussion")?.classList.add("hidden");
  }

  function renderArticle(container, article) {
    const header = document.createElement("header");
    header.className = "article-detail-header";

    const tag = document.createElement("span");
    tag.className = "article-tag";
    tag.textContent = article.tag || "文章";

    const title = document.createElement("h1");
    title.textContent = article.title;

    const meta = document.createElement("p");
    meta.className = "article-meta";
    meta.textContent = `${article.date} · ${article.author}`;

    header.append(tag, title, meta);

    const body = document.createElement("div");
    body.className = "article-detail-body";
    const paragraphs = Array.isArray(article.content) && article.content.length
      ? article.content
      : [article.excerpt];

    paragraphs.filter(Boolean).forEach((paragraph) => {
      body.appendChild(createParagraph(paragraph));
    });

    const footer = document.createElement("footer");
    footer.className = "article-detail-actions";

    if (article.relatedLink) {
      const relatedLink = document.createElement("a");
      relatedLink.className = "btn ghost";
      relatedLink.href = article.relatedLink;
      relatedLink.textContent = article.relatedLabel || "閱讀相關頁面";
      footer.appendChild(relatedLink);
    }

    const discussionLink = document.createElement("a");
    discussionLink.className = "btn primary";
    discussionLink.href = "#article-discussion";
    discussionLink.textContent = "前往留言討論";
    footer.appendChild(discussionLink);

    container.replaceChildren(header, body, footer);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    normalizeLabNavigation();

    const container = document.getElementById("article-detail");
    if (!container) return;

    try {
      await window.EvanArticles?.ready;
    } catch (error) {
      console.warn("[article-detail] 等待文章資料時發生錯誤：", error);
    }

    const articleId = new URLSearchParams(window.location.search).get("id") || "";
    const article = window.EvanArticles?.getById?.(articleId) || null;

    if (!article) {
      renderNotFound(container);
      return;
    }

    document.title = `${article.title}｜Evan Tarot`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = article.excerpt;

    document.body.dataset.articleId = article.id;
    renderArticle(container, article);

    await window.EvanGoogleAuth?.init?.();
    await window.EvanArticleComments?.init?.(article);
  });
})();
