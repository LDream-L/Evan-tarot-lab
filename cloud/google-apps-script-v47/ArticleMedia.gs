// ==============================
// 文章共用圖片後端
// Google Drive 儲存圖片檔，Google Sheets 儲存公開圖片索引
// ==============================
//
// 主要函式複雜度：
// - listPublicArticleMedia_ / listAdminArticleMedia_：時間 O(m log m)，空間 O(m)
// - isArticleMediaIdAvailable_：時間 O(m)，空間 O(m)
// - uploadArticleMedia_：時間 O(m + b)，空間 O(m + b)，m = 圖片列數、b = 圖片位元組數
//
// 更快替代方案比較：
// - 每篇文章直接保存 Base64：讀取文章時會重複下載相同圖片，且 Google Sheets 很快膨脹。
// - 本實作：圖片只存 Google Drive 一份，文章正文只保存圖片代碼；名稱查重由後端在鎖內完成，避免前端競態。
// ==============================

const ARTICLE_MEDIA_CONFIG = Object.freeze({
  sheetName: "ArticleMedia",
  folderName: "Evan Tarot Article Media",
  folderIdProperty: "ARTICLE_MEDIA_FOLDER_ID",
  maxBytes: 6 * 1024 * 1024,
  maxItems: 500,
  headers: [
    "id",
    "fileId",
    "fileName",
    "mimeType",
    "src",
    "alt",
    "caption",
    "creditLabel",
    "creditUrl",
    "createdAt",
    "updatedAt",
    "status",
  ],
  widths: [180, 220, 220, 130, 360, 360, 420, 180, 320, 170, 170, 100],
  reservedIds: [
    "case-shadow-dialogue",
    "case-conflict-shadow",
    "case-dark-distance",
    "tarot-devil-xv",
  ],
  statuses: ["active", "archived"],
});

/** 建立圖片索引表與專用 Drive 資料夾。時間／空間 O(1)。 */
function setupArticleMediaLibrary() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);
  const sheet = setupSheet_(
    spreadsheet,
    ARTICLE_MEDIA_CONFIG.sheetName,
    ARTICLE_MEDIA_CONFIG.headers,
    ARTICLE_MEDIA_CONFIG.widths
  );
  sheet.setFrozenRows(1);
  sheet.getRange("J:K").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("E:I").setWrap(true).setVerticalAlignment("top");

  const validationRows = Math.max(sheet.getMaxRows() - 1, 1);
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ARTICLE_MEDIA_CONFIG.statuses, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 12, validationRows, 1).setDataValidation(statusRule);

  const folder = getArticleMediaFolder_();
  SpreadsheetApp.flush();
  return jsonOutput_({
    success: true,
    sheetName: ARTICLE_MEDIA_CONFIG.sheetName,
    folderId: folder.getId(),
    message: "ArticleMedia 工作表與文章圖片資料夾已完成設定。",
  });
}

/** 圖片後端健康檢查。時間 O(h)，空間 O(h)，h = 欄位數。 */
function getArticleMediaHealth_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return { ready: false, error: "找不到綁定的試算表", missingHeaders: [] };

  const sheet = spreadsheet.getSheetByName(ARTICLE_MEDIA_CONFIG.sheetName);
  if (!sheet) {
    return {
      ready: false,
      error: `缺少 ${ARTICLE_MEDIA_CONFIG.sheetName} 工作表`,
      missingHeaders: ARTICLE_MEDIA_CONFIG.headers.slice(),
    };
  }

  const headers = sheet
    .getRange(1, 1, 1, ARTICLE_MEDIA_CONFIG.headers.length)
    .getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const missingHeaders = ARTICLE_MEDIA_CONFIG.headers.filter(
    (header, index) => headers[index] !== header
  );

  return {
    ready: missingHeaders.length === 0,
    error: missingHeaders.length ? `欄位不完整：${missingHeaders.join("、")}` : "",
    missingHeaders,
  };
}

/** 公開圖片索引。時間 O(m log m)，空間 O(m)。 */
function listPublicArticleMedia_(limit) {
  const health = getArticleMediaHealth_();
  if (!health.ready) return [];
  const safeLimit = clampInteger_(limit || ARTICLE_MEDIA_CONFIG.maxItems, 1, ARTICLE_MEDIA_CONFIG.maxItems);
  return readArticleMediaRows_()
    .filter((media) => media.status === "active")
    .sort(compareArticleMedia_)
    .slice(0, safeLimit)
    .map(stripArticleMediaInternal_);
}

