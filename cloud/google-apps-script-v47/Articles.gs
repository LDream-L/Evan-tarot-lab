// ==============================
// 文章管理後端
// 私人 Google Sheets 儲存；公開 API 僅輸出已發布文章
// ==============================
//
// 主要函式複雜度：
// - setupArticlesSheet：O(s)，s = 預設文章數
// - listPublishedArticles_：O(n log n)，n = Articles 資料列數
// - getPublishedArticleById_：O(n)
// - readPublishedArticles_：O(n log n)
// 空間複雜度：O(n)
//
// 更快替代方案比較：
// - 暴力法：每篇文章直接寫入 GitHub JavaScript，新增文章必須改程式並重新部署網站。
// - 本實作：文章集中在私人 Articles 工作表，網站只讀取可公開欄位；草稿、排程與內部備註不回傳。
// ==============================

const ARTICLES_CONFIG = Object.freeze({
  sheetName: "Articles",
  maxListLimit: 200,
  headers: [
    "id",
    "status",
    "publishAt",
    "updatedAt",
    "category",
    "tag",
    "title",
    "excerpt",
    "content",
    "author",
    "relatedLink",
    "relatedLabel",
    "sortOrder",
    "internalNote",
  ],
  widths: [
    180,
    100,
    160,
    160,
    120,
    120,
    300,
    420,
    620,
    100,
    240,
    180,
    90,
    320,
  ],
  statuses: ["draft", "published", "scheduled", "archived"],
  categories: ["experiment", "system", "case", "guide", "reflection"],
});

const ARTICLES_SEED = Object.freeze([
  {
    id: "tarot-as-system",
    status: "published",
    publishAt: "2025-12-06 12:00:00",
    category: "system",
    tag: "系統思維",
    title: "把塔羅當成「系統」，而不是單次答案",
    excerpt:
      "大部分人用塔羅的方式是：遇到問題 → 抽一次牌 → 拿到一個答案。但如果把每一次占卜都當成「當下狀態的快照」，並持續紀錄與回顧，塔羅就會變成一個可以追蹤自己選擇與變化的系統，而不是神秘黑盒子。",
    content:
      "大部分人用塔羅的方式是：遇到問題 → 抽一次牌 → 拿到一個答案。但如果把每一次占卜都當成「當下狀態的快照」，並持續紀錄與回顧，塔羅就會變成一個可以追蹤自己選擇與變化的系統，而不是神秘黑盒子。",
    author: "Evan",
    relatedLink: "",
    relatedLabel: "",
    sortOrder: 40,
    internalNote: "由舊版 ARTICLE_DATA 匯入",
  },
  {
    id: "timeflow-experiment",
    status: "published",
    publishAt: "2026-05-05 12:00:00",
    category: "experiment",
    tag: "實驗紀錄",
    title: "占卜時間流：從問題到事件，再到驗證",
    excerpt:
      "把占卜案例與後續事件接在同一條主題流上，可以避免只記得準的部分，也能看見牌面、選擇與現實事件之間的關聯。",
    content:
      "把占卜案例與後續事件接在同一條主題流上，可以避免只記得準的部分，也能看見牌面、選擇與現實事件之間的關聯。",
    author: "Evan",
    relatedLink: "timeflow.html",
    relatedLabel: "前往占卜時間流工具",
    sortOrder: 30,
    internalNote: "由舊版 ARTICLE_DATA 匯入",
  },
  {
    id: "lost-item-tool-note",
    status: "published",
    publishAt: "2026-05-05 11:00:00",
    category: "guide",
    tag: "占卜教學",
    title: "失物占卜不是 GPS，而是搜尋場域收斂工具",
    excerpt:
      "尋物占卜的價值不在於精準定位，而是把混亂的搜尋範圍拆成狀態、場域與行動建議，讓你先找最有機會的地方。",
    content:
      "尋物占卜的價值不在於精準定位，而是把混亂的搜尋範圍拆成狀態、場域與行動建議，讓你先找最有機會的地方。",
    author: "Evan",
    relatedLink: "lost-item.html",
    relatedLabel: "前往失物占卜工具",
    sortOrder: 20,
    internalNote: "由舊版 ARTICLE_DATA 匯入",
  },
  {
    id: "anonymous-case-template",
    status: "published",
    publishAt: "2026-05-05 10:00:00",
    category: "case",
    tag: "匿名案例",
    title: "匿名案例可以怎麼公開：保留結構，移除個資",
    excerpt:
      "公開案例時，不需要公開個人細節。真正有價值的是問題結構、牌面重點、當時解讀，以及後續事件如何驗證或修正判斷。",
    content:
      "公開案例時，不需要公開個人細節。真正有價值的是問題結構、牌面重點、當時解讀，以及後續事件如何驗證或修正判斷。",
    author: "Evan",
    relatedLink: "",
    relatedLabel: "",
    sortOrder: 10,
    internalNote: "由舊版 ARTICLE_DATA 匯入",
  },
]);

