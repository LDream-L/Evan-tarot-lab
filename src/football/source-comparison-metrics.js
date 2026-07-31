// 塔羅X賽事驗證｜雙牌源統計轉接層
//
// 目前單張模型驗證的是「總進球區間」與「和局傾向」，不是指定勝方。
// 本層把雙牌源摘要改為依現行能量模型欄位統計，舊版單張勝負紀錄則保留相容分支。
//
// 主要函式複雜度：
// - calculateSourceComparison：時間 O(r)，空間 O(g)，r = 紀錄數、g = 對照組數。
// - renderSourceComparison：時間 O(r)，DOM 額外空間 O(1)，固定建立 6 張摘要卡。
// - observeLegacyMetricRender：每次變動只檢查單一摘要面板，時間／空間 O(1)。
//
// 更快替代方案比較：
// - 每張摘要卡各自掃描全部紀錄會成為多次 O(r)；本版先用 Map 單次分組，再一次完成全部統計。
// - 直接重寫既有流程層會同時影響抽牌、雲端同步與事件綁定；本版只轉接統計與呈現，保留已驗證流程。

const baseRuntime = window.FootballSourceComparisonRuntime;
const baseCore = window.FootballLabCore;
const baseRender = window.FootballLabRender;
const MIN_DIRECTIONAL_SAMPLE = 20;

if (
  !baseRuntime
  || !baseCore
  || !baseRender
  || typeof baseRuntime.core?.sourceComparison?.isRecord !== "function"
  || typeof baseCore.calculateEvaluation !== "function"
  || typeof baseRender.renderRecords !== "function"
) {
  throw new Error("雙牌源統計轉接層無法取得既有比較流程。");
}

const isSourceComparisonRecord = baseRuntime.core.sourceComparison.isRecord;
let observer = null;
let rendering = false;

/** DOM ID 查找：時間／空間 O(1)。 */
function byId(id) {
  return document.getElementById(id);
}

/** 百分比格式：時間／空間 O(1)。 */
function formatRate(hits, eligible) {
  return eligible ? `${Math.round((hits / eligible) * 1000) / 10}%` : "—";
}

/** 單張能量兩個欄位的摘要：時間／空間 O(1)。 */
function formatDirectDetail(bucket) {
  if (bucket.directGoalBandEligible || bucket.directDrawEligible) {
    return `總進球 ${formatRate(bucket.directGoalBandHits, bucket.directGoalBandEligible)}（${bucket.directGoalBandHits}／${bucket.directGoalBandEligible}）・和局傾向 ${formatRate(bucket.directDrawHits, bucket.directDrawEligible)}（${bucket.directDrawHits}／${bucket.directDrawEligible}）`;
  }
  if (bucket.directLegacyEligible) {
    return `舊版賽果 ${bucket.directLegacyHits}／${bucket.directLegacyEligible}`;
  }
  return "尚無可核對資料";
}

/** 建立單一來源統計桶：時間／空間 O(1)。 */
function createSourceBucket() {
  return {
    directComponentEligible: 0,
    directComponentHits: 0,
    directGoalBandEligible: 0,
    directGoalBandHits: 0,
    directDrawEligible: 0,
    directDrawHits: 0,
    directLegacyEligible: 0,
    directLegacyHits: 0,
    structureEligible: 0,
    structureHits: 0,
    exactHits: 0,
    absoluteErrorTotal: 0,
  };
}

/**
 * 單次掃描建立對照組查表，再逐組統計兩種牌源。
 * 時間複雜度：O(r)
 * 空間複雜度：O(g)
 */
function calculateSourceComparison() {
  const groups = new Map();
  baseCore.getRecords().forEach((record) => {
    if (!isSourceComparisonRecord(record)) return;
    const groupId = record.match.comparisonGroupId;
    if (!groups.has(groupId)) groups.set(groupId, { manual: null, random: null });
    groups.get(groupId)[record.match.cardSource] = record;
  });

  const summary = {
    groups: groups.size,
    completedPairs: 0,
    incompletePairs: 0,
    manual: createSourceBucket(),
    random: createSourceBucket(),
  };

  groups.forEach((pair) => {
    if (!pair.manual || !pair.random || !pair.manual.actual || !pair.random.actual) {
      summary.incompletePairs += 1;
      return;
    }
    summary.completedPairs += 1;

    ["manual", "random"].forEach((source) => {
      const evaluation = baseCore.calculateEvaluation(pair[source]);
      if (!evaluation || evaluation.type === "legacy5") return;
      const bucket = summary[source];

      if (baseCore.modeIncludesDirect(evaluation.type)) {
        const hasEnergyComponents = (
          typeof evaluation.directGoalBandHit === "boolean"
          && typeof evaluation.directDrawTendencyHit === "boolean"
        );
        if (hasEnergyComponents) {
          bucket.directGoalBandEligible += 1;
          bucket.directGoalBandHits += evaluation.directGoalBandHit ? 1 : 0;
          bucket.directDrawEligible += 1;
          bucket.directDrawHits += evaluation.directDrawTendencyHit ? 1 : 0;
          bucket.directComponentEligible += 2;
          bucket.directComponentHits += (
            (evaluation.directGoalBandHit ? 1 : 0)
            + (evaluation.directDrawTendencyHit ? 1 : 0)
          );
        } else if (typeof evaluation.directResultHit === "boolean") {
          bucket.directLegacyEligible += 1;
          bucket.directLegacyHits += evaluation.directResultHit ? 1 : 0;
          bucket.directComponentEligible += 1;
          bucket.directComponentHits += evaluation.directResultHit ? 1 : 0;
        }
      }

      if (baseCore.modeIncludesStructure(evaluation.type)) {
        bucket.structureEligible += 1;
        bucket.structureHits += evaluation.structureResultHit ? 1 : 0;
        bucket.exactHits += evaluation.structureExactHit ? 1 : 0;
        bucket.absoluteErrorTotal += Number(evaluation.structureAbsoluteError || 0);
      }
    });
  });

  return summary;
}

