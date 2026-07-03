// Private gate for Evan practice tracker.
(function initPracticeAuth() {
  const URL_KEY = "evanPracticeWebAppUrl.v1";
  const REMEMBERED_KEY = "evanPracticeAccessKey.v1";
  const SESSION_KEY = "evanPracticeSessionKey.v1";
  const MIN_ACCESS_KEY_LENGTH = 8;

  const lockScreen = document.getElementById("practice-lock-screen");
  const privateContent = document.getElementById("practice-private-content");
  const authForm = document.getElementById("practice-auth-form");
  const urlInput = document.getElementById("practice-webapp-url");
  const keyInput = document.getElementById("practice-access-key");
  const rememberInput = document.getElementById("practice-remember-device");
  const message = document.getElementById("practice-auth-message");
  const submitButton = document.getElementById("practice-auth-submit");

  if (!lockScreen || !privateContent || !authForm || !urlInput || !keyInput) return;

  keyInput.minLength = MIN_ACCESS_KEY_LENGTH;
  keyInput.placeholder = `至少 ${MIN_ACCESS_KEY_LENGTH} 個字元`;

  let unlocked = false;
  let activeConfig = null;

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }

  // Time O(1), space O(1). Validation is intentionally strict so a /dev URL is not mistaken for the production endpoint.
  function normalizeWebAppUrl(raw) {
    const value = String(raw || "").trim();
    let url;
    try {
      url = new URL(value);
    } catch (_) {
      throw new Error("接收網址格式不正確。");
    }
    const validHost = url.hostname === "script.google.com";
    const validPath = /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
    if (!validHost || !validPath) throw new Error("請貼上 Apps Script 部署後、以 /exec 結尾的網址。");
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  // Time O(payload), space O(payload). Faster alternatives such as query-string GET are avoided because they expose the secret in browser history.
  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error("接收端沒有回傳可辨識的 JSON。");
    }
    if (!response.ok || !parsed?.ok) throw new Error(parsed?.message || "接收端拒絕連線。");
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

  function saveConfig(url, accessKey, remember) {
    localStorage.setItem(URL_KEY, url);
    sessionStorage.setItem(SESSION_KEY, accessKey);
    if (remember) localStorage.setItem(REMEMBERED_KEY, accessKey);
    else localStorage.removeItem(REMEMBERED_KEY);
  }

  async function verifyAndUnlock(url, accessKey, remember) {
    submitButton.disabled = true;
    setMessage("正在驗證私人連線…");
    try {
      const normalizedUrl = normalizeWebAppUrl(url);
      if (String(accessKey || "").length < MIN_ACCESS_KEY_LENGTH) {
        throw new Error(`私人接收金鑰至少需要 ${MIN_ACCESS_KEY_LENGTH} 個字元。`);
      }
      await postJson(normalizedUrl, { action: "ping", accessKey });
      saveConfig(normalizedUrl, accessKey, remember);
      setMessage("驗證成功。");
      reveal({ url: normalizedUrl, accessKey });
    } catch (error) {
      console.error(error);
      setMessage(error.message || "無法驗證私人連線。", true);
    } finally {
      submitButton.disabled = false;
    }
  }

  authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    verifyAndUnlock(urlInput.value, keyInput.value, rememberInput.checked);
  });

  window.EvanPracticeAuth = {
    isUnlocked: () => unlocked,
    getConfig: () => activeConfig ? { ...activeConfig } : null,
    postJson,
    async retest() {
      if (!activeConfig) throw new Error("尚未建立私人連線。");
      return postJson(activeConfig.url, { action: "ping", accessKey: activeConfig.accessKey });
    },
    forgetAndLock() {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBERED_KEY);
      activeConfig = null;
      unlocked = false;
      privateContent.hidden = true;
      lockScreen.hidden = false;
      document.body.classList.remove("practice-is-unlocked");
      keyInput.value = "";
      setMessage("已鎖定，這台裝置不再保存金鑰。");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const savedUrl = localStorage.getItem(URL_KEY) || "";
  const savedKey = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBERED_KEY) || "";
  urlInput.value = savedUrl;
  rememberInput.checked = Boolean(localStorage.getItem(REMEMBERED_KEY));
  if (savedUrl && savedKey) {
    keyInput.value = savedKey;
    verifyAndUnlock(savedUrl, savedKey, rememberInput.checked);
  }
})();
