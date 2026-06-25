// ==============================
// 塔羅尋物 v5.0.0：大型區域反查與空間特徵隔離
// ==============================
//
// 主要函式複雜度：
// - handleLostItemRequest_：O(c × a × f + a log a)，c <= 3、a = 11、f <= 2
// - loadLostItemModel_：O(r × z + r × a × f)，r = CardDB 牌數、z = 細部區域數
// - drawLostItemCards_：期望 O(c)
// 空間複雜度：O(r × (z + a) + a)
//
// 暴力法：每次請求都從多個工作表逐格查詢與重新掃描欄位。
// 優化法：單次批次讀取 CardDB／Area Matrix／Event Guide，建立標題索引與查表，
//         每張牌在同一大型區域只取最強子區域分數，避免子欄位數量造成偏差。
// ==============================

const LOST_ITEM_V5_CONFIG = Object.freeze({
  version: "5.0.0",
  cardSheetName: "CardDB",
  areaMatrixSheetName: "Area Matrix",
  eventGuideSheetName: "Event Guide",
  maxItemNameLength: 80,
  maxNotesLength: 300,
  maxCardCount: 3,
  publicRateLimitPerMinute: 20,
});

function getLostItemHealth_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const required = [
    LOST_ITEM_V5_CONFIG.cardSheetName,
    LOST_ITEM_V5_CONFIG.areaMatrixSheetName,
    LOST_ITEM_V5_CONFIG.eventGuideSheetName,
  ];

  if (!spreadsheet) return { ready: false, missingSheets: required };
  const missingSheets = required.filter((name) => !spreadsheet.getSheetByName(name));
  return { ready: missingSheets.length === 0, missingSheets };
}

/**
 * 主尋物流程。
 * 時間複雜度：O(c × a × f + a log a)，c <= 3、a = 11、f <= 2。
 * 空間複雜度：O(c + a)。
 */
function handleLostItemRequest_(rawPayload) {
  const health = getLostItemHealth_();
  if (!health.ready) {
    throw new Error(`尋物後端缺少工作表：${health.missingSheets.join("、")}`);
  }

  const payload = normalizeLostItemPayload_(rawPayload);
  const modelData = loadLostItemModel_();
  const cards = drawLostItemCards_(modelData.cards, payload.cardCount);
  const scoredAreas = scoreLostItemAreas_(modelData, cards);
  const topAreas = scoredAreas.slice(0, 5).map((entry, index) => ({
    rank: index + 1,
    area: entry.area,
    score: entry.totalScore,
    confidence: entry.confidence,
    cardEvidence: entry.cardEvidence,
    subAreas: entry.subAreas,
    reason: entry.reason,
    firstAction: entry.firstAction,
    description: entry.description,
    tied: entry.tied,
  }));
  const summary = buildLostItemSummary_(cards, scoredAreas);
  const events = buildLostItemEvents_(modelData, cards);

  return {
    success: true,
    version: LOST_ITEM_V5_CONFIG.version,
    itemName: payload.itemName,
    createdAt: formatTaipeiDate_(new Date()),
    model: summary.model,
    focusLevel: summary.focus,
    readingMode: summary.mode,
    searchOrder: summary.searchOrder,
    zeroStep: summary.zeroStep,
    areaNotice: summary.areaNotice,
    cards: cards.map((entry) => ({
      code: entry.card.code,
      name: entry.card.name,
      orientation: entry.orientation,
      statusHint: entry.card.statusHint,
      locationHint: entry.card.locationHint,
      areaHint: entry.card.areaHint,
      actionHint: entry.card.actionHint,
      highestAreas: entry.card.highestAreas,
      spatial: {
        verticalHeight: entry.card.verticalHeight,
        placementRelation: entry.card.placementRelation,
        visibility: entry.card.visibility,
        motion: entry.card.motion,
        basis: entry.card.spatialBasis,
      },
      eventTags: entry.card.eventTags,
    })),
    summary,
    topAreas,
    events,
    recordOnlyContext: {
      itemType: payload.itemType,
      lastAction: payload.lastAction,
      scene: payload.scene,
      roughSearched: payload.roughSearched,
      lostDuration: payload.lostDuration,
      touchedByOther: payload.touchedByOther,
      notes: payload.notes,
    },
  };
}

