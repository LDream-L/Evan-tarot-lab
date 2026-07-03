// ==============================
// ImmediateNotifications.gs
// 新預約／新留言 Gmail 近即時通知（不包含世足驗證）
// ==============================
//
// 使用方式：
// 1. 將本檔加入綁定 Google Sheet 的 Apps Script 專案。
// 2. 在「專案設定 → 指令碼屬性」新增：
//      NOTIFY_EMAILS = 你的 Gmail
// 3. 手動執行一次 setupImmediateNotifications() 並完成授權。
// 4. 設定後只處理新增加的資料，不補寄既有紀錄。
//
// 支援工作表：
// - Comments：文章新留言
// - 占卜預約：網站新預約
// - 明確不處理世足驗證
//
// 主要函式複雜度：
// - setupImmediateNotifications：時間 O(s + t)，空間 O(1)
// - sendImmediateWebsiteNotifications：時間 O(k + h)，空間 O(k + h)
//   s = 監看工作表數（固定 2），t = 既有觸發器數，k = 新增列數，h = 標題欄數。
//
// 更快替代方案比較：
// - 直接在各 doPost 寫入後寄信：單筆 O(1)、真正即時，但要修改留言與預約兩套接收端。
// - 本試行版：每分鐘只讀上次游標後的新列，並以標題名稱對應欄位；不重掃完整表格，
//   同時相容舊版與新版預約欄位順序。
// ==============================

const IMMEDIATE_NOTIFICATION_CONFIG = Object.freeze({
  recipientProperty: "NOTIFY_EMAILS",
  handlerFunction: "sendImmediateWebsiteNotifications",
  triggerMinutes: 1,
  timeZone: "Asia/Taipei",
  websiteBaseUrl: "https://ldream-l.github.io/Evan-tarot-lab/",
  sources: Object.freeze([
    Object.freeze({ sheetName: "Comments", type: "comment" }),
    Object.freeze({ sheetName: "占卜預約", type: "booking" }),
  ]),
});

function setupImmediateNotifications() {
  const recipients = getImmediateNotificationRecipients_();
  if (!recipients) throw new Error("請先在指令碼屬性設定 NOTIFY_EMAILS。");

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  const properties = PropertiesService.getScriptProperties();
  IMMEDIATE_NOTIFICATION_CONFIG.sources.forEach((source) => {
    const sheet = spreadsheet.getSheetByName(source.sheetName);
    const baseline = sheet ? Math.max(1, sheet.getLastRow()) : 1;
    properties.setProperty(getImmediateNotificationCursorKey_(spreadsheet, source), String(baseline));
  });

  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === IMMEDIATE_NOTIFICATION_CONFIG.handlerFunction) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(IMMEDIATE_NOTIFICATION_CONFIG.handlerFunction)
    .timeBased()
    .everyMinutes(IMMEDIATE_NOTIFICATION_CONFIG.triggerMinutes)
    .create();

  sendImmediateNotificationEmail_(
    recipients,
    "【Evan Tarot】網站通知測試成功",
    [
      "新預約與新留言 Gmail 通知已啟用。",
      "通知方式：每分鐘檢查一次新資料。",
      "世足驗證：不通知。",
      `設定時間：${formatImmediateNotificationDate_(new Date())}`,
    ].join("\n")
  );

  return { success: true, recipients };
}

function sendImmediateWebsiteNotifications() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;

  try {
    const recipients = getImmediateNotificationRecipients_();
    if (!recipients) throw new Error("尚未設定 NOTIFY_EMAILS。");

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");

    IMMEDIATE_NOTIFICATION_CONFIG.sources.forEach((source) => {
      processImmediateNotificationSource_(spreadsheet, source, recipients);
    });
  } finally {
    lock.releaseLock();
  }
}

function testImmediateNotificationEmail() {
  const recipients = getImmediateNotificationRecipients_();
  if (!recipients) throw new Error("請先設定 NOTIFY_EMAILS。");

  sendImmediateNotificationEmail_(
    recipients,
    "【Evan Tarot】Gmail 通知測試",
    [
      "這是一封手動測試信。",
      `寄送時間：${formatImmediateNotificationDate_(new Date())}`,
      `當日剩餘寄信額度：${MailApp.getRemainingDailyQuota()}`,
    ].join("\n")
  );
}

function stopImmediateNotifications() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === IMMEDIATE_NOTIFICATION_CONFIG.handlerFunction) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  return { success: true, removed };
}

// 時間 O(k + h)，空間 O(k + h)。只讀新增列與單一標題列。
function processImmediateNotificationSource_(spreadsheet, source, recipients) {
  const sheet = spreadsheet.getSheetByName(source.sheetName);
  if (!sheet) return;

  const properties = PropertiesService.getScriptProperties();
  const cursorKey = getImmediateNotificationCursorKey_(spreadsheet, source);
  const lastRow = sheet.getLastRow();
  let cursor = Math.max(1, Number(properties.getProperty(cursorKey) || 1));

  if (lastRow < cursor) {
    properties.setProperty(cursorKey, String(Math.max(1, lastRow)));
    return;
  }
  if (lastRow <= cursor) return;

  const columnCount = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const headerMap = buildHeaderIndexMap_(headers);
  const rowCount = lastRow - cursor;
  const values = sheet.getRange(cursor + 1, 1, rowCount, columnCount).getDisplayValues();

  values.forEach((row, index) => {
    const rowNumber = cursor + index + 1;
    const notification = buildImmediateNotification_(source, row, headerMap, rowNumber);
    if (notification) {
      sendImmediateNotificationEmail_(recipients, notification.subject, notification.body);
    }
    properties.setProperty(cursorKey, String(rowNumber));
  });
}

