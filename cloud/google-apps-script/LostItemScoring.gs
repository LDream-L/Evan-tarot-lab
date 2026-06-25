// ==============================
// 塔羅尋物 v5.0.0：大型區域計分、摘要與事件
// ==============================
//
// 主要函式複雜度：
// - scoreLostItemAreas_：O(a × c × f + a log a)，a = 11、c <= 3、f <= 2
// - buildLostItemSummary_：O(a + c)
// - buildLostItemEvents_：O(e × c × t)，e <= 8、t = 單牌事件標籤數
// 空間複雜度：O(a + e)
//
// 暴力法：把同一大型區域的所有子欄位直接相加，子欄位較多的區域會自然占優。
// 優化法：每張牌對每個大型區域只取最強子區域分數（MAX），再跨牌相加。
// ==============================

function scoreLostItemAreas_(model, cards) {
  const candidates = new Array(model.areas.length);

  for (let areaIndex = 0; areaIndex < model.areas.length; areaIndex += 1) {
    const area = model.areas[areaIndex];
    const perCardScores = new Array(cards.length);
    const fineTotals = {};
    let totalScore = 0;
    let supportCount = 0;
    let directCount = 0;
    let maxSingleScore = 0;

    area.fineAreas.forEach((fineArea) => { fineTotals[fineArea] = 0; });

    for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
      const card = cards[cardIndex].card;
      const score = Number(card.areaScores[area.name]) || 0;
      perCardScores[cardIndex] = score;
      totalScore += score;
      if (score > 0) supportCount += 1;
      if (score === 3) directCount += 1;
      maxSingleScore = Math.max(maxSingleScore, score);

      area.fineAreas.forEach((fineArea) => {
        fineTotals[fineArea] += Number(card.fineScores[fineArea]) || 0;
      });
    }

    const subAreas = Object.keys(fineTotals)
      .filter((fineArea) => fineTotals[fineArea] > 0)
      .sort((left, right) => fineTotals[right] - fineTotals[left])
      .join("、");

    const cardEvidence = cards
      .map((draw, cardIndex) => ({
        name: draw.card.name || draw.card.code,
        score: perCardScores[cardIndex],
      }))
      .filter((entry) => entry.score > 0)
      .map((entry) => `${entry.name} ${entry.score}分`)
      .join("；");

    candidates[areaIndex] = {
      area: area.name,
      areaIndex,
      totalScore,
      supportCount,
      directCount,
      maxSingleScore,
      perCardScores,
      subAreas,
      cardEvidence,
      description: area.description,
      firstAction: area.firstAction,
      confidence: lostItemConfidence_(totalScore),
      tied: false,
      reason: "",
    };
  }

  candidates.sort(compareLostItemAreas_);

  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index];
    if (entry.totalScore <= 0) continue;
    entry.tied = candidates.some((other, otherIndex) =>
      otherIndex !== index && isSameLostItemRank_(entry, other)
    );
    entry.reason = buildLostItemReason_(entry);
  }

  return candidates.filter((entry) => entry.totalScore > 0);
}

function compareLostItemAreas_(left, right) {
  if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
  if (right.supportCount !== left.supportCount) return right.supportCount - left.supportCount;
  if (right.directCount !== left.directCount) return right.directCount - left.directCount;
  if (right.maxSingleScore !== left.maxSingleScore) return right.maxSingleScore - left.maxSingleScore;
  return left.areaIndex - right.areaIndex;
}

function isSameLostItemRank_(left, right) {
  return left.totalScore === right.totalScore &&
    left.supportCount === right.supportCount &&
    left.directCount === right.directCount &&
    left.maxSingleScore === right.maxSingleScore;
}

function lostItemConfidence_(score) {
  if (score >= 7) return "高";
  if (score >= 5) return "中高";
  if (score >= 3) return "中";
  return "低";
}

function buildLostItemReason_(entry) {
  const parts = [`牌面支持 ${entry.supportCount} 張`];
  if (entry.directCount > 0) parts.push(`3 分直接指向 ${entry.directCount} 張`);
  if (entry.tied) parts.push("與其他區域完全同分；顯示順序不代表較高機率");
  return `${parts.join("；")}。`;
}

function buildLostItemSummary_(cards, scoredAreas) {
  const top1 = scoredAreas[0];
  const top2 = scoredAreas[1];
  const maxScore = top1?.totalScore || 0;
  const reversed = cards.some((entry) => entry.orientation === "逆位");
  const nearBody = cards.some((entry) => entry.card.eventTags.includes("近身"));

  return {
    model: "大型區域反查／空間特徵隔離／零回測加權 v5.0.0",
    focus: maxScore === 0 ? "無區域聚焦" : lostItemConfidence_(maxScore),
    mode: reversed
      ? "逆位＝內化／受阻提示（不改區域分）"
      : "正位牌義模式",
    priority1: top1?.area || "",
    priority2: top2?.area || "",
    searchOrder: scoredAreas.length
      ? scoredAreas.slice(0, 5).map((entry) => `${entry.area}${entry.tied ? "（並列）" : ""}`).join(" → ")
      : "只保留空間與事件線索；不得虛構區域",
    zeroStep: nearBody
      ? "0 號核對：牌面有近身／未脫手指向；只在已入選大型區域內查看貼身、身旁或最近操作面，不新增區域。"
      : "",
    areaNotice: scoredAreas.length
      ? "空間特徵只能細化已入選的大型區域，不得自行生成新的房間或場域。"
      : "牌面未形成大型區域指向；保留空間與事件線索，不強迫指定房間。",
  };
}

/**
 * 事件只讀 CardDB 的 EventTags，不讀區域、物品種類、情境或回測。
 * 時間複雜度：O(e × c × t)。
 * 空間複雜度：O(e)。
 */
function buildLostItemEvents_(model, cards) {
  const result = [];

  for (let guideIndex = 0; guideIndex < model.eventGuide.length; guideIndex += 1) {
    const guide = model.eventGuide[guideIndex];
    const triggeredCards = [];

    for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
      const draw = cards[cardIndex];
      if (draw.card.eventTags.includes(guide.tag)) {
        triggeredCards.push(`第${cardIndex + 1}張 ${draw.card.name}`);
      }
    }

    if (!triggeredCards.length) continue;
    result.push({
      name: guide.name,
      state: "牌面有指向",
      check: guide.check,
      common: guide.basis,
      triggeredCards: triggeredCards.join("、"),
    });
  }

  return result;
}

/** 時間複雜度 O(1)，空間複雜度 O(1)。 */
function enforcePublicRateLimit_(rawClientId) {
  const clientId = sanitizeText_(rawClientId, 120) || "anonymous";
  const cache = CacheService.getScriptCache();
  const key = `lostRate:${hashHex_(clientId).slice(0, 24)}`;
  const current = Number(cache.get(key) || 0);

  if (current >= LOST_ITEM_V5_CONFIG.publicRateLimitPerMinute) {
    throw new Error("短時間占卜次數過多，請稍後再試。");
  }
  cache.put(key, String(current + 1), 60);
}
