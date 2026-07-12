// ==============================
// core/script-loader.js
// 全站共用的可靠 JavaScript 載入器
// ==============================
//
// 主要函式複雜度：
// - load：時間／空間 O(1)（不含網路等待）
// - loadAll：時間／空間 O(k)，k = 固定模組數
//
// 更快替代方案比較：
// - 各功能各自建立 script 與 timeout：程式重複，失敗狀態容易不一致。
// - 本實作：同一 marker 共用 Promise，失敗移除快取並允許下次重試。
// ==============================

(function defineEvanScriptLoader() {
  "use strict";

  if (window.EvanScriptLoader) return;

  const promises = new Map();
  const DEFAULT_TIMEOUT_MS = 12000;

  function normalizeUrl(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch (error) {
      return String(url || "");
    }
  }

  function load({ src, marker, isReady, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!src || !marker) return Promise.resolve(false);
    if (typeof isReady === "function" && isReady()) return Promise.resolve(true);
    if (promises.has(marker)) return promises.get(marker);

    const promise = new Promise((resolve) => {
      const normalizedSrc = normalizeUrl(src);
      let script = Array.from(document.scripts).find((candidate) =>
        candidate.dataset.evanModule === marker || candidate.src === normalizedSrc
      );
      let settled = false;
      let timer = 0;
      let poll = 0;

      const cleanup = () => {
        if (timer) window.clearTimeout(timer);
        if (poll) window.clearInterval(poll);
        script?.removeEventListener("load", handleLoad);
        script?.removeEventListener("error", handleError);
      };

      const finish = (success) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!success) promises.delete(marker);
        resolve(Boolean(success));
      };

      const checkReady = () => {
        const ready = typeof isReady !== "function" || Boolean(isReady());
        if (ready) finish(true);
      };

      const handleLoad = () => {
        if (script) script.dataset.loadState = "loaded";
        checkReady();
      };

      const handleError = () => {
        if (script) script.dataset.loadState = "error";
        finish(false);
      };

      if (script?.dataset.loadState === "error") {
        script.remove();
        script = null;
      }

      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.evanModule = marker;
        script.dataset.loadState = "loading";
        document.head.appendChild(script);
      }

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      poll = window.setInterval(checkReady, 100);
      timer = window.setTimeout(() => {
        const ready = typeof isReady === "function" && Boolean(isReady());
        if (!ready) console.error(`[script-loader] 模組載入逾時：${src}`);
        finish(ready);
      }, Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

      checkReady();
    });

    promises.set(marker, promise);
    return promise;
  }

  async function loadAll(modules) {
    const entries = Array.isArray(modules) ? modules : [];
    return Promise.all(entries.map((module) => load(module)));
  }

  window.EvanScriptLoader = Object.freeze({ load, loadAll });
})();