function buildImmediateNotification_(source, row, headerMap, rowNumber) {
  if (source.type === "comment") return buildCommentNotification_(row, headerMap, rowNumber);
  if (source.type === "booking") return buildBookingNotification_(row, headerMap, rowNumber);
  return null;
}

function buildCommentNotification_(row, headerMap, rowNumber) {
  const id = valueByHeader_(row, headerMap, ["id", "留言編號"]);
  const createdAt = valueByHeader_(row, headerMap, ["createdat", "建立時間", "時間戳記"]);
  const name = valueByHeader_(row, headerMap, ["name", "暱稱"]) || "未填暱稱";
  const title = valueByHeader_(row, headerMap, ["title", "標題"]) || "無標題";
  const text = valueByHeader_(row, headerMap, ["text", "留言內容", "內容"]);
  const status = valueByHeader_(row, headerMap, ["status", "狀態"]).toLowerCase();
  const account = valueByHeader_(row, headerMap, ["source", "email", "帳號", "來源"]);

  if (!text || (status && status !== "visible")) return null;

  return {
    subject: oneLineNotificationText_(`【Evan Tarot 新留言】${name}｜${title}`, 180),
    body: [
      "網站收到一則新留言。",
      "",
      `時間：${createdAt || "未記錄"}`,
      `暱稱：${name}`,
      `標題：${title}`,
      `帳號／來源：${account || "未記錄"}`,
      "",
      "留言內容：",
      text,
      "",
      `工作表：Comments 第 ${rowNumber} 列`,
      `紀錄 ID：${id || "未記錄"}`,
      `查看網站：${IMMEDIATE_NOTIFICATION_CONFIG.websiteBaseUrl}articles.html`,
    ].join("\n"),
  };
}

function buildBookingNotification_(row, headerMap, rowNumber) {
  const bookingId = valueByHeader_(row, headerMap, ["預約編號", "bookingid", "id"]);
  const createdAt = valueByHeader_(row, headerMap, ["建立時間", "時間戳記", "createdat"]);
  const name = valueByHeader_(row, headerMap, ["暱稱", "name"]) || "未填暱稱";
  const contact = valueByHeader_(row, headerMap, ["聯絡方式", "contact"]) || "未填聯絡方式";
  const topic = valueByHeader_(row, headerMap, ["占卜主題", "想占卜的主題", "topic"]) || "未分類";
  const mode = valueByHeader_(row, headerMap, ["希望形式", "希望的形式", "mode"]) || "未填形式";
  const availability = valueByHeader_(row, headerMap, ["可配合時間", "availability"]);
  const message = valueByHeader_(row, headerMap, ["想說的話", "訊息", "備註", "message"]);

  if (!bookingId && !createdAt && !contact && !message) return null;

  return {
    subject: oneLineNotificationText_(`【Evan Tarot 新預約】${name}｜${topic}｜${mode}`, 180),
    body: [
      "網站收到一筆新預約。",
      "",
      `預約編號：${bookingId || "未記錄"}`,
      `時間：${createdAt || "未記錄"}`,
      `暱稱：${name}`,
      `聯絡方式：${contact}`,
      `主題：${topic}`,
      `形式：${mode}`,
      `可配合時間：${availability || "未填／文字占卜"}`,
      "",
      "想說的話：",
      message || "未填",
      "",
      `工作表：占卜預約 第 ${rowNumber} 列`,
      `回到預約頁：${IMMEDIATE_NOTIFICATION_CONFIG.websiteBaseUrl}services.html#booking`,
    ].join("\n"),
  };
}

// 時間 O(h)，空間 O(h)。欄位名稱先正規化成查表，之後每個欄位查詢為 O(1)。
function buildHeaderIndexMap_(headers) {
  const map = Object.create(null);
  headers.forEach((header, index) => {
    const key = normalizeHeader_(header);
    if (key && map[key] === undefined) map[key] = index;
  });
  return map;
}

function valueByHeader_(row, headerMap, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const key = normalizeHeader_(aliases[index]);
    const columnIndex = headerMap[key];
    if (columnIndex !== undefined) {
      return cleanNotificationText_(row[columnIndex], 4000);
    }
  }
  return "";
}

function normalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_／/()（）｜|：:－-]+/g, "");
}

function getImmediateNotificationRecipients_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(IMMEDIATE_NOTIFICATION_CONFIG.recipientProperty) || "";

  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .join(",");
}

function getImmediateNotificationCursorKey_(spreadsheet, source) {
  const sourceKey = `${spreadsheet.getId()}:${source.sheetName}`;
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    sourceKey,
    Utilities.Charset.UTF_8
  );
  const hash = digest
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
  return `IMMEDIATE_NOTIFY_CURSOR_${hash}`;
}

function sendImmediateNotificationEmail_(recipients, subject, body) {
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error("Apps Script 今日 Gmail 寄信額度已用完。");
  }

  MailApp.sendEmail({
    to: recipients,
    subject: oneLineNotificationText_(subject, 200),
    body: String(body || ""),
    name: "Evan Tarot 網站通知",
  });
}

function cleanNotificationText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function oneLineNotificationText_(value, maxLength) {
  return cleanNotificationText_(value, maxLength).replace(/\s+/g, " ");
}

function formatImmediateNotificationDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return Utilities.formatDate(
    safeDate,
    IMMEDIATE_NOTIFICATION_CONFIG.timeZone,
    "yyyy-MM-dd HH:mm:ss"
  );
}
