// 塔羅X賽事驗證｜登入到期前草稿保存與重整後恢復
//
// 保存範圍：STEP 1、STEP 2、目前 core draft、已加入但尚未鎖定的運彩單注。
// sessionStorage 僅服務同一分頁的重新整理；成功鎖定或主動放棄後立即清除。
//
// 主要函式複雜度：
// - captureFields / restoreFields：時間 O(f)、空間 O(f)，f 為兩個賽前表單欄位數。
// - saveNow / restoreSnapshot：時間 O(f + p + b)、空間 O(f + p + b)，p<=5、b=草稿投注數。
// - 單一 input/change 只做 O(1) 去抖排程，避免每次按鍵立即序列化整張表單。
//
// 更快替代方案比較：
// - 每次按鍵直接 JSON.stringify 全表單可降低最後一瞬間遺漏，但會把 O(f) 工作放到每個 keypress。
// - 本版以 120ms 去抖保存，並在 beforeunload/pagehide/登入失效事件同步 flush；兼顧輸入效能與資料安全。
// - 只存畫面欄位無法保留網站隨機抽到的牌；因此同步保存 core draft，恢復時覆回原牌組，不重新抽牌。

const STORAGE_KEY = "evanFootballPendingDraftV2";
const SAVE_DELAY_MS = 120;
const FORM_IDS = Object.freeze(["football-match-form", "football-reading-form"]);
const CONTROL_SELECTOR = "input[id], select[id], textarea[id]";
const IGNORED_TYPES = new Set(["button", "submit", "reset", "file"]);

let dirty = false;
let restoring = false;
let saveTimer = 0;
let observer = null;
let pendingSnapshot = readSnapshot();

/** JSON 深拷貝：時間／空間 O(n)，n 為草稿序列化大小。 */
function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

/** 讀取同分頁草稿：時間／空間 O(n)。 */
function readSnapshot() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("[football-draft] 草稿解析失敗：", error);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/** 取得兩個賽前表單：固定 2 個，時間／空間 O(1)。 */
function getForms() {
  return FORM_IDS.map((id) => document.getElementById(id)).filter(Boolean);
}

/** 判斷事件是否屬於賽前草稿：時間／空間 O(1)。 */
function isDraftTarget(target) {
  return Boolean(target?.closest?.("#football-match-form, #football-reading-form"));
}

/** 收集目前存在的賽前欄位：時間／空間 O(f)。 */
function captureFields() {
  const fields = {};
  for (const form of getForms()) {
    for (const control of form.querySelectorAll(CONTROL_SELECTOR)) {
      const type = String(control.type || "").toLowerCase();
      if (!control.id || IGNORED_TYPES.has(type)) continue;
      if (type === "checkbox" || type === "radio") {
        fields[control.id] = { kind: "checked", value: Boolean(control.checked) };
      } else {
        fields[control.id] = { kind: "value", value: String(control.value ?? "") };
      }
    }
  }
  return fields;
}

/** 單欄恢復：時間／空間 O(1)。 */
function restoreControl(control, saved) {
  if (!control || !saved) return false;
  const next = saved.kind === "checked" ? Boolean(saved.value) : String(saved.value ?? "");
  const current = saved.kind === "checked" ? Boolean(control.checked) : String(control.value ?? "");
  if (current === next) return false;
  if (saved.kind === "checked") control.checked = next;
  else control.value = next;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/**
 * 恢復目前已存在的欄位：時間 O(f)、額外空間 O(1)。
 * 動態投注欄位可能因 category/market change 重建，因此允許重跑多次。
 */
function restoreFields(fields = {}) {
  if (!fields || typeof fields !== "object") return 0;
  let restored = 0;
  const priority = ["football-betting-category", "football-betting-market"];
  for (const id of priority) {
    if (fields[id] && restoreControl(document.getElementById(id), fields[id])) restored += 1;
  }
  for (const [id, saved] of Object.entries(fields)) {
    if (priority.includes(id)) continue;
    if (restoreControl(document.getElementById(id), saved)) restored += 1;
  }
  return restored;
}

/** 清除已完成／已放棄草稿：時間／空間 O(1)。 */
function clearSavedDraft() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  dirty = false;
  pendingSnapshot = null;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * 立即保存：時間 O(f + p + b)、空間 O(f + p + b)。
 * force=true 只代表略過去抖、立即 flush；沒有任何未完成內容時仍不建立空草稿。
 */
function saveNow(force = false) {
  if (restoring) return null;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;

  const core = window.FootballLabCore;
  const draft = core?.getDraft?.() || null;
  const bets = window.FootballBettingRuntime?.getDraftBets?.() || [];
  if (!dirty && !draft && !bets.length) return null;

  const snapshot = {
    schema: "evan-football-pending-draft-v2",
    savedAt: new Date().toISOString(),
    dirty: Boolean(dirty),
    draft: cloneJson(draft),
    bets: cloneJson(bets) || [],
    fields: captureFields(),
  };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  pendingSnapshot = snapshot;
  return snapshot;
}

/** 單一去抖計時器：排程時間／空間 O(1)。 */
function scheduleSave() {
  if (restoring) return;
  dirty = true;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveNow(true), SAVE_DELAY_MS);
}

