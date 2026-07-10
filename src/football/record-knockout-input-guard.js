// 世足賽事驗證｜延長賽與 PK 編輯輸入保留控制器
//
// 本層只保存目前編輯工作階段的欄位值；階段顯示、牌組建立與路徑推導
// 全部交由 record-knockout-edit.js 與純模型處理，不在此重複規則。
//
// 主要函式複雜度：
// - capture／restore：時間 O(p)、空間 O(p)，p 為決勝編輯欄位數，固定小於 20。
// - scheduleRestore：時間／空間 O(1)，同一 frame 合併重複排程。
// - beginSession／clear：時間 O(p)、空間 O(1)。
// - bind：時間／空間 O(1)，使用文件事件委派，不建立逐欄監聽器。
//
// 更快替代方案比較：
// - 每次 input 都重建或深複製整筆 prediction 會造成不必要 O(record) 成本。
// - 本版只以 Map 記錄實際表單值，並以雙 requestAnimationFrame 等待轉接層完成必要 DOM 更新。

const TRACKED_SELECTOR = [
  "#football-edit-extra-stage select",
  "#football-edit-extra-stage input",
  "#football-edit-extra-stage textarea",
  "#football-edit-penalty-stage select",
  "#football-edit-penalty-stage input",
  "#football-edit-penalty-stage textarea",
].join(", ");

/**
 * 建立可注入的決勝輸入保留控制器。
 * 建立時間／空間 O(1)。
 */
export function createFootballRecordKnockoutInputGuard({
  core,
  knockoutEditor,
  browserWindow = window,
  documentRef = document,
  autoBind = true,
} = {}) {
  if (
    !core
    || !knockoutEditor
    || typeof core.getRecord !== "function"
    || typeof knockoutEditor.prepareEditor !== "function"
  ) {
    throw new Error("世足決勝輸入保留層需要核心與決勝編輯器。");
  }

  const values = new Map();
  let currentRecordId = "";
  let pending = false;
  let bound = false;

  /** DOM ID 查找：時間／空間 O(1)。 */
  function byId(id) {
    return documentRef.getElementById(id);
  }

  /** 判斷節點是否屬於決勝欄位：時間／空間 O(1)。 */
  function isTrackedTarget(target) {
    return Boolean(target?.closest?.("#football-edit-extra-stage, #football-edit-penalty-stage"));
  }

  /** 保存目前所有具名欄位：時間／空間 O(p)。 */
  function capture() {
    if (!currentRecordId) return 0;
    let count = 0;
    documentRef.querySelectorAll(TRACKED_SELECTOR).forEach((element) => {
      if (!element.id) return;
      values.set(element.id, String(element.value ?? ""));
      count += 1;
    });
    return count;
  }

  /** 回填仍存在的具名欄位：時間 O(p)、額外空間 O(1)。 */
  function restore() {
    if (!currentRecordId || !core.getRecord(currentRecordId)) return 0;
    let count = 0;
    values.forEach((value, id) => {
      const element = byId(id);
      if (!element) return;
      element.value = value;
      count += 1;
    });
    return count;
  }

  /** 清除目前工作階段：時間 O(p)、空間 O(1)。 */
  function clear() {
    values.clear();
    currentRecordId = "";
    pending = false;
  }

  /**
   * 開始單筆編輯工作階段；先清除前一筆，再等待編輯器填入既有資料後擷取。
   * 時間 O(p)、額外空間 O(1)。
   */
  function beginSession(recordId) {
    values.clear();
    currentRecordId = String(recordId || "").trim();
    pending = false;
    if (!currentRecordId) return;
    browserWindow.setTimeout(() => {
      capture();
      scheduleRestore();
    }, 0);
  }

  /**
   * 合併同一 frame 的重複回填；雙 frame 讓決勝編輯器先完成顯示與必要牌組 DOM。
   * 時間／空間 O(1)。
   */
  function scheduleRestore() {
    if (pending || !currentRecordId) return;
    pending = true;
    browserWindow.requestAnimationFrame(() => {
      browserWindow.requestAnimationFrame(() => {
        pending = false;
        restore();
      });
    });
  }

  /** 文件事件委派：時間／空間 O(1)。 */
  function handleFieldEvent(event) {
    if (!isTrackedTarget(event.target)) return;
    capture();
    scheduleRestore();
  }

  /** 編輯按鈕事件：時間／空間 O(1)。 */
  function handleEditClick(event) {
    const button = event.target.closest?.('button[data-action="edit-match"]');
    if (!button) return;
    beginSession(button.dataset.id);
  }

  /** 固定事件綁定：時間／空間 O(1)。 */
  function bind() {
    if (bound) return api;
    bound = true;
    documentRef.addEventListener("input", handleFieldEvent, true);
    documentRef.addEventListener("change", handleFieldEvent, true);
    byId("football-records-body")?.addEventListener("click", handleEditClick);
    return api;
  }

  const api = Object.freeze({
    core,
    knockoutEditor,
    trackedSelector: TRACKED_SELECTOR,
    bind,
    isBound: () => bound,
    beginSession,
    capture,
    restore,
    clear,
    scheduleRestore,
    getCurrentRecordId: () => currentRecordId,
    getSnapshot: () => new Map(values),
  });

  if (autoBind) bind();
  return api;
}