/**
 * 建立 Articles 工作表並匯入現有文章。
 * 時間複雜度：O(s)，s = 預設文章數
 * 空間複雜度：O(s)
 */
function setupArticlesSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);
  const existed = Boolean(spreadsheet.getSheetByName(ARTICLES_CONFIG.sheetName));
  const sheet = setupSheet_(
    spreadsheet,
    ARTICLES_CONFIG.sheetName,
    ARTICLES_CONFIG.headers,
    ARTICLES_CONFIG.widths
  );

  sheet.setFrozenRows(1);
  sheet.getRange("C:D").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("H:I").setWrap(true).setVerticalAlignment("top");
  sheet.getRange("N:N").setWrap(true).setVerticalAlignment("top");

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ARTICLES_CONFIG.statuses, true)
    .setAllowInvalid(false)
    .build();
  const categoryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ARTICLES_CONFIG.categories, true)
    .setAllowInvalid(false)
    .build();

  const validationRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 2, validationRows, 1).setDataValidation(statusRule);
  sheet.getRange(2, 5, validationRows, 1).setDataValidation(categoryRule);

  const notes = [[
    "網址識別碼，只能使用英文字母、數字、連字號與底線；建立後不要任意更改。",
    "draft=草稿、published=立即發布、scheduled=排程發布、archived=封存。",
    "發布時間；scheduled 必填，published 留空時以更新時間顯示。",
    "最近更新時間，可手動填寫或留空。",
    "experiment/system/case/guide/reflection。",
    "前台顯示的中文分類標籤。",
    "文章標題。",
    "文章列表摘要。",
    "文章全文；段落之間請空一行。",
    "作者名稱。",
    "可選的相關頁面連結。",
    "相關連結按鈕文字。",
    "數字越大越前面；同分再依發布時間排序。",
    "私人備註，不會傳到網站。",
  ]];
  sheet.getRange(1, 1, 1, ARTICLES_CONFIG.headers.length).setNotes(notes);

  if (!existed || sheet.getLastRow() <= 1) {
    const now = new Date();
    const rows = ARTICLES_SEED.map((article) => [
      article.id,
      article.status,
      parseArticleDate_(article.publishAt) || now,
      now,
      article.category,
      article.tag,
      article.title,
      article.excerpt,
      article.content,
      article.author,
      article.relatedLink,
      article.relatedLabel,
      article.sortOrder,
      article.internalNote,
    ]);

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, ARTICLES_CONFIG.headers.length).setValues(rows);
    }
  }

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), ARTICLES_CONFIG.headers.length).createFilter();
  }

  SpreadsheetApp.flush();
  return jsonOutput_({
    success: true,
    sheetName: ARTICLES_CONFIG.sheetName,
    seeded: !existed || sheet.getLastRow() <= ARTICLES_SEED.length + 1,
    message: "Articles 工作表已建立，可直接新增草稿或發布文章。",
  });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Evan Tarot 後台")
    .addItem("建立／修復文章管理表", "setupArticlesSheet")
    .addItem("檢查文章後端", "showArticlesHealth_")
    .addToUi();
}

function showArticlesHealth_() {
  const health = getArticlesHealth_();
  SpreadsheetApp.getUi().alert(
    health.ready
      ? "Articles 工作表格式正常。"
      : `文章後端尚未完成：${health.error || "缺少 Articles 工作表"}`
  );
}

