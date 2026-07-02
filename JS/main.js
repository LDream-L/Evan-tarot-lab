// ==============================
// main.js
// 初始化：導覽、全站帳戶、頁面脈絡、事件綁定與平滑滾動
// ==============================
//
// 主要函式複雜度：
// - normalizeSiteNavigation：O(n)，n = 導覽連結數
// - normalizeLostItemLabContext：O(1)
// - loadSiteAccountScript / loadArticleCommentsScript / loadAdminNavigationScript：O(1)
// - bindCorePageEvents：O(1)
// - DOMContentLoaded 初始化：O(n)
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 阻塞法：先等待 Google 登入模組完成，再綁定尋物、預約與其他核心功能。
// - 優化法：核心表單立即可用，帳戶、管理入口與留言模組獨立載入，避免第三方登入拖慢整頁操作。
// ==============================

const MAIN_ASSET_PROMISES = new Map();
const PODCAST_URL = "https://podcasts.apple.com/tw/podcast/%E6%9C%89%E9%BB%9E%E5%81%8F/id1896598359";

/**
 * 載入一次 JavaScript；同一 marker 共用同一 Promise。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function loadScriptOnce({ src, marker, isReady }) {
  if (typeof isReady === "function" && isReady()) return Promise.resolve(true);
  if (MAIN_ASSET_PROMISES.has(marker)) return MAIN_ASSET_PROMISES.get(marker);

  const promise = new Promise((resolve) => {
    const selector = `script[data-main-asset="${marker}"]`;
    let script = document.querySelector(selector);
    let settled = false;

    const finish = (success) => {
      if (settled) return;
      settled = true;
      resolve(Boolean(success));
    };

    const handleLoad = () => finish(typeof isReady !== "function" || isReady());
    const handleError = () => finish(false);

    if (!script) {
      script = document.createElement("script");
      script.src = src;
      script.dataset.mainAsset = marker;
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      document.head.appendChild(script);
      return;
    }

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    window.setTimeout(() => {
      if (typeof isReady === "function" && isReady()) finish(true);
    }, 0);
  });

  MAIN_ASSET_PROMISES.set(marker, promise);
  return promise;
}

function loadSiteAccountScript() {
  return loadScriptOnce({
    src: "JS/site-account.js?v=20260629-stability-v1",
    marker: "site-account",
    isReady: () => Boolean(window.EvanSiteAccount),
  }).then(async (loaded) => {
    if (!loaded || !window.EvanSiteAccount) return false;
    try {
      return await window.EvanSiteAccount.init();
    } catch (error) {
      console.error("[main] 帳戶模組初始化失敗：", error);
      return false;
    }
  });
}

function loadArticleCommentsScript() {
  return loadScriptOnce({
    src: "JS/article-comments.js?v=20260629-stability-v1",
    marker: "article-comments",
    isReady: () => Boolean(window.EvanArticleComments),
  });
}

function loadAdminNavigationScript() {
  return loadScriptOnce({
    src: "JS/admin-navigation.js?v=20260629-admin-entry-v4",
    marker: "admin-navigation",
    isReady: () => Boolean(window.EvanAdminNavigation),
  }).then(async (loaded) => {
    if (!loaded || !window.EvanAdminNavigation) return false;
    try {
      return await window.EvanAdminNavigation.init();
    } catch (error) {
      console.error("[main] 管理員入口初始化失敗：", error);
      return false;
    }
  });
}

function ensureStylesheetOnce(href, marker) {
  if (document.querySelector(`link[data-main-style="${marker}"]`)) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  stylesheet.dataset.mainStyle = marker;
  document.head.appendChild(stylesheet);
}

function ensureLabStyles() {
  if (document.querySelector('link[href*="lab.css"]')) return;
  ensureStylesheetOnce("lab.css?v=20260627-lab-layout-v1", "lab");
}

function createNavLink(href, text) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  return link;
}

/**
 * 建立不依賴外部圖片的 Podcast 小圖示。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function createPodcastIcon() {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.flex = "0 0 auto";

  const background = document.createElementNS(svgNamespace, "rect");
  background.setAttribute("x", "1");
  background.setAttribute("y", "1");
  background.setAttribute("width", "22");
  background.setAttribute("height", "22");
  background.setAttribute("rx", "5");
  background.setAttribute("fill", "#8b5cf6");

  const outerRing = document.createElementNS(svgNamespace, "path");
  outerRing.setAttribute("d", "M6.2 11a5.8 5.8 0 0 1 11.6 0");
  outerRing.setAttribute("fill", "none");
  outerRing.setAttribute("stroke", "#ffffff");
  outerRing.setAttribute("stroke-width", "1.5");
  outerRing.setAttribute("stroke-linecap", "round");

  const innerRing = document.createElementNS(svgNamespace, "path");
  innerRing.setAttribute("d", "M8.6 11a3.4 3.4 0 0 1 6.8 0");
  innerRing.setAttribute("fill", "none");
  innerRing.setAttribute("stroke", "#ffffff");
  innerRing.setAttribute("stroke-width", "1.5");
  innerRing.setAttribute("stroke-linecap", "round");

  const head = document.createElementNS(svgNamespace, "circle");
  head.setAttribute("cx", "12");
  head.setAttribute("cy", "11");
  head.setAttribute("r", "1.8");
  head.setAttribute("fill", "#ffffff");

  const body = document.createElementNS(svgNamespace, "path");
  body.setAttribute("d", "M12 13.4c-1.25 0-2.25 1-2.25 2.25V20h4.5v-4.35c0-1.25-1-2.25-2.25-2.25Z");
  body.setAttribute("fill", "#ffffff");

  svg.append(background, outerRing, innerRing, head, body);
  return svg;
}

/**
 * 將 Podcast 入口統一放在預約前，點擊後另開 Apple Podcast。
 * 時間複雜度：O(n)，n = 導覽連結數
 * 空間複雜度：O(1)
 */
