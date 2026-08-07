// 塔羅X賽事驗證｜整體場域轉接層
//
// 現行完整模型不再把單張牌當成可獨立量化的預測模型；
// 單張牌改為「整體場域」，只負責描述它如何影響四張攻防關係。
// 舊 energy-v1 紀錄仍由既有能量層核對，確保歷史資料不被改寫。
//
// 主要函式複雜度：
// - createDraft／validatePrediction／lockDraft／calculateEvaluation：時間／空間 O(1)，牌位建立仍沿用既有 O(p)／O(n) 核心。
// - calculateStats：時間 O(r)、額外空間 O(1)，r = 紀錄數。
// - decorateRecordRows：時間 O(r)、額外空間 O(r) 來自排序快照；其餘 DOM 修正 O(1)。
//
// 更快替代方案比較：
// - 暴力法：另建一套五張牌核心，會複製抽牌、雲端、雙牌源、淘汰賽與投注流程。
// - 優化法：沿用既有 direct 群組作為「場域牌」相容槽，只替換驗證、鎖定、評估與顯示語意；舊資料仍可讀。
// - 暴力法：每次 DOM 變動立即全頁掃描。
// - 優化法：MutationObserver 只排入一個 microtask，固定節點 O(1)，只有紀錄列需要 O(r) 單次掃描。

import { scoredFootballCore } from "./scoring.js";

export const FIELD_CONTEXT_MODEL_KEY = "field-v2";
const COMPAT_DIRECT_RESULT = "ND";
const COMPAT_DIRECT_CONFIDENCE = 3;

const baseCore = window.FootballLabCore;
const baseRender = window.FootballLabRender;
if (!baseCore || !baseRender) {
  throw new Error("整體場域轉接層無法取得既有能量核心與 Render。");
}

let decorating = false;
let decorateScheduled = false;
let observer = null;

/** DOM ID 查找：時間／空間 O(1)。 */
function byId(id) {
  return document.getElementById(id);
}

/** 場域新版預測判斷：時間／空間 O(1)。 */
export function isFieldContextPrediction(prediction) {
  return Boolean(prediction && prediction.directModel === FIELD_CONTEXT_MODEL_KEY);
}

/** 場域新版紀錄判斷：時間／空間 O(1)。 */
export function isFieldContextRecord(record) {
  return isFieldContextPrediction(record?.prediction);
}

/** 只建立給舊核心通過鎖定所需的相容副本，不修改輸入：時間／空間 O(1)。 */
function createCompatPrediction(prediction, mode) {
  if (!baseCore.modeIncludesDirect(mode)) return { ...prediction };
  return {
    ...prediction,
    directModel: FIELD_CONTEXT_MODEL_KEY,
    directResult: COMPAT_DIRECT_RESULT,
    directConfidence: COMPAT_DIRECT_CONFIDENCE,
    directGoalBand: "",
    directDrawTendency: "",
  };
}

/** 新版模式不允許建立單張獨立紀錄：時間／空間 O(1)。 */
function validateMatch(match) {
  if (match?.mode === "direct") {
    return "整體場域不是獨立預測模型，請使用「完整模型：整體場域＋四張攻防」或只做四張攻防。";
  }
  return baseCore.validateMatch(match);
}

/**
 * 場域只要求原始解讀；量化比分仍由四張攻防驗證。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function validatePrediction(prediction, mode) {
  if (mode === "direct") {
    return "整體場域不可單獨鎖定，必須與四張攻防一起使用。";
  }
  if (baseCore.modeIncludesDirect(mode) && !String(prediction?.directNotes || "").trim()) {
    return "請完成整體場域的原始解讀。";
  }
  return scoredFootballCore.validatePrediction(createCompatPrediction(prediction, mode), mode);
}

/**
 * 沿用同一份核心 draft，只修改場域牌的正式語意。
 * 時間複雜度：沿用既有 createDraft；額外 O(p)，p <= 5。
 * 空間複雜度：O(1) 額外空間。
 */
