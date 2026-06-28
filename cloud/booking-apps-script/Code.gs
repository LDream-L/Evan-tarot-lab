// ==============================
// Evan Tarot｜獨立占卜預約後端 v1.2
// 綁定私人 Google 試算表使用
// ==============================
//
// 主要函式複雜度：
// - setupBookingSheet：O(c)，c 為固定欄位數
// - doPost：O(m)，m 為本次輸入文字總長度
// - normalizeBooking_：O(m)
// - validateBooking_：O(1)
// - applyBookingValidations_：O(k)，k 為固定選項數
//
// 空間複雜度：O(m)
//
// 更快替代方案比較：
// - 暴力法：每次寫入前掃描整張工作表找欄位，資料增加後為 O(n)。
// - 本實作：固定欄位順序 appendRow，不掃描歷史預約資料。
//
// 重要修正：
// - Web App 執行時不能依賴 getActiveSpreadsheet()。
// - setupBookingSheet() 會把試算表 ID 存入 Script Properties。
// - Web App 之後固定使用 openById() 開啟正確試算表。
// ==============================

var BOOKING_CONFIG = {
  sheetName: "占卜預約",
  timeZone: "Asia/Taipei",
  spreadsheetIdProperty: "BOOKING_SPREADSHEET_ID",

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
    "來源"
  ],

  topicLabels: {
    relationship: "人際 / 感情",
    career: "工作 / 職涯",
    self: "自我成長 / 人生卡點",
    other: "其他"
  },

  modeLabels: {
    text: "文字占卜",
    voice: "語音 / 通話",
    flexible: "都可以，看當天狀況"
  }
};

/**
 * 初始化工作表，並保存試算表 ID 給 Web App 使用。
 *
 * 時間複雜度：O(c)
 * 空間複雜度：O(c)
 */
function setupBookingSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("請從目標 Google 試算表的『擴充功能 → Apps Script』開啟後再執行。");
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      BOOKING_CONFIG.spreadsheetIdProperty,
      spreadsheet.getId()
    );

  spreadsheet.setSpreadsheetTimeZone(BOOKING_CONFIG.timeZone);

  var sheet = spreadsheet.getSheetByName(BOOKING_CONFIG.sheetName);

  if (!sheet) {
    var activeSheet = spreadsheet.getActiveSheet();

    if (isBlankSheet_(activeSheet)) {
      activeSheet.setName(BOOKING_CONFIG.sheetName);
      sheet = activeSheet;
    } else {
      sheet = spreadsheet.insertSheet(BOOKING_CONFIG.sheetName);
    }
  }

  ensureSheetSize_(sheet, 1000, BOOKING_CONFIG.headers.length);

  var headerRange = sheet.getRange(
    1,
    1,
    1,
    BOOKING_CONFIG.headers.length
  );

  headerRange.setValues([BOOKING_CONFIG.headers]);
  headerRange
    .setFontWeight("bold")
    .setBackground("#30275f")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 40);
  sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("J:J").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("N:O").setNumberFormat("NT$#,##0");

  var widths = [
    175, 170, 120, 220, 170, 170, 260,
    380, 140, 180, 150, 190, 360, 120,
    120, 140, 360, 140, 380, 320, 120
  ];

  var index;
  for (index = 0; index < widths.length; index += 1) {
    sheet.setColumnWidth(index + 1, widths[index]);
  }

  var dataRowCount = Math.max(sheet.getMaxRows() - 1, 1);

  sheet
    .getRange(2, 1, dataRowCount, BOOKING_CONFIG.headers.length)
    .setVerticalAlignment("top");

  sheet
    .getRange(2, 7, dataRowCount, 14)
    .setWrap(true);

  applyBookingValidations_(sheet);
  SpreadsheetApp.flush();

  return jsonOutput_({
    success: true,
    configured: true,
    message: "占卜預約工作表與 Web App 連線設定已完成。"
  });
}

