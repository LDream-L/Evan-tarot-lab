const PRACTICE_SHEET_NAME = '修煉紀錄';
const ACCESS_KEY_PROPERTY = 'PRACTICE_ACCESS_KEY';
const NOTIFY_EMAIL_PROPERTY = 'PRACTICE_NOTIFY_EMAIL';

const PRACTICE_FIELDS = [
  ['practice-date', '日期'], ['practice-time', '時間'], ['practice-week', '訓練週期代碼'],
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
  ['practice-first-word', '第一個字'], ['practice-first-image', '第一個畫面'],
  ['practice-first-emotion', '第一個情緒'], ['practice-first-body', '第一個身體感'],
  ['practice-interpretation', '後來自己補上的解釋'], ['practice-no-content', '本次沒有明顯內容'],
  ['practice-clear-after', '睜眼後是否清楚'], ['practice-recovery-seconds', '回到正常狀態（秒）'],
  ['practice-best-reorientation', '最有效的回神步驟'], ['practice-sudden-step', '仍然太突然的步驟'],
  ['practice-card', '抽到的牌'], ['practice-card-orientation', '正逆位'],
  ['practice-awake-for-tarot', '抽牌前是否已完全清醒'], ['practice-tarot-match', '共同點'],
  ['practice-tarot-mismatch', '不同點'], ['practice-followup-event', '後續實際事件'],
  ['practice-after-30', '30 分鐘後狀態'], ['practice-sleep', '當晚睡眠'],
  ['practice-next-day', '隔天狀態'], ['practice-willing-next', '下一次是否願意再做'],
  ['practice-next-change', '最希望下一版修改的地方']
];

const PRACTICE_EMAIL_SECTIONS = Object.freeze([
  Object.freeze({
    title: '基本資料',
    fields: [
      ['practice-date', '日期'], ['practice-time', '時間'],
      ['practice-session-number', '本週第幾次'],
      ['practice-duration', '實際完成時間', '分鐘'],
      ['practice-audio-duration', '實際音檔長度', '分鐘']
    ]
  }),
  Object.freeze({
    title: '開始前狀態',
    fields: [
      ['practice-willingness', '願意開始', '/10'],
      ['practice-mental', '精神狀態', '/10'],
      ['practice-fatigue', '身體疲累', '/10'],
      ['practice-anxiety', '焦慮或躁動', '/10']
    ]
  }),
  Object.freeze({
    title: '過程與節奏',
    fields: [
      ['practice-distraction', '注意力最常跑去哪裡'],
      ['practice-pace', '整體速度'],
      ['practice-helpful-line', '最有幫助的一句'],
      ['practice-awkward-line', '最出戲的一句'],
      ['practice-repeated', '覺得重複的地方'],
      ['practice-speed-notes', '太快／太慢的地方']
    ]
  }),
  Object.freeze({
    title: '身體反應',
    fields: [
      ['practice-brow', '眉心感覺'], ['practice-body-sensation', '其他身體感'],
      ['practice-dizziness', '頭暈'], ['practice-head-pressure', '頭脹'],
      ['practice-chest-tightness', '胸悶'], ['practice-nausea', '噁心'],
      ['practice-floating', '飄忽或不真實感'], ['practice-anxiety-rise', '焦慮升高'],
      ['practice-discomfort', '其他不舒服']
    ]
  }),
  Object.freeze({
    title: '出現的內容',
    fields: [
      ['practice-first-word', '第一個字'], ['practice-first-image', '第一個畫面'],
      ['practice-first-emotion', '第一個情緒'], ['practice-first-body', '第一個身體感'],
      ['practice-interpretation', '後來自己補上的解釋'],
      ['practice-no-content', '本次沒有明顯內容']
    ]
  }),
  Object.freeze({
    title: '回神',
    fields: [
      ['practice-clear-after', '睜眼後是否清楚'],
      ['practice-recovery-seconds', '完全回到正常狀態', '秒'],
      ['practice-best-reorientation', '最有效的回神步驟'],
      ['practice-sudden-step', '仍然太突然的步驟']
    ]
  }),
  Object.freeze({
    title: '塔羅校準',
    optional: true,
    fields: [
      ['practice-card', '抽到的牌'], ['practice-card-orientation', '正逆位'],
      ['practice-awake-for-tarot', '抽牌前是否已完全清醒'],
      ['practice-tarot-match', '共同點'],
      ['practice-tarot-mismatch', '不同點'],
      ['practice-followup-event', '後續實際事件']
    ]
  }),
  Object.freeze({
    title: '練習後',
    fields: [
      ['practice-after-30', '30 分鐘後狀態'], ['practice-sleep', '當晚睡眠'],
      ['practice-next-day', '隔天狀態'], ['practice-willing-next', '下一次是否願意再做'],
      ['practice-next-change', '最希望下一版修改的地方']
    ]
  })
]);

