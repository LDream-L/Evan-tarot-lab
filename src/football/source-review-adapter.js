// 塔羅X賽事驗證｜雙牌源賽後回顧分流核心轉接層
//
// 同場雙牌源的客觀賽果、延長賽／PK 與賽事事件仍共用；
// reviewAnalysis 必須依「自己抽牌／網站隨機抽牌」分開保存，避免同步賽果時互相覆蓋。
//
// 主要函式複雜度：
// - resolveReviewAnalysis：時間 O(r)、額外空間 O(1)，r = 紀錄數；getRecord 由既有核心查找。
// - updateActual：時間 O(r)、額外空間 O(1)，另加既有 updateActual 成本。
//
// 更快替代方案比較：
// - 暴力法：把兩種牌源改成同一筆紀錄中的兩份 actual，會破壞既有雲端／CSV／評分契約。
// - 優化法：保留兩筆 comparisonGroupId 紀錄，只在寫入 actual 前依目前表單的牌源欄位替換 reviewAnalysis；
//   賽果同步邏輯完全沿用既有 source-comparison-runtime。

const SOURCE_EXPERIMENT = "manual-vs-random";
const baseCore = window.FootballLabCore;

if (!baseCore || typeof baseCore.getRecord !== "function" || typeof baseCore.updateActual !== "function") {
  throw new Error("雙牌源賽後回顧分流層無法取得既有核心。");
}

/** 文字正規化：時間／空間 O(n)，n 為字串長度。 */
function clean(value) {
  return String(value == null ? "" : value).trim();
}

/** 同場雙牌源判斷：時間／空間 O(1)。 */
function isComparisonRecord(record) {
  return Boolean(
    record?.match?.sourceExperiment === SOURCE_EXPERIMENT
    && record.match.comparisonGroupId
    && (record.match.cardSource === "manual" || record.match.cardSource === "random")
  );
}

/**
 * 依目前開啟的核對面板，決定該筆牌源應保存哪一份回顧。
 * 時間複雜度：O(r)
 * 空間複雜度：O(1)
 *
 * 更快替代方案比較：
 * - 直接使用 submittedActual.reviewAnalysis 會讓 sibling 被覆蓋成同一份文字。
 * - 本版只對同 comparisonGroupId 的雙牌源分流；其他紀錄完全不增加額外查找。
 */
function resolveReviewAnalysis(record, submittedActual = {}) {
  if (!isComparisonRecord(record)) return clean(submittedActual.reviewAnalysis);

  const activeId = clean(document.getElementById("football-evaluation-id")?.value);
  const activeRecord = activeId ? baseCore.getRecord(activeId) : null;
  const sameActiveGroup = Boolean(
    isComparisonRecord(activeRecord)
    && activeRecord.match.comparisonGroupId === record.match.comparisonGroupId
  );

  if (!sameActiveGroup) {
    return clean(record.actual?.reviewAnalysis ?? submittedActual.reviewAnalysis);
  }

  if (record.id === activeId) {
    const primary = document.getElementById("football-review-analysis");
    return primary ? clean(primary.value) : clean(submittedActual.reviewAnalysis);
  }

  const sibling = document.getElementById("football-review-analysis-sibling");
  const siblingMatches = sibling
    && sibling.dataset.recordId === record.id
    && sibling.dataset.comparisonGroupId === record.match.comparisonGroupId;

  if (siblingMatches) return clean(sibling.value);
  return clean(record.actual?.reviewAnalysis);
}

/**
 * 保存賽果時只替換當筆牌源自己的 reviewAnalysis。
 * 時間複雜度：O(r)
 * 空間複雜度：O(1)
 */
function updateActual(recordId, actual) {
  const record = baseCore.getRecord(recordId);
  if (!isComparisonRecord(record)) return baseCore.updateActual(recordId, actual);

  return baseCore.updateActual(recordId, {
    ...actual,
    reviewAnalysis: resolveReviewAnalysis(record, actual),
  });
}

export const sourceReviewCore = Object.freeze({
  ...baseCore,
  updateActual,
});

export const footballSourceReviewAdapter = Object.freeze({
  baseCore,
  core: sourceReviewCore,
  isComparisonRecord,
  resolveReviewAnalysis,
});

window.FootballLabCore = sourceReviewCore;
window.FootballSourceReviewAdapter = footballSourceReviewAdapter;
