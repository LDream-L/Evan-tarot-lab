// ==============================
// Google 身分驗證、管理員權限、公開暱稱與留言資料層
// ==============================
//
// 主要函式複雜度：
// - verifyGoogleCredential_：快取命中 O(m)，未命中 O(m)＋一次 Google tokeninfo 請求
// - getProfileBySubject_ / getPublicProfileByUserKey_ / setNickname_：時間 O(p)，空間 O(p)
// - listComments_：時間 O(n + p)，空間 O(p + k)，k = 回傳留言數
// - isAdmin_ / enforceRateLimit_：時間與空間 O(1)
//
// 更快替代方案比較：
// - 每次請求都重新向 Google 驗證：實作簡單，但延遲與配額成本較高。
// - 本實作：只快取已驗證後的最小使用者資料，不保存原始 ID Token；快取失效時再向 Google 驗證。
// - 每筆留言逐次查 Profiles：會退化成 O(n × p)。
// - 本實作：先建立 subject → nickname 查表，再單次反向掃描留言。
// ==============================

const AUTH_PROFILE_CONFIG = Object.freeze({
  tokenInfoEndpoint: "https://oauth2.googleapis.com/tokeninfo",
  acceptedIssuers: ["accounts.google.com", "https://accounts.google.com"],
  maxCredentialLength: 6000,
  maxEmailLength: 320,
  maxDisplayNameLength: 120,
  maxNicknameLength: 20,
  minNicknameLength: 2,
  verifiedTokenCacheSeconds: 300,
  requestRateLimitPerMinute: 60,
  activeProfileStatus: "active",
});

/** 讀取後端允許的 Google OAuth Client ID。時間／空間 O(1)。 */
function getOAuthClientId_() {
  return String(
    PropertiesService.getScriptProperties().getProperty(COMMENTS_CONFIG.oauthClientIdProperty) || ""
  ).trim();
}

