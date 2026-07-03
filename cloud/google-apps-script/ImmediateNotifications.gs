// ==============================
// ImmediateNotifications.gs
// 新預約／新留言 Gmail 近即時通知（不包含世足驗證）
// ==============================
//
// 使用方式：
// 1. 將本檔加入綁定 Google Sheet 的 Apps Script 專案。
// 2. 在「專案設定 → 指令碼屬性」新增：
//      NOTIFY_EMAILS = 你的 Gmail
//    多個收件者以逗號分隔。
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
// - sendImmediateWebsiteNotifications：時間 O(k)，空間 O(k)
//   s = 監看的工作表數（固定 2），t = 既有觸發器數，k = 本次新增列數。
//
// 更快替代方案比較：
// - 直接在各 doPost 寫入後寄信：單筆 O(1)、真正即時，但要同時修改留言與預約兩套接收端。
// - 本試行版：以每分鐘觸發器只讀「上次列號之後」的新列，不重掃完整工作表；
//   最慢約等候一個觸發週期，優點是不動現有表單接收流程，較適合先測試通知需求。
// ==============================

const IMMEDIATE_NOTIFICATION_CONFIG = Object.freeze({
  recipientProperty: "NOTIFY_EMAILS",
  handlerFunction: "sendImmediateWebsiteNotifications",
  triggerMinutes: 1,
  timeZone: "Asia/Taipei",
  websiteBaseUrl: "https://ldream-l.github.io/Evan-tarot-lab/",
  sources: Object.freeze([
    Object.freeze({
      sheetName: "Comments",
      type: "comment",
      minimumColumns: 8,
    }),
    Object.freeze({
      sheetName: "占卜預約",
      type: "booking",
      minimumColumns: 7,
    }),
  ]),
});

/**
 * 建立每分鐘觸發器，並把現有最後一列設為基準線。
 * 不會寄送設定前已存在的舊資料。
 *
 * 時間複雜度：O(s + t)
 * 空間複雜度：O(1)
 */
function setupImmediateNotifications() {
  const recipients = getImmediateNotificationRecipients_();
  if (!recipients) {
    throw new Error("請先在指令碼屬性設定 NOTIFY_EMAILS。");
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");
  }

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

  return {
    success: true,
    recipients,
    message: "新預約與新留言的近即時 Gmail 通知已啟用。",
  };
}

/**
 * 每分鐘執行，只讀取上次成功通知後新增的列。
 *
 * 時間複雜度：O(k)
 * 空間複雜度：O(k)
 */
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

/**
 * 手動寄一封測試信，不改變任何工作表游標。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
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

  return { success: true, recipients };
}

/**
 * 停用本通知模組建立的觸發器。
 *
 * 時間複雜度：O(t)
 * 空間複雜度：O(1)
 */
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

/**
 * 處理單一來源工作表，成功寄出一列後立即更新游標，避免重複寄信。
 *
 * 時間複雜度：O(k)
 * 空間複雜度：O(k)
 */
function processImmediateNotificationSource_(spreadsheet, source, recipients) {
  const sheet = spreadsheet.getSheetByName(source.sheetName);
  if (!sheet) return;

  const properties = PropertiesService.getScriptProperties();
  const cursorKey = getImmediateNotificationCursorKey_(spreadsheet, source);
  const lastRow = sheet.getLastRow();
  let cursor = Math.max(1, Number(properties.getProperty(cursorKey) || 1));

  if (lastRow < cursor) {
    cursor = lastRow;
    properties.setProperty(cursorKey, String(Math.max(1, cursor)));
    return;
  }
  if (lastRow <= cursor) return;

  const rowCount = lastRow - cursor;
  const columnCount = Math.max(source.minimumColumns, sheet.getLastColumn());
  const values = sheet.getRange(cursor + 1, 1, rowCount, columnCount).getDisplayValues();

  values.forEach((row, index) => {
    const rowNumber = cursor + index + 1;
    const notification = buildImmediateNotification_(source, row, rowNumber);

    if (notification) {
      sendImmediateNotificationEmail_(recipients, notification.subject, notification.body);
    }

    properties.setProperty(cursorKey, String(rowNumber));
  });
}

/**
 * 依來源建立信件。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)，m 為本列文字總長度。
 */
function buildImmediateNotification_(source, row, rowNumber) {
  if (source.type === "comment") return buildCommentNotification_(row, rowNumber);
  if (source.type === "booking") return buildBookingNotification_(row, rowNumber);
  return null;
}

function buildCommentNotification_(row, rowNumber) {
  const id = cleanNotificationText_(row[0], 120);
  const createdAt = cleanNotificationText_(row[1], 120);
  const name = cleanNotificationText_(row[2], 80) || "未填暱稱";
  const title = cleanNotificationText_(row[3], 160) || "無標題";
  const text = cleanNotificationText_(row[4], 3000);
  const status = cleanNotificationText_(row[5], 40).toLowerCase();
  const account = cleanNotificationText_(row[7], 320);

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

function buildBookingNotification_(row, rowNumber) {
  const createdAt = cleanNotificationText_(row[0], 120);
  const name = cleanNotificationText_(row[1], 80) || "未填暱稱";
  const contact = cleanNotificationText_(row[2], 500) || "未填聯絡方式";
  const topic = cleanNotificationText_(row[3], 160) || "未分類";
  const mode = cleanNotificationText_(row[4], 160) || "未填形式";
  const message = cleanNotificationText_(row[5], 4000);
  const availability = cleanNotificationText_(row[6], 2000);

  if (!createdAt && !contact && !message) return null;

  return {
    subject: oneLineNotificationText_(`【Evan Tarot 新預約】${name}｜${topic}｜${mode}`, 180),
    body: [
      "網站收到一筆新預約。",
      "",
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
  const spreadsheetId = spreadsheet.getId();
  const sourceKey = `${spreadsheetId}:${source.sheetName}`;
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
