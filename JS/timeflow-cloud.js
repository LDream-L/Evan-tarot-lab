// ==============================
// timeflow-cloud.js
// 占卜時間流 Google Sheets 同步
// ==============================
//
// 主要函式複雜度：
// - initialize：O(n log n)
// - saveCloud：O(n log n)
// - watchLocal：O(n)，只在本機快照變更時解析
// 空間複雜度：O(n)
//
// 更快替代方案比較：
// - 直接比較原始 JSON 字串：快，但欄位順序、null / 空字串與自動置中都會造成假衝突。
// - 本版：先正規化再建立穩定雜湊，並以 revision 判斷雲端是否真的變更。
// ==============================

(function initTimeflowCloud() {
  "use strict";

  const STATE_KEY = "evanTarotDivinationTimeflowV4";
  const META_KEY = "evanTarotTimeflowCloudMetaV2";
  const LEGACY_META_KEY = "evanTarotTimeflowCloudMetaV1";
  const AUTH_EVENT = "evan-google-auth-change";
  const POLL_MS = 1000;
  const SAVE_DELAY_MS = 1400;
  const TIMEOUT_MS = 20000;

  let signedIn = false;
  let ready = false;
  let paused = false;
  let revision = 0;
  let userKey = "";
  let lastRaw = "";
  let lastSavedHash = "";
  let timer = 0;
  let saving = false;
  let pending = false;
  let conflictPromptOpen = false;

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

  function stableNormalize(value) {
    if (Array.isArray(value)) return value.map(stableNormalize);
    if (!value || typeof value !== "object") return value;

    const normalized = {};
    Object.keys(value).sort().forEach((key) => {
      normalized[key] = stableNormalize(value[key]);
    });
    return normalized;
  }

  function normalizeStateForCompare(state) {
    if (!state || typeof state !== "object") return null;
    const normalized = JSON.parse(JSON.stringify(state));
    normalized.ui = normalized.ui && typeof normalized.ui === "object"
      ? normalized.ui
      : {};
    normalized.ui.selectedId = String(normalized.ui.selectedId || "");
    return stableNormalize(normalized);
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function stateHash(state) {
    const normalized = normalizeStateForCompare(state);
    return normalized ? hashText(JSON.stringify(normalized)) : "";
  }

  function readLocal() {
    const raw = String(localStorage.getItem(STATE_KEY) || "");
    if (!raw) return { raw: "", state: null, hash: "" };
    try {
      const state = JSON.parse(raw);
      return { raw, state, hash: stateHash(state) };
    } catch (error) {
      console.error("[timeflow-cloud] 本機資料格式錯誤：", error);
      return { raw, state: null, hash: "" };
    }
  }

  function readMeta() {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      localStorage.removeItem(META_KEY);
      return null;
    }
  }

  function writeMeta(nextRevision, nextHash, nextUserKey) {
    revision = Number(nextRevision || 0);
    lastSavedHash = String(nextHash || "");
    userKey = String(nextUserKey || userKey || "");
    localStorage.setItem(META_KEY, JSON.stringify({
      revision,
      userKey,
      lastSavedHash,
      updatedAt: new Date().toISOString(),
    }));
    localStorage.removeItem(LEGACY_META_KEY);
  }

  function meaningful(state) {
    if (!state) return false;
    if (state.readings?.length || state.events?.length) return true;
    if ((state.themes?.length || 0) > 1) return true;

    const theme = state.themes?.[0] || {};
    const title = String(theme.title || "").trim();
    const description = String(theme.description || "").trim();
    const isDefaultTitle = !title || title === "第一主題流";
    const isDefaultDescription = !description || description === "第一條驗證主線";
    return !(isDefaultTitle && isDefaultDescription);
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

  function loadStateIntoPage(state, nextRevision, nextUserKey) {
    const raw = JSON.stringify(state);
    writeMeta(nextRevision, stateHash(state), nextUserKey);
    lastRaw = raw;
    if (String(localStorage.getItem(STATE_KEY) || "") === raw) return false;
    localStorage.setItem(STATE_KEY, raw);
    window.location.reload();
    return true;
  }

  async function saveSnapshot(local, expectedRevision) {
    const result = await request("timeflowSave", {
      expectedRevision,
      state: local.state,
    });
    if (result?.conflict || result?.code === "REVISION_CONFLICT") return result;
    if (!result?.success) throw new Error(result?.error || "儲存失敗");
    writeMeta(result.revision, local.hash, result.user?.userKey || userKey);
    lastRaw = local.raw;
    return result;
  }

  async function saveCloud() {
    if (!signedIn || !ready || paused) return;
    if (saving) {
      pending = true;
      return;
    }

    const local = readLocal();
    if (!local.state || local.hash === lastSavedHash) return;

    saving = true;
    pending = false;
    status("時間流正在同步到 Google Sheets…", false);
    try {
      const result = await saveSnapshot(local, revision);
      if (result?.conflict) {
        paused = true;
        status("雲端已被其他裝置更新；已暫停同步，請重新整理後選擇版本。", false);
        return;
      }
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

  function askWhichVersion() {
    if (conflictPromptOpen) return false;
    conflictPromptOpen = true;
    try {
      return window.confirm(
        "本機與 Google Sheets 都有時間流資料。\n\n按「確定」載入雲端版本；按「取消」保留本機並暫停同步。"
      );
    } finally {
      conflictPromptOpen = false;
    }
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
      const cloudHash = stateHash(cloud.state);
      const cloudUserKey = String(cloud.user?.userKey || "");
      const sameUserMeta = Boolean(
        meta?.userKey && cloudUserKey && meta.userKey === cloudUserKey
      );
      revision = Number(cloud.revision || 0);
      userKey = cloudUserKey;

      if (!cloud.exists || !cloud.state) {
        if (!local.state) throw new Error("找不到可建立雲端版本的本機資料。");
        const saved = await saveSnapshot(local, 0);
        if (saved?.conflict) throw new Error("首次建立時發生版本衝突，請重新整理。");
        status(`已建立 Google Sheets 雲端資料｜版本 ${saved.revision}`, true);
        return;
      }

      if (local.hash === cloudHash) {
        writeMeta(cloud.revision, cloudHash, cloudUserKey);
        lastRaw = local.raw;
        status(`已連接 Google Sheets｜版本 ${cloud.revision}`, true);
        return;
      }

      // 同一使用者且雲端 revision 沒變：差異一定來自本機尚未同步的變更，
      // 包含頁面自動置中造成的 zoom / pan 更新；直接上傳，不再誤判成雙版本衝突。
      if (sameUserMeta && Number(meta.revision || 0) === Number(cloud.revision || 0)) {
        if (!local.state) {
          loadStateIntoPage(cloud.state, cloud.revision, cloudUserKey);
          return;
        }
        const saved = await saveSnapshot(local, cloud.revision);
        if (saved?.conflict) {
          ready = false;
          window.setTimeout(initialize, 500);
          return;
        }
        status(`本機變更已同步｜版本 ${saved.revision}`, true);
        return;
      }

      // 雲端 revision 已更新，而本機仍停在上次同步內容：直接載入新雲端版本。
      if (
        sameUserMeta &&
        local.hash === String(meta.lastSavedHash || "") &&
        Number(meta.revision || 0) !== Number(cloud.revision || 0)
      ) {
        loadStateIntoPage(cloud.state, cloud.revision, cloudUserKey);
        return;
      }

      if (!meaningful(local.state)) {
        loadStateIntoPage(cloud.state, cloud.revision, cloudUserKey);
        return;
      }

      if (askWhichVersion()) {
        loadStateIntoPage(cloud.state, cloud.revision, cloudUserKey);
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
      userKey = "";
      status("訪客僅能瀏覽；登入 Google 帳號後讀取與同步雲端資料。", false);
      return;
    }
    initialize();
  }

  function init() {
    const local = readLocal();
    const meta = readMeta();
    lastRaw = local.raw;
    lastSavedHash = String(meta?.lastSavedHash || "");
    revision = Number(meta?.revision || 0);
    userKey = String(meta?.userKey || "");
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
