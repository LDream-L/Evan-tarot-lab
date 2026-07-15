// ==============================
// Evan Tarot Cloud API v5.3.0
// 後端驗證＋暱稱＋文章／圖片／服務管理＋歷史／備份＋留言＋塔羅尋物
// ==============================
//
// 主要函式複雜度：
// - doPost / createComment：O(p)，p = Profiles 列數
// - doGet / listComments：O(n + p)，n = Comments 列數
// - listPublishedArticles_：O(a log a)，a = Articles 列數
// - listPublicArticleMedia_：O(m log m)，m = ArticleMedia 列數
// - listPublishedServices_：O(s log s + q log q)，q = 方案總數
// - handleLostItemRequest_：O(c × z + z log z)，c <= 3、z = 11 個大型區域
// 空間複雜度：O(n + p + a + m + s + q + r × z)
//
// 更快替代方案比較：
// - 各功能各自建立 Web App：端點多、驗證與限流容易分歧。
// - 本實作：單一 action router，Google Token 只驗證一次，再分流至各模組。
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

const ADMIN_ACTIONS = new Set([
  "adminarticles", "savearticle", "deletearticle",
  "adminarticlemedia", "checkarticlemediaid", "uploadarticlemedia",
  "adminservices", "saveservice", "deleteservice",
]);

