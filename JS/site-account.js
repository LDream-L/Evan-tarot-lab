// ==============================
// site-account.js
// 全站統一 Google 登入、暱稱與登出入口
// ==============================
// 主要函式複雜度：
// - ensureMarkup / syncMenuSpace / updateTrigger：O(1)
// - loadDependencies：O(s)，s = 固定依賴數（最多 3）
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 各功能頁各自建立登入面板：重複載入、狀態不一致、畫面占用大。
// - 本實作：全站共用右上角帳戶入口，開啟時由頁首預留面板高度，避免覆蓋頁面內容。
// ==============================

(function defineUnifiedSiteAccount() {
  "use strict";

  if (window.EvanSiteAccount) return;

  const SCRIPT_VERSION = "20260627-site-account-v2";
  const MENU_SPACE_GAP = 20;
  const loadedScripts = new Map();
  let initialized = false;
  let accountRoot = null;
  let siteHeader = null;
  let trigger = null;
  let menu = null;
  let menuResizeObserver = null;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  function loadStyle(href, marker) {
    if (document.querySelector(`link[data-site-account-style="${marker}"]`)) return;
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

  function createAccountMarkup() {
    const wrapper = document.createElement("div");
    wrapper.className = "site-account";
    wrapper.id = "site-account";

    const accountTrigger = document.createElement("button");
    accountTrigger.id = "site-account-trigger";
    accountTrigger.className = "site-account-trigger";
    accountTrigger.type = "button";
    accountTrigger.setAttribute("aria-haspopup", "dialog");
    accountTrigger.setAttribute("aria-expanded", "false");
    accountTrigger.innerHTML = `
      <span class="site-account-avatar" id="site-account-avatar" aria-hidden="true">G</span>
      <span class="site-account-label" id="site-account-label">登入</span>
      <span class="site-account-caret" aria-hidden="true">▼</span>
    `;

    const accountMenu = document.createElement("section");
    accountMenu.id = "site-account-menu";
    accountMenu.className = "site-account-menu";
    accountMenu.setAttribute("role", "dialog");
    accountMenu.setAttribute("aria-label", "Google 帳戶");
    accountMenu.hidden = true;
    accountMenu.innerHTML = `
      <div class="site-account-heading">
        <div>
          <strong>Google 帳戶</strong>
          <p id="google-auth-status">正在載入登入狀態…</p>
        </div>
        <button class="site-account-close" id="site-account-close" type="button" aria-label="關閉帳戶選單">×</button>
      </div>
      <div id="google-signin-button" class="site-account-loading">登入元件載入中…</div>
      <div class="google-user-panel hidden" id="google-user-panel">
        <div class="google-nickname-editor">
          <label for="google-nickname-input">公開暱稱</label>
          <div class="google-nickname-row">
            <input id="google-nickname-input" type="text" minlength="2" maxlength="20" autocomplete="nickname" placeholder="2～20 個字" />
            <button class="btn primary" id="google-nickname-save" type="button">儲存</button>
          </div>
          <p class="google-nickname-help">Email 不公開；留言與預約使用公開暱稱。</p>
          <p class="google-nickname-status" id="google-nickname-status" aria-live="polite"></p>
        </div>
        <button class="btn ghost google-signout-button" id="google-signout-button" type="button">登出</button>
      </div>
    `;

    wrapper.append(accountTrigger, accountMenu);
    return wrapper;
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function syncMenuSpace() {
    if (!siteHeader || !menu || menu.hidden) return;
    const menuHeight = Math.ceil(menu.getBoundingClientRect().height);
    siteHeader.style.setProperty("--site-account-menu-space", `${menuHeight + MENU_SPACE_GAP}px`);
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function ensureMarkup() {
    const headerInner = document.querySelector(".site-header .header-inner");
    if (!headerInner) return false;

    accountRoot = document.getElementById("site-account");
    if (!accountRoot) {
      accountRoot = createAccountMarkup();
      headerInner.appendChild(accountRoot);
    }

    siteHeader = headerInner.closest(".site-header");
    headerInner.classList.add("has-site-account");
    trigger = document.getElementById("site-account-trigger");
    menu = document.getElementById("site-account-menu");
    return Boolean(siteHeader && trigger && menu);
  }

  function setOpen(nextOpen) {
    if (!trigger || !menu) return;

    const shouldOpen = Boolean(nextOpen);
    menu.hidden = !shouldOpen;
    trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    siteHeader?.classList.toggle("site-account-open", shouldOpen);

    if (shouldOpen) {
      window.requestAnimationFrame(syncMenuSpace);
    } else {
      siteHeader?.style.removeProperty("--site-account-menu-space");
    }
  }

  function open(options = {}) {
    setOpen(true);
    window.setTimeout(() => {
      if (options.focusNickname) {
        document.getElementById("google-nickname-input")?.focus();
      } else {
        document.getElementById("google-nickname-input")?.focus({ preventScroll: true });
      }
    }, 0);
  }

  function close() {
    setOpen(false);
    trigger?.focus({ preventScroll: true });
  }

  /** 時間複雜度 O(1)，空間複雜度 O(1)。 */
  function updateTrigger(state) {
    const signedIn = Boolean(state?.isSignedIn);
    const nickname = String(state?.nickname || "").trim();
    const label = document.getElementById("site-account-label");
    const avatar = document.getElementById("site-account-avatar");

    if (label) label.textContent = signedIn ? (nickname || "帳戶") : "登入";
    if (avatar) {
      const source = signedIn ? (nickname || "G") : "G";
      avatar.textContent = Array.from(source)[0]?.toUpperCase?.() || "G";
    }
    trigger?.classList.toggle("is-signed-in", signedIn);

    if (menu && !menu.hidden) {
      window.requestAnimationFrame(syncMenuSpace);
    }

    window.dispatchEvent(new CustomEvent("evan-google-auth-change", { detail: state }));
  }

  function bindMenuEvents() {
    trigger?.addEventListener("click", () => setOpen(menu?.hidden !== false));
    document.getElementById("site-account-close")?.addEventListener("click", close);

    document.addEventListener("pointerdown", (event) => {
      if (menu?.hidden || accountRoot?.contains(event.target)) return;
      setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu && !menu.hidden) close();
    });

    window.addEventListener("resize", syncMenuSpace, { passive: true });

    if (window.ResizeObserver && menu) {
      menuResizeObserver = new ResizeObserver(syncMenuSpace);
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
