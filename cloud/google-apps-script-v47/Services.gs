// ==============================
// 服務項目管理後端
// 私人 Google Sheets 儲存；公開 API 僅輸出已發布服務
// ==============================
//
// 主要函式複雜度：
// - setupServicesSheet：時間／空間 O(s)，s = 預設服務數
// - listPublishedServices_：時間 O(n log n)，空間 O(n)
// - listAdminServices_：時間 O(n log n)，空間 O(n)
// - saveService_ / deleteService_：時間 O(n)，空間 O(n)
//
// 更快替代方案比較：
// - 暴力法：每次調整費用都修改 GitHub HTML 並重新部署網站。
// - 本實作：服務集中在私人 Services 工作表；公開頁只讀已發布欄位，管理操作依 ID 單次掃描定位資料列。
// ==============================

const SERVICES_CONFIG = Object.freeze({
  sheetName: "Services",
  maxListLimit: 100,
  statuses: ["draft", "published", "archived"],
  headers: [
    "id",
    "status",
    "updatedAt",
    "title",
    "summary",
    "suitableFor",
    "focus",
    "priceLabel",
    "durationLabel",
    "deliveryLabel",
    "followUpLabel",
    "policyNote",
    "bookingTopic",
    "sortOrder",
    "internalNote",
  ],
  widths: [180, 100, 165, 260, 420, 260, 260, 180, 180, 220, 220, 360, 160, 90, 320],
});

const SERVICES_SEED = Object.freeze([
  {
    id: "relationship",
    status: "published",
    title: "人際 / 感情動態占卜",
    summary: "釐清你與某個對象的互動狀態，整理目前適合前進、暫停，或把重心拉回自己的方向。",
    suitableFor: ["曖昧", "忽冷忽熱", "斷聯", "合作對象"],
    focus: ["雙方狀態", "現在能做什麼", "不該做什麼"],
    priceLabel: "費用於確認承接時說明",
    durationLabel: "依問題範圍確認",
    deliveryLabel: "文字或語音",
    followUpLabel: "追問範圍於預約前確認",
    policyNote: "送出需求不代表預約成立。",
    bookingTopic: "relationship",
    sortOrder: 30,
    internalNote: "由原 services.html 匯入",
  },
  {
    id: "career",
    status: "published",
    title: "工作 / 職涯路線占卜",
    summary: "整理工作場域氛圍、你在其中的位置，以及跳槽、續留或轉向的風險與機會。",
    suitableFor: ["轉職前後", "升遷機會", "團隊磨合"],
    focus: ["階段性課題", "決策方向", "現實限制"],
    priceLabel: "費用於確認承接時說明",
    durationLabel: "依問題範圍確認",
    deliveryLabel: "文字或語音",
    followUpLabel: "追問範圍於預約前確認",
    policyNote: "不取代職涯、法律或財務專業意見。",
    bookingTopic: "career",
    sortOrder: 20,
    internalNote: "由原 services.html 匯入",
  },
  {
    id: "deep-topic",
    status: "published",
    title: "主題深度占卜",
    summary: "針對目前最在意的一個核心主題，進行較完整的牌陣與路線整理，可合併人際、工作與自我。",
    suitableFor: ["卡很久的大問題", "不知道從哪裡切入", "多個面向互相影響"],
    focus: ["問題結構", "可能路線", "後續追蹤"],
    priceLabel: "費用於確認承接時說明",
    durationLabel: "依問題範圍確認",
    deliveryLabel: "文字或語音",
    followUpLabel: "追問範圍於預約前確認",
    policyNote: "複雜主題會先確認是否適合承接。",
    bookingTopic: "deep-topic",
    sortOrder: 10,
    internalNote: "由原 services.html 匯入",
  },
]);

