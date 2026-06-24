// ==============================
// 塔羅尋物 v4.7
// ==============================

function getLostItemHealth_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    return {
      ready: false,
      missingSheets: [
        LOST_ITEM_CONFIG.cardSheetName,
        LOST_ITEM_CONFIG.paramsSheetName,
        LOST_ITEM_CONFIG.zoneGuideSheetName,
        LOST_ITEM_CONFIG.eventGuideSheetName,
      ],
    };
  }

  const required = [
    LOST_ITEM_CONFIG.cardSheetName,
    LOST_ITEM_CONFIG.paramsSheetName,
    LOST_ITEM_CONFIG.zoneGuideSheetName,
    LOST_ITEM_CONFIG.eventGuideSheetName,
  ];
  const missingSheets = required.filter((name) => !spreadsheet.getSheetByName(name));
  return { ready: missingSheets.length === 0, missingSheets };
}

/**
 * 主尋物流程。
 * 時間複雜度：O(c × a + a log a)，c <= 3、a = 18
 * 空間複雜度：O(a + c)
 */
function handleLostItemRequest_(rawPayload) {
  const health = getLostItemHealth_();
  if (!health.ready) {
    throw new Error(`尋物後端缺少工作表：${health.missingSheets.join("、")}`);
  }

  const payload = normalizeLostItemPayload_(rawPayload);
  const modelData = loadLostItemModel_();
  const cards = drawLostItemCards_(modelData.cards, payload.cardCount);
  const scoredAreas = scoreLostItemAreas_(modelData, cards, payload);
  const topAreas = scoredAreas.slice(0, 5).map((entry, index) => ({
    rank: index + 1,
    area: entry.area,
    score: entry.totalScore,
    confidence: entry.confidence,
    reason: entry.reason,
    firstAction: entry.firstAction,
    description: entry.description,
  }));
  const summary = buildLostItemSummary_(cards, scoredAreas);
  const events = buildLostItemEvents_(modelData, cards, topAreas);

  return {
    success: true,
    version: LOST_ITEM_CONFIG.version,
    itemName: payload.itemName,
    createdAt: formatTaipeiDate_(new Date()),
    model: summary.model,
    focusLevel: summary.focus,
    readingMode: summary.mode,
    searchOrder: summary.searchOrder,
    zeroStep: summary.zeroStep,
    cards: cards.map((entry) => ({
      code: entry.card.code,
      name: entry.card.name,
      orientation: entry.orientation,
      statusHint: entry.card.statusHint,
      locationHint: entry.card.locationHint,
      areaHint: entry.card.areaHint,
      actionHint: entry.card.actionHint,
    })),
    summary,
    topAreas,
    events,
  };
}

function normalizeLostItemPayload_(rawPayload) {
  return {
    itemName: sanitizeText_(rawPayload.itemName, LOST_ITEM_CONFIG.maxItemNameLength) || "未命名物品",
    notes: sanitizeText_(rawPayload.notes, LOST_ITEM_CONFIG.maxNotesLength),
    cardCount: clampInteger_(rawPayload.cardCount || 3, 1, LOST_ITEM_CONFIG.maxCardCount),
    itemType: sanitizeText_(rawPayload.itemType, 40),
    lastAction: sanitizeText_(rawPayload.lastAction, 40),
    scene: sanitizeText_(rawPayload.scene, 40),
    roughSearched: sanitizeText_(rawPayload.roughSearched, 4) === "是" ? "是" : "否",
    lostDuration: sanitizeText_(rawPayload.lostDuration, 20) || "今天",
    touchedByOther: sanitizeText_(rawPayload.touchedByOther, 4) === "是" ? "是" : "否",
  };
}

/**
 * 從私人 Google Sheets 建立查表模型。
 * 時間複雜度：O(r × a)
 * 空間複雜度：O(r × a)
 *
 * 暴力法：每個區域、每張牌都反覆呼叫 getRange。
 * 優化法：一次批次讀取 CardDB／Params／Event Guide，再以物件查表。
 */
