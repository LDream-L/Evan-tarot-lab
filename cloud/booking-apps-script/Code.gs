// ==============================
// Evan Tarot｜獨立占卜預約後端
// 綁定新的私人 Google 試算表使用
// ==============================
//
// 主要函式複雜度：
// - setupBookingSheet：O(c)，c 為固定欄位數
// - doPost：O(1)（固定欄位寫入）
// - normalizeBooking_：O(1)
// - validateBooking_：O(1)
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 暴力法：每次送出前掃描整張表找欄位，資料增加後為 O(n)。
// - 本實作：固定欄位順序 appendRow，不掃描歷史資料。
// ==============================

const BOOKING_CONFIG = Object.freeze({
  sheetName: "占卜預約",
  timeZone: "Asia/Taipei",
  rateLimitCount: 3,
  rateLimitSeconds: 600,
  duplicateSeconds: 300,
  maxNameLength: 40,
  maxContactLength: 200,
  maxMessageLength: 2000,
  maxAvailabilityLength: 1000,
  headers: [
    "預約編號",
    "建立時間",
    "暱稱",
    "聯絡方式",
    "占卜主題",
    "希望形式",
    "可配合時間",
    "想說的話",
    "預約狀態",
    "預定占卜時間",
    "使用牌卡",
    "牌陣／抽牌類型",
    "抽牌紀錄",
    "原定金額",
    "實收金額",
    "付款狀態",
    "後續回饋",
    "驗證結果",
    "回顧與分析",
    "內部備註",
    "來源",
  ],
  topicLabels: Object.freeze({
    relationship: "人際 / 感情",
    career: "工作 / 職涯",
    self: "自我成長 / 人生卡點",
    other: "其他",
  }),
  modeLabels: Object.freeze({
    text: "文字占卜",
    voice: "語音 / 通話",
    flexible: "都可以，看當天狀況",
  }),
});

/**
 * 建立並格式化占卜預約工作表。
 * 時間複雜度：O(c)
 * 空間複雜度：O(c)
 */
function setupBookingSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  spreadsheet.setSpreadsheetTimeZone(BOOKING_CONFIG.timeZone);

  let sheet = spreadsheet.getSheetByName(BOOKING_CONFIG.sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(BOOKING_CONFIG.sheetName);

  const headers = BOOKING_CONFIG.headers;
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setFontWeight("bold")
    .setBackground("#30275f")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");

  sheet.setFrozenRows(1);
  sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("J:J").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("N:O").setNumberFormat("NT$#,##0");

  const widths = [150, 170, 120, 220, 170, 170, 260, 380, 130, 180, 150, 180, 360, 120, 120, 130, 360, 140, 380, 320, 120];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));

  applyBookingValidations_(sheet);

  return jsonOutput_({ success: true, message: "占卜預約工作表已完成設定。" });
}

