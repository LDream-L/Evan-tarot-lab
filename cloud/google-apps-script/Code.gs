// ==============================
// Evan Tarot Cloud Comments API
// Google Apps Script（綁定 Google 試算表）
// ==============================
//
// 主要函式複雜度：
// - doPost / createComment：O(1)（固定欄位追加一列）
// - doGet / listComments：O(n)（n = Comments 工作表資料列數）
// 空間複雜度：O(n)（讀取留言清單時）
//
// 暴力法：前端直接存 localStorage，無法跨裝置同步。
// 優化法（本實作）：前端只呼叫 API；Apps Script 統一驗證、追加與篩選。
// ==============================

const COMMENTS_CONFIG = Object.freeze({
  sheetName: "Comments",
  timeZone: "Asia/Taipei",
  defaultLimit: 100,
  maxLimit: 300,
  maxNameLength: 40,
  maxTitleLength: 80,
  maxTextLength: 1000,
  headers: [
    "id",
    "createdAt",
    "name",
    "title",
    "text",
    "status",
    "clientId",
    "source",
  ],
});

function setupCommentsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");
  }

  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);

  let sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(COMMENTS_CONFIG.sheetName);

  const headerRange = sheet.getRange(1, 1, 1, COMMENTS_CONFIG.headers.length);
  headerRange.setValues([COMMENTS_CONFIG.headers]);
  headerRange
    .setFontWeight("bold")
    .setBackground("#30275f")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");

  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 420);
  sheet.setColumnWidth(6, 90);
  sheet.setColumnWidth(7, 220);
  sheet.setColumnWidth(8, 110);
  sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  return jsonOutput_({ success: true, message: "Comments 工作表已完成設定。" });
}

function doGet(e) {
  try {
    const action = String(e?.parameter?.action || "list").toLowerCase();

    if (action === "health") {
      return jsonOutput_({
        success: true,
        service: "Evan Tarot Cloud Comments",
        time: formatTaipeiDate_(new Date()),
      });
    }

    if (action !== "list") {
      return jsonOutput_({ success: false, error: "不支援的 GET action。" });
    }

    const requestedLimit = Number(e?.parameter?.limit);
    const limit = clampInteger_(
      requestedLimit || COMMENTS_CONFIG.defaultLimit,
      1,
      COMMENTS_CONFIG.maxLimit
    );

    return jsonOutput_({
      success: true,
      comments: listComments_(limit),
    });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ success: false, error: String(error?.message || error) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    const payload = parsePayload_(e);

    if (String(payload.website || "").trim()) {
      return jsonOutput_({ success: true, ignored: true });
    }

    if (String(payload.action || "create").toLowerCase() !== "create") {
      return jsonOutput_({ success: false, error: "不支援的 POST action。" });
    }

    const comment = normalizeIncomingComment_(payload);
    if (!comment.text) {
      return jsonOutput_({ success: false, error: "留言內容不可空白。" });
    }

    if (!lock.tryLock(10000)) {
      return jsonOutput_({ success: false, error: "系統忙碌中，請稍後重試。" });
    }

    getCommentsSheet_().appendRow([
      comment.id,
      comment.createdAt,
      comment.name,
      comment.title,
      comment.text,
      "visible",
      comment.clientId,
      "website",
    ]);

    SpreadsheetApp.flush();

    return jsonOutput_({
      success: true,
      id: comment.id,
      createdAt: formatTaipeiDate_(comment.createdAt),
    });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ success: false, error: String(error?.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function listComments_(limit) {
  const sheet = getCommentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet
    .getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.headers.length)
    .getValues();

  const result = [];

  for (let index = values.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const row = values[index];
    const status = String(row[5] || "visible").toLowerCase();
    const text = String(row[4] || "").trim();

    if (status !== "visible" || !text) continue;

    result.push({
      id: String(row[0] || ""),
      createdAt: formatTaipeiDate_(row[1]),
      name: String(row[2] || ""),
      title: String(row[3] || ""),
      text,
    });
  }

  return result;
}

function getCommentsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");

  let sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.sheetName);
  if (!sheet) {
    setupCommentsSheet();
    sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.sheetName);
  }

  return sheet;
}

function parsePayload_(e) {
  const contents = e?.postData?.contents;
  if (contents) {
    try {
      return JSON.parse(contents);
    } catch (error) {
      // 非 JSON 時改讀 e.parameter。
    }
  }

  return Object.assign({}, e?.parameter || {});
}

function normalizeIncomingComment_(payload) {
  return {
    id: Utilities.getUuid(),
    createdAt: parseIncomingDate_(payload.createdAt),
    name: sanitizeText_(payload.name, COMMENTS_CONFIG.maxNameLength),
    title: sanitizeText_(payload.title, COMMENTS_CONFIG.maxTitleLength),
    text: sanitizeText_(payload.text || payload.comment, COMMENTS_CONFIG.maxTextLength),
    clientId: sanitizeText_(payload.clientId, 100),
  };
}

function sanitizeText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function parseIncomingDate_(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatTaipeiDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return Utilities.formatDate(safeDate, COMMENTS_CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function clampInteger_(value, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
