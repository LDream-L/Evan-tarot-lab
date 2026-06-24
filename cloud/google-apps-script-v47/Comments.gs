// ==============================
// 留言與 Google 帳號
// ==============================

function listComments_(limit) {
  const sheet = getCommentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const profileMap = getProfileMapBySubject_();
  const values = sheet
    .getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.commentHeaders.length)
    .getValues();

  const result = [];

  for (let index = values.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const row = values[index];
    const status = String(row[5] || "visible").toLowerCase();
    const text = String(row[4] || "").trim();
    if (status !== "visible" || !text) continue;

    const subject = String(row[6] || "").trim();
    const currentNickname = profileMap.get(subject)?.nickname;

    result.push({
      id: String(row[0] || ""),
      createdAt: formatTaipeiDate_(row[1]),
      name: currentNickname || String(row[2] || "Google 訪客"),
      title: String(row[3] || ""),
      text,
    });
  }

  return result;
}

function setNickname_(googleUser, rawNickname) {
  const nickname = normalizeNickname_(rawNickname);
  validateNickname_(nickname);

  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  const now = new Date();
  const userKey = createUserKey_(googleUser.sub);
  let targetRow = 0;

  if (lastRow > 1) {
    const subjects = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (let index = 0; index < subjects.length; index += 1) {
      if (String(subjects[index][0]) === googleUser.sub) {
        targetRow = index + 2;
        break;
      }
    }
  }

  const row = [googleUser.sub, userKey, googleUser.email, nickname, now, "active"];

  if (targetRow) {
    sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { userKey, nickname, updatedAt: formatTaipeiDate_(now) };
}

function getProfileBySubject_(subject) {
  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet
    .getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.profileHeaders.length)
    .getValues();

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    if (String(row[0] || "") !== subject) continue;
    if (String(row[5] || "active").toLowerCase() !== "active") return null;

    return {
      subject: String(row[0] || ""),
      userKey: String(row[1] || createUserKey_(subject)),
      email: String(row[2] || ""),
      nickname: String(row[3] || "").trim(),
      updatedAt: row[4],
    };
  }

  return null;
}

function getPublicProfileByUserKey_(userKey) {
  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet
    .getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.profileHeaders.length)
    .getValues();

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    if (String(row[1] || "") !== userKey) continue;
    if (String(row[5] || "active").toLowerCase() !== "active") return null;

    return {
      userKey,
      nickname: String(row[3] || "").trim(),
      updatedAt: formatTaipeiDate_(row[4]),
    };
  }

  return null;
}

function getProfileMapBySubject_() {
  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  const map = new Map();
  if (lastRow <= 1) return map;

  const values = sheet
    .getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.profileHeaders.length)
    .getValues();

  values.forEach((row) => {
    const subject = String(row[0] || "").trim();
    const nickname = String(row[3] || "").trim();
    const status = String(row[5] || "active").toLowerCase();
    if (subject && nickname && status === "active") map.set(subject, { nickname });
  });

  return map;
}

function normalizeNickname_(value) {
  return sanitizeText_(value, COMMENTS_CONFIG.maxNicknameLength).replace(/\s+/g, " ").trim();
}

function validateNickname_(nickname) {
  const length = Array.from(nickname).length;
  if (length < COMMENTS_CONFIG.minNicknameLength || length > COMMENTS_CONFIG.maxNicknameLength) {
    throw new Error(`暱稱須為 ${COMMENTS_CONFIG.minNicknameLength}～${COMMENTS_CONFIG.maxNicknameLength} 個字。`);
  }

  if (/[<>\[\]{}]/.test(nickname)) {
    throw new Error("暱稱不可包含 < > [ ] { } 等符號。");
  }
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
  if (current >= 10) throw new Error("短時間操作次數過多，請稍後再試。");
  cache.put(key, String(current + 1), 60);
}

function normalizeIncomingComment_(payload) {
  return {
    id: Utilities.getUuid(),
    createdAt: parseIncomingDate_(payload.createdAt),
    title: sanitizeText_(payload.title, COMMENTS_CONFIG.maxTitleLength),
    text: sanitizeText_(payload.text || payload.comment, COMMENTS_CONFIG.maxTextLength),
  };
}

function createUserKey_(subject) {
  return hashHex_(subject).slice(0, 16);
}

function sanitizeUserKey_(value) {
  const userKey = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(userKey) ? userKey : "";
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

  let sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.commentsSheetName);
  if (!sheet) {
    setupCommentsSheet();
    sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.commentsSheetName);
  }
  return sheet;
}

function getProfilesSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");

  let sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.profilesSheetName);
  if (!sheet) {
    setupCommentsSheet();
    sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.profilesSheetName);
  }
  return sheet;
}
