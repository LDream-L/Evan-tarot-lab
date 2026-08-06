// Evan Tarot｜世足賽事驗證 Google Sheets 後端 v1.3.0
// 正式部署位置：綁定全新的「Evan Tarot｜世足賽事驗證資料庫」Google 試算表。
//
// 主要複雜度：
// - setupFootballWorkbook：O(s * h) 時間／O(h) 空間，s=工作表數、h=欄位數。
// - createFootballRecord：O(r + c) 時間／O(c + b) 空間，r=既有賽事列、c=本場牌數（最多 5）、b=投注筆數。
// - updateFootballMatch：O(r + h) 時間／O(h) 空間。
// - updateFootballActual：O(r) 時間／O(1) 額外空間。
// - recalculateAllFootballEvaluations：O(r * h) 時間／O(r * h) 空間。
// - listFootballRecords：O(r + c + e) 時間／O(r + c + e) 空間。
//
// 暴力替代：每次查詢逐格呼叫 Spreadsheet API，會造成大量遠端往返。
// 本版優化：每張工作表一次批次讀取、一次批次寫入，並以 Map 組合牌面與事件。
// 運彩資料直接以鎖定 prediction.bets JSON 存在賽事列，不另外建立以隊名／日期反查的下注表，
// 可保留「自己抽牌／網站隨機抽牌」與各自投注的天然父子關係，並避免 O(r*b) 關聯搜尋。
// 嚴格比分規則：單邊進球數相同不獨立計為命中，只有完整比分一致才算比分命中。

const FOOTBALL_DB_VERSION = '1.3.0';
const FOOTBALL_SCHEMA_VERSION = 'evan-football-tarot-v2';

const FOOTBALL_SHEETS = Object.freeze({
  MATCHES: 'FootballMatches',
  CARDS: 'FootballCards',
  EVENTS: 'FootballEvents',
});

const FOOTBALL_HEADERS = Object.freeze({
  FootballMatches: Object.freeze([
    'recordId', 'schemaVersion', 'modelVersion', 'mode', 'competition', 'stage', 'kickoff', 'infoState',
    'homeTeam', 'awayTeam', 'cardSource', 'knownInfo', 'homeOdds', 'drawOdds', 'awayOdds',
    'directResult', 'directConfidence', 'directNotes',
    'structureHomeGoals', 'structureAwayGoals', 'structureResult', 'structureConfidence', 'structureNotes',
    'advancePrediction', 'drawnAt', 'lockedAt', 'status',
    'actualHomeGoals', 'actualAwayGoals', 'actualResult', 'extraHomeGoals', 'extraAwayGoals',
    'actualAdvance', 'actualNotes', 'recordedAt',
    'directResultHit', 'structureResultHit', 'structureHomeGoalHit', 'structureAwayGoalHit',
    'structureExactHit', 'structureAbsoluteError', 'modelsAgree', 'updatedAt', 'betsJson'
  ]),
  FootballCards: Object.freeze([
    'recordId', 'group', 'position', 'positionTitle', 'positionNote', 'cardName', 'orientation',
    'cardOrder', 'drawnAt', 'lockedAt'
  ]),
  FootballEvents: Object.freeze([
    'eventId', 'recordId', 'eventType', 'team', 'minute', 'details', 'createdAt'
  ]),
});

/**
 * 初次建立資料庫分頁與欄位。
 * 時間複雜度：O(s * h)
 * 空間複雜度：O(h)
 */
function setupFootballWorkbook() {
  const spreadsheet = getFootballSpreadsheet_();
  Object.values(FOOTBALL_SHEETS).forEach((sheetName) => {
    const headers = FOOTBALL_HEADERS[sheetName];
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    ensureHeaders_(sheet, headers);
    formatSheet_(sheet, headers.length);
  });
  PropertiesService.getScriptProperties().setProperty('FOOTBALL_SPREADSHEET_ID', spreadsheet.getId());
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    sheets: Object.values(FOOTBALL_SHEETS),
    version: FOOTBALL_DB_VERSION,
  };
}