const LOST_ITEM_CONFIG = Object.freeze({
  version: "5.0.0",
  cardSheetName: "CardDB",
  areaMatrixSheetName: "Area Matrix",
  eventGuideSheetName: "Event Guide",
  maxItemNameLength: 80,
  maxNotesLength: 300,
  maxCardCount: 3,
  publicRateLimitPerMinute: 20,
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
    if (action === "health") return jsonOutput_(buildCompositeHealth_());
    if (action === "auth-health") {
      if (typeof getAuthProfilesHealth_ !== "function") {
        return jsonOutput_({ success: false, ready: false, error: "AuthProfiles.gs 尚未安裝", missing: ["AuthProfiles.gs"] });
      }
      const health = getAuthProfilesHealth_();
      return jsonOutput_({
        success: health.ready,
        ready: health.ready,
        service: "Evan Tarot Auth",
        error: health.ready ? "" : health.missing.join("；"),
        missing: health.missing,
        deprecatedProperties: getDeprecatedScriptProperties_(),
        time: formatTaipeiDate_(new Date()),
      });
    }
    if (action === "lostitem-health") {
      const health = getLostItemHealth_();
      return jsonOutput_({
        success: health.ready,
        service: "Evan Tarot Lost Item v5.0.0",
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
      if (typeof getArticlesHealth_ !== "function") return jsonOutput_({ success: false, ready: false, error: "Articles.gs 尚未安裝" });
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
      if (typeof listPublishedArticles_ !== "function") return jsonOutput_({ success: false, error: "文章後端尚未安裝。" });
      const limit = clampInteger_(Number(e?.parameter?.limit) || 200, 1, 200);
      return jsonOutput_({ success: true, articles: listPublishedArticles_(limit), time: formatTaipeiDate_(new Date()) });
    }
    if (action === "article") {
      if (typeof getPublishedArticleById_ !== "function") return jsonOutput_({ success: false, error: "文章後端尚未安裝。" });
      const article = getPublishedArticleById_(e?.parameter?.id);
      return jsonOutput_({ success: Boolean(article), article, error: article ? "" : "找不到已發布文章。" });
    }
    if (action === "article-media-health") {
      if (typeof getArticleMediaHealth_ !== "function") {
        return jsonOutput_({ success: false, ready: false, error: "ArticleMedia.gs 尚未安裝", missingHeaders: [] });
      }
      const health = getArticleMediaHealth_();
      return jsonOutput_({
        success: health.ready,
        ready: health.ready,
        service: "Evan Tarot Article Media",
        error: health.error || "",
        missingHeaders: health.missingHeaders || [],
        time: formatTaipeiDate_(new Date()),
      });
    }
    if (action === "article-media") {
      if (typeof listPublicArticleMedia_ !== "function") {
        return jsonOutput_({ success: true, media: [], warning: "ArticleMedia.gs 尚未安裝。", time: formatTaipeiDate_(new Date()) });
      }
      const limit = clampInteger_(Number(e?.parameter?.limit) || 500, 1, 500);
      return jsonOutput_({ success: true, media: listPublicArticleMedia_(limit), time: formatTaipeiDate_(new Date()) });
    }
    if (action === "services-health") {
      if (typeof getServicesHealth_ !== "function") return jsonOutput_({ success: false, ready: false, error: "Services.gs 尚未安裝" });
      const health = getServicesHealth_();
      return jsonOutput_({
        success: health.ready,
        ready: health.ready,
        service: "Evan Tarot Services",
        schemaVersion: health.schemaVersion || 1,
        error: health.error || "",
        missingHeaders: health.missingHeaders || [],
        time: formatTaipeiDate_(new Date()),
      });
    }
    if (action === "services") {
      if (typeof listPublishedServices_ !== "function") return jsonOutput_({ success: false, error: "服務後端尚未安裝。" });
      const limit = clampInteger_(Number(e?.parameter?.limit) || 100, 1, 100);
      return jsonOutput_({ success: true, services: listPublishedServices_(limit), time: formatTaipeiDate_(new Date()) });
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

function buildCompositeHealth_() {
  const lostItemHealth = getLostItemHealth_();
  const authHealth = typeof getAuthProfilesHealth_ === "function"
    ? getAuthProfilesHealth_() : { ready: false, missing: ["AuthProfiles.gs 尚未安裝"] };
  const articlesHealth = typeof getArticlesHealth_ === "function"
    ? getArticlesHealth_() : { ready: false, error: "Articles.gs 尚未安裝" };
  const articleMediaHealth = typeof getArticleMediaHealth_ === "function"
    ? getArticleMediaHealth_() : { ready: false, error: "ArticleMedia.gs 尚未安裝" };
  const servicesHealth = typeof getServicesHealth_ === "function"
    ? getServicesHealth_() : { ready: false, error: "Services.gs 尚未安裝" };
  return {
    success: true,
    service: "Evan Tarot Cloud API",
    authConfigured: typeof getOAuthClientId_ === "function" && Boolean(getOAuthClientId_()),
    authReady: Boolean(authHealth.ready),
    authError: authHealth.ready ? "" : (authHealth.missing || []).join("；"),
    deprecatedProperties: getDeprecatedScriptProperties_(),
    lostItemConfigured: lostItemHealth.ready,
    missingLostItemSheets: lostItemHealth.missingSheets,
    lostItemVersion: LOST_ITEM_CONFIG.version,
    articlesConfigured: articlesHealth.ready,
    articlesError: articlesHealth.error || "",
    articleMediaConfigured: articleMediaHealth.ready,
    articleMediaError: articleMediaHealth.error || "",
    servicesConfigured: servicesHealth.ready,
    servicesSchemaVersion: servicesHealth.schemaVersion || 1,
    servicesError: servicesHealth.error || "",
    time: formatTaipeiDate_(new Date()),
  };
}

function getDeprecatedScriptProperties_() {
  const properties = PropertiesService.getScriptProperties();
  return ["ARTICLE_ADMIN_EMAILS"].filter((name) => Boolean(properties.getProperty(name)));
}

function cleanupDeprecatedScriptProperties() {
  const properties = PropertiesService.getScriptProperties();
  if (!String(properties.getProperty(COMMENTS_CONFIG.adminEmailsProperty) || "").trim()) {
    throw new Error("請先確認 ADMIN_EMAILS 已設定，再清理舊屬性。");
  }
  const removed = getDeprecatedScriptProperties_();
  removed.forEach((name) => properties.deleteProperty(name));
  SpreadsheetApp.getUi().alert(removed.length ? `已刪除：${removed.join("、")}` : "目前沒有需要清理的舊屬性。");
  return removed;
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
    if (action === "authstatus") {
      const profile = getProfileBySubject_(googleUser.sub);
      return jsonOutput_({
        success: true,
        isAdmin: isAdmin_(googleUser.email),
        profile: profile?.nickname ? { userKey: profile.userKey, nickname: profile.nickname } : null,
      });
    }
    if (action === "adminstatus") return jsonOutput_({ success: true, isAdmin: isAdmin_(googleUser.email) });
    if (ADMIN_ACTIONS.has(action)) {
      if (!isAdmin_(googleUser.email)) return jsonOutput_({ success: false, error: "此 Google 帳戶沒有管理權限。" });
      return jsonOutput_(handleAdminAction_(action, payload, lock, googleUser));
    }
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
      comment.id, comment.createdAt, profile.nickname, comment.title, comment.text,
      "visible", googleUser.sub, googleUser.email,
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

function handleAdminAction_(action, payload, lock, googleUser) {
  if (action === "adminarticles") {
    if (typeof listAdminArticles_ !== "function") throw new Error("ArticleAdmin.gs 尚未安裝。");
    return { success: true, articles: listAdminArticles_() };
  }
  if (action === "adminarticlemedia") {
    if (typeof listAdminArticleMedia_ !== "function") throw new Error("ArticleMedia.gs 尚未安裝。");
    return { success: true, media: listAdminArticleMedia_() };
  }
  if (action === "checkarticlemediaid") {
    if (typeof isArticleMediaIdAvailable_ !== "function") throw new Error("ArticleMedia.gs 尚未安裝。");
    return Object.assign({ success: true }, isArticleMediaIdAvailable_(payload.mediaId));
  }
  if (action === "adminservices") {
    if (typeof listAdminServices_ !== "function") throw new Error("Services.gs 尚未安裝。");
    return { success: true, services: listAdminServices_() };
  }
  if (!lock.tryLock(10000)) return { success: false, error: "系統忙碌中，請稍後重試。" };
  const actorEmail = googleUser?.email || "";
  const requestId = sanitizeText_(payload.requestId, 160);
  if (action === "uploadarticlemedia") {
    if (typeof uploadArticleMedia_ !== "function") throw new Error("ArticleMedia.gs 尚未安裝。");
    return { success: true, media: uploadArticleMedia_(payload.media, payload.file) };
  }
  if (action === "savearticle") {
    if (typeof saveArticle_ !== "function") throw new Error("ArticleAdmin.gs 尚未安裝。");
    const historyId = sanitizeText_(payload.originalId || payload.article?.id, 120);
    const before = typeof findAdminEntitySnapshot_ === "function" ? findAdminEntitySnapshot_("article", historyId) : null;
    const article = saveArticle_(payload.article, payload.originalId);
    if (typeof appendAdminHistory_ === "function") {
      appendAdminHistory_("article", before ? "update" : "create", article.id, before, article, actorEmail, requestId);
    }
    return { success: true, article };
  }
  if (action === "deletearticle") {
    if (typeof deleteArticle_ !== "function") throw new Error("ArticleAdmin.gs 尚未安裝。");
    const before = typeof findAdminEntitySnapshot_ === "function" ? findAdminEntitySnapshot_("article", payload.articleId) : null;
    const result = deleteArticle_(payload.articleId);
    if (typeof appendAdminHistory_ === "function") appendAdminHistory_("article", "delete", payload.articleId, before, null, actorEmail, requestId);
    return { success: true, result };
  }
  if (action === "saveservice") {
    if (typeof saveService_ !== "function") throw new Error("Services.gs 尚未安裝。");
    return { success: true, service: saveService_(payload.service, payload.originalId, actorEmail, requestId) };
  }
  if (action === "deleteservice") {
    if (typeof deleteService_ !== "function") throw new Error("Services.gs 尚未安裝。");
    return { success: true, result: deleteService_(payload.serviceId, actorEmail, requestId) };
  }
  throw new Error("不支援的管理員 action。");
}

function parsePayload_(e) {
  const contents = e?.postData?.contents;
  if (contents) {
    try { return JSON.parse(contents); }
    catch (error) { /* 非 JSON 時改讀 e.parameter。 */ }
  }
  return Object.assign({}, e?.parameter || {});
}

function sanitizeText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim().slice(0, maxLength);
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