function normalizeLostItemPayload_(rawPayload) {
  return {
    itemName: sanitizeText_(rawPayload.itemName, LOST_ITEM_V5_CONFIG.maxItemNameLength) || "未命名物品",
    notes: sanitizeText_(rawPayload.notes, LOST_ITEM_V5_CONFIG.maxNotesLength),
    cardCount: clampInteger_(rawPayload.cardCount || 3, 1, LOST_ITEM_V5_CONFIG.maxCardCount),
    itemType: sanitizeText_(rawPayload.itemType, 40),
    lastAction: sanitizeText_(rawPayload.lastAction, 40),
    scene: sanitizeText_(rawPayload.scene, 40),
    roughSearched: sanitizeText_(rawPayload.roughSearched, 4) === "是" ? "是" : "否",
    lostDuration: sanitizeText_(rawPayload.lostDuration, 20) || "今天",
    touchedByOther: sanitizeText_(rawPayload.touchedByOther, 4) === "是" ? "是" : "否",
  };
}

/**
 * 從私人 Google Sheets 建立 v5 查表模型。
 * 時間複雜度：O(r × z + r × a × f)。
 * 空間複雜度：O(r × (z + a) + a)。
 */
function loadLostItemModel_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = spreadsheet.getSheetByName(LOST_ITEM_V5_CONFIG.cardSheetName);
  const areaSheet = spreadsheet.getSheetByName(LOST_ITEM_V5_CONFIG.areaMatrixSheetName);
  const eventSheet = spreadsheet.getSheetByName(LOST_ITEM_V5_CONFIG.eventGuideSheetName);

  const cardValues = cardSheet.getDataRange().getValues();
  const areaValues = areaSheet.getDataRange().getValues();
  const eventValues = eventSheet.getDataRange().getValues();

  if (cardValues.length < 2) throw new Error("CardDB 沒有牌面資料。");

  const cardHeaders = buildLostItemHeaderMap_(cardValues[0]);
  const requiredCardHeaders = [
    "CardCode", "CardName", "StatusHint", "LocationHint", "AreaHint", "ActionHint",
    "EventTags", "垂直高度", "放置關係", "可視狀態", "動態狀態", "空間牌面依據",
  ];
  const missingCardHeaders = requiredCardHeaders.filter((name) => cardHeaders[name] == null);
  if (missingCardHeaders.length) {
    throw new Error(`CardDB 缺少欄位：${missingCardHeaders.join("、")}`);
  }

  const areaHeaderRowIndex = areaValues.findIndex((row) => String(row[0] || "").trim() === "大型區域");
  if (areaHeaderRowIndex < 0) throw new Error("Area Matrix 找不到「大型區域」標題列。");
  const areaHeaders = buildLostItemHeaderMap_(areaValues[areaHeaderRowIndex]);
  const requiredAreaHeaders = ["大型區域", "納入的區域證據", "大型區域說明", "第一搜尋動作"];
  const missingAreaHeaders = requiredAreaHeaders.filter((name) => areaHeaders[name] == null);
  if (missingAreaHeaders.length) {
    throw new Error(`Area Matrix 缺少欄位：${missingAreaHeaders.join("、")}`);
  }

  const areas = [];
  for (let rowIndex = areaHeaderRowIndex + 1; rowIndex < areaValues.length; rowIndex += 1) {
    const row = areaValues[rowIndex];
    const name = String(row[areaHeaders["大型區域"]] || "").trim();
    const fineText = String(row[areaHeaders["納入的區域證據"]] || "").trim();
    if (!name || !fineText) break;
    if (name.startsWith("注意") || name === "方法") break;

    const fineAreas = splitLostItemList_(fineText);
    fineAreas.forEach((fineArea) => {
      if (cardHeaders[fineArea] == null) {
        throw new Error(`Area Matrix 引用 CardDB 不存在的區域欄位：${fineArea}`);
      }
    });

    areas.push({
      name,
      fineAreas,
      description: String(row[areaHeaders["大型區域說明"]] || "").trim(),
      firstAction: String(row[areaHeaders["第一搜尋動作"]] || "").trim(),
      order: areas.length,
    });
  }
  if (!areas.length) throw new Error("Area Matrix 沒有可用的大型區域。");

  const cards = [];
  for (let rowIndex = 1; rowIndex < cardValues.length; rowIndex += 1) {
    const row = cardValues[rowIndex];
    const code = String(row[cardHeaders.CardCode] || "").trim();
    if (!code) continue;

    const areaScores = {};
    let highestScore = 0;
    areas.forEach((area) => {
      let score = 0;
      area.fineAreas.forEach((fineArea) => {
        score = Math.max(score, Number(row[cardHeaders[fineArea]]) || 0);
      });
      areaScores[area.name] = score;
      highestScore = Math.max(highestScore, score);
    });

    cards.push({
      code,
      name: String(row[cardHeaders.CardName] || "").trim(),
      statusHint: String(row[cardHeaders.StatusHint] || "").trim(),
      locationHint: String(row[cardHeaders.LocationHint] || "").trim(),
      areaHint: String(row[cardHeaders.AreaHint] || "").trim(),
      actionHint: String(row[cardHeaders.ActionHint] || "").trim(),
      areaScores,
      highestAreas: highestScore > 0
        ? areas.filter((area) => areaScores[area.name] === highestScore).map((area) => area.name)
        : [],
      eventTags: splitLostItemList_(row[cardHeaders.EventTags]),
      verticalHeight: String(row[cardHeaders["垂直高度"]] || "").trim(),
      placementRelation: String(row[cardHeaders["放置關係"]] || "").trim(),
      visibility: String(row[cardHeaders["可視狀態"]] || "").trim(),
      motion: String(row[cardHeaders["動態狀態"]] || "").trim(),
      spatialBasis: String(row[cardHeaders["空間牌面依據"]] || "").trim(),
      fineScores: buildLostItemFineScoreMap_(row, cardHeaders, areas),
    });
  }
  if (!cards.length) throw new Error("CardDB 沒有可抽取的牌。");

  const eventHeaderRowIndex = eventValues.findIndex((row) => String(row[0] || "").trim() === "事件核對");
  const eventGuide = [];
  if (eventHeaderRowIndex >= 0) {
    const eventHeaders = buildLostItemHeaderMap_(eventValues[eventHeaderRowIndex]);
    for (let rowIndex = eventHeaderRowIndex + 1; rowIndex < eventValues.length; rowIndex += 1) {
      const row = eventValues[rowIndex];
      const name = String(row[eventHeaders["事件核對"]] || "").trim();
      const tag = String(row[eventHeaders["牌面標籤"]] || "").trim();
      if (!name || !tag) break;
      eventGuide.push({
        name,
        tag,
        check: String(row[eventHeaders["你要核對什麼"]] || "").trim(),
        basis: String(row[eventHeaders["直接圖像基準"]] || "").trim(),
      });
    }
  }

  return { cards, areas, eventGuide };
}

