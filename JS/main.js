// ==============================
// main.js
// 初始化：事件綁定、預載資料、平滑滾動
// ==============================
//
// 時間複雜度：O(n)
// 空間複雜度：O(n)
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

document.addEventListener("DOMContentLoaded", async () => {
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
