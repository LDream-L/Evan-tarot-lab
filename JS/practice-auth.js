// ==============================
// practice-auth.js
// 私人修煉紀錄：Apps Script 接收端驗證與工作階段鎖定
// ==============================
//
// 主要函式複雜度：
// - normalizeWebAppUrl：時間／空間 O(1)
// - postJson：時間／空間 O(p)，p = 請求與回應文字長度
// - verifyAndUnlock：時間／空間 O(p)（不含網路等待）
//
// 安全取捨：
// - 長期保存明文金鑰到 localStorage：使用方便，但同網域腳本可長期讀取。
// - 本實作：金鑰只存 sessionStorage；關閉瀏覽器工作階段後即失效。
// ==============================

(function initPracticeAuth() {
  "use strict";

  const URL_KEY = "evanPracticeWebAppUrl.v1";
  const LEGACY_REMEMBERED_KEY = "evanPracticeAccessKey.v1";
  const SESSION_KEY = "evanPracticeSessionKey.v2";
  const MIN_ACCESS_KEY_LENGTH = 8;

  const lockScreen = document.getElementById("practice-lock-screen");
  const privateContent = document.getElementById("practice-private-content");
  const authForm = document.getElementById("practice-auth-form");
  const urlInput = document.getElementById("practice-webapp-url");
  const keyInput = document.getElementById("practice-access-key");
  const rememberInput = document.getElementById("practice-remember-device");
  const message = document.getElementById("practice-auth-message");
  const submitButton = document.getElementById("practice-auth-submit");

  if (!lockScreen || !privateContent || !authForm || !urlInput || !keyInput || !message || !submitButton) return;

  keyInput.minLength = MIN_ACCESS_KEY_LENGTH;
  keyInput.placeholder = `至少 ${MIN_ACCESS_KEY_LENGTH} 個字元`;

  let unlocked = false;
  let activeConfig = null;

  function safeStorageGet(storage, key) {
    try {
      return storage.getItem(key) || "";
    } catch (error) {
      console.warn(`[practice-auth] 無法讀取儲存空間 ${key}：`, error);
      return "";
    }
  }

  function safeStorageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`[practice-auth] 無法寫入儲存空間 ${key}：`, error);
      return false;
    }
  }

  function safeStorageRemove(storage, key) {
    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn(`[practice-auth] 無法移除儲存空間 ${key}：`, error);
    }
  }

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }

  /** 驗證正式 Apps Script /exec 網址，避免誤用 /dev。時間／空間複雜度 O(1)。 */
  function normalizeWebAppUrl(raw) {
    const value = String(raw || "").trim();
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      throw new Error("接收網址格式不正確。");
    }

    const validHost = url.hostname === "script.google.com";
    const validPath = /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
    if (!validHost || !validPath) {
      throw new Error("請貼上 Apps Script 部署後、以 /exec 結尾的網址。");
    }

    url.search = "";
    url.hash = "";
    return url.toString();
  }

  /** POST 避免將私人金鑰暴露在網址、瀏覽紀錄或伺服器 query log。時間／空間 O(p)。 */
  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error("接收端沒有回傳可辨識的 JSON。");
    }

    if (!response.ok || !parsed?.ok) {
      throw new Error(parsed?.message || "接收端拒絕連線。");
    }
    return parsed;
  }

  function reveal(config) {
    activeConfig = config;
    unlocked = true;
    lockScreen.hidden = true;
    privateContent.hidden = false;
    document.body.classList.add("practice-is-unlocked");
    window.dispatchEvent(new CustomEvent("practice:unlocked", { detail: { ...config } }));
  }

  /** 金鑰只存目前工作階段；勾選時僅保存接收網址。時間／空間複雜度 O(1)。 */
  function saveConfig(url, accessKey, rememberUrl) {
    safeStorageSet(sessionStorage, SESSION_KEY, accessKey);
    safeStorageRemove(localStorage, LEGACY_REMEMBERED_KEY);

    if (rememberUrl) safeStorageSet(localStorage, URL_KEY, url);
    else safeStorageRemove(localStorage, URL_KEY);
  }

  async function verifyAndUnlock(url, accessKey, rememberUrl) {
    submitButton.disabled = true;
    setMessage("正在驗證私人連線…");

    try {
      const normalizedUrl = normalizeWebAppUrl(url);
      if (String(accessKey || "").length < MIN_ACCESS_KEY_LENGTH) {
        throw new Error(`私人接收金鑰至少需要 ${MIN_ACCESS_KEY_LENGTH} 個字元。`);
      }

      await postJson(normalizedUrl, { action: "ping", accessKey });
      saveConfig(normalizedUrl, accessKey, rememberUrl);
      setMessage("驗證成功；私人金鑰只保留在目前瀏覽器工作階段。");
      reveal({ url: normalizedUrl, accessKey });
    } catch (error) {
      console.error("[practice-auth] 驗證失敗：", error);
      setMessage(error.message || "無法驗證私人連線。", true);
    } finally {
      submitButton.disabled = false;
    }
  }

  authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    verifyAndUnlock(urlInput.value, keyInput.value, Boolean(rememberInput?.checked));
  });

  window.EvanPracticeAuth = Object.freeze({
    isUnlocked: () => unlocked,
    getConfig: () => activeConfig ? { ...activeConfig } : null,
    postJson,
    async retest() {
      if (!activeConfig) throw new Error("尚未建立私人連線。");
      return postJson(activeConfig.url, { action: "ping", accessKey: activeConfig.accessKey });
    },
    forgetAndLock() {
      safeStorageRemove(sessionStorage, SESSION_KEY);
      safeStorageRemove(localStorage, LEGACY_REMEMBERED_KEY);
      activeConfig = null;
      unlocked = false;
      privateContent.hidden = true;
      lockScreen.hidden = false;
      document.body.classList.remove("practice-is-unlocked");
      keyInput.value = "";
      setMessage("已鎖定；私人金鑰已從目前工作階段移除。");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  // 清除舊版可能遺留在 localStorage 的明文金鑰。
  safeStorageRemove(localStorage, LEGACY_REMEMBERED_KEY);

  const savedUrl = safeStorageGet(localStorage, URL_KEY);
  const savedKey = safeStorageGet(sessionStorage, SESSION_KEY);
  urlInput.value = savedUrl;
  if (rememberInput) rememberInput.checked = Boolean(savedUrl);

  if (savedUrl && savedKey) {
    keyInput.value = savedKey;
    verifyAndUnlock(savedUrl, savedKey, true);
  }
})();