/** 建立 Services 工作表並匯入既有三項服務。時間／空間 O(s)。 */
function setupServicesSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");

  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);
  const existed = Boolean(spreadsheet.getSheetByName(SERVICES_CONFIG.sheetName));
  const sheet = setupSheet_(
    spreadsheet,
    SERVICES_CONFIG.sheetName,
    SERVICES_CONFIG.headers,
    SERVICES_CONFIG.widths
  );

  sheet.setFrozenRows(1);
  sheet.getRange("C:C").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("E:G").setWrap(true).setVerticalAlignment("top");
  sheet.getRange("L:L").setWrap(true).setVerticalAlignment("top");
  sheet.getRange("O:O").setWrap(true).setVerticalAlignment("top");

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SERVICES_CONFIG.statuses, true)
    .setAllowInvalid(false)
    .build();
  const validationRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 2, validationRows, 1).setDataValidation(statusRule);

  sheet.getRange(1, 1, 1, SERVICES_CONFIG.headers.length).setNotes([[
    "服務識別碼，只能使用小寫英文、數字、連字號與底線；建立後不要任意更改。",
    "draft=草稿、published=公開、archived=封存。",
    "最近更新時間，由後台自動寫入。",
    "公開服務名稱。",
    "公開服務簡介。",
    "適合情境，每行一項。",
    "整理重點，每行一項。",
    "公開費用文字，例如 NT$800／次。",
    "公開時間或工期說明。",
    "公開交付內容。",
    "公開追問範圍。",
    "公開改期、取消、退款或承接界線。",
    "預約表單保存值，建議使用服務 ID。",
    "數字越大越前面。",
    "私人備註，不會傳到網站。",
  ]]);

  if (!existed || sheet.getLastRow() <= 1) {
    const now = new Date();
    const rows = SERVICES_SEED.map((service) => serviceInputToRow_(service, now));
    if (rows.length) sheet.getRange(2, 1, rows.length, SERVICES_CONFIG.headers.length).setValues(rows);
  }

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), SERVICES_CONFIG.headers.length).createFilter();
  }

  SpreadsheetApp.flush();
  return jsonOutput_({
    success: true,
    sheetName: SERVICES_CONFIG.sheetName,
    seeded: !existed,
    message: "Services 工作表已建立，可由網站後台新增、編輯或封存服務。",
  });
}

function showServicesHealth_() {
  const health = getServicesHealth_();
  SpreadsheetApp.getUi().alert(
    health.ready
      ? "Services 工作表格式正常。"
      : `服務後端尚未完成：${health.error || "缺少 Services 工作表"}`
  );
}

/** 檢查服務工作表欄位。時間／空間 O(h)，h = 固定欄位數。 */
function getServicesHealth_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return { ready: false, error: "找不到綁定的試算表", missingHeaders: [] };

  const sheet = spreadsheet.getSheetByName(SERVICES_CONFIG.sheetName);
  if (!sheet) {
    return {
      ready: false,
      error: `缺少 ${SERVICES_CONFIG.sheetName} 工作表`,
      missingHeaders: SERVICES_CONFIG.headers.slice(),
    };
  }

  const headers = sheet
    .getRange(1, 1, 1, SERVICES_CONFIG.headers.length)
    .getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const missingHeaders = SERVICES_CONFIG.headers.filter((header, index) => headers[index] !== header);
  return {
    ready: missingHeaders.length === 0,
    error: missingHeaders.length ? `欄位不完整：${missingHeaders.join("、")}` : "",
    missingHeaders,
  };
}

/** 公開服務列表。時間 O(n log n)，空間 O(n)。 */
function listPublishedServices_(limit) {
  const safeLimit = clampInteger_(limit || SERVICES_CONFIG.maxListLimit, 1, SERVICES_CONFIG.maxListLimit);
  return readServiceRows_()
    .map((entry) => normalizePublicServiceRow_(entry.row, entry.sheetRow))
    .filter(Boolean)
    .sort(compareServiceEntries_)
    .slice(0, safeLimit)
    .map(stripServiceSortFields_);
}

/** 管理員服務列表。時間 O(n log n)，空間 O(n)。 */
function listAdminServices_() {
  return readServiceRows_()
    .map((entry) => normalizeAdminServiceRow_(entry.row, entry.sheetRow))
    .filter((service) => service.id)
    .sort(compareServiceEntries_)
    .map(stripServiceSortFields_);
}

/** 儲存單一服務。時間 O(n)，空間 O(n)。 */
function saveService_(rawService, rawOriginalId) {
  const service = normalizeServiceInput_(rawService);
  const originalId = sanitizeServiceId_(rawOriginalId) || service.id;
  const sheet = getServicesSheet_();
  const lastRow = sheet.getLastRow();
  const idValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map((row) => sanitizeServiceId_(row[0]))
    : [];

  let targetRow = 0;
  let duplicateRow = 0;
  for (let index = 0; index < idValues.length; index += 1) {
    const rowId = idValues[index];
    if (rowId === originalId) targetRow = index + 2;
    if (rowId === service.id) duplicateRow = index + 2;
  }

  if (duplicateRow && duplicateRow !== targetRow) {
    throw new Error(`服務 ID「${service.id}」已存在。`);
  }

  const now = new Date();
  const values = serviceInputToRow_(service, now);
  if (targetRow) sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  SpreadsheetApp.flush();

  return normalizeAdminServiceRow_(values, targetRow || sheet.getLastRow());
}

/** 永久刪除單一服務。時間 O(n)，空間 O(n)。 */
function deleteService_(rawId) {
  const id = sanitizeServiceId_(rawId);
  if (!id) throw new Error("服務 ID 不正確。");

  const sheet = getServicesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) throw new Error("找不到指定服務。");

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (sanitizeServiceId_(ids[index][0]) !== id) continue;
    sheet.deleteRow(index + 2);
    SpreadsheetApp.flush();
    return { id, deleted: true };
  }
  throw new Error("找不到指定服務。");
}