function createDraft(match) {
  const draft = baseCore.createDraft(match);
  const fieldCard = draft?.cards?.find((card) => card.group === "direct");
  if (fieldCard) {
    fieldCard.positionTitle = "整體場域";
    fieldCard.positionNote = "作為全場脈絡，觀察它如何放大、壓抑、扭曲或轉換四張攻防關係；不獨立預測比分、總進球或和局。";
  }
  return draft;
}

/**
 * 舊核心鎖定後立即把相容欄位清空並重新保存，避免虛構比分／信心進入正式資料。
 * 時間複雜度：O(r) 來自 importRecords 的既有合併保存。
 * 空間複雜度：O(r)。
 *
 * 更快替代方案比較：直接改 core.js 可少一次匯入，但會改動所有舊模型；
 * 此轉接只在新場域紀錄鎖定時做一次 O(r) 保存，換取歷史相容與較低回歸風險。
 */
function lockDraft(prediction, cards) {
  const mode = baseCore.getDraft()?.match?.mode;
  const compat = createCompatPrediction(prediction, mode);
  const record = scoredFootballCore.lockDraft(compat, cards);

  if (baseCore.modeIncludesDirect(mode)) {
    record.prediction = {
      ...record.prediction,
      directModel: FIELD_CONTEXT_MODEL_KEY,
      directResult: "",
      directConfidence: null,
      directGoalBand: "",
      directDrawTendency: "",
      directFieldQualitativeOnly: true,
    };
    scoredFootballCore.importRecords([record]);
  }
  return record;
}

/**
 * 新場域紀錄不產生單張命中率；舊 energy-v1 與舊單張賽果仍交由原能量層處理。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function calculateEvaluation(record) {
  if (!isFieldContextRecord(record)) return baseCore.calculateEvaluation(record);
  const evaluation = scoredFootballCore.calculateEvaluation(record);
  if (!evaluation) return evaluation;
  return {
    ...evaluation,
    directResultHit: null,
    modelsAgree: null,
    bothResultHit: null,
    fieldContextQualitativeOnly: true,
  };
}

/** 固定三項賠率取最低：時間／空間 O(1)。 */
function getMarketFavorite(record) {
  const odds = record.match?.odds || {};
  const entries = [["H", odds.home], ["D", odds.draw], ["A", odds.away]];
  if (!entries.every(([, value]) => Number.isFinite(value))) return "";
  let favorite = entries[0];
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index][1] < favorite[1]) favorite = entries[index];
  }
  return favorite[0];
}

/**
 * 單次掃描正式統計；場域只計「有質性紀錄」樣本數，不計命中率。
 * 時間複雜度：O(r)
 * 空間複雜度：O(1) 額外空間
 */
function calculateStats() {
  const stats = {
    total: 0,
    completed: 0,
    fieldContextEligible: 0,
    directEligible: 0,
    directHits: 0,
    directLegacyEligible: 0,
    directLegacyHits: 0,
    directGoalBandEligible: 0,
    directGoalBandHits: 0,
    directDrawEligible: 0,
    directDrawHits: 0,
    structureEligible: 0,
    structureResultHits: 0,
    structureExactHits: 0,
    structureErrorTotal: 0,
    dualEligible: 0,
    dualAgreements: 0,
    marketEligible: 0,
    marketHits: 0,
    legacyCompleted: 0,
    advanceEligible: 0,
    advanceHits: 0,
  };

  const records = fieldContextCore.getRecords();
  stats.total = records.length;
  records.forEach((record) => {
    const evaluation = fieldContextCore.calculateEvaluation(record);
    if (!evaluation) return;
    stats.completed += 1;
    if (evaluation.type === "legacy5") {
      stats.legacyCompleted += 1;
      return;
    }

    if (isFieldContextRecord(record)) {
      stats.fieldContextEligible += 1;
    } else if (baseCore.modeIncludesDirect(evaluation.type)) {
      if (
        typeof evaluation.directGoalBandHit === "boolean"
        && typeof evaluation.directDrawTendencyHit === "boolean"
      ) {
        stats.directGoalBandEligible += 1;
        stats.directGoalBandHits += evaluation.directGoalBandHit ? 1 : 0;
        stats.directDrawEligible += 1;
        stats.directDrawHits += evaluation.directDrawTendencyHit ? 1 : 0;
      } else if (typeof evaluation.directResultHit === "boolean") {
        stats.directEligible += 1;
        stats.directHits += evaluation.directResultHit ? 1 : 0;
        stats.directLegacyEligible += 1;
        stats.directLegacyHits += evaluation.directResultHit ? 1 : 0;
      }
    }

    if (baseCore.modeIncludesStructure(evaluation.type)) {
      stats.structureEligible += 1;
      stats.structureResultHits += evaluation.structureResultHit ? 1 : 0;
      stats.structureExactHits += evaluation.structureExactHit ? 1 : 0;
      stats.structureErrorTotal += Number(evaluation.structureAbsoluteError || 0);
    }

    if (typeof evaluation.modelsAgree === "boolean") {
      stats.dualEligible += 1;
      stats.dualAgreements += evaluation.modelsAgree ? 1 : 0;
    }

    const favorite = getMarketFavorite(record);
    if (favorite) {
      stats.marketEligible += 1;
      stats.marketHits += favorite === evaluation.actualResult ? 1 : 0;
    }

    const knockout = evaluation.knockout;
    if (knockout?.finalAdvanceEligible) {
      stats.advanceEligible += 1;
      stats.advanceHits += knockout.finalAdvanceHit ? 1 : 0;
    } else if (evaluation.advanceEligible) {
      stats.advanceEligible += 1;
      stats.advanceHits += evaluation.advanceHit ? 1 : 0;
    }
  });
  return stats;
}

