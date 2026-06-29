// ==============================
// timeflow-cloud.js
// 占卜時間流 Google Sheets 同步
// ==============================
// 主要函式複雜度：
// - initialize：O(n)
// - saveCloud：O(n)
// - watchLocal：O(n)，只在本機快照變更時解析
// 空間複雜度：O(n)
//
// 更快替代方案：
// - 每次輸入立即傳送：請求過多。
// - 本版：監看完整快照並防抖批次儲存。
// ==============================

(function initTimeflowCloud() {
  "use strict";

  const STATE_KEY = "evanTarotDivinationTimeflowV4";
  const META_KEY = "evanTarotTimeflowCloudMetaV1";
  const AUTH_EVENT = "evan-google-auth-change";
  const POLL_MS = 1000;
  const SAVE_DELAY_MS = 1400;
  const TIMEOUT_MS = 20000;

  let signedIn = false;
  let ready = false;
  let paused = false;
  let revision = 0;
  let lastRaw = "";
  let lastSavedRaw = "";
  let timer = 0;
  let saving = false;
  let pending = false;

  function apiUrl() {
    return String(window.EVAN_CLOUD_CONFIG?.timeflowApiUrl || "").trim();
  }

  function token() {
    return String(window.EvanGoogleAuth?.getCredential?.() || "").trim();
  }

  function status(text, success) {
    const element = document.getElementById("map-auth-hint");
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("is-signed-in", Boolean(success));
  }

  function readLocal() {
    const raw = String(localStorage.getItem(STATE_KEY) || "");
    if (!raw) return { raw: "", state: null };
    try {
      return { raw, state: JSON.parse(raw) };
    } catch (error) {
      console.error("[timeflow-cloud] 本機資料格式錯誤：", error);
      return { raw, state: null };
    }
  }

  function readMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function writeMeta(nextRevision, raw) {
    revision = Number(nextRevision || 0);
    lastSavedRaw = String(raw || "");
    localStorage.setItem(META_KEY, JSON.stringify({
      revision,
      lastSavedRaw,
      updatedAt: new Date().toISOString(),
    }));
  }

  function meaningful(state) {
    if (!state) return false;
    if (state.readings?.length || state.events?.length) return true;
    if ((state.themes?.length || 0) > 1) return true;
    const theme = state.themes?.[0] || {};
    return Boolean(theme.description || (theme.title && theme.title !== "第一主題流"));
  }

  async function request(action, data = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl(), {
        method: "POST",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          action,
          credential: token(),
          ...data,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!text) throw new Error("後端沒有回傳內容，請確認部署權限為任何人。");
      return JSON.parse(text);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function loadStateIntoPage(state, nextRevision) {
    const raw = JSON.stringify(state);
    writeMeta(nextRevision, raw);
    lastRaw = raw;
    if (String(localStorage.getItem(STATE_KEY) || "") === raw) return false;
    localStorage.setItem(STATE_KEY, raw);
    window.location.reload();
    return true;
  }

  async function saveCloud() {
    if (!signedIn || !ready || paused) return;
    if (saving) {
      pending = true;
      return;
    }
    const local = readLocal();
    if (!local.state || local.raw === lastSavedRaw) return;

    saving = true;
    pending = false;
    status("時間流正在同步到 Google Sheets…", false);
    try {
      const result = await request("timeflowSave", {
        expectedRevision: revision,
        state: local.state,
      });
      if (result?.conflict) {
        paused = true;
        status("雲端已被其他裝置更新；已暫停同步，請重新整理選擇版本。", false);
        return;
      }
      if (!result?.success) throw new Error(result?.error || "儲存失敗");
      writeMeta(result.revision, local.raw);
      lastRaw = local.raw;
      status(`已同步至 Google Sheets｜版本 ${result.revision}`, true);
    } catch (error) {
      console.error("[timeflow-cloud] 儲存失敗：", error);
      status(`Google Sheets 儲存失敗：${error.message}`, false);
    } finally {
      saving = false;
      if (pending) scheduleSave(300);
    }
  }

  function scheduleSave(delay = SAVE_DELAY_MS) {
    window.clearTimeout(timer);
    timer = window.setTimeout(saveCloud, delay);
  }

  function watchLocal() {
    window.setInterval(() => {
      if (!signedIn || !ready || paused) return;
      const raw = String(localStorage.getItem(STATE_KEY) || "");
      if (!raw || raw === lastRaw) return;
      lastRaw = raw;
      scheduleSave();
    }, POLL_MS);
  }

  async function initialize() {
    if (!signedIn || ready || paused) return;
    if (!apiUrl()) {
      status("尚未設定時間流雲端網址，目前只保存在本機。", false);
      return;
    }
    if (!token()) return;

    ready = true;
    status("正在讀取 Google Sheets 時間流…", false);
    try {
      const cloud = await request("timeflowLoad");
      if (!cloud?.success) throw new Error(cloud?.error || "讀取失敗");
      const local = readLocal();
      const meta = readMeta();
      revision = Number(cloud.revision || 0);

      if (!cloud.exists || !cloud.state) {
        const saved = await request("timeflowSave", {
          expectedRevision: 0,
          state: local.state,
        });
        if (!saved?.success) throw new Error(saved?.error || "首次建立失敗");
        writeMeta(saved.revision, local.raw);
        lastRaw = local.raw;
        status(`已建立 Google Sheets 雲端資料｜版本 ${saved.revision}`, true);
        return;
      }

      const cloudRaw = JSON.stringify(cloud.state);
      if (meta?.lastSavedRaw === local.raw && cloudRaw !== local.raw) {
        loadStateIntoPage(cloud.state, cloud.revision);
        return;
      }

      if (local.raw === cloudRaw) {
        writeMeta(cloud.revision, cloudRaw);
        lastRaw = cloudRaw;
        status(`已連接 Google Sheets｜版本 ${cloud.revision}`, true);
        return;
      }

      if (!meaningful(local.state)) {
        loadStateIntoPage(cloud.state, cloud.revision);
        return;
      }

      const useCloud = window.confirm(
        "本機與 Google Sheets 都有時間流資料。\n\n按「確定」載入雲端版本；按「取消」保留本機並暫停同步。"
      );
      if (useCloud) {
        loadStateIntoPage(cloud.state, cloud.revision);
      } else {
        paused = true;
        status("已保留本機版本並暫停同步；請先下載 JSON 備份。", false);
      }
    } catch (error) {
      ready = false;
      console.error("[timeflow-cloud] 初始化失敗：", error);
      status(`Google Sheets 連線失敗：${error.message}`, false);
    }
  }

  function authChanged(authState) {
    signedIn = Boolean(authState?.isSignedIn || window.EvanGoogleAuth?.isSignedIn?.());
    if (!signedIn) {
      ready = false;
      paused = false;
      revision = 0;
      status("訪客僅能瀏覽；登入 Google 帳號後讀取與同步雲端資料。", false);
      return;
    }
    initialize();
  }

  function init() {
    const local = readLocal();
    lastRaw = local.raw;
    lastSavedRaw = String(readMeta()?.lastSavedRaw || "");
    window.addEventListener(AUTH_EVENT, (event) => authChanged(event.detail));
    window.EvanGoogleAuth?.onChange?.(authChanged);
    watchLocal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
