// ==============================
// article-media-library.js
// 文章共用圖片索引：文章只引用圖片代碼，不重複保存圖片網址與署名
// ==============================
//
// 主要函式複雜度：
// - get：O(1)
// - list：O(m)，m = 圖片數量
// - resolveSrc：首次 O(b)，之後 O(1)，b = 圖片 Base64 字元數
// - upgradeMediaImages：O(i)，i = 當前頁面圖片數
// 空間複雜度：O(m + b)
//
// 更快替代方案比較：
// - 分散寫法：每篇文章各自貼完整圖片網址，維護時必須逐篇搜尋與修改。
// - 單一低畫質 JPG：載入簡單，但放大後細節與文字容易失真。
// - 本實作：文章使用圖片代碼查表；惡魔牌以分段高畫質 WebP 組合一次並快取 Object URL。
// ==============================

(function initArticleMediaLibrary() {
  "use strict";

  const DEVIL_ID = "tarot-devil-xv";
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const resolvedSourceById = new Map();
  const resolvingPromiseById = new Map();

  const MEDIA_LIBRARY = Object.freeze({
    "case-shadow-dialogue": Object.freeze({
      src: "https://images.pexels.com/photos/6800200/pexels-photo-6800200.jpeg?auto=compress&cs=tinysrgb&w=1600",
      alt: "一對男女在昏暗空間中面對彼此，只看得到剪影。",
      caption: "有些關係表面仍能對話，真正的裂痕卻藏在沒有說出口的地方。",
      creditLabel: "Pexels｜cottonbro studio",
      creditUrl: "https://www.pexels.com/photo/silhouette-of-a-couple-romantic-moments-6800200/",
    }),
    "case-conflict-shadow": Object.freeze({
      src: "https://images.pexels.com/photos/36194076/pexels-photo-36194076.jpeg?auto=compress&cs=tinysrgb&w=1200",
      alt: "一對男女低著頭站在彼此前方，牆面投下深色剪影。",
      caption: "受傷沒有被處理時，防衛可能逐漸變成下一段關係裡的傷害。",
      creditLabel: "Pexels｜Cafer Caner Şavli",
      creditUrl: "https://www.pexels.com/photo/dramatic-silhouette-of-couple-in-argument-36194076/",
    }),
    "case-dark-distance": Object.freeze({
      src: "https://images.pexels.com/photos/7119374/pexels-photo-7119374.jpeg?auto=compress&cs=tinysrgb&w=1600",
      alt: "兩個人在黑暗房間裡面對面站立，身影被背光勾勒。",
      caption: "和平分手只描述了離開的方式，不代表內在已經真正結束。",
      creditLabel: "Pexels｜Pavel Danilyuk",
      creditUrl: "https://www.pexels.com/photo/man-and-woman-standing-face-to-face-in-a-dark-room-7119374/",
    }),
    "tarot-devil-xv": Object.freeze({
      src: TRANSPARENT_PIXEL,
      fallbackSrc: "https://ldream-l.github.io/Evan-tarot-lab/assets/article-media/tarot-devil-xv.jpg?v=20260630-fallback",
      sourceParts: Object.freeze([
        "assets/article-media/devil-payload/part_00.txt?v=20260630-hq-v1",
        "assets/article-media/devil-payload/part_01.txt?v=20260630-hq-v1",
      ]),
      mimeType: "image/webp",
      adminVariant: "portrait",
      defaultVariant: "portrait",
      alt: "XV THE DEVIL 惡魔塔羅牌：中央惡魔張開雙翼，下方男女被鎖鏈束縛。",
      caption: "XV THE DEVIL｜惡魔不只象徵外在誘惑，也可能呈現內在規則、慾望與尚未掙脫的束縛。",
      creditLabel: "Evan Tarot｜原創生成",
      creditUrl: "",
    }),
  });

  function get(mediaId) {
    const normalizedId = String(mediaId || "").trim().toLowerCase();
    return MEDIA_LIBRARY[normalizedId] || null;
  }

  function list() {
    return Object.entries(MEDIA_LIBRARY).map(([id, media]) => ({ id, ...media }));
  }

  function base64ToObjectUrl(base64, mimeType) {
    const binary = window.atob(base64);
    if (binary.slice(0, 4) !== "RIFF" || binary.slice(8, 12) !== "WEBP") {
      throw new Error("高畫質圖片資料格式不正確。");
    }

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mimeType || "image/webp" }));
  }

  async function resolveSrc(mediaId) {
    const normalizedId = String(mediaId || "").trim().toLowerCase();
    const media = get(normalizedId);
    if (!media) return "";
    if (!media.sourceParts?.length) return media.src || "";
    if (resolvedSourceById.has(normalizedId)) return resolvedSourceById.get(normalizedId);
    if (resolvingPromiseById.has(normalizedId)) return resolvingPromiseById.get(normalizedId);

    const promise = (async () => {
      try {
        const chunks = await Promise.all(media.sourceParts.map(async (url) => {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error(`圖片資料載入失敗：HTTP ${response.status}`);
          return response.text();
        }));
        const base64 = chunks.join("").replace(/\s+/g, "");
        const objectUrl = base64ToObjectUrl(base64, media.mimeType);
        resolvedSourceById.set(normalizedId, objectUrl);
        return objectUrl;
      } catch (error) {
        console.error(`[article-media] ${normalizedId} 高畫質圖片載入失敗：`, error);
        return media.fallbackSrc || media.src || "";
      } finally {
        resolvingPromiseById.delete(normalizedId);
      }
    })();

    resolvingPromiseById.set(normalizedId, promise);
    return promise;
  }

  function markDevilLayout(image) {
    const card = image.closest(".article-admin-media-card");
    if (card) {
      card.classList.add("is-portrait-media");
      const selector = card.querySelector('[data-media-variant="tarot-devil-xv"]');
      if (selector) selector.value = "portrait";
    }

    const figure = image.closest(".article-media");
    if (figure) {
      figure.classList.remove("article-media-cover", "article-media-wide", "article-media-inline");
      figure.classList.add("article-media-portrait");
    }
  }

  async function upgradeMediaImages(root = document) {
    const images = root.querySelectorAll?.("img") || [];
    const targets = Array.from(images).filter((image) => {
      const alt = String(image.alt || "");
      const src = String(image.getAttribute("src") || "");
      return alt.startsWith("XV THE DEVIL") || src.includes("tarot-devil-xv");
    });

    for (const image of targets) {
      markDevilLayout(image);
      if (image.dataset.hqMediaState === "ready" || image.dataset.hqMediaState === "loading") continue;
      image.dataset.hqMediaState = "loading";
      try {
        const source = await resolveSrc(DEVIL_ID);
        if (source) image.src = source;
        image.dataset.hqMediaState = "ready";
      } catch (error) {
        image.dataset.hqMediaState = "error";
        console.error("[article-media] 惡魔牌圖片更新失敗：", error);
      }
    }
  }

  function installMediaStyle() {
    if (document.querySelector('link[data-article-media-hq-style="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "article-media-hq.css?v=20260630-hq-v1";
    link.dataset.articleMediaHqStyle = "true";
    document.head.appendChild(link);
  }

  function observeMediaChanges() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.("img")) upgradeMediaImages(node.parentElement || document);
          else if (node.querySelector?.("img")) upgradeMediaImages(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.EvanArticleMedia = Object.freeze({
    get,
    list,
    resolveSrc,
    upgrade: upgradeMediaImages,
  });

  installMediaStyle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      upgradeMediaImages();
      observeMediaChanges();
    }, { once: true });
  } else {
    upgradeMediaImages();
    observeMediaChanges();
  }
})();
