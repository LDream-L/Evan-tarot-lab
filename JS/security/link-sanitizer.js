// ==============================
// security/link-sanitizer.js
// 動態連結協定檢查
// ==============================
//
// 主要函式複雜度：
// - sanitize：時間 O(a)，空間 O(1)，a = 掃描連結數
// - observe：每批新增節點時間 O(a)，空間 O(1)
//
// 更快替代方案比較：
// - 每次互動前重掃整頁：重複工作量高。
// - 本實作：初始化掃描一次，之後只檢查 MutationObserver 新增節點。
// ==============================

(function defineLinkSanitizer() {
  "use strict";

  if (window.EvanLinkSanitizer) return;

  const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
  let observer = null;

  function sanitize(root = document) {
    const anchors = root instanceof HTMLAnchorElement
      ? [root]
      : root.querySelectorAll?.("a[href]") || [];

    anchors.forEach((anchor) => {
      const rawHref = String(anchor.getAttribute("href") || "").trim();
      if (
        !rawHref
        || rawHref.startsWith("#")
        || rawHref.startsWith("/")
        || rawHref.startsWith("./")
        || rawHref.startsWith("../")
      ) return;

      try {
        const parsed = new URL(rawHref, window.location.href);
        if (SAFE_PROTOCOLS.has(parsed.protocol)) return;
      } catch (error) {
        // 由下方統一停用。
      }

      console.warn("[link-sanitizer] 已移除不安全連結：", rawHref);
      anchor.removeAttribute("href");
      anchor.setAttribute("aria-disabled", "true");
    });
  }

  function observe() {
    if (observer) return observer;
    sanitize(document);
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) sanitize(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return observer;
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
  }

  window.EvanLinkSanitizer = Object.freeze({ sanitize, observe, disconnect });
})();
