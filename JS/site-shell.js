// ==============================
// site-shell.js
// 全站靜態頁首的鍵盤導覽漸進增強
// ==============================
//
// 主要函式複雜度：
// - activateSkipLink：時間／空間 O(1)
// - click delegation：時間／空間 O(1)
//
// 更快替代方案比較：
// - 只使用 #hash：可捲動，但部分瀏覽器不會把焦點移到 tabindex="-1" 的主要內容。
// - 每頁各自綁定：功能相同但維護成本隨頁面數增加。
// - 本實作：單一事件委派，同步更新 hash、捲動與焦點；無 JavaScript 時仍保留原生跳轉。
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

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(".skip-link");
    if (!link) return;
    activateSkipLink(link, event);
  });
})();
