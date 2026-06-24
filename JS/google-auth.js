// ==============================
// google-auth.js
// Google Identity Services：文章留言登入
// ==============================
//
// 主要函式複雜度：O(1)
// 空間複雜度：O(1)
//
// 安全設計：登入憑證只保留在目前頁面的記憶體中；
// 重新整理後需再次確認 Google 帳號，避免長期留在瀏覽器儲存空間。
// ==============================

(function initGoogleAuthModule() {
  const listeners = new Set();
  let initialized = false;
  let credential = "";

  function getClientId() {
    return String(window.EVAN_CLOUD_CONFIG?.googleClientId || "").trim();
  }

  function isConfigured() {
    const clientId = getClientId();
    return Boolean(clientId && !clientId.includes("PASTE_GOOGLE"));
  }

  function getState() {
    return Object.freeze({
      isConfigured: isConfigured(),
      isSignedIn: Boolean(credential),
    });
  }

  function notify() {
    const state = getState();
    listeners.forEach((listener) => listener(state));
  }

  function updateUI() {
    const signInContainer = document.getElementById("google-signin-button");
    const signedInPanel = document.getElementById("google-user-panel");
    const loginRequired = document.getElementById("comment-login-required");
    const form = document.getElementById("comment-form");

    signInContainer?.classList.toggle("hidden", Boolean(credential));
    signedInPanel?.classList.toggle("hidden", !credential);
    loginRequired?.classList.toggle("hidden", Boolean(credential));
    form?.classList.toggle("is-auth-locked", !credential);

    form?.querySelectorAll("textarea, button[type='submit']").forEach((element) => {
      element.disabled = !credential;
    });
  }

  function handleCredentialResponse(response) {
    credential = String(response?.credential || "");
    updateUI();
    notify();
  }

  function renderButton() {
    const container = document.getElementById("google-signin-button");
    if (!container || !window.google?.accounts?.id || !isConfigured()) return false;

    container.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: getClientId(),
      callback: handleCredentialResponse,
      auto_select: false,
    });

    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      logo_alignment: "left",
      locale: "zh_TW",
    });

    return true;
  }

  async function waitForLibrary() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (window.google?.accounts?.id) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return false;
  }

  async function init() {
    if (initialized) return getState();
    initialized = true;
    updateUI();

    const status = document.getElementById("google-auth-status");
    if (!isConfigured()) {
      if (status) status.textContent = "Google 登入尚未完成 OAuth Client ID 設定。";
      notify();
      return getState();
    }

    const loaded = await waitForLibrary();
    if (!loaded || !renderButton()) {
      if (status) status.textContent = "Google 登入元件載入失敗，請重新整理後再試。";
      notify();
      return getState();
    }

    if (status) status.textContent = "請先使用 Google 帳號登入，登入後才能留言與回覆。";
    document.getElementById("google-signout-button")?.addEventListener("click", signOut);
    notify();
    return getState();
  }

  function signOut() {
    credential = "";
    window.google?.accounts?.id?.disableAutoSelect?.();
    updateUI();
    notify();
  }

  function onChange(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  window.EvanGoogleAuth = Object.freeze({
    init,
    onChange,
    signOut,
    getCredential: () => credential,
    isSignedIn: () => Boolean(credential),
  });
})();