/**
 * Web App 健康檢查與資料讀取。
 * 時間複雜度：health 為 O(1)；list 為 O(r + c + e)
 * 空間複雜度：health 為 O(1)；list 為 O(r + c + e)
 */
function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'health');
    if (action === 'health') {
      return jsonOutput_({ ok: true, service: 'football-tarot', version: FOOTBALL_DB_VERSION });
    }
    if (action === 'list') {
      assertAuthorized_(String(e.parameter.idToken || ''));
      return jsonOutput_({ ok: true, records: listFootballRecords_() });
    }
    throw new Error('不支援的 GET action。');
  } catch (error) {
    return jsonOutput_({ ok: false, error: error.message || String(error) });
  }
}

/**
 * Web App 寫入入口。
 * 時間複雜度：依 action 為 O(r + c)、O(r + h) 或 O(r)
 * 空間複雜度：O(c + h)
 */
function doPost(e) {
  try {
    const payload = parsePayload_(e);
    assertAuthorized_(String(payload.idToken || ''));
    const action = String(payload.action || '');
    if (action === 'createRecord') {
      return jsonOutput_({ ok: true, result: createFootballRecord_(payload.record) });
    }
    if (action === 'updateMatch') {
      return jsonOutput_({ ok: true, result: updateFootballMatch_(payload.recordId, payload.match) });
    }
    if (action === 'updateActual') {
      return jsonOutput_({ ok: true, result: updateFootballActual_(payload.recordId, payload.actual) });
    }
    if (action === 'addEvent') {
      return jsonOutput_({ ok: true, result: addFootballEvent_(payload.recordId, payload.event) });
    }
    throw new Error('不支援的 POST action。');
  } catch (error) {
    return jsonOutput_({ ok: false, error: error.message || String(error) });
  }
}

/**
 * 建立一筆已鎖定的賽前紀錄；相同 recordId 重送時不重複新增。
 * 時間複雜度：O(r + c)
 * 空間複雜度：O(c + b)
 *
 * 更快替代方案比較：下注若拆成獨立表再按 recordId 逐筆 append，會增加 b 次遠端寫入；
 * 本版將已鎖定下注序列化成單一 JSON 欄位，賽事列仍只需一次 setValues。
 */
