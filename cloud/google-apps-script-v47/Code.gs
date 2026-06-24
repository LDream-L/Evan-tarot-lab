// ==============================
// Evan Tarot Cloud API v4.8
// Google 帳號驗證＋暱稱同步＋文章管理／留言＋塔羅尋物
// ==============================
//
// 主要函式複雜度：
// - doPost / createComment：O(p)，p = Profiles 列數
// - doGet / listComments：O(n + p)，n = Comments 列數
// - listPublishedArticles_：O(a log a)，a = Articles 列數
// - handleLostItemRequest_：O(c × z + z log z)，c <= 3、z = 18
// 空間複雜度：O(n + p + a + r × z)
// ==============================

const COMMENTS_CONFIG = Object.freeze({
  commentsSheetName: "Comments",
  profilesSheetName: "Profiles",
  timeZone: "Asia/Taipei",
  defaultLimit: 100,
  maxLimit: 300,
  minNicknameLength: 2,
  maxNicknameLength: 20,
  maxTitleLength: 80,
  maxTextLength: 1000,
  oauthClientIdProperty: "GOOGLE_OAUTH_CLIENT_ID",
  adminEmailsProperty: "ADMIN_EMAILS",
  commentHeaders: ["id", "createdAt", "name", "title", "text", "status", "clientId", "source"],
  profileHeaders: ["subject", "userKey", "email", "nickname", "updatedAt", "status"],
});

const LOST_ITEM_CONFIG = Object.freeze({
  version: "4.7",
  cardSheetName: "CardDB",
  paramsSheetName: "Params",
  zoneGuideSheetName: "Zone Guide",
  eventGuideSheetName: "Event Guide",
  maxItemNameLength: 80,
  maxNotesLength: 300,
  maxCardCount: 3,
  publicRateLimitPerMinute: 20,
  hiddenAreas: [
    "低處縫隙/家具後",
    "儲藏箱/舊物",
    "軟物下方/床下沙發下陰影區",
  ],
  easyFirstAreas: [
    "出入口動線",
    "包袋口袋",
    "書桌工作區",
    "手邊平台/桌面側邊",
    "水源廚浴",
    "交通工具/通勤/移動路徑",
    "垃圾桶/回收區/清理誤丟",
  ],
  nearBodyCards: [
    "The High Priestess",
    "The Moon",
    "The Hermit",
    "The Hanged Man",
    "Four of Cups",
    "Two of Swords",
    "Page of Swords",
    "The Fool",
  ],
});

function setupCommentsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);
  setupSheet_(spreadsheet, COMMENTS_CONFIG.commentsSheetName, COMMENTS_CONFIG.commentHeaders, [230, 170, 130, 260, 420, 90, 220, 260]);
  setupSheet_(spreadsheet, COMMENTS_CONFIG.profilesSheetName, COMMENTS_CONFIG.profileHeaders, [260, 150, 260, 160, 170, 90]);

  spreadsheet.getSheetByName(COMMENTS_CONFIG.commentsSheetName).getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  spreadsheet.getSheetByName(COMMENTS_CONFIG.profilesSheetName).getRange("E:E").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  return jsonOutput_({ success: true, message: "Comments 與 Profiles 工作表已完成設定。" });
}

function setupSheet_(spreadsheet, sheetName, headers, widths) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold").setBackground("#30275f").setFontColor("#ffffff").setHorizontalAlignment("center");

  sheet.setFrozenRows(1);
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  return sheet;
}

