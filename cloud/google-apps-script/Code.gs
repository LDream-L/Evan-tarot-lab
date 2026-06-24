// ==============================
// Evan Tarot Cloud Comments API
// Google 帳號驗證＋文章留言／回覆
// ==============================
//
// 主要函式複雜度：
// - doPost / createComment：O(1)
// - doGet / listComments：O(n)
// - verifyGoogleCredential_：O(1)（單次 Google 驗證請求）
// 空間複雜度：O(n)（讀取留言清單時）
//
// 更快替代方案比較：
// - 暴力法：只在前端判斷是否登入，可被直接呼叫 API 繞過。
// - 本實作：每次寫入都由 Apps Script 驗證 Google ID Token，未驗證者不能寫入。
// ==============================

const COMMENTS_CONFIG = Object.freeze({
  sheetName: "Comments",
  timeZone: "Asia/Taipei",
  defaultLimit: 100,
  maxLimit: 300,
  maxTitleLength: 80,
  maxTextLength: 1000,
  oauthClientIdProperty: "GOOGLE_OAUTH_CLIENT_ID",
  adminEmailsProperty: "ADMIN_EMAILS",
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
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

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
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 260);
  sheet.setColumnWidth(5, 420);
  sheet.setColumnWidth(6, 90);
  sheet.setColumnWidth(7, 220);
  sheet.setColumnWidth(8, 260);
  sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  return jsonOutput_({ success: true, message: "Comments 工作表已完成設定。" });
}

function doGet(e) {
  try {
    const action = String(e?.parameter?.action || "list").toLowerCase();

    if (action === "health") {
      return jsonOutput_({
        success: true,
        service: "Evan Tarot Google Comments",
        authConfigured: Boolean(getOAuthClientId_()),
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

    const googleUser = verifyGoogleCredential_(payload.credential);
    enforceRateLimit_(googleUser.sub);

    const comment = normalizeIncomingComment_(payload, googleUser);
    if (!comment.text) {
      return jsonOutput_({ success: false, error: "留言內容不可空白。" });
    }

    if (!lock.tryLock(10000)) {
      return jsonOutput_({ success: false, error: "系統忙碌中，請稍後重試。" });
    }

    getCommentsSheet_().appendRow([
      comment.id,
      comment.createdAt,
      comment.publicAlias,
      comment.title,
      comment.text,
      "visible",
      googleUser.sub,
      googleUser.email,
    ]);

    SpreadsheetApp.flush();

    return jsonOutput_({
      success: true,
      id: comment.id,
      createdAt: formatTaipeiDate_(comment.createdAt),
      alias: comment.publicAlias,
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
      name: String(row[2] || "Google 訪客"),
      title: String(row[3] || ""),
      text,
    });
  }

  return result;
}

function verifyGoogleCredential_(credential) {
  const idToken = String(credential || "").trim();
  if (!idToken) throw new Error("請先使用 Google 帳號登入。");

  const clientId = getOAuthClientId_();
  if (!clientId) throw new Error("Apps Script 尚未設定 GOOGLE_OAUTH_CLIENT_ID。");

  const cache = CacheService.getScriptCache();
  const cacheKey = `googleUser:${hashHex_(idToken).slice(0, 32)}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { muteHttpExceptions: true }
  );

  if (response.getResponseCode() !== 200) {
    throw new Error("Google 登入憑證無效或已過期，請重新登入。");
  }

  const tokenInfo = JSON.parse(response.getContentText());
  const issuer = String(tokenInfo.iss || "");
  const audience = String(tokenInfo.aud || "");
  const expiresAt = Number(tokenInfo.exp || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (audience !== clientId) throw new Error("Google 登入來源不正確。");
  if (issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") {
    throw new Error("Google 登入簽發者不正確。");
  }
  if (expiresAt <= nowSeconds) throw new Error("Google 登入已過期，請重新登入。");
  if (String(tokenInfo.email_verified) !== "true") {
    throw new Error("Google Email 尚未完成驗證。");
  }

  const user = {
    sub: sanitizeText_(tokenInfo.sub, 128),
    email: sanitizeText_(tokenInfo.email, 254).toLowerCase(),
  };

  if (!user.sub || !user.email) throw new Error("Google 帳號資料不完整。");

  const cacheSeconds = Math.max(60, Math.min(3000, expiresAt - nowSeconds - 30));
  cache.put(cacheKey, JSON.stringify(user), cacheSeconds);
  return user;
}

function enforceRateLimit_(subject) {
  const cache = CacheService.getScriptCache();
  const key = `rate:${hashHex_(subject).slice(0, 24)}`;
  const current = Number(cache.get(key) || 0);

  if (current >= 10) {
    throw new Error("短時間留言次數過多，請稍後再試。");
  }

  cache.put(key, String(current + 1), 60);
}

function normalizeIncomingComment_(payload, googleUser) {
  return {
    id: Utilities.getUuid(),
    createdAt: parseIncomingDate_(payload.createdAt),
    publicAlias: createPublicAlias_(googleUser.sub),
    title: sanitizeText_(payload.title, COMMENTS_CONFIG.maxTitleLength),
    text: sanitizeText_(payload.text || payload.comment, COMMENTS_CONFIG.maxTextLength),
  };
}

function createPublicAlias_(subject) {
  return `Google 訪客 ${hashHex_(subject).slice(0, 4).toUpperCase()}`;
}

function getOAuthClientId_() {
  return String(
    PropertiesService.getScriptProperties().getProperty(COMMENTS_CONFIG.oauthClientIdProperty) || ""
  ).trim();
}

function isAdmin_(email) {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(COMMENTS_CONFIG.adminEmailsProperty) || "";
  const admins = raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return admins.includes(String(email || "").trim().toLowerCase());
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

function sanitizeText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function hashHex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );

  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
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
