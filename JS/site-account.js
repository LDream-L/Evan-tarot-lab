// ==============================
// site-account.js
// 全站統一 Google 登入、暱稱與登出入口
// ==============================
// 主要函式複雜度：
// - ensureMarkup / positionMenu / updateTrigger：O(1)
// - getFocusableElements：O(k)，k = 帳戶視窗內可聚焦元件數
// - loadDependencies：O(s)，s = 固定依賴數（最多 3）
// 空間複雜度：O(k)
//
// 更快替代方案比較：
// - 撐高頁首容納帳戶面板：不會重疊，但會產生大面積空白並推動整頁內容。
// - 本實作：帳戶面板以 body portal 顯示為浮動視窗，搭配遮罩、焦點管理與自動定位。
// ==============================

(function defineUnifiedSiteAccount() {
  "use strict";

  if (window.EvanSiteAccount) return;

  const SCRIPT_VERSION = "20260627-site-account-v3";
  const DESKTOP_WIDTH = 380;
  const VIEWPORT_MARGIN = 16;
  const TRIGGER_GAP = 10;
  const CLOSE_ANIMATION_MS = 170;
  const loadedScripts = new Map();

  let initialized = false;
  let accountRoot = null;
  let trigger = null;
  let backdrop = null;
  let menu = null;
  let menuResizeObserver = null;
  let closeTimer = 0;
  let lastFocusedElement = null;
  let readyResolve;

  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  function loadStyle(href, marker) {
    const existing = document.querySelector(`link[data-site-account-style="${marker}"]`);
    if (existing) {
      existing.href = href;
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.siteAccountStyle = marker;
    document.head.appendChild(link);
  }

  function loadScript(src, marker) {
    if (loadedScripts.has(marker)) return loadedScripts.get(marker);

    const existing = document.querySelector(`script[data-site-account-script="${marker}"]`);
    if (existing) {
      const promise = Promise.resolve(true);
      loadedScripts.set(marker, promise);
      return promise;
    }

    const promise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.dataset.siteAccountScript = marker;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });

    loadedScripts.set(marker, promise);
    return promise;
  }

  function createAccountTriggerMarkup() {
    const wrapper = document.createElement("div");
    wrapper.className = "site-account";
    wrapper.id = "site-account";

    const accountTrigger = document.createElement("button");
    accountTrigger.id = "site-account-trigger";
    accountTrigger.className = "site-account-trigger";
    accountTrigger.type = "button";
    accountTrigger.setAttribute("aria-haspopup", "dialog");
    accountTrigger.setAttribute("aria-controls", "site-account-menu");
    accountTrigger.setAttribute("aria-expanded", "false");
    accountTrigger.innerHTML = `
      <span class="site-account-avatar" id="site-account-avatar" aria-hidden="true">G</span>
      <span class="site-account-label" id="site-account-label">登入</span>
      <span class="site-account-caret" aria-hidden="true">▼</span>
    `;

    wrapper.appendChild(accountTrigger);
    return wrapper;
  }

  function createAccountBackdrop() {
    const element = document.createElement("button");
    element.id = "site-account-backdrop";
    element.className = "site-account-backdrop";
    element.type = "button";
    element.hidden = true;
    element.setAttribute("aria-label", "關閉帳戶設定");
    element.tabIndex = -1;
    return element;
  }

  function createAccountMenu() {
    const accountMenu = document.createElement("section");
    accountMenu.id = "site-account-menu";
    accountMenu.className = "site-account-menu";
    accountMenu.setAttribute("role", "dialog");
    accountMenu.setAttribute("aria-modal", "true");
    accountMenu.setAttribute("aria-labelledby", "site-account-title");
    accountMenu.tabIndex = -1;
    accountMenu.hidden = true;
    accountMenu.innerHTML = `
      <div class="site-account-heading">
        <div class="site-account-heading-main">
          <span class="site-account-dialog-icon" aria-hidden="true">G</span>
          <div class="site-account-heading-copy">
            <strong id="site-account-title">Google 帳戶</strong>
            <p id="google-auth-status">正在載入登入狀態…</p>
          </div>
        </div>
        <button class="site-account-close" id="site-account-close" type="button" aria-label="關閉帳戶設定">×</button>
      </div>

      <div id="google-signin-button" class="site-account-loading">登入元件載入中…</div>

      <div class="google-user-panel hidden" id="google-user-panel">
        <div class="google-nickname-editor">
          <label for="google-nickname-input">公開暱稱</label>
          <div class="google-nickname-row">
            <input id="google-nickname-input" type="text" minlength="2" maxlength="20" autocomplete="nickname" placeholder="2～20 個字" />
            <button class="btn primary" id="google-nickname-save" type="button">儲存</button>
          </div>
          <p class="google-nickname-help">Email 不公開；留言與預約只會顯示這個暱稱。</p>
          <p class="google-nickname-status" id="google-nickname-status" aria-live="polite"></p>
        </div>

        <div class="site-account-actions">
          <button class="btn ghost google-signout-button" id="google-signout-button" type="button">登出</button>
        </div>
      </div>
    `;

    return accountMenu;
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function ensureMarkup() {
    const headerInner = document.querySelector(".site-header .header-inner");
    if (!headerInner) return false;

    accountRoot = document.getElementById("site-account");
    if (!accountRoot) {
      accountRoot = createAccountTriggerMarkup();
      headerInner.appendChild(accountRoot);
    }

    backdrop = document.getElementById("site-account-backdrop");
    if (!backdrop) {
      backdrop = createAccountBackdrop();
      document.body.appendChild(backdrop);
    }

    menu = document.getElementById("site-account-menu");
    if (!menu) {
      menu = createAccountMenu();
      document.body.appendChild(menu);
    }

    headerInner.classList.add("has-site-account");
    trigger = document.getElementById("site-account-trigger");

    return Boolean(trigger && backdrop && menu);
  }

  function isMobileLayout() {
    return window.matchMedia("(max-width: 640px)").matches;
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function positionMenu() {
    if (!trigger || !menu || menu.hidden || isMobileLayout()) return;

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(DESKTOP_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
    const menuHeight = Math.min(menu.scrollHeight || 320, viewportHeight - VIEWPORT_MARGIN * 2);

    let left = triggerRect.right - menuWidth;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - menuWidth - VIEWPORT_MARGIN));

    let top = triggerRect.bottom + TRIGGER_GAP;
    const availableBelow = viewportHeight - top - VIEWPORT_MARGIN;
    const availableAbove = triggerRect.top - TRIGGER_GAP - VIEWPORT_MARGIN;

    if (availableBelow < Math.min(menuHeight, 260) && availableAbove > availableBelow) {
      top = Math.max(VIEWPORT_MARGIN, triggerRect.top - TRIGGER_GAP - menuHeight);
      menu.style.transformOrigin = "bottom right";
    } else {
      menu.style.transformOrigin = "top right";
    }

    const maxHeight = Math.max(180, viewportHeight - top - VIEWPORT_MARGIN);
    menu.style.setProperty("--site-account-left", `${Math.round(left)}px`);
    menu.style.setProperty("--site-account-top", `${Math.round(top)}px`);
    menu.style.setProperty("--site-account-width", `${Math.round(menuWidth)}px`);
    menu.style.setProperty("--site-account-max-height", `${Math.round(maxHeight)}px`);
  }

  /** 時間複雜度 O(k)，空間複雜度 O(k)。 */
  function getFocusableElements() {
    if (!menu) return [];

    return Array.from(
      menu.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hidden && element.getClientRects().length > 0);
  }

  function focusInitialControl(focusNickname) {
    window.requestAnimationFrame(() => {
      if (!menu || menu.hidden) return;

      const nicknameInput = document.getElementById("google-nickname-input");
      if (focusNickname && nicknameInput && !nicknameInput.disabled) {
        nicknameInput.focus({ preventScroll: true });
        return;
      }

      const focusable = getFocusableElements();
      (focusable[0] || menu).focus({ preventScroll: true });
    });
  }

  function open(options = {}) {
    if (!trigger || !backdrop || !menu || !menu.hidden) return;

    window.clearTimeout(closeTimer);
    lastFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : trigger;

    backdrop.hidden = false;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("site-account-modal-open");
    positionMenu();

    window.requestAnimationFrame(() => {
      backdrop?.classList.add("is-open");
      menu?.classList.add("is-open");
      focusInitialControl(Boolean(options.focusNickname));
    });
  }

  function close(options = {}) {
    if (!trigger || !backdrop || !menu || menu.hidden) return;

    const restoreFocus = options.restoreFocus !== false;
    trigger.setAttribute("aria-expanded", "false");
    backdrop.classList.remove("is-open");
    menu.classList.remove("is-open");
    document.body.classList.remove("site-account-modal-open");

    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      backdrop.hidden = true;
      menu.hidden = true;
      menu.style.removeProperty("--site-account-left");
      menu.style.removeProperty("--site-account-top");
      menu.style.removeProperty("--site-account-width");
      menu.style.removeProperty("--site-account-max-height");

      if (restoreFocus) {
        (lastFocusedElement || trigger)?.focus?.({ preventScroll: true });
      }
    }, CLOSE_ANIMATION_MS);
  }

  function setOpen(nextOpen, options = {}) {
    if (nextOpen) open(options);
    else close(options);
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function updateTrigger(state) {
    const signedIn = Boolean(state?.isSignedIn);
    const nickname = String(state?.nickname || "").trim();
    const label = document.getElementById("site-account-label");
    const avatar = document.getElementById("site-account-avatar");
    const dialogIcon = document.querySelector(".site-account-dialog-icon");

    if (label) label.textContent = signedIn ? (nickname || "帳戶") : "登入";

    const source = signedIn ? (nickname || "G") : "G";
    const initial = Array.from(source)[0]?.toUpperCase?.() || "G";
    if (avatar) avatar.textContent = initial;
    if (dialogIcon) dialogIcon.textContent = initial;

    trigger?.classList.toggle("is-signed-in", signedIn);

    if (menu && !menu.hidden) {
      window.requestAnimationFrame(positionMenu);
    }

    window.dispatchEvent(new CustomEvent("evan-google-auth-change", { detail: state }));
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !menu || menu.hidden) return;

    const focusable = getFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      menu.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function bindMenuEvents() {
    trigger?.addEventListener("click", () => {
      setOpen(Boolean(menu?.hidden));
    });

    backdrop?.addEventListener("click", () => close());
    document.getElementById("site-account-close")?.addEventListener("click", () => close());

    document.addEventListener("keydown", (event) => {
      if (!menu || menu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(event);
    });

    const reposition = () => {
      if (menu && !menu.hidden) positionMenu();
    };

    window.addEventListener("resize", reposition, { passive: true });
    window.addEventListener("scroll", reposition, { passive: true, capture: true });

    if (window.ResizeObserver && menu) {
      menuResizeObserver = new ResizeObserver(reposition);
      menuResizeObserver.observe(menu);
    }
  }

  async function loadDependencies() {
    loadStyle(`site-account.css?v=${SCRIPT_VERSION}`, "account");

    if (!window.EVAN_CLOUD_CONFIG) {
      await loadScript(`JS/cloud-config.js?v=${SCRIPT_VERSION}`, "cloud-config");
    }

    if (!window.EvanGoogleAuth) {
      await loadScript(`JS/google-auth.js?v=${SCRIPT_VERSION}`, "google-auth");
    }

    if (!window.google?.accounts?.id) {
      await loadScript("https://accounts.google.com/gsi/client?hl=zh-TW", "google-identity");
    }
  }

  async function init() {
    if (initialized) return ready;
    initialized = true;

    if (!ensureMarkup()) {
      readyResolve(false);
      return ready;
    }

    bindMenuEvents();
    await loadDependencies();

    if (!window.EvanGoogleAuth) {
      const status = document.getElementById("google-auth-status");
      if (status) status.textContent = "登入模組載入失敗，請重新整理後再試。";
      readyResolve(false);
      return ready;
    }

    window.EvanGoogleAuth.onChange(updateTrigger);
    await window.EvanGoogleAuth.init();
    updateTrigger(window.EvanGoogleAuth.getState());
    window.dispatchEvent(new CustomEvent("evan-site-account-ready"));
    readyResolve(true);
    return ready;
  }

  window.EvanSiteAccount = Object.freeze({
    init,
    ready,
    open,
    close,
    isOpen: () => Boolean(menu && !menu.hidden),
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
