// 世足賽事驗證｜Google Sheets 雲端同步具名模組
//
// 正式協定僅保留 Apps Script 已確認支援的 health、createRecord、updateActual；
// 不在前端自行新增 listRecords 或其他未確認 action。
//
// 主要函式複雜度：
// - request／healthCheck／saveRecord／updateActual：前端時間／空間 O(1)，網路成本另計。
// - prepareActualForCloud：時間／空間 O(n)，n = 回顧與事件文字長度。
// - syncAll：時間 O(r)、額外空間 O(1)，r = 本機紀錄數。
// - ensurePanel／updateControls／bind：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 平行補傳可縮短大量紀錄的等待時間，但容易放大 Apps Script 配額與順序競態。
// - 本版採循序補傳，優先確保 createRecord 完成後才更新同筆 actual，並逐筆回報進度。

const CONFIRMED_ACTIONS = Object.freeze(["health", "createRecord", "updateActual"]);

/** 解析 Apps Script JSON 回應：時間／空間 O(n)，n = 回應文字長度。 */
export async function parseCloudResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`雲端回應不是有效 JSON（HTTP ${response.status}）。`);
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `雲端請求失敗（HTTP ${response.status}）。`);
  }
  return payload;
}

/** 將回顧與事件整理成試算表可讀文字：時間／空間 O(n)。 */
export function prepareActualForCloud(actual) {
  const source = actual || {};
  const sections = [];
  if (source.reviewAnalysis) sections.push(`【回顧與分析】\n${source.reviewAnalysis}`);
  if (source.notes) sections.push(`【賽事事件／特殊狀況】\n${source.notes}`);
  return { ...source, notes: sections.join("\n\n") };
}

/**
 * 建立雲端同步控制器；帳號與登入物件使用 provider 動態讀取，
 * 即使全站帳戶元件較晚完成初始化也能接上。
 * 建立時間／空間 O(1)。
 */
