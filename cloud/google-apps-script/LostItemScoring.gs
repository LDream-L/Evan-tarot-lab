// ==============================
// 塔羅尋物 v4.7：計分、摘要與事件
// ==============================

function scoreLostItemAreas_(model, cards, payload) {
  const candidates = new Array(model.areas.length);

  // 先把重複查詢移到迴圈外，避免在區域迴圈內反覆建立查表。
  const actionWeights = model.actionWeights[payload.lastAction] || {};
  const sceneWeights = model.sceneWeights[payload.scene] || {};
  const timeWeights = model.timeWeights[payload.lostDuration] || {};
  const touchedWeights = model.touchedWeights[payload.touchedByOther] || {};
  const deepSearchMode =
    payload.roughSearched === "是" ||
    payload.lostDuration === "1-3天" ||
    payload.lostDuration === "超過3天";

  for (let areaIndex = 0; areaIndex < model.areas.length; areaIndex += 1) {
    const area = model.areas[areaIndex];
    let cardScore = 0;

    for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
      const draw = cards[cardIndex];
      const card = draw.card;
      let score = Number(card.scores[areaIndex]) || 0;

      if (draw.orientation === "逆位") {
        // v4.7 對齊修正：主要區域 -1、次要區域 +1。
        if (area === card.primaryArea) score -= 1;
        if (area === card.secondaryArea) score += 1;

        if (LOST_ITEM_CONFIG.hiddenAreas.includes(area)) score += 1;

        if (
          card.suit === "Cups" &&
          ["床沙發軟物", "共用空間/他人處", "水源廚浴", "軟物下方/床下沙發下陰影區"].includes(area)
        ) {
          score += 1;
        } else if (
          card.suit === "Swords" &&
          ["書桌工作區", "書籍文件", "低處縫隙/家具後", "手邊平台/桌面側邊"].includes(area)
        ) {
          score += 1;
        } else if (
          card.suit === "Pentacles" &&
          ["包袋口袋", "財務證件/貴重物", "儲藏箱/舊物", "明顯角落/上層邊角"].includes(area)
        ) {
          score += 1;
        } else if (
          card.suit === "Wands" &&
          ["出入口動線", "交通工具/通勤/移動路徑", "戶外/陽台/邊界", "手邊平台/桌面側邊"].includes(area)
        ) {
          score += 1;
        } else if (
          card.suit === "Major Arcana" &&
          ["低處縫隙/家具後", "共用空間/他人處", "明顯角落/上層邊角"].includes(area)
        ) {
          score += 1;
        }
      }

      cardScore += score;
    }

    const actionWeight = Number(actionWeights[area]) || 0;
    const sceneWeight = Number(sceneWeights[area]) || 0;
    const refindWeight =
      payload.roughSearched === "是" ? Number(model.zones[area]?.refindWeight) || 0 : 0;
    const timeWeight = Number(timeWeights[area]) || 0;
    const touchedWeight = Number(touchedWeights[area]) || 0;
    const contextScore =
      actionWeight + sceneWeight + refindWeight + timeWeight + touchedWeight;
    const totalScore = cardScore + contextScore;

    const searchPriority = deepSearchMode
      ? LOST_ITEM_CONFIG.hiddenAreas.includes(area) ||
        ["包袋口袋", "垃圾桶/回收區/清理誤丟"].includes(area)
        ? 2
        : 1
      : LOST_ITEM_CONFIG.easyFirstAreas.includes(area)
      ? 2
      : 1;

    candidates[areaIndex] = {
      area,
      areaIndex,
      cardScore,
      contextScore,
      actionWeight,
      sceneWeight,
      refindWeight,
      timeWeight,
      touchedWeight,
      totalScore,
      searchPriority,
      description: model.zones[area]?.description || "",
      firstAction: model.zones[area]?.firstAction || "",
    };
  }

  const totalCounts = {};
  candidates.forEach((entry) => {
    totalCounts[entry.totalScore] = (totalCounts[entry.totalScore] || 0) + 1;
  });

  candidates.forEach((entry) => {
    entry.rankScore =
      entry.totalScore +
      entry.cardScore / 100 +
      entry.contextScore / 1000 +
      entry.searchPriority / 10000 +
      (entry.areaIndex + 2) / 100000;
    entry.confidence =
      entry.totalScore >= 10
        ? "高"
        : entry.totalScore >= 7
        ? "中高"
        : entry.totalScore >= 5
        ? "中"
        : "低";
    entry.reason = buildLostItemReason_(entry, totalCounts, payload);
  });

  candidates.sort((left, right) => right.rankScore - left.rankScore);
  return candidates;
}

