const PRACTICE_SHEET_NAME = '修煉紀錄';
const ACCESS_KEY_PROPERTY = 'PRACTICE_ACCESS_KEY';
const NOTIFY_EMAIL_PROPERTY = 'PRACTICE_NOTIFY_EMAIL';

const PRACTICE_FIELDS = [
  ['practice-date', '日期'], ['practice-time', '時間'], ['practice-week', '訓練週期'],
  ['practice-session-number', '本週第幾次'], ['practice-duration', '實際完成時間（分鐘）'],
  ['practice-audio-duration', '實際音檔長度（分鐘）'], ['practice-willingness', '願意開始'],
  ['practice-mental', '精神狀態'], ['practice-fatigue', '身體疲累'], ['practice-anxiety', '焦慮或躁動'],
  ['practice-distraction', '注意力最常跑去哪裡'], ['practice-pace', '整體速度'],
  ['practice-thought-label', '想法標記是否有效'], ['practice-grounding', '腳底是否能成為穩定錨點'],
  ['practice-helpful-line', '最有幫助的一句'], ['practice-awkward-line', '最出戲的一句'],
  ['practice-repeated', '覺得重複的地方'], ['practice-speed-notes', '太快／太慢的地方'],
  ['practice-brow', '眉心感覺'], ['practice-body-sensation', '其他身體感'],
  ['practice-dizziness', '頭暈'], ['practice-head-pressure', '頭脹'], ['practice-chest-tightness', '胸悶'],
  ['practice-nausea', '噁心'], ['practice-floating', '飄忽或不真實感'], ['practice-anxiety-rise', '焦慮升高'],
  ['practice-discomfort', '其他不舒服'], ['practice-grounding-help', '腳底注意力是否有幫助'],
  ['practice-first-word', '第一個字詞'], ['practice-first-image', '第一個畫面'],
  ['practice-first-emotion', '第一個情緒'], ['practice-first-body', '第一個身體感'],
  ['practice-interpretation', '後來自己補上的解釋'], ['practice-no-content', '本次沒有明顯內容'],
  ['practice-clear-after', '睜眼後是否清楚'], ['practice-recovery-seconds', '回到正常狀態（秒）'],
  ['practice-best-reorientation', '最有效的回神步驟'], ['practice-sudden-step', '仍然太突然的步驟'],
  ['practice-card', '抽到的牌'], ['practice-card-orientation', '正逆位'],
  ['practice-awake-for-tarot', '抽牌時是否完全清醒'], ['practice-tarot-match', '冥想與牌面一致處'],
  ['practice-tarot-mismatch', '冥想與牌面不一致處'], ['practice-followup-event', '後續實際事件'],
  ['practice-after-30', '30 分鐘後狀態'], ['practice-sleep', '當晚睡眠'],
  ['practice-next-day', '隔天狀態'], ['practice-willing-next', '下次是否願意再做'],
  ['practice-next-change', '最希望下一版修改的地方']
];

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    verifyAccessKey_(payload.accessKey);

    if (payload.action === 'ping') return json_({ ok: true, message: 'authorized' });
    if (payload.action === 'upsert') {
      const result = upsertPracticeRecord_(payload.record);
      return json_({ ok: true, row: result.row, updated: result.updated });
    }
    if (payload.action === 'delete') {
      deletePracticeRecord_(payload.recordId);
      return json_({ ok: true, deleted: true });
    }
    throw new Error('不支援的 action。');
  } catch (error) {
    console.error(error);
    return json_({ ok: false, message: error.message || '接收失敗。' });
  }
}

// Time O(payload), space O(payload).
function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) throw new Error('沒有收到資料。');
  return JSON.parse(raw);
}

// Time O(k), space O(1), where k is key length.
function verifyAccessKey_(candidate) {
  const expected = PropertiesService.getScriptProperties().getProperty(ACCESS_KEY_PROPERTY);
  if (!expected) throw new Error('尚未設定 PRACTICE_ACCESS_KEY。');
  if (!timingSafeEqual_(String(candidate || ''), expected)) throw new Error('私人接收金鑰錯誤。');
}

function timingSafeEqual_(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

// Time O(1), space O(1). Headers are written in one batch instead of cell by cell.
function ensurePracticeSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(PRACTICE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(PRACTICE_SHEET_NAME);

  const headers = ['接收時間', 'Record ID', 'Created At', 'Updated At']
    .concat(PRACTICE_FIELDS.map(([, label]) => label))
    .concat(['原始 JSON']);
  const currentHeader = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const headerChanged = headers.some((header, index) => currentHeader[index] !== header);
  if (headerChanged) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Time O(n) to locate an existing ID, space O(m) for one row. A database index would be faster at high volume; this tracker is low-volume.
function upsertPracticeRecord_(record) {
  if (!record || !record.id || !record.data) throw new Error('紀錄格式不完整。');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ensurePracticeSheet_();
    const rowValues = buildRow_(record);
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    let updated = false;
    if (lastRow >= 2) {
      const match = sheet.getRange(2, 2, lastRow - 1, 1)
        .createTextFinder(record.id).matchEntireCell(true).findNext();
      if (match) {
        targetRow = match.getRow();
        updated = true;
      }
    }
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    notify_(record, updated);
    return { row: targetRow, updated };
  } finally {
    lock.releaseLock();
  }
}

function buildRow_(record) {
  const data = record.data || {};
  return [new Date(), record.id, record.createdAt || '', record.updatedAt || '']
    .concat(PRACTICE_FIELDS.map(([key]) => normalizeCell_(data[key])))
    .concat([JSON.stringify(record)]);
}

function normalizeCell_(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === null || value === undefined) return '';
  return String(value);
}

// Time O(n) because deletion first locates the ID. Low volume makes this safer than maintaining a row cache.
function deletePracticeRecord_(recordId) {
  if (!recordId) throw new Error('缺少 recordId。');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ensurePracticeSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const match = sheet.getRange(2, 2, lastRow - 1, 1)
      .createTextFinder(recordId).matchEntireCell(true).findNext();
    if (match) sheet.deleteRow(match.getRow());
  } finally {
    lock.releaseLock();
  }
}

function notify_(record, updated) {
  const email = PropertiesService.getScriptProperties().getProperty(NOTIFY_EMAIL_PROPERTY);
  if (!email) return;
  const data = record.data || {};
  const subject = `【修煉紀錄】${data['practice-date'] || '未填日期'}｜${data['practice-week'] || '未分類'}`;
  const body = [
    updated ? '既有紀錄已更新。' : '新增一筆修煉紀錄。', '',
    `日期：${data['practice-date'] || ''}`,
    `週期：${data['practice-week'] || ''}`,
    `完成時間：${data['practice-duration'] || ''} 分鐘`,
    `精神：${data['practice-mental'] || ''}/10`,
    `疲累：${data['practice-fatigue'] || ''}/10`,
    `焦慮：${data['practice-anxiety'] || ''}/10`,
    `眉心：${data['practice-brow'] || ''}`,
    `飄忽：${data['practice-floating'] || ''}`,
    `回神：${data['practice-recovery-seconds'] || ''} 秒`,
    `希望修改：${data['practice-next-change'] || ''}`, '',
    `Record ID：${record.id}`
  ].join('\n');
  MailApp.sendEmail(email, subject, body);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
