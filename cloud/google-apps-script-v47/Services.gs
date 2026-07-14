// ==============================
// 服務項目管理後端 v2
// 大方向服務＋多個價格／交付方案；私人 Google Sheets 儲存
// ==============================
//
// 主要函式複雜度：
// - setupServicesSheet：時間 O(s + p)，空間 O(p)
// - listPublishedServices_ / listAdminServices_：時間 O(n log n + p log p)，空間 O(n + p)
// - saveService_ / deleteService_：時間 O(n + p)，空間 O(n + p)
//
// 更快替代方案比較：
// - 每一個價格方案各自建立一列服務：資料重複，修改大方向文案時容易分歧。
// - 本實作：Services 一列代表一個大方向，方案以 plansJson 儲存在同列；公開與管理讀取時一次解析，
//   適合目前單一管理者、每個服務少量方案的規模。若未來方案數量大量增加，再拆成 ServicePlans 工作表。
// ==============================

const SERVICES_CONFIG = Object.freeze({
  sheetName: "Services",
  maxListLimit: 100,
  maxPlansPerService: 20,
  statuses: ["draft", "published", "archived"],
  planStatuses: ["published", "hidden"],
  deliveryModes: ["text", "voice", "flexible", "custom"],
  legacyHeaders: [
    "id", "status", "updatedAt", "title", "summary", "suitableFor", "focus",
    "priceLabel", "durationLabel", "deliveryLabel", "followUpLabel", "policyNote",
    "bookingTopic", "sortOrder", "internalNote",
  ],
  headers: [
    "id", "status", "updatedAt", "title", "summary", "suitableFor", "focus",
    "priceLabel", "durationLabel", "deliveryLabel", "followUpLabel", "policyNote",
    "bookingTopic", "sortOrder", "internalNote", "plansJson",
  ],
  widths: [180, 100, 165, 260, 420, 260, 260, 180, 180, 220, 220, 360, 160, 90, 320, 620],
});

const SERVICES_SEED = Object.freeze([
  {
    id: "relationship", status: "published", title: "人際 / 感情動態占卜",
    summary: "釐清你與某個對象的互動狀態，整理目前適合前進、暫停，或把重心拉回自己的方向。",
    suitableFor: ["曖昧", "忽冷忽熱", "斷聯", "合作對象"],
    focus: ["雙方狀態", "現在能做什麼", "不該做什麼"],
    priceLabel: "費用依問題規模與交付形式確認", durationLabel: "依問題範圍確認",
    deliveryLabel: "文字或語音", followUpLabel: "追問範圍於預約前確認",
    policyNote: "送出需求不代表預約成立。", bookingTopic: "relationship", sortOrder: 30,
    internalNote: "由原 services.html 匯入", plans: [],
  },
  {
    id: "career", status: "published", title: "工作 / 職涯路線占卜",
    summary: "整理工作場域氛圍、你在其中的位置，以及跳槽、續留或轉向的風險與機會。",
    suitableFor: ["轉職前後", "升遷機會", "團隊磨合"],
    focus: ["階段性課題", "決策方向", "現實限制"],
    priceLabel: "費用依問題規模與交付形式確認", durationLabel: "依問題範圍確認",
    deliveryLabel: "文字或語音", followUpLabel: "追問範圍於預約前確認",
    policyNote: "不取代職涯、法律或財務專業意見。", bookingTopic: "career", sortOrder: 20,
    internalNote: "由原 services.html 匯入", plans: [],
  },
  {
    id: "deep-topic", status: "published", title: "主題深度占卜",
    summary: "針對目前最在意的一個核心主題，進行較完整的牌陣與路線整理，可合併人際、工作與自我。",
    suitableFor: ["卡很久的大問題", "不知道從哪裡切入", "多個面向互相影響"],
    focus: ["問題結構", "可能路線", "後續追蹤"],
    priceLabel: "費用依問題規模與交付形式確認", durationLabel: "依問題範圍確認",
    deliveryLabel: "文字或語音", followUpLabel: "追問範圍於預約前確認",
    policyNote: "複雜主題會先確認是否適合承接。", bookingTopic: "deep-topic", sortOrder: 10,
    internalNote: "由原 services.html 匯入", plans: [],
  },
]);

function setupServicesSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("此 Apps Script 必須綁定在 Google 試算表內。");
  spreadsheet.setSpreadsheetTimeZone(COMMENTS_CONFIG.timeZone);
  let sheet = spreadsheet.getSheetByName(SERVICES_CONFIG.sheetName);
  const existed = Boolean(sheet);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SERVICES_CONFIG.sheetName);
    sheet.getRange(1, 1, 1, SERVICES_CONFIG.headers.length).setValues([SERVICES_CONFIG.headers]);
  } else {
    upgradeServicesSheetSchema_(sheet);
  }
  styleServicesSheet_(sheet);
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
    success: true, sheetName: SERVICES_CONFIG.sheetName, seeded: !existed, schemaVersion: 2,
    message: "Services 工作表已完成設定，可在每個大方向下建立多個價格與交付方案。",
  });
}

function upgradeServicesSheetSchema_(sheet) {
  const existingCount = Math.max(sheet.getLastColumn(), SERVICES_CONFIG.legacyHeaders.length);
  const actual = sheet.getRange(1, 1, 1, existingCount).getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const fullMatches = SERVICES_CONFIG.headers.every((header, index) => actual[index] === header);
  if (fullMatches) return sheet;
  const legacyMatches = SERVICES_CONFIG.legacyHeaders.every((header, index) => actual[index] === header);
  const planHeader = actual[SERVICES_CONFIG.legacyHeaders.length] || "";
  if (legacyMatches && (!planHeader || planHeader === "plansJson")) {
    sheet.getRange(1, SERVICES_CONFIG.headers.length).setValue("plansJson");
    return sheet;
  }
  throw new Error("Services 工作表欄位順序與正式格式不一致，請先備份後再人工核對。");
}

function styleServicesSheet_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, SERVICES_CONFIG.headers.length);
  headerRange.setValues([SERVICES_CONFIG.headers]);
  headerRange.setFontWeight("bold").setBackground("#30275f").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  SERVICES_CONFIG.widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.getRange("C:C").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("E:G").setWrap(true).setVerticalAlignment("top");
  sheet.getRange("L:L").setWrap(true).setVerticalAlignment("top");
  sheet.getRange("O:P").setWrap(true).setVerticalAlignment("top");
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SERVICES_CONFIG.statuses, true).setAllowInvalid(false).build();
  const validationRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 2, validationRows, 1).setDataValidation(statusRule);
  sheet.getRange(1, 1, 1, SERVICES_CONFIG.headers.length).setNotes([[
    "服務識別碼，只能使用小寫英文、數字、連字號與底線；建立後不要任意更改。",
    "draft=草稿、published=公開、archived=封存。", "最近更新時間，由後台自動寫入。",
    "公開服務大方向名稱。", "公開服務簡介。", "適合情境，每行一項。", "整理重點，每行一項。",
    "沒有建立方案時使用的備援費用文字。", "沒有建立方案時使用的備援時間文字。",
    "沒有建立方案時使用的備援交付內容。", "沒有建立方案時使用的備援追問範圍。",
    "公開改期、取消、退款或承接界線。", "沒有建立方案時的預約表單值，建議使用服務 ID。",
    "數字越大越前面。", "私人備註，不會傳到網站。",
    "方案 JSON，由網站後台管理。每個方案可設定問題規模、文字／語音、價格、工期、計算量與追問。",
  ]]);
}

function showServicesHealth_() {
  const health = getServicesHealth_();
  SpreadsheetApp.getUi().alert(
    health.ready ? "Services 工作表格式正常，已支援多方案價格。" : `服務後端尚未完成：${health.error || "缺少 Services 工作表"}`
  );
}