function buildLostItemReason_(entry, totalCounts, payload) {
  if (entry.totalScore === 0) return "";

  const parts = [];
  if ((totalCounts[entry.totalScore] || 0) > 1) {
    if (entry.cardScore >= 3) {
      parts.push("同分先搜：牌意更直指。");
    } else if (entry.contextScore >= 3) {
      parts.push("同分先搜：情境更貼近。");
    } else {
      parts.push("同分先搜：比較好翻。");
    }
  }

  if (entry.cardScore > 0) parts.push("牌面有指向。");
  if (entry.actionWeight > 0) parts.push("和最後動作有關。");
  if (entry.sceneWeight > 0) parts.push("和場景吻合。");
  if (entry.refindWeight > 0) parts.push("你可能上次沒翻到底。");

  if (entry.timeWeight > 0) {
    if (payload.lostDuration === "剛剛") {
      parts.push("先找你剛待過的地方。");
    } else if (payload.lostDuration === "今天") {
      parts.push("先沿今天動線回找。");
    } else if (payload.lostDuration === "1-3天") {
      parts.push("可能被蓋住或滑進縫裡。");
    } else {
      parts.push("放比較久，像被收進去或移位。");
    }
  }

  if (entry.touchedWeight > 0) parts.push("也可能被別人順手移過。");
  return parts.join(" ");
}

function buildLostItemSummary_(cards, scoredAreas) {
  const top1 = scoredAreas[0];
  const top2 = scoredAreas[1];
  const top3 = scoredAreas[2];
  const maxScore = top1?.totalScore || 0;
  const reversed = cards.some((entry) => entry.orientation === "逆位");
  const nearBody = cards.some((entry) =>
    LOST_ITEM_CONFIG.nearBodyCards.includes(entry.card.name)
  );

  let searchOrder = "";
  if (top1 && top2 && top1.totalScore === top2.totalScore) {
    searchOrder =
      `同分先搜 ${top1.area} → ${top2.area}` +
      (top3 ? `；次查 ${top3.area}` : "");
  } else {
    searchOrder = [top1?.area, top2?.area, top3?.area].filter(Boolean).join(" → ");
  }

  return {
    model: "牌面主導／情境弱修正 v4.7",
    focus: maxScore >= 10 ? "高聚焦" : maxScore >= 7 ? "中聚焦" : "低聚焦",
    mode: reversed ? "偏移／遮蔽模式" : "直線／原位模式",
    priority1: top1?.area || "",
    priority2: top2?.area || "",
    searchOrder,
    zeroStep: nearBody
      ? "0 號步驟：牌面偏向近身範圍／未脫手或視線邊角，先看手邊平台、椅面、被子與身旁 30 公分內。"
      : "",
  };
}

/**
 * 只在牌面或 Top 區域符合時回傳事件核對。
 * 時間複雜度：O(c + a + e)
 * 空間複雜度：O(c + a + e)
 */
function buildLostItemEvents_(model, cards, topAreas) {
  const cardNames = new Set(cards.map((entry) => entry.card.name));
  const areas = new Set(topAreas.map((entry) => entry.area));

  const definitions = [
    {
      name: "近身／未脫手",
      cards: LOST_ITEM_CONFIG.nearBodyCards,
      areas: ["手邊平台/桌面側邊", "床沙發軟物"],
    },
    {
      name: "清理誤丟",
      cards: ["Death", "Ten of Swords", "Three of Swords"],
      areas: ["垃圾桶/回收區/清理誤丟"],
    },
    {
      name: "已轉交／送人",
      cards: ["Six of Pentacles", "Five of Swords", "The Lovers"],
      areas: ["共用空間/他人處"],
    },
    {
      name: "移動中脫離",
      cards: [
        "The Fool",
        "The Chariot",
        "Eight of Wands",
        "Knight of Wands",
        "Six of Swords",
        "Knight of Swords",
      ],
      areas: ["交通工具/通勤/移動路徑", "出入口動線", "戶外/陽台/邊界"],
    },
    {
      name: "交換／混放",
      cards: ["The Lovers", "Two of Pentacles", "Five of Wands", "Seven of Cups"],
      areas: ["共用空間/他人處"],
    },
    {
      name: "被收到別的物件內",
      cards: [
        "The High Priestess",
        "Four of Pentacles",
        "Seven of Swords",
        "Eight of Swords",
        "Judgement",
        "The World",
      ],
      areas: ["包袋口袋", "儲藏箱/舊物"],
    },
  ];

  const result = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const cardHit = definition.cards.some((name) => cardNames.has(name));
    const areaHit = definition.areas.some((area) => areas.has(area));
    if (!cardHit && !areaHit) continue;

    const guide = model.eventGuide[definition.name];
    if (guide) result.push(guide);
  }
  return result;
}

function enforcePublicRateLimit_(rawClientId) {
  const clientId = sanitizeText_(rawClientId, 120) || "anonymous";
  const cache = CacheService.getScriptCache();
  const key = `lostRate:${hashHex_(clientId).slice(0, 24)}`;
  const current = Number(cache.get(key) || 0);

  if (current >= LOST_ITEM_CONFIG.publicRateLimitPerMinute) {
    throw new Error("短時間占卜次數過多，請稍後再試。");
  }
  cache.put(key, String(current + 1), 60);
}