/**
 * Web App 健康檢查，不提供預約資料內容。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function doGet(e) {
  var parameters = e && e.parameter ? e.parameter : {};
  var action = String(parameters.action || "health").toLowerCase();

  if (action !== "health") {
    return jsonOutput_({
      success: false,
      error: "不支援的操作。"
    });
  }

  return jsonOutput_({
    success: true,
    service: "Evan Tarot Booking",
    configured: Boolean(getStoredSpreadsheetId_()),
    time: formatTaipeiDate_(new Date())
  });
}

/**
 * 接收網站預約並寫入私人試算表。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    var payload = parsePayload_(e);

    if (String(payload.website || "").trim() !== "") {
      return jsonOutput_({
        success: true,
        ignored: true
      });
    }

    var action = String(
      payload.action || "createbooking"
    ).toLowerCase();

    if (action !== "createbooking") {
      return jsonOutput_({
        success: false,
        error: "不支援的操作。"
      });
    }

    var booking = normalizeBooking_(payload);
    validateBooking_(booking);
    enforceRateLimit_(booking.clientId || booking.contact);

    var cache = CacheService.getScriptCache();
    var duplicateKey = createDuplicateKey_(booking);

    if (cache.get(duplicateKey)) {
      return jsonOutput_({
        success: true,
        duplicate: true
      });
    }

    if (!lock.tryLock(10000)) {
      return jsonOutput_({
        success: false,
        error: "系統忙碌中，請稍後再試。"
      });
    }

    var sheet = getBookingSheet_();

    sheet.appendRow([
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
      "未報價",
      "",
      "待驗證",
      "",
      "",
      "網站預約"
    ]);

    SpreadsheetApp.flush();
    cache.put(
      duplicateKey,
      "1",
      BOOKING_CONFIG.duplicateSeconds
    );

    return jsonOutput_({
      success: true,
      createdAt: formatTaipeiDate_(booking.createdAt)
    });
  } catch (error) {
    console.error(error);

    return jsonOutput_({
      success: false,
      error: String(
        error && error.message
          ? error.message
          : error
      )
    });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * 手動測試寫入，不經網站。
 * 成功後會新增一筆「Apps Script 測試」資料。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function testBookingWrite() {
  var now = new Date();
  var sheet = getBookingSheet_();

  sheet.appendRow([
    createBookingId_(now),
    now,
    "後端測試",
    "test",
    "工作 / 職涯",
    "文字占卜",
    "",
    "Apps Script 手動寫入測試",
    "新預約",
    "",
    "",
    "",
    "",
    "",
    "",
    "未報價",
    "",
    "待驗證",
    "",
    "",
    "Apps Script 測試"
  ]);

  SpreadsheetApp.flush();
}

/**
 * 正規化網站送入資料。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function normalizeBooking_(payload) {
  return {
    createdAt: parseIncomingDate_(payload.createdAt),
    name: sanitizeText_(payload.name, BOOKING_CONFIG.maxNameLength),
    contact: sanitizeText_(payload.contact, BOOKING_CONFIG.maxContactLength),
    topic: sanitizeText_(payload.topic, 32).toLowerCase(),
    mode: sanitizeText_(payload.mode, 32).toLowerCase(),
    availability: sanitizeText_(
      payload.availability,
      BOOKING_CONFIG.maxAvailabilityLength
    ),
    message: sanitizeText_(
      payload.message,
      BOOKING_CONFIG.maxMessageLength
    ),
    clientId: sanitizeText_(payload.clientId, 128)
  };
}

/**
 * 驗證必填欄位與白名單選項。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function validateBooking_(booking) {
  if (!booking.name) {
    throw new Error("請填寫暱稱。");
  }

  if (!booking.contact) {
    throw new Error("請填寫聯絡方式。");
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      BOOKING_CONFIG.topicLabels,
      booking.topic
    )
  ) {
    throw new Error("占卜主題不正確。");
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      BOOKING_CONFIG.modeLabels,
      booking.mode
    )
  ) {
    throw new Error("占卜形式不正確。");
  }

  if (booking.mode !== "text" && !booking.availability) {
    throw new Error("非文字占卜請填寫可配合時間。");
  }
}

/**
 * 相同識別資料的短時間限流。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function enforceRateLimit_(identity) {
  var normalizedIdentity = String(identity || "anonymous")
    .trim()
    .toLowerCase();

  var cache = CacheService.getScriptCache();
  var key = "booking-rate:" + hashHex_(normalizedIdentity).slice(0, 24);
  var current = Number(cache.get(key) || 0);

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
 * 建立防止相同內容重複送出的快取鍵。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function createDuplicateKey_(booking) {
  var raw = [
    booking.name,
    booking.contact,
    booking.topic,
    booking.mode,
    booking.availability,
    booking.message
  ].join("\n");

  return "booking-duplicate:" + hashHex_(raw).slice(0, 32);
}

/**
 * 建立預約編號。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function createBookingId_(date) {
  var timestamp = Utilities.formatDate(
    date,
    BOOKING_CONFIG.timeZone,
    "yyyyMMdd-HHmmss"
  );

  var suffix = Utilities
    .getUuid()
    .replace(/-/g, "")
    .slice(0, 4)
    .toUpperCase();

  return "T" + timestamp + "-" + suffix;
}

/**
 * 取得已保存的試算表 ID。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function getStoredSpreadsheetId_() {
  return String(
    PropertiesService
      .getScriptProperties()
      .getProperty(BOOKING_CONFIG.spreadsheetIdProperty) || ""
  ).trim();
}

/**
 * Web App 固定以 ID 開啟目標試算表。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function getBookingSpreadsheet_() {
  var spreadsheetId = getStoredSpreadsheetId_();

  if (!spreadsheetId) {
    throw new Error("尚未設定試算表 ID，請先重新執行 setupBookingSheet。"
    );
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

/**
 * 取得「占卜預約」工作表。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function getBookingSheet_() {
  var spreadsheet = getBookingSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(BOOKING_CONFIG.sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(BOOKING_CONFIG.sheetName);
    ensureSheetSize_(sheet, 1000, BOOKING_CONFIG.headers.length);
    sheet
      .getRange(1, 1, 1, BOOKING_CONFIG.headers.length)
      .setValues([BOOKING_CONFIG.headers]);
    applyBookingValidations_(sheet);
  }

  return sheet;
}

/**
 * 判斷工作表是否空白。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function isBlankSheet_(sheet) {
  if (!sheet) {
    return false;
  }

  if (sheet.getLastRow() === 0) {
    return true;
  }

  return (
    sheet.getLastRow() === 1 &&
    sheet.getLastColumn() === 1 &&
    String(sheet.getRange("A1").getValue() || "").trim() === ""
  );
}

/**
 * 套用管理欄位下拉選單。
 *
 * 時間複雜度：O(k)
 * 空間複雜度：O(k)
 */