function normalizePodcastNavigation(nav) {
  const bookingLink = nav.querySelector('a[href="services.html#booking"]');
  let podcastLink = nav.querySelector(
    '[data-podcast-link], a[href="index.html#podcast"], a[href*="podcasts.apple.com"][href*="id1896598359"]'
  );

  if (!podcastLink) podcastLink = createNavLink(PODCAST_URL, "Podcast");

  podcastLink.dataset.podcastLink = "true";
  podcastLink.href = PODCAST_URL;
  podcastLink.target = "_blank";
  podcastLink.rel = "noopener noreferrer";
  podcastLink.title = "在 Apple Podcast 收聽《有點偏》";
  podcastLink.setAttribute("aria-label", "前往 Apple Podcast 收聽《有點偏》（另開新分頁）");
  podcastLink.style.display = "inline-flex";
  podcastLink.style.alignItems = "center";
  podcastLink.style.gap = "5px";
  podcastLink.replaceChildren(createPodcastIcon(), document.createTextNode("Podcast"));

  nav.insertBefore(podcastLink, bookingLink || null);
}

/**
 * 文章與實驗室保持獨立；塔羅尋物、世足驗證與占卜時間流均歸入實驗室。
 * 時間複雜度：O(n)
 * 空間複雜度：O(1)
 */
function normalizeSiteNavigation() {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  let articleLink = nav.querySelector('a[href="articles.html"]');
  let labLink = nav.querySelector('a[href="lab.html"]');
  const lostItemLink = nav.querySelector('a[href="lost-item.html"]');
  const timeflowLink = nav.querySelector('a[href="timeflow.html"]');
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  if (!articleLink) {
    articleLink = createNavLink("articles.html", "文章");
    nav.insertBefore(articleLink, labLink || timeflowLink || null);
  }
  articleLink.textContent = "文章";

  if (!labLink) {
    labLink = createNavLink("lab.html", "實驗室");
    articleLink.insertAdjacentElement("afterend", labLink);
  }
  labLink.textContent = "實驗室";

  lostItemLink?.remove();
  timeflowLink?.remove();
  articleLink.removeAttribute("aria-current");
  labLink.removeAttribute("aria-current");

  if (currentPage === "articles.html" || currentPage === "article.html") {
    articleLink.setAttribute("aria-current", "page");
  }
  if (
    currentPage === "lab.html" ||
    currentPage === "lost-item.html" ||
    currentPage === "football-lab.html" ||
    currentPage === "timeflow.html"
  ) {
    labLink.setAttribute("aria-current", "page");
  }

  normalizePodcastNavigation(nav);
}

