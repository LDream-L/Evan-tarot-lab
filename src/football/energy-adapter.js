// 世足賽事驗證｜單張整體能量表單與核心轉接層
//
// 此檔負責把純模型接到既有 DOM、紀錄核心與 Render；
// 規則判定集中在 energy-model.js，不在本檔重寫。
//
// 主要函式複雜度：
// - createDraft：時間 O(p)、額外空間 O(1)，p <= 5。
// - calculateEvaluation：時間／空間 O(1)。
// - calculateStats：時間 O(r)、額外空間 O(1)，r = 紀錄數。
// - decorateDraft：時間 O(h+s)、額外空間 O(h+s)，h/s 為固定少量 DOM 節點。
//
// 更快替代方案比較：
// - 每次 Render 重建整個頁面會重複抽牌、淘汰賽與雲端同步 DOM。
// - 本轉接層只建立必要欄位與覆寫必要核心函式，保留既有 Render 結果。

import { scoredFootballCore } from "./scoring.js";
import {
  ENERGY_MODEL_VERSION,
  NON_DRAW_CODE,
  GOAL_BANDS,
  DRAW_TENDENCIES,
  footballEnergyModel,
  validDrawTendency,
  directCodeFromTendency,
  validateEnergyPrediction,
  normalizeEnergyPrediction,
  applyEnergyEvaluation,
  isEnergyRecord,
  createEnergyData,
} from "./energy-model.js";

const baseCore = scoredFootballCore;
const baseUi = window.FootballLabRender;
if (!baseUi) throw new Error("世足 Render 尚未載入，無法啟動單張能量轉接層。");

/** DOM ID 查找：時間／空間 O(1)。 */
function byId(id) {
  return document.getElementById(id);
}

/** 讀取固定兩個能量欄位：時間／空間 O(1)。 */
export function readEnergyForm() {
  return {
    goalBand: String(byId("football-direct-goal-band")?.value || "").trim(),
    drawTendency: String(byId("football-direct-draw-tendency")?.value || "").trim(),
  };
}

/** 固定少量 label childNodes：時間 O(c)、空間 O(c)。 */
function setLeadingLabelText(label, text) {
  if (!label) return;
  const node = Array.from(label.childNodes).find(
    (child) => child.nodeType === Node.TEXT_NODE && String(child.textContent || "").trim()
  );
  if (node) node.textContent = `\n                    ${text}\n                    `;
}

/** 固定少量 options：時間／空間 O(o)。 */
function createSelect(id, options) {
  const select = document.createElement("select");
  select.id = id;
  select.required = true;
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  return select;
}

/** 隱藏相容欄位同步：時間／空間 O(1)。 */
export function syncHiddenDirectResult() {
  const source = byId("football-direct-draw-tendency");
  const target = byId("football-direct-result");
  if (!target) return;
  target.value = validDrawTendency(source?.value)
    ? directCodeFromTendency(source.value)
    : "";
}

/**
 * 建立兩個可獨立驗證的單張能量欄位。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
export function ensureEnergyFields() {
  const fieldset = byId("football-direct-reading");
  const oldSelect = byId("football-direct-result");
  if (!fieldset || !oldSelect) return;
  const firstInit = fieldset.dataset.energyReady !== "1";

  const legend = fieldset.querySelector("legend");
  if (legend) legend.textContent = "A｜單張整體能量模型";
  const disclaimer = fieldset.querySelector(":scope > .football-disclaimer");
  if (disclaimer) {
    disclaimer.textContent = "單張牌只看 90 分鐘整體節奏、總進球量與是否和局，不用它判斷主隊或客隊勝。";
  }

  oldSelect.closest("label")?.classList.add("football-hidden");
  if (!oldSelect.querySelector(`option[value="${NON_DRAW_CODE}"]`)) {
    const option = document.createElement("option");
    option.value = NON_DRAW_CODE;
    option.textContent = "非和局";
    oldSelect.appendChild(option);
  }

  if (!byId("football-direct-goal-band")) {
    const grid = fieldset.querySelector(".football-form-grid");
    const confidence = byId("football-direct-confidence")?.closest("label");
    if (!grid || !confidence) return;

    const goalLabel = document.createElement("label");
    goalLabel.dataset.energyField = "goal-band";
    goalLabel.append(
      document.createTextNode("90 分鐘總進球區間"),
      createSelect("football-direct-goal-band", [
        ["", "請選擇"],
        ["low", GOAL_BANDS.low.label],
        ["medium", GOAL_BANDS.medium.label],
        ["high", GOAL_BANDS.high.label],
      ])
    );

    const drawLabel = document.createElement("label");
    drawLabel.dataset.energyField = "draw-tendency";
    drawLabel.append(
      document.createTextNode("90 分鐘是否和局"),
      createSelect("football-direct-draw-tendency", [
        ["", "請選擇"],
        ["draw", DRAW_TENDENCIES.draw.label],
        ["decisive", DRAW_TENDENCIES.decisive.label],
      ])
    );

    grid.insertBefore(goalLabel, confidence);
    grid.insertBefore(drawLabel, confidence);
  }

  setLeadingLabelText(
    byId("football-direct-confidence")?.closest("label"),
    "單張能量信心"
  );

  const notes = byId("football-direct-notes");
  setLeadingLabelText(notes?.closest("label"), "單張整體能量原始解讀");
  if (notes) {
    notes.placeholder = "記錄牌面如何對應比賽節奏、總進球量、和局或進入延長賽／PK 的傾向；不要指定哪一隊獲勝。";
  }

  if (firstInit) {
    byId("football-direct-draw-tendency")?.addEventListener(
      "change",
      syncHiddenDirectResult
    );
    byId("football-reading-form")?.addEventListener("reset", () => {
      window.setTimeout(syncHiddenDirectResult, 0);
    });
    fieldset.dataset.energyReady = "1";
  }
  syncHiddenDirectResult();
}

/** 固定 option 查找：時間／空間 O(1)。 */
function setOptionText(selectId, value, text) {
  const option = byId(selectId)?.querySelector(`option[value="${value}"]`);
  if (option) option.textContent = text;
}

