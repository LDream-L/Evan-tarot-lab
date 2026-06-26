// ==============================
// Booking.gs
// 公開預約表單 ->「占卜預約」工作表
// ==============================
//
// 使用方式：
// 1. 將本檔加入目前綁定試算表的 Apps Script 專案。
// 2. 在 Code.gs 的 doPost(e) 解析 action 後、Google 登入驗證前加入：
//      if (action === "createbooking") {
//        return handlePublicBookingPost_(payload, lock);
//      }
// 3. 執行一次 setupBookingSheet()。
// 4. 更新既有 Web App 部署。
//
// 主要函式複雜度：
// - handlePublicBookingPost_：O(1)（固定欄位寫入）
// - normalizeBooking_：O(1)
// - getBookingSheet_：O(1)（單次工作表查找）
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 暴力法：每次寫入前掃描整張工作表找欄位，資料增加後成本為 O(n)。
// - 本實作：固定欄位順序直接 appendRow，單筆寫入不掃描歷史資料。
// ==============================

const BOOKING_CONFIG = Object.freeze({
  sheetName: "占卜預約",
  maxNameLength: 40,
  maxContactLength: 200,
  maxMessageLength: 2000,
  maxAvailabilityLength: 1000,
  rateLimitCount: 3,
  rateLimitSeconds: 600,
  headers: [
    "時間戳記",
    "暱稱",
    "聯絡方式",
    "想占卜的主題",
    "希望的形式",
    "想說的話",
    "可配合時間",
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
 * 建立或補齊「占卜預約」工作表。
 * 既有 A～F 資料不會被清除，只會設定標題並補上 G 欄。
 *
 * 時間複雜度：O(c)，c 為固定欄位數。
 * 空間複雜度：O(c)
 */
function setupBookingSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);

  let sheet = spreadsheet.getSheetByName(BOOKING_CONFIG.sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(BOOKING_CONFIG.sheetName);

  const headers = BOOKING_CONFIG.headers;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#30275f")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");

  const widths = [170, 140, 240, 190, 190, 420, 300];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.setFrozenRows(1);
  sheet.getRange("A:A").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  return jsonOutput_({
    success: true,
    message: "占卜預約工作表已完成設定。",
  });
}

/**
 * 處理不要求 Google 登入的公開預約。
 * 預約資料只寫入試算表，不提供對外讀取 API。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {Object} payload
 * @param {GoogleAppsScript.Lock.Lock} lock
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handlePublicBookingPost_(payload, lock) {
  const booking = normalizeBooking_(payload);
  validateBooking_(booking);
  enforceBookingRateLimit_(booking.clientId || booking.contact);

  const duplicateKey = createBookingDuplicateKey_(booking);
  const cache = CacheService.getScriptCache();
  if (cache.get(duplicateKey)) {
    return jsonOutput_({ success: true, duplicate: true });
  }

  if (!lock.tryLock(10000)) {
    return jsonOutput_({ success: false, error: "系統忙碌中，請稍後重試。" });
  }

  getBookingSheet_().appendRow([
    booking.createdAt,
    booking.name,
    booking.contact,
    BOOKING_CONFIG.topicLabels[booking.topic],
    BOOKING_CONFIG.modeLabels[booking.mode],
    booking.message,
    booking.availability,
  ]);

  SpreadsheetApp.flush();
  cache.put(duplicateKey, "1", 300);

  return jsonOutput_({
    success: true,
    createdAt: formatTaipeiDate_(booking.createdAt),
  });
}

/**
 * 清理固定欄位。
 *
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
    message: sanitizeText_(payload.message, BOOKING_CONFIG.maxMessageLength),
    availability: sanitizeText_(payload.availability, BOOKING_CONFIG.maxAvailabilityLength),
    clientId: sanitizeText_(payload.clientId, 128),
  };
}

/**
 * 驗證必填欄位與白名單選項。
 *
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
 * 公開表單的基本限流。
 * clientId 可被偽造，因此這是降低誤觸與一般濫用，不是完整身分驗證。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function enforceBookingRateLimit_(identity) {
  const normalizedIdentity = String(identity || "anonymous").trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const key = `booking-rate:${hashHex_(normalizedIdentity).slice(0, 24)}`;
  const current = Number(cache.get(key) || 0);

  if (current >= BOOKING_CONFIG.rateLimitCount) {
    throw new Error("短時間送出次數過多，請稍後再試。");
  }

  cache.put(
    key,
    String(current + 1),
    BOOKING_CONFIG.rateLimitSeconds
  );
}

/**
 * 五分鐘內相同內容不重複寫入。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function createBookingDuplicateKey_(booking) {
  const raw = [
    booking.name,
    booking.contact,
    booking.topic,
    booking.mode,
    booking.message,
    booking.availability,
  ].join("\n");

  return `booking-duplicate:${hashHex_(raw).slice(0, 32)}`;
}

/**
 * 取得預約工作表；不存在時自動建立。
 *
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