/**
 * 將塔羅尋物標示為實驗室內的實驗物件。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function normalizeLostItemLabContext() {
  if (!document.getElementById("lost-item-tool")) return;

  ensureLabStyles();

  const heroText = document.querySelector(".subpage-hero .hero-text");
  const heroButtons = heroText?.querySelectorAll(".hero-cta .btn");
  const heroPills = heroText?.querySelectorAll(".hero-meta .pill");
  const heroCard = document.querySelector(".subpage-hero .hero-card-inner");

  if (heroText && !heroText.querySelector(".lab-breadcrumb")) {
    const breadcrumb = document.createElement("a");
    breadcrumb.className = "lab-breadcrumb";
    breadcrumb.href = "lab.html#projects";
    breadcrumb.textContent = "← 塔羅實驗室 / 實驗物件";
    heroText.prepend(breadcrumb);
  }

  if (heroButtons?.[1]) {
    heroButtons[1].href = "lab.html#projects";
    heroButtons[1].textContent = "回實驗室";
  }

  if (heroPills?.[0]) heroPills[0].textContent = "大型區域反查";
  if (heroPills?.[1]) heroPills[1].textContent = "零回測加權";

  if (heroCard) {
    const tag = heroCard.querySelector(".hero-tag");
    const items = heroCard.querySelectorAll("li");
    const note = heroCard.querySelector(".hero-note");

    if (tag) tag.textContent = "判讀原則";
    if (items[0]) items[0].textContent = "三張牌等權反查大型搜尋區域";
    if (items[1]) items[1].textContent = "空間特徵只細化已入選區域";
    if (items[2]) items[2].textContent = "找到與否只作紀錄，不回寫權重";
    if (note) note.textContent = "結果用來安排搜尋順序，不是 GPS 座標。";
  }
}

/**
 * 核心表單不等待 Google 登入或第三方資源。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function bindCorePageEvents() {
  const lostItemForm = document.getElementById("lost-item-form");
  if (lostItemForm && window.handleLostItemForm) {
    lostItemForm.addEventListener("submit", window.handleLostItemForm);
  }

  const lostItemFeedbackForm = document.getElementById("lost-item-feedback-form");
  if (lostItemFeedbackForm && window.handleLostItemFeedbackForm) {
    lostItemFeedbackForm.addEventListener("submit", window.handleLostItemFeedbackForm);
  }

  const bookingForm = document.getElementById("booking-form");
  if (bookingForm && window.handleBookingForm) {
    bookingForm.addEventListener("submit", window.handleBookingForm);
  }

  const commentForm = document.getElementById("comment-form");
  if (commentForm && window.handleCommentForm) {
    commentForm.addEventListener("submit", window.handleCommentForm);
  }
}

function bindSmoothHashNavigation() {
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.('a[href^="#"]');
    if (!anchor) return;

    const targetId = anchor.getAttribute("href");
    if (!targetId || targetId === "#") return;

    let targetElement = null;
    try {
      targetElement = document.querySelector(targetId);
    } catch (error) {
      console.warn("[main] 無效的頁內連結：", targetId, error);
      return;
    }

    if (!targetElement) return;
    event.preventDefault();
    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function initOptionalArticleComments(accountReadyPromise) {
  const articlePage = Boolean(
    document.getElementById("article-list") &&
    document.getElementById("comment-form")
  );
  if (!articlePage) return;

  ensureStylesheetOnce(
    "article-comments.css?v=20260629-stability-v1",
    "article-comments"
  );

  Promise.all([accountReadyPromise, loadArticleCommentsScript()])
    .then(([, commentsReady]) => {
      if (!commentsReady || !window.EvanArticleComments) return;
      return window.EvanArticleComments.init?.();
    })
    .catch((error) => {
      console.error("[main] 文章留言模組初始化失敗：", error);
    });
}

document.addEventListener("DOMContentLoaded", () => {
  normalizeSiteNavigation();
  normalizeLostItemLabContext();
  bindCorePageEvents();
  bindSmoothHashNavigation();

  window.loadMappingFromSheet?.();
  window.renderComments?.();
  window.initDivinationMap?.();

  const accountReadyPromise = loadSiteAccountScript();
  accountReadyPromise
    .then(() => loadAdminNavigationScript())
    .catch((error) => {
      console.error("[main] 管理員入口載入失敗：", error);
    });
  initOptionalArticleComments(accountReadyPromise);
});