const PRACTICE_WEEK_DETAIL_LABELS = Object.freeze({
  'week-1-v8': Object.freeze({
    breathToFeetHelpful: '把注意力帶回腳底是否有幫助',
    repeatedSection: '哪一段覺得重複',
    speedSection: '哪一段太快或太慢',
    reorientationEffective: '左右觀看或其他回神步驟是否有效',
    suddenStep: '有沒有哪一步仍然太突然'
  }),
  'week-2-v9': Object.freeze({
    thoughtLabelEffective: '用「想法」標記後是否比較容易回來',
    thoughtStage: '思緒最常在哪個階段出現',
    groundingStable: '腳底是否能成為穩定錨點',
    dualAnchorDifficulty: '同時注意腳底與眉心的難度',
    groundingReducedFloating: '保留腳底注意力是否降低飄忽',
    browChange: '眉心感覺與第一週相比',
    rawFeeling: '練習中最先出現的原始感受',
    laterInterpretation: '後來才加上的解釋或推論'
  }),
  'week-3-v10': Object.freeze({
    openingGoalClear: '開頭是否清楚知道今天要練什麼',
    electronicToneImpact: '電子音是否影響進入狀態',
    tooFastSection: '哪一段仍然太快',
    tooSlowSection: '哪一段太慢',
    thoughtStage: '思緒最常在哪個階段出現',
    thoughtPhraseReturn: '說「我正在想」後，是否比較容易回到呼吸',
    thoughtPhraseAddsThoughts: '「我正在想」這句話本身會不會讓思緒更多',
    recurringThoughtType: '最常反覆出現的想法類型',
    footContactClarity: '腳底接觸感',
    browPressure: '眉心脹感',
    browThrobbing: '眉心跳動',
    alternatingAnchorEasier: '交替觀察腳底與眉心是否比同時注意兩者容易',
    firstContentType: '哪一項是最先出現的',
    pauseBeforeOpenHelpful: '睜眼前停十秒是否有幫助',
    sitAfterOpenHelpful: '睜眼後坐二十秒是否有幫助',
    shuffleDrawTimeEnough: '洗牌與抽牌時間是否足夠',
    meditationRawContent: '冥想原始內容',
    cardFirstReaction: '看牌第一反應',
    basicCardMeaning: '基本牌義'
  })
});

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

// 時間複雜度 O(payload)，空間複雜度 O(payload)。
function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) throw new Error('沒有收到資料。');
  return JSON.parse(raw);
}

// 時間複雜度 O(k)，空間複雜度 O(1)，k 為金鑰長度。
function verifyAccessKey_(candidate) {
  const expected = PropertiesService.getScriptProperties().getProperty(ACCESS_KEY_PROPERTY);
  if (!expected) throw new Error('尚未設定 PRACTICE_ACCESS_KEY。');
  if (!timingSafeEqual_(String(candidate || ''), expected)) throw new Error('私人接收金鑰錯誤。');
}

