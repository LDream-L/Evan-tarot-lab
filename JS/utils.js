// ==============================
// utils.js
// 共用時間工具、品牌初始化與全站防護載入器
// ==============================
//
// 主要函式複雜度：
// - nowTaipeiISO：時間 O(1)，空間 O(1)
// - applyBranding：時間 O(1)，空間 O(1)
// - loadSiteHardening：時間 O(1)，空間 O(1)（不含網路等待）
//
// 替代方案比較：
// - 各頁複製 Logo、favicon 與安全修補：維護成本隨頁面數線性增加。
// - 共用初始化：所有載入 utils.js 的頁面使用同一來源，避免頁面版本分歧。
// ==============================

(function initSharedUtils() {
  "use strict";

  /**
   * 取得台北時間 ISO 字串（不含時區尾碼）。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
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
// Evan Tarot Site Branding
// 全站頁首 Logo 與瀏覽器圖示
// ==============================
(function initSiteBranding() {
  "use strict";

  const LOGO_URL = "images/branding/evan-tarot-logo.svg?v=20260625-brand-v4";
  const STYLE_ID = "evan-site-branding-style";

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function addBrandStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .site-brand-link {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        color: inherit;
        text-decoration: none;
      }

      .site-brand-image {
        width: 54px;
        height: 54px;
        flex: 0 0 54px;
        object-fit: cover;
        border-radius: 15px;
        border: 1px solid rgba(214, 163, 91, 0.34);
        background: #090705;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .site-brand-link:hover .site-brand-image,
      .site-brand-link:focus-visible .site-brand-image {
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(214, 163, 91, 0.22);
      }

      .site-brand-copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.15;
      }

      @media (max-width: 720px) {
        .site-brand-image {
          width: 46px;
          height: 46px;
          flex-basis: 46px;
          border-radius: 13px;
        }

        .site-brand-link {
          gap: 10px;
        }
      }

      @media (max-width: 520px) {
        .site-brand-copy .logo-sub {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function addFavicon() {
    document.querySelectorAll('link[rel~="icon"]').forEach((node) => node.remove());

    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = LOGO_URL;
    document.head.appendChild(icon);
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function addHeaderLogo() {
    const currentLogo = document.querySelector(".site-header .logo");
    if (!currentLogo || currentLogo.querySelector(".site-brand-image")) return;

    const link = document.createElement("a");
    link.className = `${currentLogo.className} site-brand-link`;
    link.href = "index.html";
    link.setAttribute("aria-label", "Evan Tarot 首頁");

    const image = document.createElement("img");
    image.className = "site-brand-image";
    image.src = LOGO_URL;
    image.alt = "Evan Tarot 品牌圖示";
    image.width = 54;
    image.height = 54;
    image.decoding = "async";

    const copy = document.createElement("span");
    copy.className = "site-brand-copy";
    while (currentLogo.firstChild) copy.appendChild(currentLogo.firstChild);

    link.append(image, copy);
    currentLogo.replaceWith(link);
  }

  function applyBranding() {
    addBrandStyles();
    addFavicon();
    addHeaderLogo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBranding, { once: true });
  } else {
    applyBranding();
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