const fieldModeLabels = Object.freeze({
  ...baseCore.data.modeLabels,
  dual: "完整模型：整體場域＋四張攻防",
  structure: "只做四張攻防",
  direct: "舊版單張整體能量（已停用）",
});

const fieldData = Object.freeze({
  ...baseCore.data,
  modeLabels: fieldModeLabels,
});

export const fieldContextCore = Object.freeze({
  ...baseCore,
  data: fieldData,
  validateMatch,
  validatePrediction,
  createDraft,
  lockDraft,
  calculateEvaluation,
  calculateStats,
  fieldContextModelKey: FIELD_CONTEXT_MODEL_KEY,
  isFieldContextPrediction,
  isFieldContextRecord,
});

/** 固定 label 的第一段文字：時間 O(c)、空間 O(c)，c 為少量 childNodes。 */
function setLeadingLabelText(label, text) {
  if (!label) return;
  const node = Array.from(label.childNodes).find(
    (child) => child.nodeType === Node.TEXT_NODE && String(child.textContent || "").trim()
  );
  if (node && String(node.textContent || "").trim() !== text) {
    node.textContent = `\n                    ${text}\n                    `;
  }
}

/** 固定場域表單整理：時間／空間 O(1)。 */
function configureFieldForm() {
  const mode = byId("football-mode");
  const directOption = mode?.querySelector('option[value="direct"]');
  directOption?.remove();
  if (mode?.value === "direct") mode.value = "dual";

  const dualOption = mode?.querySelector('option[value="dual"]');
  const structureOption = mode?.querySelector('option[value="structure"]');
  if (dualOption) dualOption.textContent = "完整模型：整體場域＋四張攻防";
  if (structureOption) structureOption.textContent = "只做四張攻防";

  const fieldset = byId("football-direct-reading");
  const legend = fieldset?.querySelector("legend");
  if (legend) legend.textContent = "A｜整體場域";
  const disclaimer = fieldset?.querySelector(":scope > .football-disclaimer");
  if (disclaimer) {
    disclaimer.textContent = "場域牌不獨立預測比分、總進球或和局；只記錄它如何影響四張攻防關係與整場脈絡。";
  }

  [
    byId("football-direct-result"),
    byId("football-direct-goal-band"),
    byId("football-direct-draw-tendency"),
    byId("football-direct-confidence"),
  ].forEach((field) => {
    if (!field) return;
    field.required = false;
    field.disabled = true;
    field.closest("label")?.classList.add("football-hidden");
  });

  const notes = byId("football-direct-notes");
  setLeadingLabelText(notes?.closest("label"), "整體場域原始解讀");
  if (notes) {
    notes.maxLength = 1200;
    notes.placeholder = "先寫場域主調，再說明它如何放大、壓抑、扭曲或轉換「主攻×客防、客攻×主防」的關係；若影響有條件、矛盾或時間轉折也一起記錄。場域本身不另外預測比分、總進球或和局。";
  }
}