function loadLostItemModel_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = spreadsheet.getSheetByName(LOST_ITEM_CONFIG.cardSheetName);
  const paramsSheet = spreadsheet.getSheetByName(LOST_ITEM_CONFIG.paramsSheetName);
  const eventSheet = spreadsheet.getSheetByName(LOST_ITEM_CONFIG.eventGuideSheetName);

  const cardValues = cardSheet.getDataRange().getValues();
  const paramsValues = paramsSheet.getDataRange().getValues();
  const eventValues = eventSheet.getDataRange().getValues();

  if (cardValues.length < 2 || cardValues[0].length < 29) {
    throw new Error("CardDB 格式不完整，必須至少包含 A:AC。");
  }
  if (paramsValues.length < 63 || paramsValues[0].length < 19) {
    throw new Error("Params 格式不完整，必須至少包含 A:S、共 63 列。");
  }

  const areas = cardValues[0].slice(8, 26).map((value) => String(value || "").trim());
  const cards = [];

  for (let rowIndex = 1; rowIndex < cardValues.length; rowIndex += 1) {
    const row = cardValues[rowIndex];
    const code = String(row[0] || "").trim();
    if (!code) continue;

    const scores = new Array(areas.length);
    for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
      scores[areaIndex] = Number(row[8 + areaIndex]) || 0;
    }

    cards.push({
      code,
      name: String(row[1] || "").trim(),
      statusHint: String(row[2] || "").trim(),
      locationHint: String(row[3] || "").trim(),
      areaHint: String(row[4] || "").trim(),
      actionHint: String(row[5] || "").trim(),
      suit: String(row[6] || "").trim(),
      rank: row[7],
      scores,
      primaryArea: String(row[26] || "").trim(),
      secondaryArea: String(row[27] || "").trim(),
    });
  }

  const zoneRows = paramsValues.slice(34, 52);
  const zones = {};
  for (let index = 0; index < zoneRows.length; index += 1) {
    const row = zoneRows[index];
    const area = String(row[0] || "").trim();
    if (!area) continue;
    zones[area] = {
      description: String(row[1] || "").trim(),
      firstAction: String(row[2] || "").trim(),
      refindWeight: Number(row[3]) || 0,
    };
  }

  const actionWeights = rowsToWeightMap_(paramsValues.slice(13, 21), areas);
  const sceneWeights = rowsToWeightMap_(paramsValues.slice(24, 30), areas);
  const timeWeights = rowsToWeightMap_(paramsValues.slice(54, 58), areas);
  const touchedWeights = rowsToWeightMap_(paramsValues.slice(61, 63), areas);

  const eventGuide = {};
  for (let rowIndex = 4; rowIndex < eventValues.length; rowIndex += 1) {
    const row = eventValues[rowIndex];
    const name = String(row[0] || "").trim();
    if (!name) continue;
    eventGuide[name] = {
      name,
      state: String(row[1] || "").trim(),
      check: String(row[2] || "").trim(),
      common: String(row[3] || "").trim(),
    };
  }

  return {
    areas,
    cards,
    zones,
    actionWeights,
    sceneWeights,
    timeWeights,
    touchedWeights,
    eventGuide,
  };
}

/**
 * 將 Params 的「標籤＋18 個位置權重」轉成 O(1) 查表。
 * 時間複雜度：O(r × a)
 * 空間複雜度：O(r × a)
 */
function rowsToWeightMap_(rows, areas) {
  const result = {};

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const label = String(row[0] || "").trim();
    if (!label || label === "項目") continue;

    const weights = {};
    for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
      weights[areas[areaIndex]] = Number(row[areaIndex + 1]) || 0;
    }
    result[label] = weights;
  }

  return result;
}

/**
 * 抽出不重複牌與正逆位。
 * 時間複雜度：期望 O(c)，c <= 3
 * 空間複雜度：O(c)
 *
 * 暴力法：完整洗牌 78 張後取前 c 張，O(n)。
 * 優化法：只抽需要的 c 張，使用 Set 避免重複。
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

/**
 * 以 UUID＋SHA-256 產生單次亂數索引。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
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