export function createFootballCloud({
  core,
  config = {},
  authProvider = () => window.EvanGoogleAuth,
  accountProvider = () => window.EvanSiteAccount,
  fetchImpl = (...args) => window.fetch(...args),
  browserWindow = window,
  documentRef = document,
  autoInit = true,
} = {}) {
  if (!core || typeof core.getRecords !== "function") {
    throw new Error("世足雲端層需要固定的 workflow 核心快照。");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("世足雲端層需要有效的 fetch 實作。");
  }

  const apiUrl = String(config.footballApiUrl || "").trim();
  const clientId = String(config.googleClientId || "").trim();
  let initialized = false;
  let controlsBound = false;
  let accountEventsBound = false;
  let authBound = false;
  let authUnsubscribe = null;

  /** DOM ID 查找：時間／空間 O(1)。 */
  function byId(id) {
    return documentRef.getElementById(id);
  }

  /** 固定樣式注入：時間／空間 O(1)。 */
  function injectCompactStyles() {
    if (byId("football-cloud-compact-style")) return;
    const style = documentRef.createElement("style");
    style.id = "football-cloud-compact-style";
    style.textContent = `
      #football-cloud-panel.football-cloud-compact {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        padding: 16px 18px;
      }
      .football-cloud-compact-copy { min-width: 0; }
      .football-cloud-compact-title {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 5px;
      }
      .football-cloud-compact-title h3,
      .football-cloud-compact-copy p { margin: 0; }
      .football-cloud-compact-copy p { font-size: 0.84rem; line-height: 1.55; }
      #football-cloud-status { padding: 0; border: 0; background: transparent; }
      @media (max-width: 680px) {
        #football-cloud-panel.football-cloud-compact { grid-template-columns: 1fr; }
        #football-sync-all { width: 100%; }
      }
    `;
    documentRef.head.appendChild(style);
  }

  /** 建立固定同步工具列：時間／空間 O(1)。 */
  function ensurePanel() {
    if (byId("football-cloud-panel")) return true;
    const kpis = byId("football-kpis");
    if (!kpis?.parentElement) return false;

    injectCompactStyles();
    const panel = documentRef.createElement("section");
    panel.id = "football-cloud-panel";
    panel.className = "football-panel football-cloud-compact";

    const copy = documentRef.createElement("div");
    copy.className = "football-cloud-compact-copy";
    const title = documentRef.createElement("div");
    title.className = "football-cloud-compact-title";
    const heading = documentRef.createElement("h3");
    heading.textContent = "Google Sheets 同步";
    const badge = documentRef.createElement("span");
    badge.className = "football-version";
    badge.textContent = "獨立資料庫";
    title.append(heading, badge);

    const status = documentRef.createElement("p");
    status.id = "football-cloud-status";
    status.className = "football-message is-warning";
    status.setAttribute("aria-live", "polite");
    status.textContent = "正在檢查雲端連線……";
    copy.append(title, status);

    const button = documentRef.createElement("button");
    button.id = "football-sync-all";
    button.className = "btn ghost";
    button.type = "button";
    button.disabled = true;
    button.textContent = "同步全部本機紀錄";

    panel.append(copy, button);
    kpis.parentElement.insertBefore(panel, kpis);
    return true;
  }

  /** 狀態訊息：時間／空間 O(1)。 */
  function setStatus(message, type = "") {
    const element = byId("football-cloud-status");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  /** 設定完整性：時間／空間 O(1)。 */
  function isConfigured() {
    return Boolean(apiUrl && clientId);
  }

  /** 動態取得登入模組：時間／空間 O(1)。 */
  function getAuth() {
    return typeof authProvider === "function" ? authProvider() : null;
  }

  /** 動態取得帳戶視窗：時間／空間 O(1)。 */
  function getAccount() {
    return typeof accountProvider === "function" ? accountProvider() : null;
  }

  /** 動態讀取目前 Google credential：時間／空間 O(1)。 */
  function getToken() {
    return String(getAuth()?.getCredential?.() || "");
  }

  /** 時間／空間 O(1)。 */
  function hasToken() {
    return Boolean(getToken());
  }

  /** 時間／空間 O(1)。 */
  function openAccount() {
    getAccount()?.open?.();
  }

  /** 時間／空間 O(1)。 */
  function clearToken() {
    getAuth()?.signOut?.();
    updateControls();
  }

  /** 固定控制項更新：時間／空間 O(1)。 */
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

  /** 延後帳戶初始化後再綁定一次：時間／空間 O(1)。 */
  function bindUnifiedAuth() {
    if (authBound) return true;
    const auth = getAuth();
    if (typeof auth?.onChange !== "function") return false;
    const unsubscribe = auth.onChange(updateControls);
    authUnsubscribe = typeof unsubscribe === "function" ? unsubscribe : null;
    authBound = true;
    return true;
  }

  /**
   * Apps Script 不處理瀏覽器 CORS 預檢，使用 text/plain 維持 simple request。
   * 前端時間／空間 O(1)。
   */
  async function request(action, payload = {}) {
    if (!CONFIRMED_ACTIONS.includes(action) || action === "health") {
      throw new Error("不支援的世足雲端 action。");
    }
    if (!isConfigured()) throw new Error("世足雲端 API 尚未設定。");
    const idToken = getToken();
    if (!idToken) {
      openAccount();
      throw new Error("請先從右上角登入資料庫擁有者帳號。");
    }

    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, idToken, ...payload }),
      redirect: "follow",
    });
    return parseCloudResponse(response);
  }

  /** 健康檢查：前端時間／空間 O(1)。 */
  async function healthCheck() {
    if (!isConfigured()) return false;
    try {
      const separator = apiUrl.includes("?") ? "&" : "?";
      const response = await fetchImpl(`${apiUrl}${separator}action=health`, {
        redirect: "follow",
      });
      const payload = await parseCloudResponse(response);
      return payload.service === "football-tarot";
    } catch (error) {
      setStatus(`雲端端點檢查失敗：${error.message}`, "is-error");
      return false;
    }
  }

  /** 單筆新增：前端時間／空間 O(1)。 */
  async function saveRecord(record) {
    if (!record) throw new Error("缺少要同步的賽事紀錄。");
    const payload = await request("createRecord", { record });
    return payload.result;
  }

  /** 單筆賽果更新：前端時間 O(n)、空間 O(n)。 */
  async function updateActual(recordId, actual) {
    if (!recordId || !actual) throw new Error("缺少賽後結果資料。");
    const payload = await request("updateActual", {
      recordId,
      actual: prepareActualForCloud(actual),
    });
    return payload.result;
  }

  /** 循序補傳全部本機紀錄：時間 O(r)、額外空間 O(1)。 */
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

  /** 同步按鈕固定讀取注入的 workflow 核心快照：時間／空間 O(1)。 */
  function bindControls() {
    if (controlsBound) return;
    const button = byId("football-sync-all");
    if (!button) return;
    controlsBound = true;

    button.addEventListener("click", async (event) => {
      const target = event.currentTarget;
      const records = core.getRecords();
      if (!records.length) {
        setStatus("目前沒有本機紀錄需要同步。", "is-warning");
        return;
      }
      if (!hasToken()) {
        openAccount();
        setStatus("請先從右上角登入資料庫擁有者帳號。", "is-warning");
        return;
      }

      target.disabled = true;
      try {
        const result = await syncAll(records, (done, total) => {
          setStatus(`正在同步 ${done}／${total} 筆……`, "is-warning");
        });
        setStatus(
          `同步完成：${result.synced} 筆賽事，其中 ${result.completed} 筆包含賽果與回顧。`,
          "is-success"
        );
      } catch (error) {
        setStatus(`同步失敗：${error.message}`, "is-error");
      } finally {
        target.disabled = !hasToken() || !isConfigured();
      }
    });
  }

  /** 固定兩種全站帳戶事件：時間／空間 O(1)。 */
  function bindAccountEvents() {
    if (accountEventsBound) return;
    accountEventsBound = true;
    browserWindow.addEventListener("evan-site-account-ready", () => {
      bindUnifiedAuth();
      updateControls();
    });
    browserWindow.addEventListener("evan-google-auth-change", updateControls);
  }

  /** 初始化同步面板與動態帳號連結：時間／空間 O(1)，另有一次 health 網路請求。 */
  async function init() {
    if (initialized) return api;
    initialized = true;
    ensurePanel();
    bindControls();
    bindAccountEvents();
    bindUnifiedAuth();
    updateControls();
    const healthy = await healthCheck();
    if (healthy) updateControls();
    return api;
  }

  /** 解除登入訂閱：時間／空間 O(1)。 */
  function destroy() {
    authUnsubscribe?.();
    authUnsubscribe = null;
    authBound = false;
  }

  const api = Object.freeze({
    core,
    protocol: CONFIRMED_ACTIONS,
    init,
    destroy,
    ensurePanel,
    isConfigured,
    hasToken,
    getToken,
    clearToken,
    setStatus,
    updateControls,
    bindUnifiedAuth,
    request,
    saveRecord,
    updateActual,
    syncAll,
    healthCheck,
  });

  if (autoInit) void init();
  return api;
}