/** 固定頁面文案同步：時間／空間 O(1)。 */
function updateFieldCopy() {
  const readingTitle = document.querySelector("#football-reading-panel .football-section-heading h3");
  if (readingTitle) readingTitle.textContent = "牌面與判讀";

  const toolLead = document.querySelector("#football-tool .section-lead");
  if (toolLead) {
    toolLead.textContent = "完整模型以 1 張整體場域牌作為 4 張攻防的脈絡修正；場域不獨立計分，也可只做四張攻防。";
  }

  const matchDisclaimer = document.querySelector("#football-match-form > .football-disclaimer");
  if (matchDisclaimer) {
    matchDisclaimer.textContent = "完整模型共 5 張：1 張整體場域＋4 張攻防。場域只作脈絡修正，不獨立預測總進球、和局或勝方。";
  }

  const recordsLead = document.querySelector("#football-records .section-lead");
  if (recordsLead) {
    recordsLead.textContent = "整體場域採質性回顧、不獨立計分；量化驗證以四張攻防推導的賽果、確切比分與投注損益為主。";
  }

  const footer = document.querySelector(".site-footer .footer-sub");
  if (footer) {
    footer.textContent = "整體場域提供脈絡，四張攻防負責推導；場域不另外製造一組勝負或進球預測。";
  }
}

/** 草稿區固定修正：時間 O(p)、空間 O(1)，p <= 5。 */
function decorateDraft(draft) {
  configureFieldForm();
  updateFieldCopy();

  const headings = document.querySelectorAll(".football-card-group-heading");
  headings.forEach((heading) => {
    const title = heading.querySelector("h4");
    if (!title?.textContent?.startsWith("A｜")) return;
    title.textContent = "A｜整體場域";
    const note = heading.querySelector("p");
    if (note) note.textContent = "先記錄全場脈絡，再用它理解四張攻防之間的放大、壓抑、扭曲或轉換。";
  });

  document.querySelectorAll("#football-card-grid .football-card").forEach((card) => {
    const name = card.querySelector(".football-card-name");
    if (name?.textContent?.includes("90 分鐘整體能量")) name.textContent = "整體場域";
    const role = card.querySelector(".football-card-role");
    if (name?.textContent === "整體場域" && role) {
      role.textContent = "觀察全場脈絡如何影響兩組攻防關係；不獨立預測比分、總進球或和局。";
    }
  });

  document.querySelectorAll("#football-match-summary .football-summary-item").forEach((item) => {
    if (item.querySelector("small")?.textContent !== "實驗模式") return;
    const value = item.querySelector("strong");
    if (value && draft?.match?.mode) value.textContent = fieldModeLabels[draft.match.mode] || value.textContent;
  });
}

/** 新版場域紀錄的顯示摘要：時間／空間 O(1)。 */
function fieldPredictionText(record) {
  const prediction = record.prediction || {};
  if (!baseCore.modeIncludesStructure(baseCore.getMode(record))) return "整體場域：已記錄";
  const result = fieldContextCore.getResult(
    prediction.structureHomeGoals,
    prediction.structureAwayGoals
  );
  return `整體場域：已記錄｜攻防：${prediction.structureHomeGoals}：${prediction.structureAwayGoals}（${fieldData.resultLabels[result]}）`;
}

