// ==============================
// utils.js
// 共用時間工具、舊頁品牌備援與全站防護載入器
// ==============================
//
// 主要函式複雜度：
// - nowTaipeiISO：時間／空間 O(1)
// - applyBrandingFallback：時間／空間 O(1)
// - loadSiteHardening：時間／空間 O(1)（不含網路等待）
//
// 更快替代方案比較：
// - 正式站：品牌、favicon 與樣式由建置器靜態輸出，首次繪製即為最終狀態。
// - 備援：直接開啟未建置的來源 HTML 時，才由本檔補上品牌，方便本機檢視。
// - 舊版每次 DOMContentLoaded 都替換 Logo：會產生首屏閃動；正式輸出已不採用。
// ==============================

(function initSharedUtils() {
  "use strict";

  /** 取得台北時間 ISO 字串（不含時區尾碼）。時間／空間 O(1)。 */
  function nowTaipeiISO() {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  }

  window.nowTaipeiISO = nowTaipeiISO;
})();

// ==============================
// Evan Tarot Site Branding Fallback
// 正式 dist 已由 build-site.cjs 靜態產生；此處只支援直接開啟來源 HTML。
// ==============================
(function initSiteBrandingFallback() {
  "use strict";

  const LOGO_URL = "images/branding/evan-tarot-logo.svg?v=20260625-brand-v4";
  const STYLE_ID = "evan-site-branding-fallback-style";

  /** 判斷正式靜態品牌是否已存在。時間／空間 O(1)。 */
  function hasStaticBranding() {
    return Boolean(
      document.querySelector(".site-header .site-brand-image")
      && document.querySelector('link[href*="site-shell.css"]')
    );
  }

  /** 只供未建置來源頁使用的品牌樣式。時間／空間 O(1)。 */
  function addFallbackStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .site-brand-link { display: inline-flex; align-items: center; gap: 12px; min-width: 0; color: inherit; text-decoration: none; }
      .site-brand-image { width: 54px; height: 54px; flex: 0 0 54px; object-fit: cover; border-radius: 15px; border: 1px solid rgba(214,163,91,.34); background: #090705; box-shadow: 0 10px 24px rgba(0,0,0,.34); }
      .site-brand-copy { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
      @media (max-width: 720px) { .site-brand-image { width: 46px; height: 46px; flex-basis: 46px; border-radius: 13px; } .site-brand-link { gap: 10px; } }
      @media (max-width: 520px) { .site-brand-copy .logo-sub { display: none; } }
    `;
    document.head.appendChild(style);
  }

  /** 未提供 favicon 時補上品牌圖示。時間／空間 O(1)。 */
  function addFaviconFallback() {
    if (document.querySelector('link[rel~="icon"]')) return;
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = LOGO_URL;
    document.head.appendChild(icon);
  }

  /** 未建置來源頁才將文字 Logo 包成品牌首頁連結。時間／空間 O(1)。 */
  function addHeaderLogoFallback() {
    const currentLogo = document.querySelector(".site-header .logo");
    if (!currentLogo || currentLogo.querySelector(".site-brand-image")) return;

    const link = document.createElement("a");
    link.className = `${currentLogo.className} site-brand-link`;
    link.href = "index.html";
    link.setAttribute("aria-label", "Evan Tarot 首頁");

    const image = document.createElement("img");
    image.className = "site-brand-image";
    image.src = LOGO_URL;
    image.alt = "";
    image.width = 54;
    image.height = 54;
    image.decoding = "async";

    const copy = document.createElement("span");
    copy.className = "site-brand-copy";
    while (currentLogo.firstChild) copy.appendChild(currentLogo.firstChild);

    link.append(image, copy);
    currentLogo.replaceWith(link);
  }

  /** 正式靜態品牌存在時立即結束；否則套用來源頁備援。時間／空間 O(1)。 */
  function applyBrandingFallback() {
    if (hasStaticBranding()) return;
    addFallbackStyles();
    addFaviconFallback();
    addHeaderLogoFallback();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBrandingFallback, { once: true });
  } else {
    applyBrandingFallback();
  }
})();

// ==============================
// Evan Dialog 即時備援
// site-hardening 載入後會換成完整無障礙彈窗。
// ==============================
(function initDialogFallback() {
  "use strict";
  if (window.EvanDialog) return;

  window.EvanDialog = {
    alert(message) {
      window.alert(String(message || "").replace(/<br\s*\/?>/gi, "\n"));
      return Promise.resolve(true);
    },
    confirm(message) {
      return Promise.resolve(window.confirm(String(message || "").replace(/<br\s*\/?>/gi, "\n")));
    },
    prompt(message, defaultValue = "") {
      return Promise.resolve(window.prompt(String(message || "").replace(/<br\s*\/?>/gi, "\n"), defaultValue));
    },
  };
})();

// ==============================
// 全站防護模組
// ==============================
(function loadSiteHardening() {
  "use strict";

  if (window.EvanSiteHardening || document.querySelector('script[data-site-hardening="true"]')) return;

  const script = document.createElement("script");
  script.src = "JS/site-hardening.js?v=20260710-hardening-v1";
  script.async = true;
  script.dataset.siteHardening = "true";
  script.addEventListener("error", () => {
    console.error("[utils] 全站防護模組載入失敗。");
  }, { once: true });
  document.head.appendChild(script);
})();
