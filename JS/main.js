// ==============================
// main.js
// 初始化：事件綁定、預載資料、平滑滾動
// ==============================
//
// 時間複雜度：O(n)（renderComments 與載入 Mapping 各一次）
// 空間複雜度：O(n)
// ==============================

document.addEventListener("DOMContentLoaded", () => {
  const lostItemForm = document.getElementById("lost-item-form");
  if (lostItemForm) {
    lostItemForm.addEventListener("submit", window.handleLostItemForm);
  }

  // 失物占卜回饋表單
  const lostItemFeedbackForm = document.getElementById(
    "lost-item-feedback-form"
  );
  if (lostItemFeedbackForm && window.handleLostItemFeedbackForm) {
    lostItemFeedbackForm.addEventListener(
      "submit",
      window.handleLostItemFeedbackForm
    );
  }

  const bookingForm = document.getElementById("booking-form");
  if (bookingForm) {
    bookingForm.addEventListener("submit", window.handleBookingForm);
  }

  const commentForm = document.getElementById("comment-form");
  if (commentForm) {
    commentForm.addEventListener("submit", window.handleCommentForm);
  }

  // 一進頁面就先背景載入 Mapping，使用體驗會比較順
  window.loadMappingFromSheet();

  // 初始渲染留言
  window.renderComments();

  // 錨點平滑滾動
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const targetId = this.getAttribute("href");
      const targetEl = document.querySelector(targetId);
      if (!targetEl) return;
      e.preventDefault();
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
});
