// ==============================
// site-shell.js
// 全站靜態頁首的鍵盤導覽與動態文章 canonical 增強
// ==============================
//
// 主要函式複雜度：
// - activateSkipLink：時間／空間 O(1)
// - normalizeDynamicCanonical：時間／空間 O(1)
// - click delegation：時間／空間 O(1)
//
// 更快替代方案比較：
// - 只使用 #hash：可捲動，但部分瀏覽器不會把焦點移到 tabindex="-1" 的主要內容。
// - 每頁各自綁定：功能相同但維護成本隨頁面數增加。
// - 本實作：單一事件委派處理焦點；文章 query URL 則只在文章頁更新一次 canonical 與 og:url。
// ==============================

(function initSiteShell() {
  "use strict";

  /** 將 skip link 的目標同時設為網址、視窗位置與鍵盤焦點。時間／空間 O(1)。 */
  function activateSkipLink(link, event) {
    const selector = link.getAttribute("href");
    if (!selector || !selector.startsWith("#")) return;

    let target = null;
    try {
      target = document.querySelector(selector);
    } catch (error) {
      console.warn("[site-shell] 無效的 skip link：", selector, error);
      return;
    }
    if (!target) return;

    event.preventDefault();
    if (window.location.hash !== selector) {
      window.history.pushState(null, "", selector);
    }
    target.scrollIntoView({ block: "start", behavior: "auto" });
    target.focus({ preventScroll: true });
  }

  /** 文章詳情以 id query 區分，避免所有文章共用同一 canonical。時間／空間 O(1)。 */
  function normalizeDynamicCanonical() {
    const fileName = window.location.pathname.split("/").pop() || "index.html";
    if (fileName !== "article.html") return;

    const articleId = new URLSearchParams(window.location.search).get("id") || "";
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(articleId)) return;

    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    url.searchParams.set("id", articleId.toLowerCase());

    const canonical = document.querySelector('link[rel="canonical"]');
    const openGraphUrl = document.querySelector('meta[property="og:url"]');
    if (canonical) canonical.href = url.toString();
    if (openGraphUrl) openGraphUrl.content = url.toString();
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(".skip-link");
    if (!link) return;
    activateSkipLink(link, event);
  });

  normalizeDynamicCanonical();
})();
