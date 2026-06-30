// ==============================
// article-media-library.js
// 文章共用圖片索引：文章只引用圖片代碼，不重複保存圖片網址與署名
// ==============================
//
// 主要函式複雜度：
// - get：O(1)
// - list：O(m)，m = 圖片數量
// 空間複雜度：O(m)
//
// 更快替代方案比較：
// - 分散寫法：每篇文章各自貼完整圖片網址，維護時必須逐篇搜尋與修改。
// - 本實作：以圖片代碼查表，文章內使用 [[image:圖片代碼|版型]] 即可載入。
// ==============================

(function initArticleMediaLibrary() {
  "use strict";

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
      src: "assets/article-media/tarot-devil-xv.webp",
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

  window.EvanArticleMedia = Object.freeze({
    get,
    list,
  });
})();