/** 固定頁面節點更新：時間／空間 O(1)。 */
function updatePageCopy() {
  document.title = "Evan Tarot｜世足賽事驗證 v1.6";

  const heroTitle = document.querySelector(".subpage-hero .hero-text h1");
  const heroText = document.querySelector(".subpage-hero .hero-text > p");
  if (heroTitle) heroTitle.textContent = "世足賽事驗證 v1.6。";
  if (heroText) {
    heroText.textContent = "單張牌觀察 90 分鐘整體能量，四張牌則從雙方攻防推導比分；兩種模型分開驗證。";
  }

  const principleItems = document.querySelectorAll(".subpage-hero .hero-card li");
  if (principleItems[0]) principleItems[0].textContent = "單張整體能量與四張攻防分開抽、分開解讀";
  if (principleItems[1]) principleItems[1].textContent = "單張不指定勝方；攻防模型才推導雙方比分與賽果";
  if (principleItems[2]) principleItems[2].textContent = "總進球、和局傾向與攻防比分分開核對";

  const toolLead = document.querySelector("#football-tool .section-lead");
  if (toolLead) {
    toolLead.textContent = "可只做單張整體能量、只做四張攻防，或同場用兩組獨立抽牌比較不同層次的準確率。";
  }

  const version = document.querySelector("#football-match-form .football-version");
  if (version) version.textContent = `模型 v${ENERGY_MODEL_VERSION}`;

  setOptionText("football-mode", "dual", "雙模型比較：單張能量＋四張攻防");
  setOptionText("football-mode", "direct", "只做單張整體能量");

  const matchDisclaimer = document.querySelector(
    "#football-match-form > .football-disclaimer"
  );
  if (matchDisclaimer) {
    matchDisclaimer.textContent = "雙模型模式是兩次獨立抽牌：先判讀單張整體能量，再重新洗牌記錄四張攻防。";
  }

  const recordsLead = document.querySelector("#football-records .section-lead");
  if (recordsLead) {
    recordsLead.textContent = "單張總進球區間、單張和局傾向、攻防推導賽果與確切比分分開統計；舊版單張勝負紀錄保留但不混入新版 KPI。";
  }

  const footer = document.querySelector(".site-footer .footer-sub");
  if (footer) {
    footer.textContent = "單張看整體能量，四張看雙方攻防；不同問題，分開驗證。";
  }
}

/** 只修改單張牌位文案，不重建牌組：時間 O(p)、額外空間 O(1)。 */
function createDraft(match) {
  const draft = baseCore.createDraft(match);
  const directCard = draft?.cards?.find((card) => card.group === "direct");
  if (directCard) {
    directCard.positionTitle = "單張｜90 分鐘整體能量";
    directCard.positionNote = "觀察比賽活躍度、總進球區間，以及是否可能和局進入決勝階段；不指定勝方";
  }
  return draft;
}

/** 固定欄位驗證：時間／空間 O(1)。 */
function validatePrediction(prediction, mode) {
  const includesDirect = baseCore.modeIncludesDirect(mode);
  const energyInput = readEnergyForm();
  const energyError = validateEnergyPrediction(prediction, energyInput, includesDirect);
  if (energyError) return energyError;

  const normalized = normalizeEnergyPrediction(prediction, energyInput, {
    includesDirect,
    lock: false,
  });
  return baseCore.validatePrediction(normalized, mode);
}

/** 鎖定前正規化固定欄位：時間／空間 O(1)。 */
function lockDraft(prediction, cards) {
  const mode = baseCore.getDraft()?.match?.mode;
  const includesDirect = baseCore.modeIncludesDirect(mode);
  const normalized = normalizeEnergyPrediction(prediction, readEnergyForm(), {
    includesDirect,
    lock: true,
  });

  const record = baseCore.lockDraft(normalized, cards);
  record.modelVersion = ENERGY_MODEL_VERSION;
  baseCore.importRecords([record]);
  return record;
}