function createFootballRecord_(record) {
  validateRecord_(record);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getFootballSpreadsheet_();
    const matchesSheet = spreadsheet.getSheetByName(FOOTBALL_SHEETS.MATCHES);
    const cardsSheet = spreadsheet.getSheetByName(FOOTBALL_SHEETS.CARDS);
    const existingRow = findRecordRow_(matchesSheet, record.id);
    if (existingRow > 0) {
      return { created: false, recordId: record.id, reason: 'duplicate' };
    }

    const matchRow = buildMatchRow_(record);
    matchesSheet.getRange(matchesSheet.getLastRow() + 1, 1, 1, matchRow.length).setValues([matchRow]);

    const cardRows = record.cards.map((card, index) => [
      record.id,
      card.group || '',
      card.position || '',
      card.positionTitle || '',
      card.positionNote || '',
      card.name || '',
      card.orientation || '',
      index + 1,
      record.drawnAt || '',
      record.lockedAt || '',
    ]);
    if (cardRows.length) {
      cardsSheet.getRange(cardsSheet.getLastRow() + 1, 1, cardRows.length, cardRows[0].length).setValues(cardRows);
    }
    return { created: true, recordId: record.id };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 只修正賽事基本資料，不改動牌面、鎖定預測、投注或賽後結果。
 * 時間複雜度：O(r + h)
 * 空間複雜度：O(h)
 * 更快替代方案：逐欄 setValue 會產生多次遠端寫入；本函式整列讀取、整列寫回一次。
 */
function updateFootballMatch_(recordId, match) {
  if (!recordId) throw new Error('缺少 recordId。');
  validateEditableMatch_(match);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getFootballSpreadsheet_().getSheetByName(FOOTBALL_SHEETS.MATCHES);
    const rowNumber = findRecordRow_(sheet, recordId);
    if (rowNumber < 2) throw new Error('找不到指定紀錄。');

    const headers = FOOTBALL_HEADERS.FootballMatches;
    const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    const odds = match.odds || {};
    const updates = {
      competition: String(match.competition || '').trim(),
      stage: String(match.stage || '').trim(),
      kickoff: String(match.kickoff || '').trim(),
      infoState: String(match.infoState || '').trim(),
      homeTeam: String(match.homeTeam || '').trim(),
      awayTeam: String(match.awayTeam || '').trim(),
      knownInfo: String(match.knownInfo || '').trim(),
      homeOdds: nullable_(toNullableNumber_(odds.home)),
      drawOdds: nullable_(toNullableNumber_(odds.draw)),
      awayOdds: nullable_(toNullableNumber_(odds.away)),
      updatedAt: new Date().toISOString(),
    };

    Object.entries(updates).forEach(([key, value]) => {
      const column = headers.indexOf(key);
      if (column >= 0) row[column] = value;
    });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
    return { updated: true, recordId, updatedFields: Object.keys(updates) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 更新賽後結果與自動核對欄位。
 * 時間複雜度：O(r)
 * 空間複雜度：O(1)
 * 更快替代方案：資料達數萬列後可新增索引分頁，把 recordId 查詢降為直接列號查表。
 */
function updateFootballActual_(recordId, actual) {
  if (!recordId) throw new Error('缺少 recordId。');
  validateActual_(actual);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getFootballSpreadsheet_().getSheetByName(FOOTBALL_SHEETS.MATCHES);
    const rowNumber = findRecordRow_(sheet, recordId);
    if (rowNumber < 2) throw new Error('找不到指定紀錄。');

    const headers = FOOTBALL_HEADERS.FootballMatches;
    const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    const data = rowToObject_(headers, row);
    const evaluation = evaluateActual_(data, actual);
    const updates = {
      status: 'completed',
      actualHomeGoals: actual.homeGoals,
      actualAwayGoals: actual.awayGoals,
      actualResult: evaluation.actualResult,
      extraHomeGoals: nullable_(actual.extraHomeGoals),
      extraAwayGoals: nullable_(actual.extraAwayGoals),
      actualAdvance: actual.advance || '',
      actualNotes: actual.notes || '',
      recordedAt: actual.recordedAt || new Date().toISOString(),
      directResultHit: nullable_(evaluation.directResultHit),
      structureResultHit: nullable_(evaluation.structureResultHit),
      structureHomeGoalHit: nullable_(evaluation.structureHomeGoalHit),
      structureAwayGoalHit: nullable_(evaluation.structureAwayGoalHit),
      structureExactHit: nullable_(evaluation.structureExactHit),
      structureAbsoluteError: nullable_(evaluation.structureAbsoluteError),
      modelsAgree: nullable_(evaluation.modelsAgree),
      updatedAt: new Date().toISOString(),
    };

    Object.entries(updates).forEach(([key, value]) => {
      const column = headers.indexOf(key);
      if (column >= 0) row[column] = value;
    });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
    return { updated: true, recordId, evaluation };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 依嚴格比分規則重算試算表內所有已核對紀錄。
 * 時間複雜度：O(r * h)
 * 空間複雜度：O(r * h)
 * 更快替代方案：逐列 setValue 會產生 O(r) 次遠端寫入；本函式整批讀寫一次。
 */
function recalculateAllFootballEvaluations() {
  const sheet = getFootballSpreadsheet_().getSheetByName(FOOTBALL_SHEETS.MATCHES);
  const lastRow = sheet.getLastRow();
  const headers = FOOTBALL_HEADERS.FootballMatches;
  if (lastRow < 2) return { ok: true, updated: 0 };

  const range = sheet.getRange(2, 1, lastRow - 1, headers.length);
  const rows = range.getValues();
  const index = Object.fromEntries(headers.map((header, column) => [header, column]));
  let updated = 0;

  rows.forEach((row) => {
    const actualHomeGoals = toNullableNumber_(row[index.actualHomeGoals]);
    const actualAwayGoals = toNullableNumber_(row[index.actualAwayGoals]);
    if (!Number.isInteger(actualHomeGoals) || !Number.isInteger(actualAwayGoals)) return;

    const stored = rowToObject_(headers, row);
    const evaluation = evaluateActual_(stored, {
      homeGoals: actualHomeGoals,
      awayGoals: actualAwayGoals,
    });

    row[index.actualResult] = evaluation.actualResult;
    row[index.directResultHit] = nullable_(evaluation.directResultHit);
    row[index.structureResultHit] = nullable_(evaluation.structureResultHit);
    row[index.structureHomeGoalHit] = nullable_(evaluation.structureHomeGoalHit);
    row[index.structureAwayGoalHit] = nullable_(evaluation.structureAwayGoalHit);
    row[index.structureExactHit] = nullable_(evaluation.structureExactHit);
    row[index.structureAbsoluteError] = nullable_(evaluation.structureAbsoluteError);
    row[index.modelsAgree] = nullable_(evaluation.modelsAgree);
    row[index.updatedAt] = new Date().toISOString();
    updated += 1;
  });

  range.setValues(rows);
  return { ok: true, updated };
}

/**
 * 新增賽後特殊事件。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function addFootballEvent_(recordId, event) {
  if (!recordId) throw new Error('缺少 recordId。');
  if (!event || !event.eventType) throw new Error('缺少事件類型。');
  const sheet = getFootballSpreadsheet_().getSheetByName(FOOTBALL_SHEETS.EVENTS);
  const eventId = event.eventId || Utilities.getUuid();
  const row = [
    eventId,
    recordId,
    event.eventType,
    event.team || '',
    nullable_(event.minute),
    event.details || '',
    event.createdAt || new Date().toISOString(),
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return { created: true, eventId, recordId };
}

/**
 * 一次讀取三張表並組合完整紀錄。
 * 時間複雜度：O(r + c + e)
 * 空間複雜度：O(r + c + e)
 */
function listFootballRecords_() {
  const spreadsheet = getFootballSpreadsheet_();
  const matches = readObjects_(spreadsheet.getSheetByName(FOOTBALL_SHEETS.MATCHES));
  const cards = readObjects_(spreadsheet.getSheetByName(FOOTBALL_SHEETS.CARDS));
  const events = readObjects_(spreadsheet.getSheetByName(FOOTBALL_SHEETS.EVENTS));

  const cardsByRecord = new Map();
  cards.forEach((card) => {
    if (!cardsByRecord.has(card.recordId)) cardsByRecord.set(card.recordId, []);
    cardsByRecord.get(card.recordId).push(card);
  });
  cardsByRecord.forEach((items) => items.sort((a, b) => Number(a.cardOrder) - Number(b.cardOrder)));

  const eventsByRecord = new Map();
  events.forEach((event) => {
    if (!eventsByRecord.has(event.recordId)) eventsByRecord.set(event.recordId, []);
    eventsByRecord.get(event.recordId).push(event);
  });

  return matches.map((match) => ({
    ...match,
    cards: cardsByRecord.get(match.recordId) || [],
    events: eventsByRecord.get(match.recordId) || [],
  }));
}

/**
 * 將已鎖定 prediction 與投注序列化成單一賽事列。
 * 時間複雜度：O(b)，b = 投注筆數（JSON.stringify）。
 * 空間複雜度：O(b)。
 */
function buildMatchRow_(record) {
  const match = record.match || {};
  const prediction = record.prediction || {};
  const structureResult = Number.isInteger(prediction.structureHomeGoals) && Number.isInteger(prediction.structureAwayGoals)
    ? getResult_(prediction.structureHomeGoals, prediction.structureAwayGoals)
    : '';
  const values = {
    recordId: record.id,
    schemaVersion: FOOTBALL_SCHEMA_VERSION,
    modelVersion: record.modelVersion || '',
    mode: match.mode || '',
    competition: match.competition || '',
    stage: match.stage || '',
    kickoff: match.kickoff || '',
    infoState: match.infoState || '',
    homeTeam: match.homeTeam || '',
    awayTeam: match.awayTeam || '',
    cardSource: match.cardSource || '',
    knownInfo: match.knownInfo || '',
    homeOdds: nullable_(match.odds && match.odds.home),
    drawOdds: nullable_(match.odds && match.odds.draw),
    awayOdds: nullable_(match.odds && match.odds.away),
    directResult: prediction.directResult || '',
    directConfidence: nullable_(prediction.directConfidence),
    directNotes: prediction.directNotes || '',
    structureHomeGoals: nullable_(prediction.structureHomeGoals),
    structureAwayGoals: nullable_(prediction.structureAwayGoals),
    structureResult,
    structureConfidence: nullable_(prediction.structureConfidence),
    structureNotes: prediction.structureNotes || '',
    advancePrediction: prediction.advance || '',
    drawnAt: record.drawnAt || '',
    lockedAt: record.lockedAt || '',
    status: 'locked',
    updatedAt: new Date().toISOString(),
    betsJson: JSON.stringify(Array.isArray(prediction.bets) ? prediction.bets : []),
  };
  return FOOTBALL_HEADERS.FootballMatches.map((header) => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
}

/**
 * 嚴格比分核對：單邊進球數相同只作誤差資訊，不獨立計為命中。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function evaluateActual_(stored, actual) {
  const actualHome = Number(actual.homeGoals);
  const actualAway = Number(actual.awayGoals);
  const actualResult = getResult_(actualHome, actualAway);
  const hasDirect = stored.directResult === 'H' || stored.directResult === 'D' || stored.directResult === 'A';
  const structureHome = toNullableNumber_(stored.structureHomeGoals);
  const structureAway = toNullableNumber_(stored.structureAwayGoals);
  const hasStructure = Number.isInteger(structureHome) && Number.isInteger(structureAway);
  const structureResult = hasStructure ? getResult_(structureHome, structureAway) : '';
  const exactScoreHit = hasStructure ? structureHome === actualHome && structureAway === actualAway : null;

  return {
    actualResult,
    directResultHit: hasDirect ? stored.directResult === actualResult : null,
    structureResultHit: hasStructure ? structureResult === actualResult : null,
    // 舊欄位保留相容性，但只有完整比分命中時才為 true。
    structureHomeGoalHit: hasStructure ? exactScoreHit : null,
    structureAwayGoalHit: hasStructure ? exactScoreHit : null,
    structureExactHit: exactScoreHit,
    structureAbsoluteError: hasStructure
      ? Math.abs(structureHome - actualHome) + Math.abs(structureAway - actualAway)
      : null,
    modelsAgree: hasDirect && hasStructure ? stored.directResult === structureResult : null,
  };
}

function validateRecord_(record) {
  if (!record || !record.id || !record.match || !record.prediction || !Array.isArray(record.cards)) {
    throw new Error('賽事紀錄格式不完整。');
  }
  if (!record.match.competition || !record.match.kickoff || !record.match.homeTeam || !record.match.awayTeam) {
    throw new Error('賽事基本資料不完整。');
  }
  if (!record.lockedAt) throw new Error('只允許寫入已鎖定的賽前紀錄。');
}

function validateEditableMatch_(match) {
  if (!match || !String(match.competition || '').trim() || !String(match.kickoff || '').trim()
    || !String(match.homeTeam || '').trim() || !String(match.awayTeam || '').trim()) {
    throw new Error('賽事名稱、開賽時間與兩隊名稱不可留白。');
  }
  if (Number.isNaN(Date.parse(String(match.kickoff)))) throw new Error('開賽時間格式不正確。');

  const homeTeam = String(match.homeTeam).trim().toLowerCase();
  const awayTeam = String(match.awayTeam).trim().toLowerCase();
  if (homeTeam === awayTeam) throw new Error('主隊與客隊不能是同一支隊伍。');

  const odds = match.odds || {};
  const values = [odds.home, odds.draw, odds.away].map(toNullableNumber_);
  const count = values.filter((value) => Number.isFinite(value)).length;
  if (count !== 0 && count !== 3) throw new Error('市場賠率要嘛三項都填，要嘛全部留白。');
  if (values.some((value) => value != null && (value < 1.01 || value > 999))) {
    throw new Error('市場賠率必須介於 1.01 與 999。');
  }
}

function validateActual_(actual) {
  if (!actual || !Number.isInteger(Number(actual.homeGoals)) || !Number.isInteger(Number(actual.awayGoals))) {
    throw new Error('90 分鐘比分必須是整數。');
  }
  if (Number(actual.homeGoals) < 0 || Number(actual.awayGoals) < 0) throw new Error('比分不能小於 0。');
}

function getFootballSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty('FOOTBALL_SPREADSHEET_ID');
  if (savedId) return SpreadsheetApp.openById(savedId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('找不到綁定的 Google 試算表。請先從新試算表開啟 Apps Script。');
  return active;
}

function ensureHeaders_(sheet, headers) {
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const mismatch = headers.some((header, index) => current[index] !== header);
  if (mismatch) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function formatSheet_(sheet, columnCount) {
  sheet.setFrozenRows(1);
  const header = sheet.getRange(1, 1, 1, columnCount);
  header.setFontWeight('bold').setBackground('#31285f').setFontColor('#ffffff');
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), columnCount).createFilter();
  sheet.autoResizeColumns(1, columnCount);
  for (let column = 1; column <= columnCount; column += 1) {
    if (sheet.getColumnWidth(column) > 280) sheet.setColumnWidth(column, 280);
  }
}

function findRecordRow_(sheet, recordId) {
  if (sheet.getLastRow() < 2) return -1;
  const match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(recordId))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : -1;
}

function readObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1).filter((row) => row.some((value) => value !== '')).map((row) => rowToObject_(headers, row));
}

function rowToObject_(headers, row) {
  return headers.reduce((object, header, index) => {
    object[header] = row[index];
    return object;
  }, {});
}

function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!raw) throw new Error('缺少請求內容。');
  return JSON.parse(raw);
}

function assertAuthorized_(idToken) {
  const properties = PropertiesService.getScriptProperties();
  const clientId = properties.getProperty('GOOGLE_CLIENT_ID');
  const ownerEmail = String(properties.getProperty('OWNER_EMAIL') || '').toLowerCase();
  if (!clientId || !ownerEmail) throw new Error('尚未設定 GOOGLE_CLIENT_ID 或 OWNER_EMAIL。');
  if (!idToken) throw new Error('請先以指定 Google 帳號登入。');

  const response = UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('Google 登入憑證驗證失敗。');
  const token = JSON.parse(response.getContentText());
  if (token.aud !== clientId) throw new Error('Google 登入憑證不屬於本站。');
  if (String(token.email || '').toLowerCase() !== ownerEmail) throw new Error('此帳號沒有世足資料庫寫入權限。');
}

function getResult_(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'H';
  if (homeGoals < awayGoals) return 'A';
  return 'D';
}

function nullable_(value) {
  return value === null || value === undefined ? '' : value;
}

function toNullableNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