/** 紀錄列只修正新版場域資料：時間 O(r)、空間 O(r) 排序快照。 */
function decorateRecordRows() {
  const rows = Array.from(byId("football-records-body")?.querySelectorAll(":scope > tr") || []);
  if (!rows.length) return;
  const records = fieldContextCore.getRecords().sort(
    (left, right) => String(right.match.kickoff).localeCompare(String(left.match.kickoff))
  );

  records.forEach((record, index) => {
    if (!isFieldContextRecord(record)) return;
    const cells = rows[index]?.children;
    if (!cells || cells.length < 5) return;

    const modeDetail = cells[1].querySelector("small");
    if (modeDetail) {
      const separator = modeDetail.textContent.indexOf("｜");
      modeDetail.textContent = `${fieldModeLabels[baseCore.getMode(record)]}${separator >= 0 ? modeDetail.textContent.slice(separator) : ""}`;
    }

    const predictionText = cells[2].querySelector("span");
    if (predictionText) predictionText.textContent = fieldPredictionText(record);

    const hitText = cells[4].querySelector("span");
    const hitDetail = cells[4].querySelector("small");
    if (!record.actual) {
      if (hitText) hitText.textContent = "—";
      if (hitDetail) hitDetail.textContent = "等待賽後核對";
      return;
    }

    const evaluation = fieldContextCore.calculateEvaluation(record);
    if (hitText) {
      hitText.textContent = baseCore.modeIncludesStructure(evaluation?.type)
        ? `攻防賽果${evaluation.structureResultHit ? "命中" : "未中"}`
        : "場域質性回顧";
    }
    if (hitDetail) {
      hitDetail.textContent = baseCore.modeIncludesStructure(evaluation?.type)
        ? `場域不獨立計分／比分${evaluation.structureExactHit ? "命中" : "未中"}／總誤差 ${evaluation.structureAbsoluteError} 球`
        : "場域不獨立計分";
    }
  });
}

/** 統計卡移除已停用的單張量化與模型一致率：時間 O(k)、空間 O(1)，k 為固定 KPI 數。 */
function decorateKpis() {
  document.querySelectorAll("#football-kpis .football-kpi").forEach((card) => {
    const label = card.querySelector("small")?.textContent || "";
    card.classList.toggle(
      "football-hidden",
      label === "單張賽果" || label === "雙模型一致率"
    );
  });
}

/** 雙牌源統計把場域標為質性，不偽造命中率；保留隱藏相容文字避免舊 observer 重畫循環。 */
function decorateSourceComparison() {
  const panel = byId("football-source-comparison");
  if (!panel) return;
  panel.querySelectorAll(".football-source-metric").forEach((card) => {
    const label = card.querySelector("small");
    const value = card.querySelector("strong");
    const detail = card.querySelector("span");
    if (!label || !value || !detail) return;
    if (label.textContent === "自己抽牌｜單張能量") {
      label.textContent = "自己抽牌｜整體場域";
      value.textContent = "質性";
      detail.textContent = "作為四張攻防的脈絡修正，不獨立計算命中率";
    } else if (label.textContent === "網站抽牌｜單張能量") {
      label.textContent = "網站抽牌｜整體場域";
      value.textContent = "質性";
      detail.textContent = "作為四張攻防的脈絡修正，不獨立計算命中率";
    }
  });

  if (!byId("football-field-legacy-metric-text")) {
    const compatibility = document.createElement("span");
    compatibility.id = "football-field-legacy-metric-text";
    compatibility.className = "football-hidden";
    compatibility.textContent = "自己抽牌｜單張能量 網站抽牌｜單張能量";
    panel.appendChild(compatibility);
  }
}

/** 場域核對卡：固定最多 5 個項目，時間／DOM 空間 O(1)。 */
function decorateScorecard(record) {
  if (!isFieldContextRecord(record) || !record.actual) return;
  const container = byId("football-scorecard");
  if (!container) return;
  const evaluation = fieldContextCore.calculateEvaluation(record);
  if (!evaluation) return;

  const title = document.createElement("h4");
  title.textContent = `${fieldModeLabels[baseCore.getMode(record)]}核對`;
  const grid = document.createElement("div");
  grid.className = "football-score-grid";

  const fieldItem = document.createElement("div");
  fieldItem.className = "football-score-item";
  const fieldSmall = document.createElement("small");
  fieldSmall.textContent = "整體場域";
  const fieldStrong = document.createElement("strong");
  fieldStrong.textContent = "質性回顧";
  const fieldSpan = document.createElement("span");
  fieldSpan.textContent = "不獨立判定命中；請用賽後回顧確認場域如何實際作用於攻防關係。";
  fieldItem.append(fieldSmall, fieldStrong, fieldSpan);
  grid.appendChild(fieldItem);

  if (baseCore.modeIncludesStructure(evaluation.type)) {
    [
      ["攻防推導賽果", evaluation.structureResultHit, `預測 ${fieldData.resultLabels[evaluation.structureResult]}／實際 ${fieldData.resultLabels[evaluation.actualResult]}`],
      ["主隊進球", evaluation.structureHomeGoalHit, `預測 ${record.prediction.structureHomeGoals}／實際 ${record.actual.homeGoals}`],
      ["客隊進球", evaluation.structureAwayGoalHit, `預測 ${record.prediction.structureAwayGoals}／實際 ${record.actual.awayGoals}`],
      ["確切比分", evaluation.structureExactHit, `總誤差 ${evaluation.structureAbsoluteError} 球`],
    ].forEach(([label, hit, detail]) => {
      const item = document.createElement("div");
      item.className = `football-score-item ${hit ? "is-hit" : "is-miss"}`;
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = hit ? "命中" : "未中";
      const span = document.createElement("span");
      span.textContent = detail;
      item.append(small, strong, span);
      grid.appendChild(item);
    });
  }

  container.replaceChildren(title, grid);
  container.classList.remove("football-hidden");
}