/** 顯示恢復提示：時間／空間 O(1)。 */
function showRestoredMessage() {
  const message = document.getElementById("football-match-message");
  if (!message) return;
  message.textContent = "已恢復登入到期前尚未完成的賽事草稿，可從原位置繼續填寫。";
  message.classList.remove("football-hidden", "is-error");
  message.classList.add("is-success");
}

/**
 * 恢復 core draft 時沿用原 match/cards/drawnAt，不重新抽牌。
 * createDraft 只用來恢復各包裝層（雙牌源）的 phase；隨後把新抽出的暫時牌覆回保存牌。
 * 時間 O(p)、空間 O(p)，p<=5。
 */
function restoreCoreDraft(savedDraft) {
  const core = window.FootballLabCore;
  const render = window.FootballLabRender;
  if (!savedDraft || !core?.createDraft || !render?.renderDraft) return null;
  if (core.getDraft?.()) return core.getDraft();

  const rebuilt = core.createDraft(cloneJson(savedDraft.match));
  rebuilt.match = cloneJson(savedDraft.match);
  rebuilt.cards = cloneJson(savedDraft.cards) || [];
  rebuilt.drawnAt = savedDraft.drawnAt || rebuilt.drawnAt;
  Object.keys(savedDraft).forEach((key) => {
    if (!["match", "cards", "drawnAt"].includes(key)) rebuilt[key] = cloneJson(savedDraft[key]);
  });
  render.renderDraft(rebuilt);
  return rebuilt;
}

/**
 * 重整後恢復：時間 O(f + p + b)、空間 O(p + b)。
 * 先恢復 STEP 1，再建立原 core draft，最後恢復動態牌位／投注欄位。
 */
function restoreSnapshot() {
  const snapshot = pendingSnapshot;
  if (!snapshot) return false;
  restoring = true;
  try {
    restoreFields(snapshot.fields);
    const restoredDraft = snapshot.draft ? restoreCoreDraft(snapshot.draft) : null;
    if (restoredDraft && typeof window.FootballBettingRuntime?.restoreDraftBets === "function") {
      window.FootballBettingRuntime.restoreDraftBets(snapshot.bets || [], restoredDraft);
    }
    restoreFields(snapshot.fields);
    window.queueMicrotask(() => {
      restoring = true;
      try { restoreFields(snapshot.fields); } finally { restoring = false; }
    });
    window.setTimeout(() => {
      restoring = true;
      try { restoreFields(snapshot.fields); } finally { restoring = false; }
    }, 0);
    dirty = Boolean(snapshot.dirty || snapshot.draft || Object.keys(snapshot.fields || {}).length);
    showRestoredMessage();
    return true;
  } catch (error) {
    console.error("[football-draft] 草稿恢復失敗：", error);
    return false;
  } finally {
    restoring = false;
  }
}

/** 動態欄位出現時補填：每批 DOM 變更排程 O(1)，恢復掃描 O(f)。 */
function observeDynamicFields() {
  if (observer || !document.body) return;
  observer = new MutationObserver(() => {
    if (!pendingSnapshot || restoring) return;
    window.queueMicrotask(() => {
      restoring = true;
      try { restoreFields(pendingSnapshot?.fields); } finally { restoring = false; }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** 固定事件綁定：時間／空間 O(1)。 */
function bind() {
  document.addEventListener("input", (event) => {
    if (isDraftTarget(event.target)) scheduleSave();
  }, true);
  document.addEventListener("change", (event) => {
    if (isDraftTarget(event.target)) scheduleSave();
  }, true);
  document.addEventListener("click", (event) => {
    if (!isDraftTarget(event.target)) return;
    window.setTimeout(() => saveNow(true), 0);
  }, true);

  document.getElementById("football-match-form")?.addEventListener("submit", () => {
    window.setTimeout(() => saveNow(true), 0);
  });

  document.getElementById("football-reading-form")?.addEventListener("submit", () => {
    window.setTimeout(() => {
      if (window.FootballLabCore?.getDraft?.()) {
        dirty = true;
        saveNow(true);
      } else {
        clearSavedDraft();
      }
    }, 40);
  });

  document.getElementById("football-abandon-draft")?.addEventListener("click", () => {
    window.setTimeout(() => {
      if (!window.FootballLabCore?.getDraft?.()) clearSavedDraft();
      else saveNow(true);
    }, 40);
  });

  window.addEventListener("evan-google-auth-change", (event) => {
    if (event.detail?.isSignedIn === false && (dirty || window.FootballLabCore?.getDraft?.())) saveNow(true);
  });
  window.addEventListener("beforeunload", () => saveNow(true));
  window.addEventListener("pagehide", () => saveNow(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow(true);
  });
}

bind();
observeDynamicFields();
restoreSnapshot();

export const footballDraftPersistenceRuntime = Object.freeze({
  stage: "draft-recovery-ready",
  storageKey: STORAGE_KEY,
  saveNow,
  restoreSnapshot,
  clear: clearSavedDraft,
  hasSavedDraft: () => Boolean(readSnapshot()),
});

window.FootballDraftPersistenceRuntime = footballDraftPersistenceRuntime;