/** 讀取管理員 Email allowlist。時間 O(a)，空間 O(a)，a = 管理員數量。 */
function getAdminEmails_() {
  const raw = String(
    PropertiesService.getScriptProperties().getProperty(COMMENTS_CONFIG.adminEmailsProperty) || ""
  );
  return raw
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** 管理員判斷。一般情況 a 很小，視為 O(1)。 */
function isAdmin_(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return Boolean(normalized && getAdminEmails_().includes(normalized));
}

/** Google ID Token 驗證。時間 O(m)，空間 O(m)，m = Token 長度。 */
function verifyGoogleCredential_(rawCredential) {
  const credential = String(rawCredential || "").trim();
  if (!credential) throw new Error("請先登入 Google 帳號。");
  if (credential.length > AUTH_PROFILE_CONFIG.maxCredentialLength) {
    throw new Error("Google 登入資料長度異常，請重新登入。");
  }

  const clientId = getOAuthClientId_();
  if (!clientId) throw new Error("後端尚未設定 GOOGLE_OAUTH_CLIENT_ID。");

  const cache = CacheService.getScriptCache();
  const cacheKey = `google-id-token:${hashHex_(credential).slice(0, 40)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const user = JSON.parse(cached);
      if (user?.sub && user?.email) return user;
    } catch (error) {
      cache.remove(cacheKey);
    }
  }

  let response;
  try {
    response = UrlFetchApp.fetch(
      `${AUTH_PROFILE_CONFIG.tokenInfoEndpoint}?id_token=${encodeURIComponent(credential)}`,
      { method: "get", muteHttpExceptions: true, followRedirects: true }
    );
  } catch (error) {
    throw new Error("目前無法連線到 Google 驗證服務，請稍後再試。");
  }

  if (response.getResponseCode() !== 200) {
    throw new Error("Google 登入已失效，請登出後重新登入。");
  }

  let payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error("Google 驗證服務回傳格式異常。");
  }

  const audience = String(payload?.aud || "").trim();
  const issuer = String(payload?.iss || "").trim();
  const expiresAt = Number(payload?.exp || 0) * 1000;
  const emailVerified = payload?.email_verified === true || String(payload?.email_verified) === "true";
  const subject = sanitizeText_(payload?.sub, 255);
  const email = sanitizeText_(payload?.email, AUTH_PROFILE_CONFIG.maxEmailLength).toLowerCase();

  if (audience !== clientId) throw new Error("Google 登入來源與本站 OAuth 設定不一致。");
  if (!AUTH_PROFILE_CONFIG.acceptedIssuers.includes(issuer)) throw new Error("Google 登入簽發來源不正確。");
  if (!expiresAt || expiresAt <= Date.now()) throw new Error("Google 登入已過期，請重新登入。");
  if (!emailVerified) throw new Error("此 Google 帳號的 Email 尚未完成驗證。");
  if (!subject || !email) throw new Error("Google 登入資料缺少必要欄位。");

  const user = {
    sub: subject,
    email,
    name: sanitizeText_(payload?.name, AUTH_PROFILE_CONFIG.maxDisplayNameLength),
  };
  const remainingSeconds = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  cache.put(
    cacheKey,
    JSON.stringify(user),
    Math.min(AUTH_PROFILE_CONFIG.verifiedTokenCacheSeconds, remainingSeconds)
  );
  return user;
}

/** 單一 Google subject 每分鐘請求限制。時間／空間 O(1)。 */
function enforceRateLimit_(subject) {
  const safeSubject = sanitizeText_(subject, 255);
  if (!safeSubject) throw new Error("Google 帳號識別資料不完整。");

  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `auth-rate:${hashHex_(safeSubject).slice(0, 24)}:${minuteBucket}`;
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key) || 0);
  if (count >= AUTH_PROFILE_CONFIG.requestRateLimitPerMinute) {
    throw new Error("操作過於頻繁，請稍後再試。");
  }
  cache.put(key, String(count + 1), 120);
}

/** 檢查固定欄位順序。時間／空間 O(h)，h = 欄位數。 */
function validateSheetHeaders_(sheet, expectedHeaders) {
  const actual = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const missing = expectedHeaders.filter((header, index) => actual[index] !== header);
  if (missing.length) throw new Error(`${sheet.getName()} 欄位不完整：${missing.join("、")}`);
}

/** Profiles 工作表。時間／空間 O(h)。 */
function getProfilesSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");
  const sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.profilesSheetName);
  if (!sheet) throw new Error("缺少 Profiles 工作表，請先執行 setupCommentsSheet。");
  validateSheetHeaders_(sheet, COMMENTS_CONFIG.profileHeaders);
  return sheet;
}

/** Comments 工作表。時間／空間 O(h)。 */
function getCommentsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");
  const sheet = spreadsheet.getSheetByName(COMMENTS_CONFIG.commentsSheetName);
  if (!sheet) throw new Error("缺少 Comments 工作表，請先執行 setupCommentsSheet。");
  validateSheetHeaders_(sheet, COMMENTS_CONFIG.commentHeaders);
  return sheet;
}

/** 正規化 Profile 列。時間／空間 O(1)。 */
function profileRowToObject_(row, sheetRow) {
  return {
    subject: sanitizeText_(row[0], 255),
    userKey: sanitizeUserKey_(row[1]),
    email: sanitizeText_(row[2], AUTH_PROFILE_CONFIG.maxEmailLength).toLowerCase(),
    nickname: sanitizeText_(row[3], AUTH_PROFILE_CONFIG.maxNicknameLength),
    updatedAt: row[4] || "",
    status: String(row[5] || AUTH_PROFILE_CONFIG.activeProfileStatus).trim().toLowerCase(),
    _row: sheetRow,
  };
}

/** 依 Google subject 查 Profile。時間 O(p)，空間 O(p)。 */
function getProfileBySubject_(subject) {
  const safeSubject = sanitizeText_(subject, 255);
  if (!safeSubject) return null;

  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.profileHeaders.length).getValues();
  for (let index = 0; index < values.length; index += 1) {
    const profile = profileRowToObject_(values[index], index + 2);
    if (profile.subject === safeSubject) return profile;
  }
  return null;
}

/** 公開 profile 只回傳暱稱與不可逆 userKey。時間 O(p)，空間 O(p)。 */
function getPublicProfileByUserKey_(userKey) {
  const safeUserKey = sanitizeUserKey_(userKey);
  if (!safeUserKey) return null;

  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.profileHeaders.length).getValues();
  for (let index = 0; index < values.length; index += 1) {
    const profile = profileRowToObject_(values[index], index + 2);
    if (profile.userKey !== safeUserKey || profile.status !== AUTH_PROFILE_CONFIG.activeProfileStatus) continue;
    return { userKey: profile.userKey, nickname: profile.nickname };
  }
  return null;
}

/** 新增或更新公開暱稱。時間 O(p)，空間 O(p)。 */
function setNickname_(googleUser, rawNickname) {
  const subject = sanitizeText_(googleUser?.sub, 255);
  const email = sanitizeText_(googleUser?.email, AUTH_PROFILE_CONFIG.maxEmailLength).toLowerCase();
  const nickname = String(rawNickname || "").replace(/\s+/g, " ").trim();
  const nicknameLength = Array.from(nickname).length;

  if (!subject || !email) throw new Error("Google 帳號資料不完整，請重新登入。");
  if (
    nicknameLength < AUTH_PROFILE_CONFIG.minNicknameLength
    || nicknameLength > AUTH_PROFILE_CONFIG.maxNicknameLength
  ) {
    throw new Error("暱稱須為 2～20 個字。");
  }
  if (/[<>\[\]{}]/.test(nickname)) throw new Error("暱稱不可包含 < > [ ] { } 等符號。");

  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  const userKey = hashHex_(subject).slice(0, 16);
  const row = [subject, userKey, email, nickname, new Date(), AUTH_PROFILE_CONFIG.activeProfileStatus];
  let targetRow = 0;

  if (lastRow > 1) {
    const subjects = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (let index = 0; index < subjects.length; index += 1) {
      if (sanitizeText_(subjects[index][0], 255) === subject) {
        targetRow = index + 2;
        break;
      }
    }
  }

  if (targetRow) sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);

  return { userKey, nickname };
}

/** userKey 僅接受 16 碼十六進位字串。時間／空間 O(1)。 */
function sanitizeUserKey_(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : "";
}

/** 留言輸入正規化。時間／空間 O(m)，m = 單筆文字長度。 */
function normalizeIncomingComment_(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    id: sanitizeText_(source.id, 120) || Utilities.getUuid(),
    createdAt: parseIncomingDate_(source.createdAt),
    title: sanitizeText_(source.title, COMMENTS_CONFIG.maxTitleLength),
    text: sanitizeText_(source.text, COMMENTS_CONFIG.maxTextLength),
  };
}

/** 建立 subject → nickname 查表。時間 O(p)，空間 O(p)。 */
function buildNicknameBySubject_() {
  const sheet = getProfilesSheet_();
  const lastRow = sheet.getLastRow();
  const nicknameBySubject = new Map();
  if (lastRow <= 1) return nicknameBySubject;

  const values = sheet.getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.profileHeaders.length).getValues();
  values.forEach((row, index) => {
    const profile = profileRowToObject_(row, index + 2);
    if (
      profile.subject
      && profile.nickname
      && profile.status === AUTH_PROFILE_CONFIG.activeProfileStatus
    ) {
      nicknameBySubject.set(profile.subject, profile.nickname);
    }
  });
  return nicknameBySubject;
}

/** 公開留言列表。時間 O(n + p)，空間 O(p + k)。 */
function listComments_(limit) {
  const safeLimit = clampInteger_(limit || COMMENTS_CONFIG.defaultLimit, 1, COMMENTS_CONFIG.maxLimit);
  const sheet = getCommentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const nicknameBySubject = buildNicknameBySubject_();
  const values = sheet.getRange(2, 1, lastRow - 1, COMMENTS_CONFIG.commentHeaders.length).getValues();
  const comments = [];

  for (let index = values.length - 1; index >= 0 && comments.length < safeLimit; index -= 1) {
    const row = values[index];
    const status = String(row[5] || "visible").trim().toLowerCase();
    const text = sanitizeText_(row[4], COMMENTS_CONFIG.maxTextLength);
    if (status !== "visible" || !text) continue;

    const subject = sanitizeText_(row[6], 255);
    comments.push({
      id: sanitizeText_(row[0], 120),
      createdAt: formatTaipeiDate_(row[1] || new Date()),
      name: nicknameBySubject.get(subject) || sanitizeText_(row[2], AUTH_PROFILE_CONFIG.maxNicknameLength) || "匿名",
      title: sanitizeText_(row[3], COMMENTS_CONFIG.maxTitleLength),
      text,
    });
  }
  return comments;
}

/** 手動檢查 OAuth、管理員與工作表設定。時間／空間 O(h)。 */
function getAuthProfilesHealth_() {
  const missing = [];
  if (!getOAuthClientId_()) missing.push("Script Property: GOOGLE_OAUTH_CLIENT_ID");
  if (!getAdminEmails_().length) missing.push("Script Property: ADMIN_EMAILS");

  try {
    getProfilesSheet_();
  } catch (error) {
    missing.push(String(error?.message || error));
  }
  try {
    getCommentsSheet_();
  } catch (error) {
    missing.push(String(error?.message || error));
  }

  return { ready: missing.length === 0, missing };
}

function showAuthProfilesHealth_() {
  const health = getAuthProfilesHealth_();
  SpreadsheetApp.getUi().alert(
    health.ready ? "Google 登入、管理員與暱稱資料層設定正常。" : `尚未完成：\n${health.missing.join("\n")}`
  );
}