/**
 * Web App 健康檢查，不提供任何預約資料讀取。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function doGet(e) {
  const action = String(e?.parameter?.action || "health").toLowerCase();
  if (action !== "health") {
    return jsonOutput_({ success: false, error: "不支援的操作。" });
  }

  return jsonOutput_({
    success: true,
    service: "Evan Tarot Booking",
    time: formatTaipeiDate_(new Date()),
  });
}

/**
 * 接收網站預約並寫入私人試算表。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    const payload = parsePayload_(e);

    // 蜜罐欄位：正常使用者永遠不會填。
    if (String(payload.website || "").trim()) {
      return jsonOutput_({ success: true, ignored: true });
    }

    const action = String(payload.action || "createbooking").toLowerCase();
    if (action !== "createbooking") {
      return jsonOutput_({ success: false, error: "不支援的操作。" });
    }

    const booking = normalizeBooking_(payload);
    validateBooking_(booking);
    enforceRateLimit_(booking.clientId || booking.contact);

    const cache = CacheService.getScriptCache();
    const duplicateKey = createDuplicateKey_(booking);
    if (cache.get(duplicateKey)) {
      return jsonOutput_({ success: true, duplicate: true });
    }

    if (!lock.tryLock(10000)) {
      return jsonOutput_({ success: false, error: "系統忙碌中，請稍後再試。" });
    }

    getBookingSheet_().appendRow([
      createBookingId_(booking.createdAt),
      booking.createdAt,
      booking.name,
      booking.contact,
      BOOKING_CONFIG.topicLabels[booking.topic],
      BOOKING_CONFIG.modeLabels[booking.mode],
      booking.availability,
      booking.message,
      "新預約",
      "",
      "",
      "",
      "",
      "",
      "",
      "待付款",
      "",
      "待驗證",
      "",
      "",
      "網站預約",
    ]);

    SpreadsheetApp.flush();
    cache.put(duplicateKey, "1", BOOKING_CONFIG.duplicateSeconds);

    return jsonOutput_({
      success: true,
      createdAt: formatTaipeiDate_(booking.createdAt),
    });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ success: false, error: String(error?.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

/**
 * 固定欄位正規化。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function normalizeBooking_(payload) {
  return {
    createdAt: parseIncomingDate_(payload.createdAt),
    name: sanitizeText_(payload.name, BOOKING_CONFIG.maxNameLength),
    contact: sanitizeText_(payload.contact, BOOKING_CONFIG.maxContactLength),
    topic: sanitizeText_(payload.topic, 32).toLowerCase(),
    mode: sanitizeText_(payload.mode, 32).toLowerCase(),
    availability: sanitizeText_(payload.availability, BOOKING_CONFIG.maxAvailabilityLength),
    message: sanitizeText_(payload.message, BOOKING_CONFIG.maxMessageLength),
    clientId: sanitizeText_(payload.clientId, 128),
  };
}

/**
 * 驗證必填欄位與白名單選項。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function validateBooking_(booking) {
  if (!booking.name) throw new Error("請填寫暱稱。");
  if (!booking.contact) throw new Error("請填寫聯絡方式。");
  if (!Object.prototype.hasOwnProperty.call(BOOKING_CONFIG.topicLabels, booking.topic)) {
    throw new Error("占卜主題不正確。");
  }
  if (!Object.prototype.hasOwnProperty.call(BOOKING_CONFIG.modeLabels, booking.mode)) {
    throw new Error("占卜形式不正確。");
  }
  if (booking.mode !== "text" && !booking.availability) {
    throw new Error("非文字占卜請填寫可配合時間。");
  }
}

/**
 * 短時間送出限流。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function enforceRateLimit_(identity) {
  const normalizedIdentity = String(identity || "anonymous").trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const key = `booking-rate:${hashHex_(normalizedIdentity).slice(0, 24)}`;
  const current = Number(cache.get(key) || 0);

  if (current >= BOOKING_CONFIG.rateLimitCount) {
    throw new Error("短時間送出次數過多，請稍後再試。");
  }

  cache.put(key, String(current + 1), BOOKING_CONFIG.rateLimitSeconds);
}

/**
 * 建立五分鐘內防重複鍵。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function createDuplicateKey_(booking) {
  const raw = [
    booking.name,
    booking.contact,
    booking.topic,
    booking.mode,
    booking.availability,
    booking.message,
  ].join("\n");

  return `booking-duplicate:${hashHex_(raw).slice(0, 32)}`;
}

/**
 * 建立預約編號。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function createBookingId_(date) {
  const timestamp = Utilities.formatDate(date, BOOKING_CONFIG.timeZone, "yyyyMMdd-HHmmss");
  const suffix = Utilities.getUuid().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `T${timestamp}-${suffix}`;
}

/**
 * 取得預約工作表。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function getBookingSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");

  let sheet = spreadsheet.getSheetByName(BOOKING_CONFIG.sheetName);
  if (!sheet) {
    setupBookingSheet();
    sheet = spreadsheet.getSheetByName(BOOKING_CONFIG.sheetName);
  }

  return sheet;
}

/**
 * 管理欄位下拉選單。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function applyBookingValidations_(sheet) {
  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);

  setDropdown_(sheet.getRange(2, 9, rowCount, 1), [
    "新預約", "待聯絡", "待確認時間", "待付款", "已付款", "占卜進行中", "已完成", "待回饋", "已回饋", "已取消", "已退款"
  ]);

  setDropdown_(sheet.getRange(2, 11, rowCount, 1), [
    "偉特塔羅", "雷諾曼", "神諭卡", "混合使用", "其他"
  ]);

  setDropdown_(sheet.getRange(2, 12, rowCount, 1), [
    "單張牌", "三張牌", "時間流", "二選一牌陣", "關係牌陣", "問題牌陣", "自由抽牌", "其他"
  ]);

  setDropdown_(sheet.getRange(2, 16, rowCount, 1), [
    "未報價", "已報價", "待付款", "部分付款", "已付款", "已退款", "免費"
  ]);

  setDropdown_(sheet.getRange(2, 18, rowCount, 1), [
    "待驗證", "明確符合", "部分符合", "明確不符合", "無法驗證", "未提供回饋"
  ]);
}

/**
 * 建立下拉選單。
 * 時間複雜度：O(k)，k 為固定選項數
 * 空間複雜度：O(k)
 */
function setDropdown_(range, values) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
}

/**
 * 解析 JSON 或表單參數。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function parsePayload_(e) {
  const contents = e?.postData?.contents;
  if (contents) {
    try {
      return JSON.parse(contents);
    } catch (error) {
      // 不是 JSON 時改讀表單參數。
    }
  }
  return Object.assign({}, e?.parameter || {});
}

/**
 * 清理文字。
 * 時間複雜度：O(m)，m 為輸入字串長度
 * 空間複雜度：O(m)
 */
function sanitizeText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

/**
 * SHA-256 雜湊。
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function hashHex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );

  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
}

/**
 * 解析送出時間。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function parseIncomingDate_(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * 台北時區格式化。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function formatTaipeiDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return Utilities.formatDate(safeDate, BOOKING_CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * JSON 回應。
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