/** 管理員圖片索引。時間 O(m log m)，空間 O(m)。 */
function listAdminArticleMedia_() {
  const health = getArticleMediaHealth_();
  if (!health.ready) throw new Error(`${health.error || "圖片後端尚未設定"}；請先執行 setupArticleMediaLibrary。`);
  return readArticleMediaRows_()
    .sort(compareArticleMedia_)
    .map(stripArticleMediaInternal_);
}

/** 確認圖片代碼是否可使用。時間 O(m)，空間 O(m)。 */
function isArticleMediaIdAvailable_(rawId) {
  const id = sanitizeArticleMediaId_(rawId);
  if (!id) return { id: "", available: false, error: "圖片名稱格式不正確。" };
  if (ARTICLE_MEDIA_CONFIG.reservedIds.includes(id)) {
    return { id, available: false, error: `圖片名稱「${id}」已被內建圖片使用。` };
  }

  const health = getArticleMediaHealth_();
  if (!health.ready) {
    return { id, available: false, error: `${health.error || "圖片後端尚未設定"}；請先執行 setupArticleMediaLibrary。` };
  }

  const sheet = getArticleMediaSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { id, available: true, error: "" };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  const duplicated = ids.some((row) => sanitizeArticleMediaId_(row[0]) === id);
  return {
    id,
    available: !duplicated,
    error: duplicated ? `圖片名稱「${id}」已存在。` : "",
  };
}

/** 上傳圖片並新增共用圖片索引。時間 O(m + b)，空間 O(m + b)。 */
function uploadArticleMedia_(rawMedia, rawFile) {
  const media = normalizeArticleMediaInput_(rawMedia);
  const availability = isArticleMediaIdAvailable_(media.id);
  if (!availability.available) throw new Error(availability.error || "圖片名稱已存在。");

  const fileInput = rawFile && typeof rawFile === "object" ? rawFile : {};
  const rawBase64 = String(fileInput.base64 || "")
    .replace(/^data:[^;,]+;base64,/i, "")
    .replace(/\s+/g, "");
  if (!rawBase64) throw new Error("沒有收到圖片內容。");
  if (rawBase64.length > Math.ceil(ARTICLE_MEDIA_CONFIG.maxBytes * 1.5)) {
    throw new Error("圖片內容超過 6 MB 上限，請先縮小圖片。");
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(rawBase64);
  } catch (error) {
    throw new Error("圖片內容無法解碼。", { cause: error });
  }
  if (!bytes.length || bytes.length > ARTICLE_MEDIA_CONFIG.maxBytes) {
    throw new Error("圖片需小於 6 MB。");
  }

  const detected = detectArticleImageType_(bytes);
  if (!detected) throw new Error("只接受 JPEG、PNG 或 WebP 圖片。");

  const folder = getArticleMediaFolder_();
  const fileName = `${media.id}.${detected.extension}`;
  if (folder.getFilesByName(fileName).hasNext()) {
    throw new Error(`Drive 中已存在檔名「${fileName}」，請更換圖片名稱。`);
  }

  const blob = Utilities.newBlob(bytes, detected.mimeType, fileName);
  let file = null;
  try {
    file = folder.createFile(blob);
    file.setDescription(`Evan Tarot article media: ${media.id}`);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const now = new Date();
    const src = `https://drive.google.com/uc?export=view&id=${encodeURIComponent(file.getId())}`;
    const row = [
      media.id,
      file.getId(),
      fileName,
      detected.mimeType,
      src,
      media.alt,
      media.caption,
      media.creditLabel,
      media.creditUrl,
      now,
      now,
      "active",
    ];
    getArticleMediaSheet_().appendRow(row);
    SpreadsheetApp.flush();
    return stripArticleMediaInternal_(normalizeArticleMediaRow_(row, getArticleMediaSheet_().getLastRow()));
  } catch (error) {
    if (file) {
      try { file.setTrashed(true); }
      catch (cleanupError) { console.error("[article-media] 上傳失敗後清理 Drive 檔案失敗：", cleanupError); }
    }
    throw error;
  }
}

