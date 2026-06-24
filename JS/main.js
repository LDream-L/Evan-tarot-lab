// ==============================
// main.js
// 初始化：導覽、頁面脈絡、事件綁定與平滑滾動
// ==============================
//
// 主要函式複雜度：
// - normalizeSiteNavigation：O(n)，n = 導覽連結數
// - normalizeLostItemLabContext：O(1)
// - DOMContentLoaded 初始化：O(n)
// 空間複雜度：O(n)
//
// 更快替代方案比較：
// - 各頁分別維護導覽：容易出現文章／實驗室名稱不同步。
// - 共用導覽修正：載入時一次補齊文章與實驗室入口，並移除舊尋物主選單。
// ==============================

function loadArticleCommentsScript() {
  return new Promise((resolve) => {
    if (window.EvanArticleComments) {
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "JS/article-comments.js?v=20260624-article-comments-v1";
    script.onload = () => resolve(Boolean(window.EvanArticleComments));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function ensureLabStyles() {
  if (document.querySelector('link[href*="lab.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "lab.css?v=20260624-lab-v2";
  document.head.appendChild(stylesheet);
}

function createNavLink(href, text) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  return link;
}

/**
 * 文章與實驗室保持獨立，塔羅尋物歸入實驗室。
 * 時間複雜度：O(n)
 * 空間複雜度：O(1)
 */
function normalizeSiteNavigation() {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  let articleLink = nav.querySelector('a[href="articles.html"]');
  let labLink = nav.querySelector('a[href="lab.html"]');
  const lostItemLink = nav.querySelector('a[href="lost-item.html"]');
  const timeflowLink = nav.querySelector('a[href="timeflow.html"]');
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  if (!articleLink) {
    articleLink = createNavLink("articles.html", "文章");
    nav.insertBefore(articleLink, timeflowLink || null);
  }
  articleLink.textContent = "文章";

  if (!labLink) {
    labLink = createNavLink("lab.html", "實驗室");
    articleLink.insertAdjacentElement("afterend", labLink);
  }
  labLink.textContent = "實驗室";

  lostItemLink?.remove();
  articleLink.removeAttribute("aria-current");
  labLink.removeAttribute("aria-current");

  if (currentPage === "articles.html" || currentPage === "article.html") {
    articleLink.setAttribute("aria-current", "page");
  }
  if (currentPage === "lab.html" || currentPage === "lost-item.html") {
    labLink.setAttribute("aria-current", "page");
  }
}

/**
 * 將塔羅尋物標示為實驗室內的實驗物件。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function normalizeLostItemLabContext() {
  if (!document.getElementById("lost-item-tool")) return;

  ensureLabStyles();

  const heroText = document.querySelector(".subpage-hero .hero-text");
  const heroButtons = heroText?.querySelectorAll(".hero-cta .btn");
  const heroPills = heroText?.querySelectorAll(".hero-meta .pill");
  const heroCard = document.querySelector(".subpage-hero .hero-card-inner");

  if (heroText && !heroText.querySelector(".lab-breadcrumb")) {
    const breadcrumb = document.createElement("a");
    breadcrumb.className = "lab-breadcrumb";
    breadcrumb.href = "lab.html#projects";
    breadcrumb.textContent = "← 塔羅實驗室 / 實驗物件";
    heroText.prepend(breadcrumb);
  }

  if (heroButtons?.[1]) {
    heroButtons[1].href = "lab.html#projects";
    heroButtons[1].textContent = "回實驗室";
  }

  if (heroPills?.[0]) heroPills[0].textContent = "實驗物件";
  if (heroPills?.[1]) heroPills[1].textContent = "塔羅尋物 v4.7";

  if (heroCard) {
    const tag = heroCard.querySelector(".hero-tag");
    const items = heroCard.querySelectorAll("li");
    const note = heroCard.querySelector(".hero-note");

    if (tag) tag.textContent = "實驗重點";
    if (items[0]) items[0].textContent = "以牌面與情境權重收斂搜尋區域";
    if (items[1]) items[1].textContent = "依 Top 1～3 的順序逐區搜尋";
    if (items[2]) items[2].textContent = "找到後回填結果，作為後續模型驗證";
    if (note) note.textContent = "結果用來安排搜尋順序，不是 GPS 座標。";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  normalizeSiteNavigation();
  normalizeLostItemLabContext();

  const articlePage = Boolean(
    document.getElementById("article-list") &&
    document.getElementById("comment-form")
  );

  let articleCommentsReady = false;

  if (articlePage) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "article-comments.css?v=20260624-article-comments-v1";
    document.head.appendChild(stylesheet);

    articleCommentsReady = await loadArticleCommentsScript();
    if (articleCommentsReady) {
      await window.EvanArticleComments.init();
    }
  }

  const lostItemForm = document.getElementById("lost-item-form");
  if (lostItemForm && window.handleLostItemForm) {
    lostItemForm.addEventListener("submit", window.handleLostItemForm);
  }

  const lostItemFeedbackForm = document.getElementById("lost-item-feedback-form");
  if (lostItemFeedbackForm && window.handleLostItemFeedbackForm) {
    lostItemFeedbackForm.addEventListener("submit", window.handleLostItemFeedbackForm);
  }

  const bookingForm = document.getElementById("booking-form");
  if (bookingForm && window.handleBookingForm) {
    bookingForm.addEventListener("submit", window.handleBookingForm);
  }

  const commentForm = document.getElementById("comment-form");
  if (commentForm) {
    const commentHandler = articleCommentsReady
      ? window.EvanArticleComments.handleArticleCommentForm
      : window.handleCommentForm;

    if (commentHandler) commentForm.addEventListener("submit", commentHandler);
  }

  window.loadMappingFromSheet?.();

  if (!articleCommentsReady) {
    window.renderComments?.();
  }

  window.initDivinationMap?.();

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (event) {
      const targetId = this.getAttribute("href");
      const targetElement = document.querySelector(targetId);
      if (!targetElement) return;

      event.preventDefault();
      targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
});
