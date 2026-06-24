// ==============================
// copy-cleanup.js
// 將舊版動態訊息統一成直接、必要的操作文字
// ==============================
//
// 時間複雜度：O(n)，n = 本次新增或更新的文字節點數
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 分散修改：每個模組各自維護相同訊息，容易遺漏舊快取或備援流程。
// - 集中查表：以固定字串查表統一替換，單一節點查詢為常數時間。
// ==============================

(function initCopyCleanup() {
  "use strict";

  const REPLACEMENTS = new Map([
    [
      "暱稱已更新，所有歷史留言會同步顯示新暱稱。",
      "暱稱已更新。",
    ],
    [
      "暱稱尚未成功更新，請確認 Apps Script 已部署最新版。",
      "暱稱更新失敗，請稍後再試。",
    ],
    [
      "Google 登入尚未完成 OAuth Client ID 設定。",
      "Google 登入目前無法使用。",
    ],
    [
      "這篇文章目前還沒有留言，可以成為第一個留言的人。",
      "此文章尚無留言。",
    ],
    [
      "登入、暱稱或雲端儲存狀態異常，請重新確認後再試。",
      "留言送出失敗，請重新登入後再試。",
    ],
  ]);

  function replaceTextNode(node) {
    const current = String(node.nodeValue || "");
    const trimmed = current.trim();
    const replacement = REPLACEMENTS.get(trimmed);
    if (!replacement) return;

    const leading = current.match(/^\s*/)?.[0] || "";
    const trailing = current.match(/\s*$/)?.[0] || "";
    node.nodeValue = `${leading}${replacement}${trailing}`;
  }

  function cleanNode(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      replaceTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      replaceTextNode(node);
      node = walker.nextNode();
    }
  }

  function start() {
    cleanNode(document.body);

    const observer = new MutationObserver((mutations) => {
      for (let index = 0; index < mutations.length; index += 1) {
        const mutation = mutations[index];
        if (mutation.type === "characterData") {
          replaceTextNode(mutation.target);
          continue;
        }

        for (let childIndex = 0; childIndex < mutation.addedNodes.length; childIndex += 1) {
          cleanNode(mutation.addedNodes[childIndex]);
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