/** 賽後摘要移除單張獨立預測語意：時間 O(s)、空間 O(1)，s 為固定摘要項。 */
function decorateEvaluationSummary(record) {
  if (!isFieldContextRecord(record)) return;
  document.querySelectorAll("#football-evaluation-summary .football-summary-item").forEach((item) => {
    const label = item.querySelector("small")?.textContent;
    const value = item.querySelector("strong");
    if (!value) return;
    if (label === "模式") value.textContent = fieldModeLabels[baseCore.getMode(record)] || value.textContent;
    if (label === "鎖定預測") value.textContent = fieldPredictionText(record);
  });
}

/** 編輯面板文字保持新模型語意：時間／空間 O(1)。 */
function decorateEditorCopy() {
  const warning = document.querySelector("#football-edit-panel .football-edit-warning");
  if (warning) {
    warning.textContent = "可修正賽事基本資料與四張攻防的預測比分；牌面、整體場域判讀、文字解讀及已輸入的實際賽果不會被清除。若比分改變決勝路徑，完整編輯層會要求補齊必要的延長賽／PK 牌組。";
  }
}

/** 固定表面整理；紀錄列為唯一隨 r 成長的部分。 */
function decorateSurface() {
  if (decorating) return;
  decorating = true;
  try {
    configureFieldForm();
    updateFieldCopy();
    decorateRecordRows();
    decorateKpis();
    decorateSourceComparison();
    decorateEditorCopy();
  } finally {
    decorating = false;
  }
}

/** MutationObserver 去抖：同一批 DOM 變更只執行一次。 */
function scheduleDecorate() {
  if (decorateScheduled) return;
  decorateScheduled = true;
  window.queueMicrotask(() => {
    decorateScheduled = false;
    decorateSurface();
  });
}

export const fieldContextRender = Object.freeze({
  ...baseRender,
  renderDraft(draft) {
    const result = baseRender.renderDraft(draft);
    decorateDraft(draft);
    return result;
  },
  renderRecords() {
    const result = baseRender.renderRecords();
    decorateSurface();
    return result;
  },
  openEvaluation(record) {
    const result = baseRender.openEvaluation(record);
    decorateEvaluationSummary(record);
    decorateScorecard(record);
    return result;
  },
  renderScorecard(record) {
    const result = baseRender.renderScorecard(record);
    decorateScorecard(record);
    return result;
  },
});

function observeFutureRenders() {
  if (observer) return;
  observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("football-energy-render", scheduleDecorate);
}

export const footballFieldContextRuntime = Object.freeze({
  stage: "field-context-v2",
  modelKey: FIELD_CONTEXT_MODEL_KEY,
  baseCore,
  baseRender,
  core: fieldContextCore,
  render: fieldContextRender,
  isFieldContextPrediction,
  isFieldContextRecord,
  decorateSurface,
});

window.FootballLabCore = fieldContextCore;
window.FootballLabRender = fieldContextRender;
window.FootballFieldContextRuntime = footballFieldContextRuntime;

configureFieldForm();
updateFieldCopy();
observeFutureRenders();
scheduleDecorate();