/** 固定摘要卡建立：時間／DOM 空間 O(1)。 */
function createMetricCard(label, value, detail) {
  const article = document.createElement("article");
  article.className = "football-source-metric";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = detail;
  article.append(small, strong, span);
  return article;
}

/**
 * 以現行單張能量欄位重畫固定 6 張摘要卡。
 * 時間複雜度：O(r)
 * 空間複雜度：O(g)
 */
function renderSourceComparison() {
  if (rendering) return;
  const kpis = byId("football-kpis");
  if (!kpis?.parentElement) return;

  rendering = true;
  try {
    let panel = byId("football-source-comparison");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "football-source-comparison";
      panel.className = "football-panel football-source-comparison";
      kpis.parentElement.insertBefore(panel, kpis);
    }

    const summary = calculateSourceComparison();
    const manualMae = summary.manual.structureEligible
      ? Math.round((summary.manual.absoluteErrorTotal / summary.manual.structureEligible) * 100) / 100
      : null;
    const randomMae = summary.random.structureEligible
      ? Math.round((summary.random.absoluteErrorTotal / summary.random.structureEligible) * 100) / 100
      : null;

    const heading = document.createElement("div");
    heading.className = "football-source-heading";
    const copy = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "football-eyebrow";
    eyebrow.textContent = "雙牌源驗證";
    const title = document.createElement("h3");
    title.textContent = "自己抽牌 vs 網站隨機抽牌";
    const note = document.createElement("p");
    note.textContent = summary.completedPairs >= MIN_DIRECTIONAL_SAMPLE
      ? "已達初步方向觀察門檻；仍應同時檢查賽事類型、模型與樣本偏差。"
      : `目前 ${summary.completedPairs} 場完成對照；未滿 ${MIN_DIRECTIONAL_SAMPLE} 場只顯示趨勢，不判定哪一種一定較準。`;
    copy.append(eyebrow, title, note);

    const badge = document.createElement("span");
    badge.className = "football-version";
    badge.textContent = `${summary.completedPairs} 場已核對`;
    heading.append(copy, badge);

    const grid = document.createElement("div");
    grid.className = "football-source-grid";
    grid.append(
      createMetricCard(
        "同場對照",
        String(summary.completedPairs),
        summary.incompletePairs ? `${summary.incompletePairs} 組尚未完成` : `${summary.groups} 組已建立`
      ),
      createMetricCard(
        "自己抽牌｜單張能量",
        formatRate(summary.manual.directComponentHits, summary.manual.directComponentEligible),
        formatDirectDetail(summary.manual)
      ),
      createMetricCard(
        "網站抽牌｜單張能量",
        formatRate(summary.random.directComponentHits, summary.random.directComponentEligible),
        formatDirectDetail(summary.random)
      ),
      createMetricCard(
        "自己抽牌｜攻防賽果",
        formatRate(summary.manual.structureHits, summary.manual.structureEligible),
        `確切比分 ${summary.manual.exactHits}／${summary.manual.structureEligible}・MAE ${manualMae ?? "—"}`
      ),
      createMetricCard(
        "網站抽牌｜攻防賽果",
        formatRate(summary.random.structureHits, summary.random.structureEligible),
        `確切比分 ${summary.random.exactHits}／${summary.random.structureEligible}・MAE ${randomMae ?? "—"}`
      ),
      createMetricCard(
        "驗證規則",
        "先手動、後網站",
        "先鎖定自己抽牌，才揭示網站牌，避免兩組判讀互相影響"
      )
    );

    panel.dataset.metricModel = "energy-v1";
    panel.replaceChildren(heading, grid);
  } finally {
    rendering = false;
  }
}

/**
 * 舊流程內部若重畫舊版摘要，立即以現行能量統計覆蓋。
 * 每次變動時間／空間 O(1)。
 */
function observeLegacyMetricRender() {
  if (observer) return;
  const root = byId("football-records") || document.body;
  observer = new MutationObserver(() => {
    const panel = byId("football-source-comparison");
    if (!panel || rendering) return;
    if (panel.textContent.includes("單張賽果") || !panel.textContent.includes("單張能量")) {
      window.queueMicrotask(renderSourceComparison);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}

const metricsRender = Object.freeze({
  ...baseRender,
  renderRecords() {
    const result = baseRender.renderRecords();
    renderSourceComparison();
    return result;
  },
});

window.FootballLabRender = metricsRender;
window.FootballSourceComparisonRuntime = Object.freeze({
  ...baseRuntime,
  render: metricsRender,
  calculateSourceComparison,
  renderSourceComparison,
  metricModel: "energy-v1",
});

renderSourceComparison();
observeLegacyMetricRender();
