// ==============================
// 文章管理員寫入後端
// 與 Articles.gs 共用欄位定義，僅管理員 API 可呼叫
// ==============================
//
// 主要函式複雜度：
// - listAdminArticles_：時間 O(n log n)，空間 O(n)
// - saveArticle_ / deleteArticle_：時間 O(n)，空間 O(n)
//
// 更快替代方案比較：
// - 暴力法：每次選取文章都重複掃描工作表。
// - 本實作：單次 API 批次回傳管理清單，前端建立 Map；寫入時只掃描 ID 欄定位目標列。
// ==============================

/** 管理員文章列表。時間 O(n log n)，空間 O(n)。 */
function listAdminArticles_() {
  const sheet = getArticlesSheetForAdmin_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, ARTICLES_CONFIG.headers.length).getValues();
  return values
    .map((row, index) => normalizeAdminArticleRow_(row, index + 2))
    .filter((article) => article.id)
    .sort(compareAdminArticles_)
    .map(stripAdminArticleSortFields_);
}

/** 儲存單篇文章。時間 O(n)，空間 O(n)。 */
function saveArticle_(rawArticle, rawOriginalId) {
  const article = normalizeArticleInput_(rawArticle);
  const originalId = sanitizeArticleId_(rawOriginalId) || article.id;
  const sheet = getArticlesSheetForAdmin_();
  const lastRow = sheet.getLastRow();
  const ids = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map((row) => sanitizeArticleId_(row[0]))
    : [];

  let targetRow = 0;
  let duplicateRow = 0;
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index] === originalId) targetRow = index + 2;
    if (ids[index] === article.id) duplicateRow = index + 2;
  }
  if (duplicateRow && duplicateRow !== targetRow) {
    throw new Error(`文章 ID「${article.id}」已存在。`);
  }

  const now = new Date();
  const values = articleInputToRow_(article, now);
  if (targetRow) sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  SpreadsheetApp.flush();

  return stripAdminArticleSortFields_(
    normalizeAdminArticleRow_(values, targetRow || sheet.getLastRow())
  );
}

/** 永久刪除文章。時間 O(n)，空間 O(n)。 */
function deleteArticle_(rawId) {
  const id = sanitizeArticleId_(rawId);
  if (!id) throw new Error("文章 ID 不正確。");

  const sheet = getArticlesSheetForAdmin_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) throw new Error("找不到指定文章。");

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (sanitizeArticleId_(ids[index][0]) !== id) continue;
    sheet.deleteRow(index + 2);
    SpreadsheetApp.flush();
    return { id, deleted: true };
  }
  throw new Error("找不到指定文章。");
}

function getArticlesSheetForAdmin_() {
  const health = getArticlesHealth_();
  if (!health.ready) throw new Error(health.error || "文章後端尚未完成設定。");
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARTICLES_CONFIG.sheetName);
}

function normalizeAdminArticleRow_(row, sheetRow) {
  const publishAt = parseArticleDate_(row[2]);
  const updatedAt = parseArticleDate_(row[3]);
  const sortOrder = Number(row[12]);
  const safeSortOrder = Number.isFinite(sortOrder) ? sortOrder : 0;
  return {
    id: sanitizeArticleId_(row[0]),
    status: String(row[1] || "draft").trim().toLowerCase(),
    publishAt: publishAt ? formatTaipeiDate_(publishAt) : "",
    updatedAt: updatedAt ? formatTaipeiDate_(updatedAt) : "",
    category: sanitizeText_(row[4], 40) || "reflection",
    tag: sanitizeText_(row[5], 40) || "文章",
    title: sanitizeText_(row[6], 180),
    excerpt: sanitizeText_(row[7], 1000),
    content: String(row[8] == null ? "" : row[8]).trim(),
    author: sanitizeText_(row[9], 80) || "Evan",
    relatedLink: sanitizePublicLink_(row[10]),
    relatedLabel: sanitizeText_(row[11], 80),
    sortOrder: safeSortOrder,
    internalNote: sanitizeText_(row[13], 1000),
    _sortOrder: safeSortOrder,
    _publishMs: publishAt?.getTime() || updatedAt?.getTime() || 0,
    _row: sheetRow,
  };
}

function compareAdminArticles_(left, right) {
  if (left._sortOrder !== right._sortOrder) return right._sortOrder - left._sortOrder;
  if (left._publishMs !== right._publishMs) return right._publishMs - left._publishMs;
  return left._row - right._row;
}

function stripAdminArticleSortFields_(article) {
  const output = Object.assign({}, article);
  delete output._sortOrder;
  delete output._publishMs;
  delete output._row;
  return output;
}

function normalizeArticleInput_(raw) {
  const article = raw && typeof raw === "object" ? raw : {};
  const id = sanitizeArticleId_(article.id);
  const status = String(article.status || "draft").trim().toLowerCase();
  const category = sanitizeText_(article.category, 40) || "reflection";
  const title = sanitizeText_(article.title, 180);
  const excerpt = sanitizeText_(article.excerpt, 1000);
  const content = Array.isArray(article.content)
    ? article.content.map((item) => String(item || "").trim()).filter(Boolean).join("\n\n")
    : String(article.content || "").trim();
  const publishAt = parseArticleDate_(article.publishAt);
  const sortOrder = Number(article.sortOrder || 0);

  if (!id) throw new Error("文章 ID 須為 2～80 字，只能使用小寫英文、數字、連字號與底線。");
  if (!ARTICLES_CONFIG.statuses.includes(status)) throw new Error("文章狀態不正確。");
  if (!ARTICLES_CONFIG.categories.includes(category)) throw new Error("文章分類不正確。");
  if (!title) throw new Error("文章標題不可空白。");
  if (!excerpt) throw new Error("文章摘要不可空白。");
  if (!content) throw new Error("文章正文不可空白。");
  if (status === "scheduled" && !publishAt) throw new Error("排程文章必須設定發布時間。");
  if (!Number.isFinite(sortOrder)) throw new Error("排序值必須是數字。");

  return {
    id,
    status,
    publishAt,
    category,
    tag: sanitizeText_(article.tag, 40) || "文章",
    title,
    excerpt,
    content: content.slice(0, 50000),
    author: sanitizeText_(article.author, 80) || "Evan",
    relatedLink: sanitizePublicLink_(article.relatedLink),
    relatedLabel: sanitizeText_(article.relatedLabel, 80),
    sortOrder,
    internalNote: sanitizeText_(article.internalNote, 1000),
  };
}

function articleInputToRow_(article, updatedAt) {
  return [
    article.id,
    article.status,
    article.publishAt || "",
    updatedAt || new Date(),
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
  ];
}