/** 批次讀取圖片資料。時間／空間 O(m)。 */
function readArticleMediaRows_() {
  const sheet = getArticleMediaSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, ARTICLE_MEDIA_CONFIG.headers.length)
    .getValues()
    .map((row, index) => normalizeArticleMediaRow_(row, index + 2))
    .filter((media) => media.id && media.src);
}

function getArticleMediaSheet_() {
  const health = getArticleMediaHealth_();
  if (!health.ready) throw new Error(`${health.error || "圖片後端尚未設定"}；請先執行 setupArticleMediaLibrary。`);
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARTICLE_MEDIA_CONFIG.sheetName);
}

/** 取得或建立專用 Drive 資料夾。時間／空間 O(1)。 */
function getArticleMediaFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const storedId = String(properties.getProperty(ARTICLE_MEDIA_CONFIG.folderIdProperty) || "").trim();
  if (storedId) {
    try { return DriveApp.getFolderById(storedId); }
    catch (error) { properties.deleteProperty(ARTICLE_MEDIA_CONFIG.folderIdProperty); }
  }

  const folder = DriveApp.createFolder(ARTICLE_MEDIA_CONFIG.folderName);
  properties.setProperty(ARTICLE_MEDIA_CONFIG.folderIdProperty, folder.getId());
  return folder;
}

function normalizeArticleMediaRow_(row, sheetRow) {
  const createdAt = parseArticleMediaDate_(row[9]);
  const updatedAt = parseArticleMediaDate_(row[10]);
  return {
    id: sanitizeArticleMediaId_(row[0]),
    fileId: sanitizeText_(row[1], 240),
    fileName: sanitizeText_(row[2], 240),
    mimeType: sanitizeText_(row[3], 80),
    src: sanitizeArticleMediaHttpUrl_(row[4]),
    alt: sanitizeText_(row[5], 500),
    caption: sanitizeText_(row[6], 1000),
    creditLabel: sanitizeText_(row[7], 160),
    creditUrl: sanitizeArticleMediaHttpUrl_(row[8]),
    createdAt: createdAt ? formatTaipeiDate_(createdAt) : "",
    updatedAt: updatedAt ? formatTaipeiDate_(updatedAt) : "",
    status: ARTICLE_MEDIA_CONFIG.statuses.includes(String(row[11] || "").trim().toLowerCase())
      ? String(row[11]).trim().toLowerCase()
      : "active",
    _createdMs: createdAt?.getTime() || 0,
    _row: sheetRow,
  };
}

function normalizeArticleMediaInput_(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const id = sanitizeArticleMediaId_(input.id);
  const alt = sanitizeText_(input.alt, 500);
  if (!id) throw new Error("圖片名稱須為 2～80 字，只能使用小寫英文、數字、連字號與底線。");
  if (!alt) throw new Error("請填寫圖片替代文字，讓圖片失效或讀屏時仍能理解內容。");
  return {
    id,
    alt,
    caption: sanitizeText_(input.caption, 1000),
    creditLabel: sanitizeText_(input.creditLabel, 160),
    creditUrl: sanitizeArticleMediaHttpUrl_(input.creditUrl),
  };
}

function sanitizeArticleMediaId_(value) {
  const id = String(value == null ? "" : value).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) ? id : "";
}

function sanitizeArticleMediaHttpUrl_(value) {
  const url = String(value == null ? "" : value).trim();
  if (!url) return "";
  return /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 1000) : "";
}

function parseArticleMediaDate_(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareArticleMedia_(left, right) {
  if (left._createdMs !== right._createdMs) return right._createdMs - left._createdMs;
  return left._row - right._row;
}

function stripArticleMediaInternal_(media) {
  const output = Object.assign({}, media);
  delete output.fileId;
  delete output.fileName;
  delete output.mimeType;
  delete output.status;
  delete output._createdMs;
  delete output._row;
  return output;
}

/** 依檔頭判斷圖片格式，避免只信任前端 MIME。時間／空間 O(1)。 */
function detectArticleImageType_(bytes) {
  const byteAt = (index) => ((Number(bytes[index]) || 0) + 256) % 256;
  if (bytes.length >= 3 && byteAt(0) === 0xFF && byteAt(1) === 0xD8 && byteAt(2) === 0xFF) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((value, index) => byteAt(index) === value)
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(byteAt(0), byteAt(1), byteAt(2), byteAt(3)) === "RIFF" &&
    String.fromCharCode(byteAt(8), byteAt(9), byteAt(10), byteAt(11)) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}
