// ==============================
// article-media-refresh.js
// 雲端圖片索引完成後，重新建立公開文章正文中的圖片節點。
// ==============================
//
// 主要函式複雜度：
// - refreshPublicArticleBody：時間／空間 O(L)，L = 文章正文字元／區塊數
//
// 更快替代方案比較：
// - 每張圖片各自等待網路索引：會建立多個重複等待與查詢。
// - 本實作：圖片索引只批次載入一次，完成後整篇正文線性重建一次。
// ==============================

(function initArticleMediaRefresh() {
  "use strict";

  const MAX_RENDER_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 80;

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function refreshPublicArticleBody() {
    await Promise.all([
      window.EvanArticles?.ready,
      window.EvanArticleMedia?.ready,
    ]);

    const articleId = new URLSearchParams(window.location.search).get("id") || "";
    const article = window.EvanArticles?.getById?.(articleId) || null;
    if (!article || !window.EvanArticleRenderer?.createBody) return false;

    for (let attempt = 0; attempt < MAX_RENDER_ATTEMPTS; attempt += 1) {
      const currentBody = document.querySelector("#article-detail > .article-detail-body");
      if (currentBody) {
        currentBody.replaceWith(window.EvanArticleRenderer.createBody(article));
        return true;
      }
      await delay(RETRY_DELAY_MS);
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshPublicArticleBody().catch((error) => {
      console.warn("[article-media-refresh] 更新文章圖片失敗：", error);
    });
  });
})();