function doGet(e) {
  try {
    const action = String(e?.parameter?.action || "list").toLowerCase();

    if (action === "health") {
      const lostItemHealth = getLostItemHealth_();
      const articlesHealth =
        typeof getArticlesHealth_ === "function"
          ? getArticlesHealth_()
          : { ready: false, error: "Articles.gs 尚未安裝" };

      return jsonOutput_({
        success: true,
        service: "Evan Tarot Cloud API",
        authConfigured: Boolean(getOAuthClientId_()),
        lostItemConfigured: lostItemHealth.ready,
        missingLostItemSheets: lostItemHealth.missingSheets,
        articlesConfigured: articlesHealth.ready,
        articlesError: articlesHealth.error || "",
        time: formatTaipeiDate_(new Date()),
      });
    }

    if (action === "lostitem-health") {
      const health = getLostItemHealth_();
      return jsonOutput_({
        success: health.ready,
        service: "Evan Tarot Lost Item v4.7",
        version: LOST_ITEM_CONFIG.version,
        missingSheets: health.missingSheets,
        time: formatTaipeiDate_(new Date()),
      });
    }

    if (action === "lostitem") {
      enforcePublicRateLimit_(e?.parameter?.clientId);
      return jsonOutput_(handleLostItemRequest_(e?.parameter || {}));
    }

    if (action === "articles-health") {
      if (typeof getArticlesHealth_ !== "function") {
        return jsonOutput_({ success: false, ready: false, error: "Articles.gs 尚未安裝" });
      }
      const health = getArticlesHealth_();
      return jsonOutput_({
        success: health.ready,
        ready: health.ready,
        service: "Evan Tarot Articles",
        error: health.error || "",
        missingHeaders: health.missingHeaders || [],
        time: formatTaipeiDate_(new Date()),
      });
    }

    if (action === "articles") {
      if (typeof listPublishedArticles_ !== "function") {
        return jsonOutput_({ success: false, error: "文章後端尚未安裝。" });
      }
      const limit = clampInteger_(Number(e?.parameter?.limit) || 200, 1, 200);
      return jsonOutput_({
        success: true,
        articles: listPublishedArticles_(limit),
        time: formatTaipeiDate_(new Date()),
      });
    }

    if (action === "article") {
      if (typeof getPublishedArticleById_ !== "function") {
        return jsonOutput_({ success: false, error: "文章後端尚未安裝。" });
      }
      const article = getPublishedArticleById_(e?.parameter?.id);
      return jsonOutput_({
        success: Boolean(article),
        article,
        error: article ? "" : "找不到已發布文章。",
      });
    }

    if (action === "profile") {
      const userKey = sanitizeUserKey_(e?.parameter?.userKey);
      return jsonOutput_({ success: true, profile: userKey ? getPublicProfileByUserKey_(userKey) : null });
    }

    if (action !== "list") return jsonOutput_({ success: false, error: "不支援的 GET action。" });

    const limit = clampInteger_(Number(e?.parameter?.limit) || COMMENTS_CONFIG.defaultLimit, 1, COMMENTS_CONFIG.maxLimit);
    return jsonOutput_({ success: true, comments: listComments_(limit) });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ success: false, error: String(error?.message || error) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    const payload = parsePayload_(e);
    if (String(payload.website || "").trim()) return jsonOutput_({ success: true, ignored: true });

    const action = String(payload.action || "create").toLowerCase();

    if (action === "lostitem") {
      enforcePublicRateLimit_(payload.clientId);
      return jsonOutput_(handleLostItemRequest_(payload));
    }

    const googleUser = verifyGoogleCredential_(payload.credential);
    enforceRateLimit_(googleUser.sub);

    if (action === "setnickname") {
      if (!lock.tryLock(10000)) return jsonOutput_({ success: false, error: "系統忙碌中，請稍後重試。" });
      const profile = setNickname_(googleUser, payload.nickname);
      SpreadsheetApp.flush();
      return jsonOutput_({ success: true, profile });
    }

    if (action !== "create") return jsonOutput_({ success: false, error: "不支援的 POST action。" });

    const profile = getProfileBySubject_(googleUser.sub);
    if (!profile?.nickname) return jsonOutput_({ success: false, error: "請先設定公開暱稱。" });

    const comment = normalizeIncomingComment_(payload);
    if (!comment.text) return jsonOutput_({ success: false, error: "留言內容不可空白。" });
    if (!lock.tryLock(10000)) return jsonOutput_({ success: false, error: "系統忙碌中，請稍後重試。" });

    getCommentsSheet_().appendRow([
      comment.id,
      comment.createdAt,
      profile.nickname,
      comment.title,
      comment.text,
      "visible",
      googleUser.sub,
      googleUser.email,
    ]);

    SpreadsheetApp.flush();
    return jsonOutput_({ success: true, id: comment.id, createdAt: formatTaipeiDate_(comment.createdAt), nickname: profile.nickname });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ success: false, error: String(error?.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
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
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function hashHex_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ""), Utilities.Charset.UTF_8);
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
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
