// 世足賽事驗證 v1.2.5｜Google Sheets 雲端同步
// request：O(1) 前端運算／O(1) 空間；syncAll：O(r) 網路請求／O(1) 額外空間。
// 更快替代方案：全站共用同一登入憑證，避免每個功能頁重複初始化 Google Identity。
(function defineFootballLabCloud() {
  "use strict";

  const config = window.EVAN_CLOUD_CONFIG || {};
  const apiUrl = String(config.footballApiUrl || "").trim();
  const clientId = String(config.googleClientId || "").trim();
  let authUnsubscribe = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function injectCompactStyles() {
    if (byId("football-cloud-compact-style")) return;
    const style = document.createElement("style");
    style.id = "football-cloud-compact-style";
    style.textContent = `
      #football-cloud-panel.football-cloud-compact {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        padding: 16px 18px;
      }
      .football-cloud-compact-copy {
        min-width: 0;
      }
      .football-cloud-compact-title {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 5px;
      }
      .football-cloud-compact-title h3,
      .football-cloud-compact-copy p {
        margin: 0;
      }
      .football-cloud-compact-copy p {
        font-size: 0.84rem;
        line-height: 1.55;
      }
      #football-cloud-status {
        padding: 0;
        border: 0;
        background: transparent;
      }
      @media (max-width: 680px) {
        #football-cloud-panel.football-cloud-compact {
          grid-template-columns: 1fr;
        }
        #football-sync-all {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /** 建立精簡同步工具列：O(1) 時間／O(1) 空間。 */
  function ensurePanel() {
    if (byId("football-cloud-panel")) return;
    const kpis = byId("football-kpis");
    if (!kpis || !kpis.parentElement) return;

    injectCompactStyles();
    const panel = document.createElement("section");
    panel.id = "football-cloud-panel";
    panel.className = "football-panel football-cloud-compact";
    panel.innerHTML = `
      <div class="football-cloud-compact-copy">
        <div class="football-cloud-compact-title">
          <h3>Google Sheets 同步</h3>
          <span class="football-version">獨立資料庫</span>
        </div>
        <p id="football-cloud-status" class="football-message is-warning" aria-live="polite">正在檢查雲端連線……</p>
      </div>
      <button id="football-sync-all" class="btn ghost" type="button" disabled>同步全部本機紀錄</button>
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
    return String(window.EvanGoogleAuth?.getCredential?.() || "");
  }

  function hasToken() {
    return Boolean(getToken());
  }

  function clearToken() {
    window.EvanGoogleAuth?.signOut?.();
    updateControls();
  }

  function updateControls() {
    const signedIn = hasToken();
    const syncButton = byId("football-sync-all");
    if (syncButton) syncButton.disabled = !signedIn || !isConfigured();

    if (!isConfigured()) {
      setStatus("尚未設定世足雲端 API。", "is-error");
    } else if (signedIn) {
      setStatus("已使用右上角帳戶登入，可同步到試算表。", "is-success");
    } else {
      setStatus("需要同步時，請從右上角登入資料庫擁有者帳號。", "is-warning");
    }
  }

  function bindUnifiedAuth() {
    if (authUnsubscribe || !window.EvanGoogleAuth?.onChange) return;
    authUnsubscribe = window.EvanGoogleAuth.onChange(updateControls);
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
    if (!idToken) {
      window.EvanSiteAccount?.open?.();
      throw new Error("請先從右上角登入資料庫擁有者帳號。");
    }

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

  /** 將賽後分析整理成試算表可讀文字。時間／空間複雜度 O(n)。 */
  function prepareActualForCloud(actual) {
    const source = actual || {};
    const sections = [];
    if (source.reviewAnalysis) sections.push(`【回顧與分析】\n${source.reviewAnalysis}`);
    if (source.notes) sections.push(`【賽事事件／特殊狀況】\n${source.notes}`);
    return { ...source, notes: sections.join("\n\n") };
  }

  async function updateActual(recordId, actual) {
    if (!recordId || !actual) throw new Error("缺少賽後結果資料。");
    const payload = await request("updateActual", {
      recordId,
      actual: prepareActualForCloud(actual),
    });
    return payload.result;
  }

  /** 循序補傳所有本機紀錄。時間複雜度 O(r)，額外空間 O(1)。 */
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
    byId("football-sync-all")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const records = window.FootballLabCore?.getRecords?.() || [];
      if (!records.length) {
        setStatus("目前沒有本機紀錄需要同步。", "is-warning");
        return;
      }
      if (!hasToken()) {
        window.EvanSiteAccount?.open?.();
        setStatus("請先從右上角登入資料庫擁有者帳號。", "is-warning");
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
    bindUnifiedAuth();
    updateControls();

    window.addEventListener("evan-site-account-ready", () => {
      bindUnifiedAuth();
      updateControls();
    });
    window.addEventListener("evan-google-auth-change", updateControls);

    const healthy = await healthCheck();
    if (healthy) updateControls();
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
