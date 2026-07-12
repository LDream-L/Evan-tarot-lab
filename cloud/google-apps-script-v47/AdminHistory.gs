// ==============================
// 管理後台修改歷史
// 文章與服務建立、修改、刪除前後快照
// ==============================
//
// 主要函式複雜度：
// - appendAdminHistory_：時間／空間 O(m)，m = JSON 快照長度
// - findAdminEntitySnapshot_：時間 O(n)，空間 O(n)
//
// 更快替代方案比較：
// - 只依賴 Google Sheets 版本紀錄：可回溯整份表，但難以按項目與操作者查詢。
// - 本實作：每次管理寫入額外記錄結構化快照，方便依 entityType / entityId 篩選。
// ==============================

const ADMIN_HISTORY_CONFIG = Object.freeze({
  sheetName: "AdminHistory",
  headers: ["timestamp", "entityType", "action", "entityId", "actorEmail", "requestId", "beforeJson", "afterJson"],
  widths: [170, 110, 100, 180, 260, 260, 560, 560],
  maxSnapshotLength: 45000,
});

function setupAdminHistorySheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");
  const sheet = setupSheet_(
    spreadsheet,
    ADMIN_HISTORY_CONFIG.sheetName,
    ADMIN_HISTORY_CONFIG.headers,
    ADMIN_HISTORY_CONFIG.widths
  );
  sheet.getRange("A:A").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("G:H").setWrap(true).setVerticalAlignment("top");
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), ADMIN_HISTORY_CONFIG.headers.length).createFilter();
  }
  SpreadsheetApp.flush();
  return jsonOutput_({ success: true, sheetName: ADMIN_HISTORY_CONFIG.sheetName });
}

function getAdminHistorySheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");
  let sheet = spreadsheet.getSheetByName(ADMIN_HISTORY_CONFIG.sheetName);
  if (!sheet) {
    setupAdminHistorySheet();
    sheet = spreadsheet.getSheetByName(ADMIN_HISTORY_CONFIG.sheetName);
  }
  const headers = sheet.getRange(1, 1, 1, ADMIN_HISTORY_CONFIG.headers.length).getDisplayValues()[0];
  const mismatch = ADMIN_HISTORY_CONFIG.headers.some((header, index) => String(headers[index] || "").trim() !== header);
  if (mismatch) throw new Error("AdminHistory 工作表欄位不完整。");
  return sheet;
}

function serializeHistorySnapshot_(value) {
  if (value == null) return "";
  const json = JSON.stringify(value);
  if (json.length <= ADMIN_HISTORY_CONFIG.maxSnapshotLength) return json;
  return JSON.stringify({ truncated: true, originalLength: json.length, preview: json.slice(0, ADMIN_HISTORY_CONFIG.maxSnapshotLength - 100) });
}

function appendAdminHistory_(entityType, action, entityId, before, after, actorEmail, requestId) {
  const sheet = getAdminHistorySheet_();
  sheet.appendRow([
    new Date(),
    sanitizeText_(entityType, 40),
    sanitizeText_(action, 40),
    sanitizeText_(entityId, 120),
    sanitizeText_(actorEmail, 320).toLowerCase(),
    sanitizeText_(requestId, 160),
    serializeHistorySnapshot_(before),
    serializeHistorySnapshot_(after),
  ]);
  return true;
}

/** 只供寫入歷史前取得既有快照。 */
function findAdminEntitySnapshot_(entityType, rawId) {
  const id = String(rawId || "").trim().toLowerCase();
  if (!id) return null;
  if (entityType === "article" && typeof listAdminArticles_ === "function") {
    return listAdminArticles_().find((item) => String(item.id || "").toLowerCase() === id) || null;
  }
  if (entityType === "service" && typeof listAdminServices_ === "function") {
    return listAdminServices_().find((item) => String(item.id || "").toLowerCase() === id) || null;
  }
  return null;
}
