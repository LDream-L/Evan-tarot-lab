// ==============================
// timeflow-cloud.js
// 時間樹 Google Sheets 同步 v6
// ==============================
//
// 主要函式時間複雜度／空間複雜度：
// - normalizeStateForCompare / stateHash：O(n log n)，O(n)
// - initialize / saveCloud：O(n log n)，O(n)
// - watchLocal：每次 O(1) 比較字串；只有內容改變時才進行 O(n log n) 雜湊。
//
// 更快替代方案比較：
// - 直接比較整份原始 JSON：速度快，但縮放、平移與選取節點會造成無意義同步。
// - 本版先移除短暫 UI 狀態，再穩定排序欄位建立雜湊；只同步真正的資料與檢視設定。
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

  function cloneState(state) {
    return state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : state;
  }

  /**
   * 現有 Apps Script 仍以 themes／readings／events 驗證輸入；同步時附上相容欄位，
   * 但 topics／timelines／nodes／links 仍是唯一正式資料，樹狀親緣不會被降級。
   * 時間／空間 O(T+L+N+E)。
   */
  function prepareStateForCloud(state) {
    const prepared = cloneState(state);
    if (!prepared || !Array.isArray(prepared.topics)) return prepared;

    const firstTopicId = String(prepared.topics[0]?.id || "");
    const topicByTimelineId = new Map(
      (prepared.timelines || []).map((line) => [String(line.id || ""), String(line.topicId || firstTopicId)])
    );
    const nodeById = new Map((prepared.nodes || []).map((node) => [String(node.id || ""), node]));
    const readingByTimelineId = new Map();
    const relatedReadingByNodeId = new Map();

    (prepared.nodes || []).forEach((node) => {
      if (node.type === "reading" && !readingByTimelineId.has(node.timelineId)) {
        readingByTimelineId.set(node.timelineId, node.id);
      }
    });
    (prepared.links || []).forEach((link) => {
      if (link.deletedAt) return;
      const from = nodeById.get(String(link.fromNodeId || ""));
      const to = nodeById.get(String(link.toNodeId || ""));
      if (from?.type === "reading" && to && to.type !== "reading") relatedReadingByNodeId.set(to.id, from.id);
      if (to?.type === "reading" && from && from.type !== "reading") relatedReadingByNodeId.set(from.id, to.id);
    });

    const legacyNode = (node) => ({
      ...node,
      themeId: topicByTimelineId.get(String(node.timelineId || "")) || firstTopicId,
      date: String(node.dateValue || ""),
    });
    prepared.themes = prepared.topics.map((topic) => ({ ...topic }));
    prepared.readings = (prepared.nodes || [])
      .filter((node) => node.type === "reading")
      .map(legacyNode);
    prepared.events = (prepared.nodes || [])
      .filter((node) => node.type !== "reading")
      .map((node) => ({
        ...legacyNode(node),
        relatedReadingId: String(
          relatedReadingByNodeId.get(node.id)
          || readingByTimelineId.get(node.timelineId)
          || ""
        ),
      }));
    prepared.ui = {
      ...(prepared.ui || {}),
      activeThemeId: String(prepared.ui?.activeTopicId || firstTopicId),
    };
    prepared.cloudCompatibility = { schema: "themes-v1", treeVersion: Number(prepared.version || 0) };
    return prepared;
  }

  /** 移除只供舊後端驗證的鏡像欄位；時間／空間 O(S)。 */
  function cleanStateFromCloud(state) {
    const cleaned = cloneState(state);
    if (!cleaned || !Array.isArray(cleaned.topics)) return cleaned;
    delete cleaned.themes;
    delete cleaned.readings;
    delete cleaned.events;
    delete cleaned.cloudCompatibility;
    if (cleaned.ui && typeof cleaned.ui === "object") delete cleaned.ui.activeThemeId;
    return cleaned;
  }

  function isLegacySchemaError(value) {
    return /至少需要一條主題流/.test(String(value || ""));
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

  /** 時間複雜度 O(n log n)，空間複雜度 O(n)。 */
  function normalizeStateForCompare(state) {
    if (!state || typeof state !== "object") return null;
    const normalized = JSON.parse(JSON.stringify(state));
    const ui = normalized.ui && typeof normalized.ui === "object" ? normalized.ui : {};
    normalized.ui = {
      activeTopicId: String(ui.activeTopicId || ui.activeThemeId || ""),
      activeTimelineId: String(ui.activeTimelineId || ""),
      viewMode: String(ui.viewMode || "single"),
      showPrivate: ui.showPrivate !== false,
      filterStatus: String(ui.filterStatus || "all"),
      filterCategory: String(ui.filterCategory || "all"),
      search: String(ui.search || ""),
    };
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

    if (Number(state.version || 0) >= 5 || Array.isArray(state.topics)) {
      const activeNodes = (state.nodes || []).filter((item) => !item.deletedAt);
      const activeTimelines = (state.timelines || []).filter((item) => !item.deletedAt);
      const activeTopics = (state.topics || []).filter((item) => !item.deletedAt);
      const activeLinks = (state.links || []).filter((item) => !item.deletedAt);
      if (activeNodes.length || activeLinks.length || activeTimelines.length > 1 || activeTopics.length > 1) return true;
      const topic = activeTopics[0] || {};
      const timeline = activeTimelines[0] || {};
      const defaultTopic = !String(topic.title || "").trim() || ["第一主題", "第一分支"].includes(topic.title);
      const defaultTimeline = !String(timeline.title || "").trim() || ["第一案例時間線", "第一分支"].includes(timeline.title);
      const topicDescription = String(topic.description || "").trim();
      const timelineDescription = String(timeline.description || "").trim();
      const defaultDescriptions = (
        !topicDescription || ["可用於人物、關係、專案、研究或事物。", "從全域時空主幹長出的案例或研究主題。"].includes(topicDescription)
      ) && (
        !timelineDescription || ["同一脈絡下的事件、占卜與驗證。", "事件會沿著這條分支發展，也能從任一節點再長出平行分支。"].includes(timelineDescription)
      );
      return !(defaultTopic && defaultTimeline && defaultDescriptions);
    }

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

  function loadStateIntoPage(nextState, nextRevision, nextUserKey) {
    const raw = JSON.stringify(nextState);
    writeMeta(nextRevision, stateHash(nextState), nextUserKey);
    lastRaw = raw;
    if (String(localStorage.getItem(STATE_KEY) || "") === raw) return false;
    localStorage.setItem(STATE_KEY, raw);
    window.location.reload();
    return true;
  }

  async function saveSnapshot(local, expectedRevision) {
    const result = await request("timeflowSave", {
      expectedRevision,
      state: prepareStateForCloud(local.state),
    });
    if (result?.conflict || result?.code === "REVISION_CONFLICT") return result;
    if (!result?.success) throw new Error(result?.error || "儲存失敗");
    writeMeta(result.revision, local.hash, result.user?.userKey || userKey);
    lastRaw = local.raw;
    return result;
  }

  /** 已存在的不相容雲端資料只在使用者確認後修復；最多重試一次版本衝突。 */
  async function repairLegacyCloud(local, payload = {}) {
    if (!local.state) return false;
    const branchCount = (local.state.timelines || []).filter((item) => !item.deletedAt).length;
    const nodeCount = (local.state.nodes || []).filter((item) => !item.deletedAt).length;
    const confirmed = window.confirm(
      `Google Sheets 仍是舊版時間流格式，無法辨識目前的時間樹。\n\n` +
      `是否用此瀏覽器內的 ${branchCount} 條分支、${nodeCount} 個事件修復雲端資料？\n` +
      `按「確定」會寫入目前時間樹；按「取消」會保留本機並暫停同步。`
    );
    if (!confirmed) {
      paused = true;
      status("已保留本機時間樹並暫停同步；Google Sheets 尚未修復。", false);
      return true;
    }

    let expectedRevision = Number(payload.revision || payload.currentRevision || revision || 0);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await saveSnapshot(local, expectedRevision);
      if (!result?.conflict) {
        status(`已修復並同步 Google Sheets｜版本 ${result.revision}`, true);
        return true;
      }
      const nextRevision = Number(result.revision || result.currentRevision || 0);
      if (!nextRevision || nextRevision === expectedRevision) break;
      expectedRevision = nextRevision;
    }
    throw new Error("雲端版本同時被其他裝置更新，請重新整理後再修復。");
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
    status("時間樹正在同步到 Google Sheets…", false);
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
        "本機與 Google Sheets 都有時間樹資料。\n\n按「確定」載入雲端版本；按「取消」保留本機並暫停同步。"
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
    status("正在讀取 Google Sheets 時間樹…", false);
    try {
      const local = readLocal();
      const meta = readMeta();

      const cloud = await request("timeflowLoad");
      if (!cloud?.success) {
        if (isLegacySchemaError(cloud?.error) && await repairLegacyCloud(local, cloud)) return;
        throw new Error(cloud?.error || "讀取失敗");
      }

      const cloudState = cleanStateFromCloud(cloud.state);
      const cloudHash = stateHash(cloudState);
      const cloudUserKey = String(cloud.user?.userKey || "");
      const sameUserMeta = Boolean(meta?.userKey && cloudUserKey && meta.userKey === cloudUserKey);
      revision = Number(cloud.revision || 0);
      userKey = cloudUserKey;

      if (!cloud.exists || !cloudState) {
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

      if (sameUserMeta && Number(meta.revision || 0) === Number(cloud.revision || 0)) {
        if (!local.state) {
          loadStateIntoPage(cloudState, cloud.revision, cloudUserKey);
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

      if (
        sameUserMeta &&
        local.hash === String(meta.lastSavedHash || "") &&
        Number(meta.revision || 0) !== Number(cloud.revision || 0)
      ) {
        loadStateIntoPage(cloudState, cloud.revision, cloudUserKey);
        return;
      }

      if (!meaningful(local.state)) {
        loadStateIntoPage(cloudState, cloud.revision, cloudUserKey);
        return;
      }

      if (askWhichVersion()) {
        loadStateIntoPage(cloudState, cloud.revision, cloudUserKey);
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
      status("訪客僅能瀏覽一般分支；登入 Google 帳號後讀取僅自己可見的時間樹。", false);
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

  window.EvanTimeflowCloud = Object.freeze({
    prepareStateForCloud,
    cleanStateFromCloud,
    isLegacySchemaError,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
