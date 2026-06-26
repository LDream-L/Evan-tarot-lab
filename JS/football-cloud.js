// 世足賽事驗證 v1.2.4｜Google Sheets 雲端同步
// request：O(1) 前端運算／O(1) 空間；syncAll：O(r) 網路請求／O(1) 額外空間。
// 更快替代方案：後端提供批次同步可把 O(r) 次網路往返降成 O(1) 次；目前採循序同步，避免 Apps Script 同時寫入衝突。
(function defineFootballLabCloud() {
  "use strict";

  const TOKEN_KEY = "evanFootballGoogleIdToken";
  const config = window.EVAN_CLOUD_CONFIG || {};
  const apiUrl = String(config.footballApiUrl || "").trim();
  const clientId = String(config.googleClientId || "").trim();
  let googleButtonRendered = false;

  function byId(id) {
    return document.getElementById(id);
  }

  /** 建立雲端控制區：O(1) 時間／O(1) 空間。 */
  function ensurePanel() {
    if (byId("football-cloud-panel")) return;
    const kpis = byId("football-kpis");
    if (!kpis || !kpis.parentElement) return;

    const panel = document.createElement("section");
    panel.id = "football-cloud-panel";
    panel.className = "football-panel";
    panel.innerHTML = `
      <div class="football-section-heading">
        <div>
          <p class="football-eyebrow">Cloud</p>
          <h3>Google Sheets 雲端同步</h3>
        </div>
        <span class="football-version">獨立資料庫</span>
      </div>
      <p id="football-cloud-status" class="football-message is-warning" aria-live="polite">正在檢查雲端連線……</p>
      <div class="football-record-actions">
        <div id="football-google-signin"></div>
        <button id="football-sync-all" class="btn primary" type="button" disabled>同步全部本機紀錄</button>
        <button id="football-cloud-signout" class="btn ghost football-hidden" type="button">本次工作階段登出</button>
      </div>
      <p class="football-storage-note">新紀錄會先安全保存在此瀏覽器，再同步到獨立 Google 試算表；雲端失敗不會刪除本機資料。</p>
    `;
    kpis.parentElement.insertBefore(panel, kpis);
  }

  function setStatus(message, type = "") {
    const element = byId("football-cloud-status");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  function isConfigured() {
    return Boolean(apiUrl && clientId);
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function hasToken() {
    return Boolean(getToken());
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    updateControls();
  }

  function updateControls() {
    const signedIn = hasToken();
    const syncButton = byId("football-sync-all");
    const signOutButton = byId("football-cloud-signout");
    const loginWrap = byId("football-google-signin");
    if (syncButton) syncButton.disabled = !signedIn || !isConfigured();
    if (signOutButton) signOutButton.classList.toggle("football-hidden", !signedIn);
    if (loginWrap) loginWrap.classList.toggle("football-hidden", signedIn);

    if (!isConfigured()) {
      setStatus("尚未設定世足雲端 API。", "is-error");
    } else if (signedIn) {
      setStatus("已取得本次工作階段的 Google 登入憑證，可同步到試算表。", "is-success");
    } else {
      setStatus("請先用資料庫擁有者的 Google 帳號登入，再同步紀錄。", "is-warning");
    }
  }

  function handleCredential(response) {
    const credential = String(response && response.credential || "");
    if (!credential) {
      setStatus("Google 登入沒有回傳有效憑證。", "is-error");
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, credential);
    updateControls();
    window.dispatchEvent(new CustomEvent("football-cloud-authenticated"));
  }

  function renderGoogleButton() {
    if (googleButtonRendered || !isConfigured()) return;
    const container = byId("football-google-signin");
    if (!container || !window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      width: 260,
    });
    googleButtonRendered = true;
  }

  function loadGoogleIdentityScript() {
    if (window.google?.accounts?.id || document.querySelector('script[data-football-google-identity="1"]')) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.footballGoogleIdentity = "1";
    script.onload = renderGoogleButton;
    script.onerror = () => setStatus("Google 登入元件載入失敗，請檢查網路後重新整理。", "is-error");
    document.head.appendChild(script);
  }

  function waitForGoogleIdentity(attempt = 0) {
    renderGoogleButton();
    if (googleButtonRendered || attempt >= 40) return;
    window.setTimeout(() => waitForGoogleIdentity(attempt + 1), 250);
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`雲端回應不是有效 JSON（HTTP ${response.status}）。`);
    }

    if (!response.ok || !payload.ok) {
      const message = payload.error || `雲端請求失敗（HTTP ${response.status}）。`;
      if (/憑證|登入|帳號|權限/.test(message)) clearToken();
      throw new Error(message);
    }
    return payload;
  }

  /**
   * Apps Script 不處理瀏覽器 CORS 預檢，使用 text/plain 維持 simple request。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  async function request(action, payload = {}) {
    if (!isConfigured()) throw new Error("世足雲端 API 尚未設定。");
    const idToken = getToken();
    if (!idToken) throw new Error("請先使用資料庫擁有者的 Google 帳號登入。");

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, idToken, ...payload }),
      redirect: "follow",
    });
    return parseResponse(response);
  }

  async function healthCheck() {
    if (!isConfigured()) return false;
    try {
      const separator = apiUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${apiUrl}${separator}action=health`, { redirect: "follow" });
      const payload = await parseResponse(response);
      return payload.service === "football-tarot";
    } catch (error) {
      setStatus(`雲端端點檢查失敗：${error.message}`, "is-error");
      return false;
    }
  }

  async function saveRecord(record) {
    if (!record) throw new Error("缺少要同步的賽事紀錄。");
    const payload = await request("createRecord", { record });
    return payload.result;
  }

  /**
   * 將賽後分析整理成 Google Sheets 可直接閱讀的備註。
   * 時間複雜度 O(n)，空間複雜度 O(n)。
   */
  function prepareActualForCloud(actual) {
    const source = actual || {};
    const sections = [];
    if (source.reviewAnalysis) sections.push(`【回顧與分析】\n${source.reviewAnalysis}`);
    if (source.notes) sections.push(`【賽事事件／特殊狀況】\n${source.notes}`);

    return {
      ...source,
      notes: sections.join("\n\n"),
    };
  }

  async function updateActual(recordId, actual) {
    if (!recordId || !actual) throw new Error("缺少賽後結果資料。");
    const payload = await request("updateActual", {
      recordId,
      actual: prepareActualForCloud(actual),
    });
    return payload.result;
  }

  /**
   * 循序補傳所有本機紀錄，後端以 recordId 去重。
   * 時間複雜度：O(r)
   * 空間複雜度：O(1)
   */
  async function syncAll(records, onProgress) {
    if (!Array.isArray(records)) throw new Error("同步資料格式不正確。");
    let synced = 0;
    let completed = 0;

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      await saveRecord(record);
      synced += 1;
      if (record.actual) {
        await updateActual(record.id, record.actual);
        completed += 1;
      }
      if (typeof onProgress === "function") onProgress(index + 1, records.length);
    }
    return { synced, completed };
  }

  function bindControls() {
    byId("football-cloud-signout")?.addEventListener("click", () => {
      clearToken();
      setStatus("本次工作階段已登出；試算表中的資料不受影響。", "is-warning");
    });

    byId("football-sync-all")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const records = window.FootballLabCore?.getRecords?.() || [];
      if (!records.length) {
        setStatus("目前沒有本機紀錄需要同步。", "is-warning");
        return;
      }

      button.disabled = true;
      try {
        const result = await syncAll(records, (done, total) => {
          setStatus(`正在同步 ${done}／${total} 筆……`, "is-warning");
        });
        setStatus(`同步完成：${result.synced} 筆賽事，其中 ${result.completed} 筆包含賽果與回顧。`, "is-success");
      } catch (error) {
        setStatus(`同步失敗：${error.message}`, "is-error");
      } finally {
        button.disabled = !hasToken();
      }
    });
  }

  async function init() {
    ensurePanel();
    bindControls();
    updateControls();
    loadGoogleIdentityScript();
    waitForGoogleIdentity();
    const healthy = await healthCheck();
    if (healthy && !hasToken()) setStatus("試算表端點已連線；登入後即可寫入。", "is-warning");
  }

  window.FootballLabCloud = Object.freeze({
    init,
    isConfigured,
    hasToken,
    getToken,
    clearToken,
    setStatus,
    saveRecord,
    updateActual,
    syncAll,
    healthCheck,
  });

  init();
})();