function getServicesHealth_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return { ready: false, error: "找不到綁定的試算表", missingHeaders: [] };
  const sheet = spreadsheet.getSheetByName(SERVICES_CONFIG.sheetName);
  if (!sheet) return { ready: false, error: `缺少 ${SERVICES_CONFIG.sheetName} 工作表`, missingHeaders: SERVICES_CONFIG.headers.slice() };
  try { upgradeServicesSheetSchema_(sheet); }
  catch (error) { return { ready: false, error: String(error?.message || error), missingHeaders: [] }; }
  const headers = sheet.getRange(1, 1, 1, SERVICES_CONFIG.headers.length).getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const missingHeaders = SERVICES_CONFIG.headers.filter((header, index) => headers[index] !== header);
  return { ready: missingHeaders.length === 0, error: missingHeaders.length ? `欄位不完整：${missingHeaders.join("、")}` : "", missingHeaders, schemaVersion: 2 };
}

function listPublishedServices_(limit) {
  const safeLimit = clampInteger_(limit || SERVICES_CONFIG.maxListLimit, 1, SERVICES_CONFIG.maxListLimit);
  return readServiceRows_().map((entry) => normalizePublicServiceRow_(entry.row, entry.sheetRow))
    .filter(Boolean).sort(compareServiceEntries_).slice(0, safeLimit).map(stripServiceSortFields_);
}

function listAdminServices_() {
  return readServiceRows_().map((entry) => normalizeAdminServiceRow_(entry.row, entry.sheetRow))
    .filter((service) => service.id).sort(compareServiceEntries_).map(stripServiceSortFields_);
}

function saveService_(rawService, rawOriginalId, actorEmail, requestId) {
  const service = normalizeServiceInput_(rawService);
  const originalId = sanitizeServiceId_(rawOriginalId);
  const sheet = getServicesSheet_();
  const lastRow = sheet.getLastRow();
  const idValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map((row) => sanitizeServiceId_(row[0])) : [];
  let targetRow = 0;
  let duplicateRow = 0;
  for (let index = 0; index < idValues.length; index += 1) {
    const rowId = idValues[index];
    if (rowId === originalId) targetRow = index + 2;
    if (rowId === service.id) duplicateRow = index + 2;
  }
  if (duplicateRow && (!targetRow || duplicateRow !== targetRow)) throw new Error(`服務 ID「${service.id}」已存在。`);
  const before = targetRow
    ? stripServiceSortFields_(normalizeAdminServiceRow_(sheet.getRange(targetRow, 1, 1, SERVICES_CONFIG.headers.length).getValues()[0], targetRow)) : null;
  const values = serviceInputToRow_(service, new Date());
  if (targetRow) sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  SpreadsheetApp.flush();
  const saved = stripServiceSortFields_(normalizeAdminServiceRow_(values, targetRow || sheet.getLastRow()));
  if (typeof appendAdminHistory_ === "function") appendAdminHistory_("service", before ? "update" : "create", service.id, before, saved, actorEmail, requestId);
  return saved;
}

function deleteService_(rawId, actorEmail, requestId) {
  const id = sanitizeServiceId_(rawId);
  if (!id) throw new Error("服務 ID 不正確。");
  const sheet = getServicesSheet_();
  const lastRow = sheet.getLastRow();
  // 刪除採冪等設計：若前一次請求其實已成功，重送時仍回傳成功狀態，
  // 避免管理頁停留在舊快照並把「已刪除」誤顯示成失敗。
  if (lastRow <= 1) return { id, deleted: false, alreadyAbsent: true };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (sanitizeServiceId_(ids[index][0]) !== id) continue;
    const rowNumber = index + 2;
    const before = stripServiceSortFields_(normalizeAdminServiceRow_(
      sheet.getRange(rowNumber, 1, 1, SERVICES_CONFIG.headers.length).getValues()[0], rowNumber
    ));
    if (typeof appendAdminHistory_ === "function") appendAdminHistory_("service", "delete", id, before, null, actorEmail, requestId);
    sheet.deleteRow(rowNumber);
    SpreadsheetApp.flush();
    return { id, deleted: true };
  }
  return { id, deleted: false, alreadyAbsent: true };
}

function getServicesSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");
  const sheet = spreadsheet.getSheetByName(SERVICES_CONFIG.sheetName);
  if (!sheet) throw new Error("缺少 Services 工作表，請先執行 setupServicesSheet。");
  upgradeServicesSheetSchema_(sheet);
  return sheet;
}

function readServiceRows_() {
  const sheet = getServicesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, SERVICES_CONFIG.headers.length).getValues();
  return values.map((row, index) => ({ row, sheetRow: index + 2 }));
}

function normalizePublicServiceRow_(row, sheetRow) {
  if (String(row[1] || "draft").trim().toLowerCase() !== "published") return null;
  const service = normalizeAdminServiceRow_(row, sheetRow);
  if (!service.id || !service.title || !service.summary) return null;
  service.plans = service.plans.filter((plan) => plan.status === "published");
  delete service.internalNote;
  return service;
}

function normalizeAdminServiceRow_(row, sheetRow) {
  const id = sanitizeServiceId_(row[0]);
  const sortOrder = Number(row[13]) || 0;
  return {
    id, status: String(row[1] || "draft").trim().toLowerCase(), updatedAt: formatTaipeiDate_(row[2] || new Date()),
    title: sanitizeText_(row[3], 120), summary: sanitizeText_(row[4], 600),
    suitableFor: parseServiceList_(row[5]), focus: parseServiceList_(row[6]),
    priceLabel: sanitizeText_(row[7], 120), durationLabel: sanitizeText_(row[8], 120),
    deliveryLabel: sanitizeText_(row[9], 160), followUpLabel: sanitizeText_(row[10], 160),
    policyNote: sanitizeText_(row[11], 600), bookingTopic: sanitizeServiceId_(row[12]) || id,
    sortOrder, internalNote: sanitizeText_(row[14], 1000), plans: parseServicePlans_(row[15], id),
    _sortOrder: sortOrder, _row: sheetRow,
  };
}

function compareServiceEntries_(left, right) {
  if (left._sortOrder !== right._sortOrder) return right._sortOrder - left._sortOrder;
  return left._row - right._row;
}

function stripServiceSortFields_(service) {
  const output = Object.assign({}, service);
  delete output._sortOrder;
  delete output._row;
  return output;
}

function normalizeServiceInput_(raw) {
  const service = raw && typeof raw === "object" ? raw : {};
  const id = sanitizeServiceId_(service.id);
  const status = String(service.status || "draft").trim().toLowerCase();
  const title = sanitizeText_(service.title, 120);
  const summary = sanitizeText_(service.summary, 600);
  const bookingTopic = sanitizeServiceId_(service.bookingTopic) || id;
  const sortOrder = Number(service.sortOrder || 0);
  const plans = normalizeServicePlans_(service.plans, id, true);
  if (!id) throw new Error("服務 ID 須為 2～80 字，只能使用小寫英文、數字、連字號與底線。");
  if (!SERVICES_CONFIG.statuses.includes(status)) throw new Error("服務狀態不正確。");
  if (!title) throw new Error("服務名稱不可空白。");
  if (!summary) throw new Error("服務簡介不可空白。");
  if (!bookingTopic) throw new Error("預約表單值不正確。");
  if (!Number.isFinite(sortOrder)) throw new Error("排序值必須是數字。");
  return {
    id, status, title, summary, suitableFor: normalizeServiceList_(service.suitableFor), focus: normalizeServiceList_(service.focus),
    priceLabel: sanitizeText_(service.priceLabel, 120), durationLabel: sanitizeText_(service.durationLabel, 120),
    deliveryLabel: sanitizeText_(service.deliveryLabel, 160), followUpLabel: sanitizeText_(service.followUpLabel, 160),
    policyNote: sanitizeText_(service.policyNote, 600), bookingTopic, sortOrder,
    internalNote: sanitizeText_(service.internalNote, 1000), plans,
  };
}

