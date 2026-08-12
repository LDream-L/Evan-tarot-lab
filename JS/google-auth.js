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
  const RESTORE_TIMEOUT_MS = 5000;
  const CREDENTIAL_STORAGE_KEY = "evanGoogleIdToken";
  const EXPIRY_SAFETY_MS = 5000;
  const MAX_TIMER_MS = 2147483647;

  let initialized = false;
  let credential = "";
  let user = null;
  let nickname = "";
  let profileLoading = false;
  let authVerifying = false;
  let authError = "";
  let credentialExpiresAt = 0;
  let expiryTimer = 0;
  let reloadScheduled = false;
  let lifecycleBound = false;
  let restoringSession = false;
  let verificationAttempt = 0;

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

  /** 清除單一到期計時器：時間／空間 O(1)。 */
  function clearCredentialExpiryTimer() {
    if (expiryTimer) window.clearTimeout(expiryTimer);
    expiryTimer = 0;
  }

  /**
   * 登出後只排一次重新整理：時間／空間 O(1)。
   * 更快替代方案比較：每個 auth listener 各自 reload 會造成重複導頁；集中在登入核心只需一次狀態切換。
   */
  function schedulePageReload() {
    if (reloadScheduled) return;
    reloadScheduled = true;
    window.setTimeout(() => window.location.reload(), 0);
  }

  /**
   * 清除工作階段；時間／空間 O(1)。
   * reload=true 時先清除 storage 再重整，避免重新載入時再次拿到同一枚過期 Token。
   */
  function clearSession({ message = "", reload = false } = {}) {
    clearCredentialExpiryTimer();
    credentialExpiresAt = 0;
    credential = "";
    user = null;
    nickname = "";
    profileLoading = false;
    authVerifying = false;
    authError = message;
    sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);
    sessionStorage.removeItem("evanFootballGoogleIdToken");
    window.google?.accounts?.id?.disableAutoSelect?.();
    setText("google-nickname-status", "");
    updateUI();
    notify();
    renderButton();
    if (reload) schedulePageReload();
  }

  /**
   * 主動檢查目前 Token 是否到期：時間／空間 O(1)。
   * 更快替代方案比較：固定每秒輪詢會持續喚醒頁面；只在到期 timer 與頁面重新可見／聚焦時檢查即可。
   */
  function checkCredentialExpiry() {
    if (!credential || !user || !credentialExpiresAt) return false;
    if (credentialExpiresAt > Date.now() + EXPIRY_SAFETY_MS) return false;
    expireSession("Google 登入已過期，頁面將重新整理。");
    return true;
  }

  /**
   * 依 JWT exp 排程一次到期處理：時間／空間 O(1)。
   * Safari 背景頁可能暫停 timer，因此另由 lifecycle 事件補檢查。
   */
  function scheduleCredentialExpiry(payload) {
    clearCredentialExpiryTimer();
    credentialExpiresAt = Number(payload?.exp || 0) * 1000;
    if (!credentialExpiresAt) return;
    const delay = credentialExpiresAt - Date.now() - EXPIRY_SAFETY_MS;
    if (delay <= 0) {
      window.queueMicrotask(checkCredentialExpiry);
      return;
    }
    expiryTimer = window.setTimeout(checkCredentialExpiry, Math.min(delay, MAX_TIMER_MS));
  }

  /** lifecycle 事件固定三個：時間／空間 O(1)。 */
  function bindCredentialLifecycle() {
    if (lifecycleBound) return;
    lifecycleBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkCredentialExpiry();
    });
    window.addEventListener("focus", checkCredentialExpiry, { passive: true });
    window.addEventListener("pageshow", checkCredentialExpiry, { passive: true });
  }

  /** 後端或到期計時器可共用的失效入口：時間／空間 O(1)。 */
  function expireSession(message = "Google 登入已過期，頁面將重新整理。") {
    clearSession({ message, reload: true });
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

  /**
   * 單次網路請求逾時控制：時間／空間 O(1)（不含網路等待）。
   * 更快替代方案比較：所有驗證共用 12 秒會讓舊工作階段恢復卡住介面過久；
   * 本版允許恢復流程使用較短逾時，但新登入仍保留完整驗證時間。
   */
  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      Math.max(1, Number(timeoutMs) || REQUEST_TIMEOUT_MS)
    );
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

    if (signInContainer && authVerifying && !isSignedIn && !restoringSession) {
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
        status.textContent = restoringSession
          ? "正在恢復上次 Google 工作階段；若等待過久，可直接重新登入。"
          : "正在向 Apps Script 驗證 Google 工作階段…";
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

  async function verifyCredentialWithBackend(nextCredential, timeoutMs = REQUEST_TIMEOUT_MS) {
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
    }, timeoutMs);
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

  /**
   * 後端驗證並套用單次 Google 憑證。
   * 時間複雜度：O(m)＋一次後端請求，m = JWT payload 長度。
   * 空間複雜度：O(m)。
   * 更快替代方案比較：直接信任瀏覽器 JWT 可省一次請求，但會失去 audience／issuer 的後端安全驗證；
   * 本版保留後端驗證，並用 attempt 編號 O(1) 丟棄較舊的非同步結果，讓重新登入不必等待舊恢復請求。
   */
  async function setCredential(nextCredential, persist, options = {}) {
    const payload = decodeJwtPayload(nextCredential);
    if (!nextCredential || !isCredentialFresh(payload)) {
      authError = "Google 登入資料無效或已過期，請重新登入。";
      return false;
    }

    const attempt = ++verificationAttempt;
    const isRestore = Boolean(options.restore);
    restoringSession = isRestore;
    authVerifying = true;
    authError = "";
    credential = "";
    user = null;
    nickname = "";
    updateUI();
    notify();
    if (isRestore) renderButton();

    try {
      await verifyCredentialWithBackend(
        nextCredential,
        isRestore ? RESTORE_TIMEOUT_MS : REQUEST_TIMEOUT_MS
      );
      if (attempt !== verificationAttempt) return false;
      const nextUser = await createUser(payload);
      if (attempt !== verificationAttempt) return false;
      credential = nextCredential;
      user = nextUser;
      restoringSession = false;
      scheduleCredentialExpiry(payload);
      if (persist) sessionStorage.setItem(CREDENTIAL_STORAGE_KEY, nextCredential);
      authVerifying = false;
      updateUI();
      notify();
      await loadProfile();
      return true;
    } catch (error) {
      if (attempt !== verificationAttempt) return false;
      console.error("[google-auth] 後端驗證失敗：", error);
      clearCredentialExpiryTimer();
      credentialExpiresAt = 0;
      if (sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) === nextCredential) {
        sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);
      }
      credential = "";
      user = null;
      nickname = "";
      restoringSession = false;
      authVerifying = false;
      authError = error?.name === "AbortError"
        ? (isRestore
          ? "上次登入恢復逾時，請直接重新登入。"
          : "Google 登入驗證逾時，請稍後重新登入。")
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

  /**
   * 背景恢復舊工作階段：時間 O(m)＋一次後端請求，空間 O(m)。
   * 重新登入若已寫入新 Token，不得由較舊恢復流程刪除。
   */
  async function restoreCredential() {
    const storedCredential = String(sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) || "");
    if (!storedCredential) return false;
    const accepted = await setCredential(storedCredential, false, { restore: true });
    if (!accepted && sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) === storedCredential) {
      sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);
    }
    return accepted;
  }

  function renderButton() {
    const container = document.getElementById("google-signin-button");
    if (
      !container
      || !window.google?.accounts?.id
      || !isConfigured()
      || Boolean(credential && user)
      || (authVerifying && !restoringSession)
    ) return false;
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
    bindCredentialLifecycle();
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

  /**
   * 登出後重新整理頁面；時間／空間 O(1)。
   * click event 直接傳入時沒有 reload=false，因此手動登出同樣會重整。
   */
  function signOut(options = {}) {
    const shouldReload = options?.reload !== false;
    clearSession({ message: "", reload: shouldReload });
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
    expireSession,
    checkCredentialExpiry,
    saveNickname,
    getCredential: () => credential,
    getState,
    getNickname: () => nickname,
    isSignedIn: () => Boolean(credential && user),
    hasNickname: () => Boolean(nickname),
  });
})();
