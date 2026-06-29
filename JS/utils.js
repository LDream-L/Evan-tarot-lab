// ==============================
// utils.js
// 共用時間小工具、品牌圖示與網站彈窗
// ==============================
//
// 主要函式複雜度：
// - nowTaipeiISO：O(1)
// - initSiteBranding：O(1)
// - escapeHtml / createDialog：O(m)，m = 動態文字總長度
// 空間複雜度：O(m)
//
// 品牌圖示替代方案比較：
// - 逐頁改 HTML：每新增頁面都要重複維護。
// - 共用初始化：所有載入 utils.js 的頁面自動套用同一品牌圖示與 favicon。
// ==============================

(function initSharedUtils() {
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
// 全站頁首 LOGO 與瀏覽器圖示
// 時間複雜度：O(1)
// 空間複雜度：O(1)
// ==============================
(function initSiteBranding() {
  const LOGO_URL = "images/branding/evan-tarot-logo.svg?v=20260625-brand-v4";
  const STYLE_ID = "evan-site-branding-style";

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

  function addFavicon() {
    document.querySelectorAll('link[rel~="icon"]').forEach((node) => node.remove());

    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = LOGO_URL;
    document.head.appendChild(icon);
  }

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
// Evan Tarot Custom Dialog
// 統一網站彈窗樣式，取代原生 alert / confirm / prompt
// 時間複雜度：O(m)，m = 動態文字總長度
// 空間複雜度：O(m)
// 更快替代方案：原生 alert/prompt/confirm 雖然成本最低，但無法配合網站 UI；本實作使用單一 Promise modal，維持低成本並符合視覺系統。
// 安全替代方案：動態文字先做 HTML／屬性編碼，再進入固定模板，避免使用者輸入或後端訊息被解讀成標籤。
// ==============================
(function initEvanDialog() {
  if (window.EvanDialog) return;

  const ESCAPE_PATTERN = /[&<>"']/g;
  const ESCAPE_MAP = Object.freeze({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(ESCAPE_PATTERN, (character) => ESCAPE_MAP[character]);
  }

  function closeDialog(backdrop, result, resolve) {
    if (backdrop.dataset.closing === "1") return;
    backdrop.dataset.closing = "1";
    backdrop.classList.add("is-leaving");
    window.setTimeout(() => {
      backdrop.remove();
      resolve(result);
    }, 120);
  }

  function createDialog({ type = "alert", title = "提示", message = "", defaultValue = "", placeholder = "" }) {
    return new Promise((resolve) => {
      document.querySelector(".evan-dialog-backdrop")?.remove();

      const safeTitle = escapeHtml(title);
      const safeMessage = escapeHtml(message);
      const safeDefaultValue = escapeHtml(defaultValue);
      const safePlaceholder = escapeHtml(placeholder);
      const backdrop = document.createElement("div");
      backdrop.className = "evan-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="evan-dialog" role="dialog" aria-modal="true" aria-label="${safeTitle}">
          <div class="evan-dialog-orb" aria-hidden="true"></div>
          <div class="evan-dialog-header">
            <p class="map-form-kicker">Evan Tarot</p>
            <h3>${safeTitle}</h3>
            ${safeMessage ? `<p>${safeMessage}</p>` : ""}
          </div>
          ${type === "prompt" ? `
            <label class="evan-dialog-field">
              <span>輸入內容</span>
              <input id="evan-dialog-input" type="text" value="${safeDefaultValue}" placeholder="${safePlaceholder}" autocomplete="off" />
            </label>
          ` : ""}
          <div class="evan-dialog-actions">
            ${type !== "alert" ? `<button type="button" class="btn ghost" data-dialog-action="cancel">取消</button>` : ""}
            <button type="button" class="btn primary" data-dialog-action="ok">${type === "confirm" ? "確認" : "確定"}</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const input = backdrop.querySelector("#evan-dialog-input");
      const okButton = backdrop.querySelector('[data-dialog-action="ok"]');
      const cancelButton = backdrop.querySelector('[data-dialog-action="cancel"]');

      if (input) {
        input.focus();
        input.select();
      } else {
        okButton.focus();
      }

      okButton.addEventListener("click", () => {
        if (type === "prompt") {
          closeDialog(backdrop, input.value, resolve);
          return;
        }
        closeDialog(backdrop, true, resolve);
      });

      cancelButton?.addEventListener("click", () => {
        closeDialog(backdrop, type === "prompt" ? null : false, resolve);
      });

      backdrop.addEventListener("click", (event) => {
        if (event.target !== backdrop) return;
        closeDialog(backdrop, type === "alert" ? true : type === "prompt" ? null : false, resolve);
      });

      backdrop.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog(backdrop, type === "alert" ? true : type === "prompt" ? null : false, resolve);
        }
        if (event.key === "Enter" && type === "prompt") {
          event.preventDefault();
          closeDialog(backdrop, input.value, resolve);
        }
      });
    });
  }

  window.EvanDialog = {
    alert(message, title = "提示") {
      return createDialog({ type: "alert", title, message });
    },
    confirm(message, title = "確認操作") {
      return createDialog({ type: "confirm", title, message });
    },
    prompt(message, defaultValue = "", title = "輸入內容", placeholder = "") {
      return createDialog({ type: "prompt", title, message, defaultValue, placeholder });
    },
  };
})();