function serviceInputToRow_(service, updatedAt) {
  const normalized = normalizeServiceInput_(service);
  return [
    normalized.id, normalized.status, updatedAt || new Date(), normalized.title, normalized.summary,
    normalized.suitableFor.join("\n"), normalized.focus.join("\n"), normalized.priceLabel,
    normalized.durationLabel, normalized.deliveryLabel, normalized.followUpLabel, normalized.policyNote,
    normalized.bookingTopic, normalized.sortOrder, normalized.internalNote, JSON.stringify(normalized.plans),
  ];
}

function normalizeServicePlans_(value, serviceId, strict) {
  const source = Array.isArray(value) ? value : [];
  if (source.length > SERVICES_CONFIG.maxPlansPerService) throw new Error(`每個服務最多 ${SERVICES_CONFIG.maxPlansPerService} 個方案。`);
  const usedIds = new Set();
  const plans = source.map((rawPlan, index) => {
    const plan = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
    const id = sanitizeServiceId_(plan.id);
    const status = String(plan.status || "published").trim().toLowerCase();
    const title = sanitizeText_(plan.title, 120);
    const priceLabel = sanitizeText_(plan.priceLabel, 120);
    const deliveryMode = String(plan.deliveryMode || "custom").trim().toLowerCase();
    const deliveryLabel = sanitizeText_(plan.deliveryLabel, 160);
    const sortOrder = Number(plan.sortOrder || 0);
    if (!id) throw new Error(`第 ${index + 1} 個方案 ID 不正確。`);
    if (usedIds.has(id)) throw new Error(`方案 ID「${id}」重複。`);
    usedIds.add(id);
    if (!SERVICES_CONFIG.planStatuses.includes(status)) throw new Error(`方案「${id}」狀態不正確。`);
    if (!SERVICES_CONFIG.deliveryModes.includes(deliveryMode)) throw new Error(`方案「${id}」交付模式不正確。`);
    if (!title) throw new Error(`方案「${id}」名稱不可空白。`);
    if (!Number.isFinite(sortOrder)) throw new Error(`方案「${id}」排序值必須是數字。`);
    if (strict && status === "published" && !priceLabel) throw new Error(`已公開方案「${title}」必須填寫價格。`);
    if (strict && status === "published" && !deliveryLabel) throw new Error(`已公開方案「${title}」必須填寫交付內容。`);
    return {
      id, status, title, description: sanitizeText_(plan.description, 500), priceLabel,
      durationLabel: sanitizeText_(plan.durationLabel, 120), deliveryMode, deliveryLabel,
      followUpLabel: sanitizeText_(plan.followUpLabel, 160), calculationLabel: sanitizeText_(plan.calculationLabel, 240),
      sortOrder, bookingValue: buildServicePlanBookingValue_(serviceId, id),
    };
  });
  return plans.sort((left, right) => left.sortOrder !== right.sortOrder
    ? right.sortOrder - left.sortOrder : left.title.localeCompare(right.title, "zh-Hant"));
}

function parseServicePlans_(rawValue, serviceId) {
  const text = String(rawValue || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return normalizeServicePlans_(Array.isArray(parsed) ? parsed : [], serviceId, false);
  } catch (error) {
    console.error(`[Services] ${serviceId || "unknown"} plansJson 解析失敗：`, error);
    return [];
  }
}

function buildServicePlanBookingValue_(serviceId, planId) {
  const service = sanitizeServiceId_(serviceId);
  const plan = sanitizeServiceId_(planId);
  return service && plan ? `${service}--${plan}`.slice(0, 80) : "";
}

function normalizeServiceList_(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n|、|,/);
  return source.map((item) => sanitizeText_(item, 120)).filter(Boolean).slice(0, 12);
}

function parseServiceList_(value) { return normalizeServiceList_(String(value || "").split(/\r?\n/)); }

function sanitizeServiceId_(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) ? id : "";
}
