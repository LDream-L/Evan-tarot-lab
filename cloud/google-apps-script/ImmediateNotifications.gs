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

const BOOKING_NOTIFICATION_FIELDS = Object.freeze([
  Object.freeze({ key: "bookingId", label: "預約編號", aliases: ["預約編號", "bookingid", "id"], primary: true }),
  Object.freeze({ key: "createdAt", label: "建立時間", aliases: ["建立時間", "時間戳記", "createdat"], primary: true }),
  Object.freeze({ key: "name", label: "暱稱", aliases: ["暱稱", "name"], primary: true }),
  Object.freeze({ key: "contact", label: "聯絡方式", aliases: ["聯絡方式", "contact"], primary: true }),
  Object.freeze({ key: "topic", label: "占卜主題", aliases: ["占卜主題", "想占卜的主題", "topic"], primary: true }),
  Object.freeze({ key: "mode", label: "希望形式", aliases: ["希望形式", "希望的形式", "mode"], primary: true }),
  Object.freeze({ key: "availability", label: "可配合時間", aliases: ["可配合時間", "availability"], primary: true }),
  Object.freeze({ key: "message", label: "想說的話", aliases: ["想說的話", "訊息", "message"], primary: true }),
  Object.freeze({ key: "bookingStatus", label: "預約狀態", aliases: ["預約狀態"] }),
  Object.freeze({ key: "scheduledAt", label: "預定占卜時間", aliases: ["預定占卜時間"] }),
  Object.freeze({ key: "deck", label: "使用牌卡", aliases: ["使用牌卡"] }),
  Object.freeze({ key: "spread", label: "牌陣／抽牌類型", aliases: ["牌陣／抽牌類型", "牌陣抽牌類型"] }),
  Object.freeze({ key: "drawRecord", label: "抽牌紀錄", aliases: ["抽牌紀錄"] }),
  Object.freeze({ key: "originalAmount", label: "原定金額", aliases: ["原定金額"] }),
  Object.freeze({ key: "receivedAmount", label: "實收金額", aliases: ["實收金額"] }),
  Object.freeze({ key: "paymentStatus", label: "付款狀態", aliases: ["付款狀態"] }),
  Object.freeze({ key: "followupFeedback", label: "後續回饋", aliases: ["後續回饋"] }),
  Object.freeze({ key: "verificationResult", label: "驗證結果", aliases: ["驗證結果"] }),
  Object.freeze({ key: "reviewAnalysis", label: "回顧與分析", aliases: ["回顧與分析"] }),
  Object.freeze({ key: "internalNote", label: "內部備註", aliases: ["內部備註", "備註"] }),
  Object.freeze({ key: "source", label: "來源", aliases: ["來源", "source"] }),
]);

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

// 時間 O(f)，空間 O(f)，f 為固定的預約欄位數（目前 21）。
function buildBookingNotification_(row, headerMap, rowNumber) {
  const booking = Object.create(null);
  BOOKING_NOTIFICATION_FIELDS.forEach((field) => {
    booking[field.key] = valueByHeader_(row, headerMap, field.aliases);
  });

  if (!booking.bookingId && !booking.createdAt && !booking.contact && !booking.message) return null;

  const primaryLines = BOOKING_NOTIFICATION_FIELDS
    .filter((field) => field.primary)
    .map((field) => `${field.label}：${booking[field.key] || "未填"}`);

  const managementLines = BOOKING_NOTIFICATION_FIELDS
    .filter((field) => !field.primary && booking[field.key])
    .map((field) => `${field.label}：${booking[field.key]}`);

  const bodyLines = [
    "網站收到一筆新預約。",
    "",
    ...primaryLines,
  ];

  if (managementLines.length) {
    bodyLines.push("", "後續管理欄位：", ...managementLines);
  }

  bodyLines.push(
    "",
    `工作表：占卜預約 第 ${rowNumber} 列`,
    `回到預約頁：${IMMEDIATE_NOTIFICATION_CONFIG.websiteBaseUrl}services.html#booking`
  );

  return {
    subject: oneLineNotificationText_(
      `【Evan Tarot 新預約】${booking.name || "未填暱稱"}｜${booking.topic || "未分類"}｜${booking.mode || "未填形式"}`,
      180
    ),
    body: bodyLines.join("\n"),
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
