// ==============================
// google-auth.js v2
// Google Identity Services＋後端驗證＋雲端暱稱＋全站工作階段
// ==============================
//
// 主要函式複雜度：
// - init / updateUI / verifyCredentialWithBackend：O(1)（不含網路等待）
// - decodeJwtPayload / createUser：O(m)，m = JWT payload 長度
// 空間複雜度：O(m)
//
// 更快替代方案比較：
// - 只在瀏覽器解析 Token 就顯示已登入：反應快，但後端缺檔、Token audience 不符時會形成假登入畫面。
// - 本實作：瀏覽器先做基本格式檢查，再由 Apps Script 驗證後才建立正式工作階段。
// ==============================

(function initGoogleAuthModule() {
  "use strict";

  const listeners = new Set();
  const REQUEST_TIMEOUT_MS = 12000;
  const CREDENTIAL_STORAGE_KEY = "evanGoogleIdToken";

  let initialized = false;
  let credential = "";
  let user = null;
  let nickname = "";
  let profileLoading = false;
  let authVerifying = false;
  let authError = "";

  function getClientId() {
    return String(window.EVAN_CLOUD_CONFIG?.googleClientId || "").trim();
  }

  function getApiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.commentsApiUrl || "").trim();
  }

  function isConfigured() {
    const clientId = getClientId();
    const apiUrl = getApiUrl();
    return Boolean(clientId && !clientId.includes("PASTE_GOOGLE") && apiUrl);
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

  function isCredentialFresh(payload) {
    if (!payload?.sub) return false;
    const expiresAt = Number(payload.exp || 0) * 1000;
    return !expiresAt || expiresAt > Date.now() + 30000;
  }

  async function createUser(payload) {
    const bytes = new TextEncoder().encode(String(payload.sub || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const userKey = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
    return { subject: String(payload.sub), userKey };
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function readJsonResponse(response, fallbackMessage) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(fallbackMessage || "後端沒有回傳可讀的 JSON。", { cause: error });
    }
    if (!payload?.success) throw new Error(payload?.error || fallbackMessage || "後端處理失敗。");
    return payload;
  }

  function getState() {
    return Object.freeze({
      isConfigured: isConfigured(),
      isSignedIn: Boolean(credential && user),
      isVerifying: authVerifying,
      hasNickname: Boolean(nickname),
      nickname,
      userKey: user?.userKey || "",
      error: authError,
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
    const canComment = isSignedIn && hasNickname && !profileLoading;
    const signInContainer = document.getElementById("google-signin-button");
    const signedInPanel = document.getElementById("google-user-panel");
    const loginRequired = document.getElementById("comment-login-required");
    const form = document.getElementById("comment-form");
    const nicknameInput = document.getElementById("google-nickname-input");
    const nicknameButton = document.getElementById("google-nickname-save");

    signInContainer?.classList.toggle("hidden", isSignedIn);
    signedInPanel?.classList.toggle("hidden", !isSignedIn);
    form?.classList.toggle("is-auth-locked", !canComment);

    if (signInContainer && authVerifying && !isSignedIn) {
      signInContainer.textContent = "正在向後端確認 Google 登入…";
      signInContainer.classList.add("site-account-loading");
    }

    if (loginRequired) {
      loginRequired.classList.toggle("hidden", canComment);
      loginRequired.textContent = authVerifying
        ? "正在確認 Google 登入，請稍候。"
        : !isSignedIn
          ? "請從右上角登入 Google 帳號，登入後才可留言與回覆。"
          : "請從右上角帳戶選單設定公開暱稱，設定後才可留言與回覆。";
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
    if (status) {
      if (authVerifying) {
        status.textContent = "正在向 Apps Script 驗證 Google 工作階段…";
      } else if (authError && !isSignedIn) {
        status.textContent = authError;
      } else if (!isSignedIn) {
        status.textContent = "使用 Google 帳號登入後，可在全站共用同一工作階段。";
      } else if (profileLoading) {
        status.textContent = "登入已驗證，正在讀取暱稱…";
      } else {
        status.textContent = hasNickname ? `目前公開暱稱：${nickname}` : "登入已驗證，請先設定公開暱稱。";
      }
    }
  }

  async function verifyCredentialWithBackend(nextCredential) {
    const response = await fetchWithTimeout(getApiUrl(), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        action: "authStatus",
        credential: nextCredential,
        requestId: window.crypto?.randomUUID?.() || `auth_${Date.now().toString(36)}`,
        website: "",
      }),
    });
    return readJsonResponse(response, "Google 登入後端驗證失敗。");
  }

  async function loadProfile() {
    if (!user?.userKey || !getApiUrl()) {
      nickname = "";
      return null;
    }
    profileLoading = true;
    updateUI();
    notify();
    try {
      const url = new URL(getApiUrl());
      url.searchParams.set("action", "profile");
      url.searchParams.set("userKey", user.userKey);
      url.searchParams.set("_", String(Date.now()));
      const response = await fetchWithTimeout(url.toString(), { method: "GET", cache: "no-store" });
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
    if (length < 2 || length > 20) throw new Error("暱稱須為 2～20 個字。");
    if (/[<>\[\]{}]/.test(normalized)) throw new Error("暱稱不可包含 < > [ ] { } 等符號。");
    return normalized;
  }

  async function saveNickname() {
    const input = document.getElementById("google-nickname-input");
    const status = document.getElementById("google-nickname-status");
    if (!credential || !user) {
      if (status) status.textContent = "請先完成 Google 登入驗證。";
      return false;
    }

    let nextNickname;
    try {
      nextNickname = validateNickname(input?.value);
    } catch (error) {
      if (status) status.textContent = error.message;
      input?.focus();
      return false;
    }

    profileLoading = true;
    updateUI();
    notify();
    if (status) status.textContent = "暱稱儲存中…";
    try {
      const response = await fetchWithTimeout(getApiUrl(), {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          action: "setNickname",
          credential,
          nickname: nextNickname,
          requestId: window.crypto?.randomUUID?.() || `nickname_${Date.now().toString(36)}`,
          website: "",
        }),
        keepalive: true,
      });
      const payload = await readJsonResponse(response, "暱稱儲存失敗。");
      nickname = String(payload?.profile?.nickname || payload?.nickname || nextNickname).trim() || nextNickname;
      if (input) input.value = nickname;
      if (status) status.textContent = "暱稱已更新，所有歷史留言會同步顯示新暱稱。";
      return true;
    } catch (error) {
      console.error("[google-auth] 暱稱儲存失敗：", error);
      if (status) {
        status.textContent = error?.name === "AbortError"
          ? "暱稱儲存逾時，請重新開啟帳戶確認是否已更新。"
          : error?.message || "暱稱儲存失敗，請稍後再試。";
      }
      return false;
    } finally {
      profileLoading = false;
      updateUI();
      notify();
    }
  }

  async function setCredential(nextCredential, persist) {
    const payload = decodeJwtPayload(nextCredential);
    if (!nextCredential || !isCredentialFresh(payload)) {
      authError = "Google 登入資料無效或已過期，請重新登入。";
      return false;
    }

    authVerifying = true;
    authError = "";
    credential = "";
    user = null;
    nickname = "";
    updateUI();
    notify();

    try {
      await verifyCredentialWithBackend(nextCredential);
      const nextUser = await createUser(payload);
      credential = nextCredential;
      user = nextUser;
      if (persist) sessionStorage.setItem(CREDENTIAL_STORAGE_KEY, nextCredential);
      authVerifying = false;
      updateUI();
      notify();
      await loadProfile();
      return true;
    } catch (error) {
      console.error("[google-auth] 後端驗證失敗：", error);
      sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);
      credential = "";
      user = null;
      nickname = "";
      authVerifying = false;
      authError = error?.name === "AbortError"
        ? "Google 登入驗證逾時，請稍後重新登入。"
        : error?.message || "Google 登入驗證失敗，請重新操作。";
      updateUI();
      notify();
      renderButton();
      return false;
    }
  }

  async function handleCredentialResponse(response) {
    const nextCredential = String(response?.credential || "");
    const accepted = await setCredential(nextCredential, true);
    if (!accepted && !authError) {
      authError = "Google 登入失敗，請重新操作。";
      updateUI();
      notify();
    }
  }

  async function restoreCredential() {
    const storedCredential = String(sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) || "");
    if (!storedCredential) return false;
    const accepted = await setCredential(storedCredential, false);
    if (!accepted) sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);
    return accepted;
  }

  function renderButton() {
    const container = document.getElementById("google-signin-button");
    if (!container || !window.google?.accounts?.id || !isConfigured() || authVerifying) return false;
    container.replaceChildren();
    container.classList.remove("site-account-loading", "hidden");
    window.google.accounts.id.initialize({
      client_id: getClientId(),
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      logo_alignment: "left",
      locale: "zh_TW",
      width: 300,
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

    if (!isConfigured()) {
      authError = "Google 登入尚未完成 OAuth Client ID 或後端網址設定。";
      updateUI();
      notify();
      return getState();
    }

    const loaded = await waitForLibrary();
    if (!loaded || !renderButton()) {
      authError = "Google 登入元件載入失敗，請重新整理後再試。";
      updateUI();
      notify();
      return getState();
    }

    const restored = await restoreCredential();
    if (!restored && !authVerifying) {
      renderButton();
      updateUI();
      notify();
    }
    return getState();
  }

  function signOut() {
    credential = "";
    user = null;
    nickname = "";
    profileLoading = false;
    authVerifying = false;
    authError = "";
    sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);
    sessionStorage.removeItem("evanFootballGoogleIdToken");
    window.google?.accounts?.id?.disableAutoSelect?.();
    setText("google-nickname-status", "");
    updateUI();
    notify();
    renderButton();
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