function buildLostItemHeaderMap_(headers) {
  const result = {};
  for (let index = 0; index < headers.length; index += 1) {
    const key = String(headers[index] || "").trim();
    if (key) result[key] = index;
  }
  return result;
}

function splitLostItemList_(value) {
  return String(value == null ? "" : value)
    .split(/[、,，;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildLostItemFineScoreMap_(row, cardHeaders, areas) {
  const result = {};
  areas.forEach((area) => {
    area.fineAreas.forEach((fineArea) => {
      result[fineArea] = Number(row[cardHeaders[fineArea]]) || 0;
    });
  });
  return result;
}

/**
 * 抽出不重複牌與正逆位。
 * 時間複雜度：期望 O(c)，c <= 3。
 * 空間複雜度：O(c)。
 */
function drawLostItemCards_(cards, count) {
  if (!cards.length) throw new Error("CardDB 沒有可抽取的牌。");

  const used = new Set();
  const result = [];
  while (result.length < count) {
    const index = randomInt_(cards.length);
    if (used.has(index)) continue;
    used.add(index);
    result.push({
      card: cards[index],
      orientation: randomInt_(2) === 0 ? "正位" : "逆位",
    });
  }
  return result;
}

/** 時間複雜度 O(1)，空間複雜度 O(1)。 */
function randomInt_(maxExclusive) {
  const safeMax = Math.max(1, Math.trunc(maxExclusive));
  const seed = `${Utilities.getUuid()}|${Date.now()}|${Math.random()}`;
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8
  );
  const value =
    ((bytes[0] + 256) % 256) * 16777216 +
    ((bytes[1] + 256) % 256) * 65536 +
    ((bytes[2] + 256) % 256) * 256 +
    ((bytes[3] + 256) % 256);
  return value % safeMax;
}
