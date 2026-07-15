// ==============================
// article-admin-media-refresh.js
// 共用圖片索引更新後，觸發文章後台即時預覽重繪。
// ==============================
//
// 主要函式複雜度：時間／空間 O(1)。
// 更快替代方案比較：直接重建整個管理表單會造成多餘 DOM 工作；本實作只觸發既有防抖預覽流程。
// ==============================

(function initArticleAdminMediaRefresh() {
  "use strict";

  function refreshPreview() {
    const content = document.getElementById("article-admin-content");
    content?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  document.addEventListener("evan:article-media-updated", refreshPreview);
  document.addEventListener("DOMContentLoaded", async () => {
    try { await window.EvanArticleMedia?.ready; }
    catch (error) { console.warn("[article-admin-media-refresh] 等待圖片庫失敗：", error); }
    refreshPreview();
  });
})();