/** 新版單張能量核對：時間／空間 O(1)。 */
function calculateEvaluation(record) {
  return applyEnergyEvaluation(
    record,
    baseCore.calculateEvaluation(record),
    baseCore.getMode
  );
}

/** 固定三個賠率，單次掃描取最小值：時間／空間 O(1)。 */
function getMarketFavorite(record) {
  const entries = [
    ["H", record.match?.odds?.home],
    ["D", record.match?.odds?.draw],
    ["A", record.match?.odds?.away],
  ];
  if (!entries.every(([, value]) => Number.isFinite(value))) return "";

  let favorite = entries[0];
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index][1] < favorite[1]) favorite = entries[index];
  }
  return favorite[0];
}

/**
 * 單次掃描所有紀錄。
 * 時間複雜度：O(r)
 * 空間複雜度：O(1) 額外空間
 */
function calculateStats() {
  const stats = {
    total: 0,
    completed: 0,
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

  const records = energyFootballCore.getRecords();
  stats.total = records.length;

  records.forEach((record) => {
    const evaluation = energyFootballCore.calculateEvaluation(record);
    if (!evaluation) return;
    stats.completed += 1;

    if (evaluation.type === "legacy5") {
      stats.legacyCompleted += 1;
      return;
    }

    if (baseCore.modeIncludesDirect(evaluation.type)) {
      if (isEnergyRecord(record)) {
        stats.directGoalBandEligible += 1;
        stats.directGoalBandHits += evaluation.directGoalBandHit ? 1 : 0;
        stats.directDrawEligible += 1;
        stats.directDrawHits += evaluation.directDrawTendencyHit ? 1 : 0;
      } else {
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

    if (evaluation.type === "dual" && typeof evaluation.modelsAgree === "boolean") {
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

export const energyFootballData = createEnergyData(baseCore.data);

export const energyFootballCore = Object.freeze({
  ...baseCore,
  data: energyFootballData,
  createDraft,
  validatePrediction,
  lockDraft,
  calculateEvaluation,
  calculateStats,
});

/** 固定少量摘要節點：時間 O(h+s)、空間 O(h+s)。 */
function decorateDraft(draft) {
  ensureEnergyFields();
  const heading = Array.from(
    document.querySelectorAll(".football-card-group-heading")
  ).find((item) => item.querySelector("h4")?.textContent?.startsWith("A｜"));

  if (heading) {
    const title = heading.querySelector("h4");
    const note = heading.querySelector("p");
    if (title) title.textContent = "A｜單張整體能量模型";
    if (note) {
      note.textContent = "這一組只看 90 分鐘整體節奏、總進球量與是否和局，不判定哪一隊獲勝。";
    }
  }

  const summaryItems = document.querySelectorAll(
    "#football-match-summary .football-summary-item"
  );
  summaryItems.forEach((item) => {
    if (item.querySelector("small")?.textContent === "實驗模式") {
      const value = item.querySelector("strong");
      if (value) {
        value.textContent = energyFootballData.modeLabels[draft.match.mode]
          || value.textContent;
      }
    }
  });

  window.dispatchEvent(new CustomEvent("football-energy-render"));
}

export const energyFootballUi = Object.freeze({
  ...baseUi,
  renderDraft(draft) {
    const result = baseUi.renderDraft(draft);
    decorateDraft(draft);
    return result;
  },
  renderRecords() {
    const result = baseUi.renderRecords();
    window.dispatchEvent(new CustomEvent("football-energy-render"));
    return result;
  },
  openEvaluation(record) {
    const result = baseUi.openEvaluation(record);
    window.dispatchEvent(new CustomEvent("football-energy-render"));
    return result;
  },
  renderScorecard(record) {
    const result = baseUi.renderScorecard(record);
    window.dispatchEvent(new CustomEvent("football-energy-render"));
    return result;
  },
});

export const footballEnergyAdapter = Object.freeze({
  model: footballEnergyModel,
  core: energyFootballCore,
  ui: energyFootballUi,
  modelVersion: footballEnergyModel.modelVersion,
  modelKey: footballEnergyModel.modelKey,
  nonDrawCode: footballEnergyModel.nonDrawCode,
  goalBands: footballEnergyModel.goalBands,
  drawTendencies: footballEnergyModel.drawTendencies,
  isEnergyPrediction: footballEnergyModel.isEnergyPrediction,
  isEnergyRecord: footballEnergyModel.isEnergyRecord,
  getActualGoalBand: footballEnergyModel.getActualGoalBand,
  getActualDrawTendency: footballEnergyModel.getActualDrawTendency,
  directCodeFromTendency: footballEnergyModel.directCodeFromTendency,
  syncHiddenDirectResult,
  ensureEnergyFields,
});

window.FootballLabCore = energyFootballCore;
window.FootballLabRender = energyFootballUi;
window.FootballDirectEnergy = footballEnergyAdapter;

updatePageCopy();
ensureEnergyFields();