function applyBookingValidations_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);

  setDropdown_(sheet.getRange(2, 9, rowCount, 1), [
    "新預約",
    "待聯絡",
    "待確認時間",
    "待付款",
    "已付款",
    "占卜進行中",
    "已完成",
    "待回饋",
    "已回饋",
    "已取消",
    "已退款"
  ]);

  setDropdown_(sheet.getRange(2, 11, rowCount, 1), [
    "偉特塔羅",
    "雷諾曼",
    "神諭卡",
    "混合使用",
    "其他"
  ]);

  setDropdown_(sheet.getRange(2, 12, rowCount, 1), [
    "單張牌",
    "三張牌",
    "時間流",
    "二選一牌陣",
    "關係牌陣",
    "問題牌陣",
    "自由抽牌",
    "其他"
  ]);

  setDropdown_(sheet.getRange(2, 16, rowCount, 1), [
    "未報價",
    "已報價",
    "待付款",
    "部分付款",
    "已付款",
    "已退款",
    "免費"
  ]);

  setDropdown_(sheet.getRange(2, 18, rowCount, 1), [
    "待驗證",
    "明確符合",
    "部分符合",
    "明確不符合",
    "無法驗證",
    "未提供回饋"
  ]);
}

/**
 * 建立下拉選單。
 *
 * 時間複雜度：O(k)
 * 空間複雜度：O(k)
 */
function setDropdown_(range, values) {
  var rule = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();

  range.setDataValidation(rule);
}

/**
 * 確保工作表列數與欄數足夠。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function ensureSheetSize_(sheet, requiredRows, requiredColumns) {
  var currentRows = sheet.getMaxRows();
  var currentColumns = sheet.getMaxColumns();

  if (currentRows < requiredRows) {
    sheet.insertRowsAfter(
      currentRows,
      requiredRows - currentRows
    );
  }

  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(
      currentColumns,
      requiredColumns - currentColumns
    );
  }
}

/**
 * 解析 JSON 或一般表單參數。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function parsePayload_(e) {
  var contents = "";

  if (e && e.postData && e.postData.contents) {
    contents = e.postData.contents;
  }

  if (contents) {
    try {
      return JSON.parse(contents);
    } catch (error) {
      // 不是 JSON 時改讀 e.parameter。
    }
  }

  return Object.assign(
    {},
    e && e.parameter ? e.parameter : {}
  );
}

/**
 * 清理控制字元並限制長度。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function sanitizeText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    )
    .trim()
    .slice(0, maxLength);
}

/**
 * SHA-256 雜湊。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function hashHex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );

  return bytes
    .map(function (byte) {
      return ((byte + 256) % 256)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");
}

/**
 * 解析建立時間。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function parseIncomingDate_(value) {
  var date = value ? new Date(value) : new Date();

  if (isNaN(date.getTime())) {
    return new Date();
  }

  return date;
}

/**
 * 台北時區格式化。
 *
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function formatTaipeiDate_(value) {
  var date = value instanceof Date ? value : new Date(value);

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  return Utilities.formatDate(
    date,
    BOOKING_CONFIG.timeZone,
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  );
}

/**
 * 建立 JSON 回應。
 *
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 */
function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