// 時間複雜度 O(k)，空間複雜度 O(1)，k 為較長字串長度。
function timingSafeEqual_(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

// 時間複雜度 O(f)，空間複雜度 O(f)，f 為固定欄位數。
function ensurePracticeSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(PRACTICE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(PRACTICE_SHEET_NAME);

  const headers = ['接收時間', 'Record ID', 'Created At', 'Updated At']
    .concat(PRACTICE_FIELDS.map(([, label]) => label))
    .concat(['原始 JSON', '週次名稱', '版本', '週次專屬回饋 JSON']);
  const currentHeader = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const headerChanged = headers.some((header, index) => currentHeader[index] !== header);
  if (headerChanged) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 時間複雜度 O(n)，空間複雜度 O(f)。低資料量下以 Record ID 搜尋比額外維護索引更穩定。
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

// 時間複雜度 O(f)，空間複雜度 O(f)，f 為固定欄位數。
function buildRow_(record) {
  const data = record.data || {};
  return [new Date(), record.id, record.createdAt || '', record.updatedAt || '']
    .concat(PRACTICE_FIELDS.map(([key]) => normalizeCell_(data[key])))
    .concat([
      JSON.stringify(record),
      record.weekLabel || '',
      record.version || '',
      JSON.stringify(record.weekDetails || {})
    ]);
}

// 時間複雜度 O(1)，空間複雜度 O(1)。
function normalizeCell_(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === null || value === undefined) return '';
  return String(value);
}

// 時間複雜度 O(n)，空間複雜度 O(1)。
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

// 時間複雜度 O(f + w)，空間複雜度 O(f + w)，f 為固定欄位數，w 為當週專屬欄位數。
function notify_(record, updated) {
  const email = PropertiesService.getScriptProperties().getProperty(NOTIFY_EMAIL_PROPERTY);
  if (!email) return;

  const data = record.data || {};
  const weekKey = record.weekKey || data['practice-week'] || '';
  const weekLabel = record.weekLabel || weekKey || '未分類';
  const version = record.version || '';
  const sessionNumber = hasPracticeValue_(data['practice-session-number'])
    ? `｜第${data['practice-session-number']}次`
    : '';
  const subject = `【修煉紀錄】${data['practice-date'] || '未填日期'}｜${weekLabel}${sessionNumber}`;

  const bodyLines = [
    updated ? '既有修煉紀錄已更新。' : '新增一筆修煉紀錄。',
    '',
    `週次：${weekLabel}`,
    `版本：${version || '未填'}`
  ];

  PRACTICE_EMAIL_SECTIONS.forEach((section) => {
    const sectionLines = buildPracticeSectionLines_(section.fields, data);
    if (section.optional && sectionLines.length === 0) return;
    bodyLines.push('', `【${section.title}】`);
    if (sectionLines.length) bodyLines.push(...sectionLines);
    else bodyLines.push('未填');
  });

  const weekLines = buildWeekDetailLines_(weekKey, record.weekDetails || {});
  bodyLines.push('', `【${weekLabel}｜本週專屬回饋】`);
  bodyLines.push(...(weekLines.length ? weekLines : ['未填']));
  bodyLines.push('', `Record ID：${record.id}`);

  MailApp.sendEmail({
    to: email,
    subject,
    body: bodyLines.join('\n'),
    name: 'Evan 修煉紀錄'
  });
}

// 時間複雜度 O(f)，空間複雜度 O(f)，f 為該區段欄位數。
function buildPracticeSectionLines_(fields, data) {
  const lines = [];
  fields.forEach(([key, label, suffix]) => {
    const value = data[key];
    if (!hasPracticeValue_(value)) return;
    lines.push(`${label}：${formatPracticeEmailValue_(value, suffix)}`);
  });
  return lines;
}

// 時間複雜度 O(w)，空間複雜度 O(w)，w 為當週專屬欄位數。
function buildWeekDetailLines_(weekKey, details) {
  const labels = PRACTICE_WEEK_DETAIL_LABELS[weekKey] || {};
  const preferredKeys = Object.keys(labels);
  const extraKeys = Object.keys(details).filter((key) => !Object.prototype.hasOwnProperty.call(labels, key));
  return preferredKeys.concat(extraKeys)
    .filter((key) => hasPracticeValue_(details[key]))
    .map((key) => `${labels[key] || key}：${formatPracticeEmailValue_(details[key])}`);
}

// 時間複雜度 O(1)，空間複雜度 O(1)。
function hasPracticeValue_(value) {
  if (value === true || value === false || value === 0) return true;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

// 時間複雜度 O(v)，空間複雜度 O(v)，v 為值轉字串後長度。
function formatPracticeEmailValue_(value, suffix) {
  const normalized = normalizeCell_(value);
  return suffix ? `${normalized}${suffix}` : normalized;
}

// 時間複雜度 O(v)，空間複雜度 O(v)，v 為 JSON 輸出長度。
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
