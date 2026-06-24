// ==============================
// google-auth.js
// Google Identity Services＋雲端暱稱
// ==============================
//
// 主要函式複雜度：
// - init / updateUI：O(1)
// - decodeJwtPayload：O(m)，m = JWT payload 長度
// - createUserKey：O(m)
// 空間複雜度：O(m)
//
// 更快替代方案比較：
// - 暴力法：把暱稱複製到每則留言，改名必須逐筆更新。
// - 本實作：登入身分只對應一筆 Profiles 資料，所有歷史留言讀取時套用最新暱稱。
// ==============================

(function initGoogleAuthModule() {
  const listeners = new Set();
  const REQUEST_TIMEOUT_MS = 12000;

  let initialized = false;
  let credential = "";
  let user = null;
  let nickname = "";
  let profileLoading = false;

  function getClientId() {
    return String(window.EVAN_CLOUD_CONFIG?.googleClientId || "").trim();
  }

  function getApiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.commentsApiUrl || "").trim();
  }

  function isConfigured() {
    const clientId = getClientId();
    return Boolean(clientId && !clientId.includes("PASTE_GOOGLE"));
  }

  function decodeJwtPayload(token) {
    try {
      const payloadPart = String(token || "").split(".")[1];
      if (!payloadPart) return null;

      const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const json = decodeURIComponent(
        atob(padded)
          .split("")
          .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
          .join("")
      );
      return JSON.parse(json);
    } catch (error) {
      console.warn("[google-auth] 無法解析 Google 登入資料：", error);
      return null;
    }
  }

  async function createUserKey(subject) {
    const bytes = new TextEncoder().encode(String(subject || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function getState() {
    return Object.freeze({
      isConfigured: isConfigured(),
      isSignedIn: Boolean(credential && user),
      hasNickname: Boolean(nickname),
      nickname,
      userKey: user?.userKey || "",
    });
  }

  function notify() {
    const state = getState();
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error("[google-auth] 狀態監聽器錯誤：", error);
      }
    });
  }

  function setText(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) element.textContent = value;
  }

  function updateUI() {
    const isSignedIn = Boolean(credential && user);
    const hasNickname = Boolean(nickname);
    const canComment = isSignedIn && hasNickname;
    const signInContainer = document.getElementById("google-signin-button");
    const signedInPanel = document.getElementById("google-user-panel");
    const loginRequired = document.getElementById("comment-login-required");
    const form = document.getElementById("comment-form");
    const nicknameInput = document.getElementById("google-nickname-input");
    const nicknameButton = document.getElementById("google-nickname-save");

    signInContainer?.classList.toggle("hidden", isSignedIn);
    signedInPanel?.classList.toggle("hidden", !isSignedIn);
    form?.classList.toggle("is-auth-locked", !canComment);

    if (loginRequired) {
      loginRequired.classList.toggle("hidden", canComment);
      loginRequired.textContent = !isSignedIn
        ? "請先登入 Google 帳號，登入後才可留言與回覆。"
        : "請先設定公開暱稱，設定後才可留言與回覆。";
    }

    if (nicknameInput) {
      nicknameInput.disabled = !isSignedIn || profileLoading;
      if (document.activeElement !== nicknameInput) nicknameInput.value = nickname;
    }
    if (nicknameButton) nicknameButton.disabled = !isSignedIn || profileLoading;

    form?.querySelectorAll("textarea, button[type='submit']").forEach((element) => {
      element.disabled = !canComment;
    });

    const status = document.getElementById("google-auth-status");
    if (status && isSignedIn) {
      status.textContent = profileLoading
        ? "正在讀取暱稱…"
        : hasNickname
          ? `目前公開暱稱：${nickname}`
          : "已登入，請先設定公開暱稱。";
    }
  }

  async function loadProfile() {
    if (!user?.userKey || !getApiUrl()) {
      nickname = "";
      return null;
    }

    profileLoading = true;
    updateUI();

    try {
      const url = new URL(getApiUrl());
      url.searchParams.set("action", "profile");
      url.searchParams.set("userKey", user.userKey);
      url.searchParams.set("_", String(Date.now()));

      const response = await fetchWithTimeout(url.toString(), {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      nickname = String(payload?.profile?.nickname || "").trim();
      return payload?.profile || null;
    } catch (error) {
      console.error("[google-auth] 暱稱讀取失敗：", error);
      nickname = "";
      setText("google-nickname-status", "暱稱讀取失敗，請稍後再試。");
      return null;
    } finally {
      profileLoading = false;
      updateUI();
      notify();
    }
  }

  function validateNickname(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    const length = Array.from(normalized).length;

    if (length < 2 || length > 20) {
      throw new Error("暱稱須為 2～20 個字。");
    }
    if (/[<>\[\]{}]/.test(normalized)) {
      throw new Error("暱稱不可包含 < > [ ] { } 等符號。");
    }
    return normalized;
  }

  async function saveNickname() {
    const input = document.getElementById("google-nickname-input");
    const status = document.getElementById("google-nickname-status");

    if (!credential || !user) {
      if (status) status.textContent = "請先登入 Google 帳號。";
      return false;
    }

    let nextNickname = "";
    try {
      nextNickname = validateNickname(input?.value);
    } catch (error) {
      if (status) status.textContent = error.message;
      input?.focus();
      return false;
    }

    profileLoading = true;
    updateUI();
    if (status) status.textContent = "暱稱儲存中…";

    try {
      await fetchWithTimeout(getApiUrl(), {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          action: "setNickname",
          credential,
          nickname: nextNickname,
          website: "",
        }),
        keepalive: true,
      });

      profileLoading = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500 + attempt * 250));
        const profile = await loadProfile();
        if (profile?.nickname === nextNickname) {
          if (status) status.textContent = "暱稱已更新，所有歷史留言會同步顯示新暱稱。";
          return true;
        }
      }

      if (status) status.textContent = "暱稱尚未成功更新，請確認 Apps Script 已部署最新版。";
      return false;
    } catch (error) {
      console.error("[google-auth] 暱稱儲存失敗：", error);
      if (status) status.textContent = "暱稱儲存失敗，請稍後再試。";
      return false;
    } finally {
      profileLoading = false;
      updateUI();
      notify();
    }
  }

  async function handleCredentialResponse(response) {
    const nextCredential = String(response?.credential || "");
    const payload = decodeJwtPayload(nextCredential);

    if (!nextCredential || !payload?.sub) {
      setText("google-auth-status", "Google 登入失敗，請重新操作。");
      return;
    }

    credential = nextCredential;
    user = {
      subject: String(payload.sub),
      userKey: await createUserKey(payload.sub),
    };
    nickname = "";
    updateUI();
    notify();
    await loadProfile();
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

    document.getElementById("google-signout-button")?.addEventListener("click", signOut);
    document.getElementById("google-nickname-save")?.addEventListener("click", saveNickname);

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

    if (status) status.textContent = "請先使用 Google 帳號登入。";
    notify();
    return getState();
  }

  function signOut() {
    credential = "";
    user = null;
    nickname = "";
    profileLoading = false;
    window.google?.accounts?.id?.disableAutoSelect?.();
    setText("google-nickname-status", "");
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
    saveNickname,
    getCredential: () => credential,
    getState,
    getNickname: () => nickname,
    isSignedIn: () => Boolean(credential && user),
    hasNickname: () => Boolean(nickname),
  });
})();