function getArticlesHealth_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return { ready: false, error: "找不到綁定的試算表" };

  const sheet = spreadsheet.getSheetByName(ARTICLES_CONFIG.sheetName);
  if (!sheet) return { ready: false, error: `缺少 ${ARTICLES_CONFIG.sheetName} 工作表` };

  const headers = sheet
    .getRange(1, 1, 1, ARTICLES_CONFIG.headers.length)
    .getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const missingHeaders = ARTICLES_CONFIG.headers.filter(
    (header, index) => headers[index] !== header
  );

  return {
    ready: missingHeaders.length === 0,
    error: missingHeaders.length ? `欄位不完整：${missingHeaders.join("、")}` : "",
    missingHeaders,
  };
}

/**
 * 回傳所有已發布文章。
 * 時間複雜度：O(n log n)
 * 空間複雜度：O(n)
 */
function listPublishedArticles_(limit) {
  const safeLimit = clampInteger_(limit || ARTICLES_CONFIG.maxListLimit, 1, ARTICLES_CONFIG.maxListLimit);
  return readPublishedArticles_().slice(0, safeLimit);
}

/**
 * 依 id 取得單篇已發布文章。
 * 時間複雜度：O(n)
 * 空間複雜度：O(n)
 */
function getPublishedArticleById_(rawId) {
  const id = sanitizeArticleId_(rawId);
  if (!id) return null;
  const articles = readPublishedArticles_();
  return articles.find((article) => article.id === id) || null;
}

/**
 * 批次讀取 Articles，過濾草稿與未到期排程。
 * 時間複雜度：O(n log n)
 * 空間複雜度：O(n)
 */
function readPublishedArticles_() {
  const health = getArticlesHealth_();
  if (!health.ready) throw new Error(health.error || "文章後端尚未完成設定。");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARTICLES_CONFIG.sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet
    .getRange(2, 1, lastRow - 1, ARTICLES_CONFIG.headers.length)
    .getValues();
  const nowMs = Date.now();
  const articles = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const article = normalizeArticleRow_(values[rowIndex], rowIndex + 2, nowMs);
    if (article) articles.push(article);
  }

  articles.sort((left, right) => {
    if (left._sortOrder !== right._sortOrder) return right._sortOrder - left._sortOrder;
    if (left._publishMs !== right._publishMs) return right._publishMs - left._publishMs;
    return left._row - right._row;
  });

  return articles.map(({ _sortOrder, _publishMs, _row, ...publicArticle }) => publicArticle);
}

function normalizeArticleRow_(row, sheetRow, nowMs) {
  const id = sanitizeArticleId_(row[0]);
  const status = String(row[1] || "draft").trim().toLowerCase();
  const publishAt = parseArticleDate_(row[2]);
  const updatedAt = parseArticleDate_(row[3]);
  const publishMs = publishAt?.getTime() || updatedAt?.getTime() || 0;

  const isPublished = status === "published";
  const isScheduledReady = status === "scheduled" && publishAt && publishMs <= nowMs;
  if (!id || (!isPublished && !isScheduledReady)) return null;

  const title = sanitizeText_(row[6], 180);
  const excerpt = sanitizeText_(row[7], 1000);
  const rawContent = String(row[8] == null ? "" : row[8]).trim();
  if (!title || (!excerpt && !rawContent)) return null;

  const content = splitArticleContent_(rawContent || excerpt);
  const displayDate = Utilities.formatDate(
    publishAt || updatedAt || new Date(),
    COMMENTS_CONFIG.timeZone,
    "yyyy-MM-dd"
  );

  return {
    id,
    category: sanitizeText_(row[4], 40) || "reflection",
    tag: sanitizeText_(row[5], 40) || "文章",
    title,
    date: displayDate,
    author: sanitizeText_(row[9], 80) || "Evan",
    excerpt: excerpt || content[0] || "",
    content,
    relatedLink: sanitizePublicLink_(row[10]),
    relatedLabel: sanitizeText_(row[11], 80),
    _sortOrder: Number(row[12]) || 0,
    _publishMs: publishMs,
    _row: sheetRow,
  };
}

function splitArticleContent_(value) {
  return String(value || "")
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function sanitizeArticleId_(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) ? id : "";
}

function sanitizePublicLink_(value) {
  const link = String(value || "").trim();
  if (!link) return "";
  if (/^(?:https:\/\/|[a-z0-9][a-z0-9_-]*\.html(?:[?#].*)?$)/i.test(link)) return link.slice(0, 500);
  return "";
}

function parseArticleDate_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || "").trim();
  if (!text) return null;

  const normalized = text.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