function getServicesSheet_() {
  const health = getServicesHealth_();
  if (!health.ready) throw new Error(health.error || "服務後端尚未完成設定。");
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SERVICES_CONFIG.sheetName);
}

function readServiceRows_() {
  const sheet = getServicesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, SERVICES_CONFIG.headers.length).getValues();
  return values.map((row, index) => ({ row, sheetRow: index + 2 }));
}

function normalizePublicServiceRow_(row, sheetRow) {
  const status = String(row[1] || "draft").trim().toLowerCase();
  if (status !== "published") return null;
  const service = normalizeAdminServiceRow_(row, sheetRow);
  if (!service.id || !service.title || !service.summary) return null;
  return service;
}

function normalizeAdminServiceRow_(row, sheetRow) {
  const id = sanitizeServiceId_(row[0]);
  const sortOrder = Number(row[13]) || 0;
  return {
    id,
    status: String(row[1] || "draft").trim().toLowerCase(),
    updatedAt: formatTaipeiDate_(row[2] || new Date()),
    title: sanitizeText_(row[3], 120),
    summary: sanitizeText_(row[4], 600),
    suitableFor: parseServiceList_(row[5]),
    focus: parseServiceList_(row[6]),
    priceLabel: sanitizeText_(row[7], 120),
    durationLabel: sanitizeText_(row[8], 120),
    deliveryLabel: sanitizeText_(row[9], 160),
    followUpLabel: sanitizeText_(row[10], 160),
    policyNote: sanitizeText_(row[11], 600),
    bookingTopic: sanitizeServiceId_(row[12]) || id,
    sortOrder,
    internalNote: sanitizeText_(row[14], 1000),
    _sortOrder: sortOrder,
    _row: sheetRow,
  };
}

function compareServiceEntries_(left, right) {
  if (left._sortOrder !== right._sortOrder) return right._sortOrder - left._sortOrder;
  return left._row - right._row;
}

function stripServiceSortFields_(service) {
  const publicService = Object.assign({}, service);
  delete publicService._sortOrder;
  delete publicService._row;
  return publicService;
}

function normalizeServiceInput_(raw) {
  const service = raw && typeof raw === "object" ? raw : {};
  const id = sanitizeServiceId_(service.id);
  const status = String(service.status || "draft").trim().toLowerCase();
  const title = sanitizeText_(service.title, 120);
  const summary = sanitizeText_(service.summary, 600);
  const bookingTopic = sanitizeServiceId_(service.bookingTopic) || id;
  const sortOrder = Number(service.sortOrder || 0);

  if (!id) throw new Error("服務 ID 須為 2～80 字，只能使用小寫英文、數字、連字號與底線。");
  if (!SERVICES_CONFIG.statuses.includes(status)) throw new Error("服務狀態不正確。");
  if (!title) throw new Error("服務名稱不可空白。");
  if (!summary) throw new Error("服務簡介不可空白。");
  if (!bookingTopic) throw new Error("預約表單值不正確。");
  if (!Number.isFinite(sortOrder)) throw new Error("排序值必須是數字。");

  return {
    id,
    status,
    title,
    summary,
    suitableFor: normalizeServiceList_(service.suitableFor),
    focus: normalizeServiceList_(service.focus),
    priceLabel: sanitizeText_(service.priceLabel, 120),
    durationLabel: sanitizeText_(service.durationLabel, 120),
    deliveryLabel: sanitizeText_(service.deliveryLabel, 160),
    followUpLabel: sanitizeText_(service.followUpLabel, 160),
    policyNote: sanitizeText_(service.policyNote, 600),
    bookingTopic,
    sortOrder,
    internalNote: sanitizeText_(service.internalNote, 1000),
  };
}

function serviceInputToRow_(service, updatedAt) {
  const normalized = normalizeServiceInput_(service);
  return [
    normalized.id,
    normalized.status,
    updatedAt || new Date(),
    normalized.title,
    normalized.summary,
    normalized.suitableFor.join("\n"),
    normalized.focus.join("\n"),
    normalized.priceLabel,
    normalized.durationLabel,
    normalized.deliveryLabel,
    normalized.followUpLabel,
    normalized.policyNote,
    normalized.bookingTopic,
    normalized.sortOrder,
    normalized.internalNote,
  ];
}

function normalizeServiceList_(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n|、|,/);
  return source
    .map((item) => sanitizeText_(item, 120))
    .filter(Boolean)
    .slice(0, 12);
}

function parseServiceList_(value) {
  return normalizeServiceList_(String(value || "").split(/\r?\n/));
}

function sanitizeServiceId_(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) ? id : "";
}
