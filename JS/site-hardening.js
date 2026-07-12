// ==============================
// site-hardening.js
// 全站安全與可靠性模組啟動器
// ==============================
//
// 主要函式複雜度：
// - loadBootstrapScript：時間／空間 O(1)（不含網路等待）
// - boot：時間／空間 O(k)，k = 固定功能模組數
//
// 更快替代方案比較：
// - 單一大型檔案包含彈窗、連結、文章、時間流與帳戶：修改任一功能都要重新理解整份檔案。
// - 本實作：此檔只處理啟動順序；各功能各自暴露小型 API，可獨立測試與替換。
// ==============================

(function initSiteHardeningBootstrap() {
  "use strict";

  if (window.EvanSiteHardening) return;

  const BOOTSTRAP_TIMEOUT_MS = 12000;
  const VERSION = "20260712-modular-v1";

  function loadBootstrapScript(src, marker, isReady) {
    if (typeof isReady === "function" && isReady()) return Promise.resolve(true);

    return new Promise((resolve) => {
      let script = document.querySelector(`script[data-site-bootstrap="${marker}"]`);
      let settled = false;
      let timer = 0;

      const finish = (success) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(Boolean(success));
      };

      const verify = () => finish(typeof isReady !== "function" || Boolean(isReady()));

      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.siteBootstrap = marker;
        document.head.appendChild(script);
      }

      script.addEventListener("load", verify, { once: true });
      script.addEventListener("error", () => finish(false), { once: true });
      timer = window.setTimeout(
        () => finish(typeof isReady === "function" && Boolean(isReady())),
        BOOTSTRAP_TIMEOUT_MS
      );
      queueMicrotask(() => {
        if (typeof isReady === "function" && isReady()) finish(true);
      });
    });
  }

  async function boot() {
    const loaderReady = await loadBootstrapScript(
      `JS/core/script-loader.js?v=${VERSION}`,
      "script-loader",
      () => Boolean(window.EvanScriptLoader)
    );
    if (!loaderReady || !window.EvanScriptLoader) {
      console.error("[site-hardening] 可靠模組載入器無法啟動。");
      return false;
    }

    const modules = [
      {
        src: `JS/core/dialog.js?v=${VERSION}`,
        marker: "dialog",
        isReady: () => window.EvanDialog?.isEnhanced === true,
      },
      {
        src: `JS/security/link-sanitizer.js?v=${VERSION}`,
        marker: "link-sanitizer",
        isReady: () => Boolean(window.EvanLinkSanitizer),
      },
      {
        src: `JS/articles/article-fallback.js?v=${VERSION}`,
        marker: "article-fallback",
        isReady: () => Boolean(window.EvanArticleFallback),
      },
      {
        src: `JS/timeflow/import-export.js?v=${VERSION}`,
        marker: "timeflow-import-export",
        isReady: () => Boolean(window.EvanTimeflowImportExport),
      },
      {
        src: `JS/bootstrap/optional-modules.js?v=${VERSION}`,
        marker: "optional-modules",
        isReady: () => Boolean(window.EvanOptionalModules),
      },
    ];

    const results = await window.EvanScriptLoader.loadAll(modules);
    if (!results.every(Boolean)) {
      console.warn("[site-hardening] 部分非核心模組未完成載入；主要頁面仍可繼續使用。", results);
    }

    window.EvanLinkSanitizer?.observe?.();
    window.EvanArticleFallback?.render?.();
    window.EvanTimeflowImportExport?.install?.();
    await window.EvanOptionalModules?.init?.();
    return true;
  }

  const ready = document.readyState === "loading"
    ? new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", () => resolve(boot()), { once: true });
      })
    : boot();

  window.EvanSiteHardening = Object.freeze({
    version: VERSION,
    ready,
    get loader() {
      return window.EvanScriptLoader || null;
    },
    get dialog() {
      return window.EvanDialog || null;
    },
    get linkSanitizer() {
      return window.EvanLinkSanitizer || null;
    },
    get articleFallback() {
      return window.EvanArticleFallback || null;
    },
    get timeflowImportExport() {
      return window.EvanTimeflowImportExport || null;
    },
  });
})();
