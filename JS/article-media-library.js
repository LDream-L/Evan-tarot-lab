// ==============================
// article-media-library.js
// 文章共用圖片索引：正文只保存圖片代碼，實際圖片集中由此處管理。
// ==============================
//
// 主要函式複雜度：
// - get：時間 O(1)，空間 O(1)
// - list：時間 O(m)，空間 O(m)，m = 圖片數量
// - resolveSrc：時間 O(1)，空間 O(1)
// - upgrade：時間 O(i)，空間 O(i)，i = 掃描範圍內的圖片數量
//
// 更快替代方案比較：
// - Base64 分段重組：需額外下載多個文字檔、合併、解碼並建立 Blob，失敗點多。
// - 直接圖片檔：瀏覽器只需一次請求且可正常快取，因此採用此方案。
// ==============================

(function initArticleMediaLibrary() {
  "use strict";

  const DEVIL_ID = "tarot-devil-xv";
  const VERSION = "20260701-devil-original-v1";

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
      src: `assets/article-media/tarot-devil-xv.jpg?v=${VERSION}`,
      adminVariant: "portrait",
      defaultVariant: "portrait",
      alt: "XV THE DEVIL 惡魔塔羅牌：中央惡魔張開雙翼，下方男女被鎖鏈束縛。",
      caption: "XV THE DEVIL｜惡魔不只象徵外在誘惑，也可能呈現內在規則、慾望與尚未掙脫的束縛。",
      creditLabel: "Evan Tarot",
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

  async function resolveSrc(mediaId) {
    return get(mediaId)?.src || "";
  }

  function isDevilImage(image) {
    const alt = String(image.alt || "");
    const src = String(image.getAttribute("src") || "");
    return alt.startsWith("XV THE DEVIL") || src.includes("tarot-devil-xv");
  }

  function applyPortraitLayout(image) {
    const card = image.closest(".article-admin-media-card");
    if (card) {
      image.style.aspectRatio = "3 / 4";
      image.style.objectFit = "contain";
      image.style.objectPosition = "center";
      image.style.padding = "10px";
      image.style.background = "rgba(4, 5, 20, 0.96)";

      const selector = card.querySelector(`[data-media-variant="${DEVIL_ID}"]`);
      if (selector) selector.value = "portrait";
    }

    const figure = image.closest(".article-media");
    if (figure) {
      figure.classList.remove("article-media-cover", "article-media-wide", "article-media-inline");
      figure.classList.add("article-media-portrait");
    }
  }

  function upgrade(root = document) {
    const images = root instanceof HTMLImageElement
      ? [root]
      : Array.from(root.querySelectorAll?.("img") || []);

    images.filter(isDevilImage).forEach(applyPortraitLayout);
    return Promise.resolve(true);
  }

  function observeMediaChanges() {
    if (!document.body) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) upgrade(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.EvanArticleMedia = Object.freeze({
    get,
    list,
    resolveSrc,
    upgrade,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      upgrade();
      observeMediaChanges();
    }, { once: true });
  } else {
    upgrade();
    observeMediaChanges();
  }
})();
