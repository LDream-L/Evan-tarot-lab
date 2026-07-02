// ==============================
// football-direct-energy.js
// 世足賽事驗證 v1.6.0：單張牌改為 90 分鐘整體能量模型
// ==============================
// 核心規則：
// - 單張牌不再判斷主隊勝或客隊勝。
// - 單張牌只記錄 90 分鐘總進球區間與是否和局。
// - 四張攻防模型仍負責預測雙方比分並推導主客勝負。
//
// 主要函式複雜度：
// - calculateEvaluation：O(1) 時間／O(1) 空間。
// - calculateStats：O(r) 時間／O(1) 額外空間，r 為紀錄數。
// - createDraft：O(p) 時間／O(1) 額外空間，p <= 5。
//
// 更快替代方案比較：
// - 直接重寫全部賽事模組：需重複處理抽牌、雲端與淘汰賽流程。
// - 本版：包裝既有核心，只替換單張模型語意，沿用既有攻防與雲端流程。
// ==============================

(function initFootballDirectEnergyModel() {
  "use strict";

  const baseCore = window.FootballLabCore;
  const baseUi = window.FootballLabRender;
  if (!baseCore || !baseUi) return;

  const MODEL_VERSION = "1.6.0";
  const DIRECT_MODEL = "energy-v1";
  const NON_DRAW_CODE = "ND";

  const GOAL_BANDS = Object.freeze({
    low: Object.freeze({ label: "0–1 球（低比分）", short: "0–1 球" }),
    medium: Object.freeze({ label: "2–3 球（中等比分）", short: "2–3 球" }),
    high: Object.freeze({ label: "4 球以上（高比分）", short: "4 球以上" }),
  });

  const DRAW_TENDENCIES = Object.freeze({
    draw: Object.freeze({ label: "和局／進入決勝階段", short: "和局傾向" }),
    decisive: Object.freeze({ label: "90 分鐘內分出勝負", short: "非和局傾向" }),
  });

  const MODE_LABELS = Object.freeze({
    ...baseCore.data.modeLabels,
    direct: "單張整體能量模式",
    dual: "雙模型比較模式",
  });

  function byId(id) {
    return document.getElementById(id);
  }

  function validGoalBand(value) {
    return Object.prototype.hasOwnProperty.call(GOAL_BANDS, value);
  }

  function validDrawTendency(value) {
    return Object.prototype.hasOwnProperty.call(DRAW_TENDENCIES, value);
  }

  function getActualGoalBand(totalGoals) {
    if (totalGoals <= 1) return "low";
    if (totalGoals <= 3) return "medium";
    return "high";
  }

  function isEnergyPrediction(prediction) {
    return Boolean(
      prediction
      && prediction.directModel === DIRECT_MODEL
      && validGoalBand(prediction.directGoalBand)
      && validDrawTendency(prediction.directDrawTendency)
    );
  }

  function isEnergyRecord(record) {
    return isEnergyPrediction(record?.prediction);
  }

  function directCodeFromTendency(tendency) {
    return tendency === "draw" ? "D" : NON_DRAW_CODE;
  }

  function readEnergyForm() {
    return {
      goalBand: String(byId("football-direct-goal-band")?.value || "").trim(),
      drawTendency: String(byId("football-direct-draw-tendency")?.value || "").trim(),
    };
  }

  function setLeadingLabelText(label, text) {
    if (!label) return;
    const node = Array.from(label.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && String(child.textContent || "").trim()
    );
    if (node) node.textContent = `\n                    ${text}\n                    `;
  }

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

  function syncHiddenDirectResult() {
    const source = byId("football-direct-draw-tendency");
    const target = byId("football-direct-result");
    if (!target) return;
    target.value = validDrawTendency(source?.value)
      ? directCodeFromTendency(source.value)
      : "";
  }

  /** 建立兩個可獨立驗證的單張能量欄位：O(1) 時間／O(1) 空間。 */
  function ensureEnergyFields() {
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

    const oldLabel = oldSelect.closest("label");
    oldLabel?.classList.add("football-hidden");

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

    const confidenceLabel = byId("football-direct-confidence")?.closest("label");
    setLeadingLabelText(confidenceLabel, "單張能量信心");

    const notes = byId("football-direct-notes");
    const notesLabel = notes?.closest("label");
    setLeadingLabelText(notesLabel, "單張整體能量原始解讀");
    if (notes) {
      notes.placeholder = "記錄牌面如何對應比賽節奏、總進球量、和局或進入延長賽／PK 的傾向；不要指定哪一隊獲勝。";
    }

    if (firstInit) {
      byId("football-direct-draw-tendency")?.addEventListener("change", syncHiddenDirectResult);
      byId("football-reading-form")?.addEventListener("reset", () => {
        window.setTimeout(syncHiddenDirectResult, 0);
      });
      fieldset.dataset.energyReady = "1";
    }
    syncHiddenDirectResult();
  }

  function setOptionText(selectId, value, text) {
    const option = byId(selectId)?.querySelector(`option[value="${value}"]`);
    if (option) option.textContent = text;
  }

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
    if (version) version.textContent = `模型 v${MODEL_VERSION}`;

    setOptionText("football-mode", "dual", "雙模型比較：單張能量＋四張攻防");
    setOptionText("football-mode", "direct", "只做單張整體能量");

    const matchDisclaimer = document.querySelector("#football-match-form > .football-disclaimer");
    if (matchDisclaimer) {
      matchDisclaimer.textContent = "雙模型模式是兩次獨立抽牌：先判讀單張整體能量，再重新洗牌記錄四張攻防。";
    }

    const recordsLead = document.querySelector("#football-records .section-lead");
    if (recordsLead) {
      recordsLead.textContent = "單張總進球區間、單張和局傾向、攻防推導賽果與確切比分分開統計；舊版單張勝負紀錄保留但不混入新版 KPI。";
    }

    const footer = document.querySelector(".site-footer .footer-sub");
    if (footer) footer.textContent = "單張看整體能量，四張看雙方攻防；不同問題，分開驗證。";
  }

  /** 只修改單張牌位文案，不重建牌組：O(p)，p <= 5。 */
  function createDraft(match) {
    const draft = baseCore.createDraft(match);
    const directCard = draft?.cards?.find((card) => card.group === "direct");
    if (directCard) {
      directCard.positionTitle = "單張｜90 分鐘整體能量";
      directCard.positionNote = "觀察比賽活躍度、總進球區間，以及是否可能和局進入決勝階段；不指定勝方";
    }
    return draft;
  }

  function validatePrediction(prediction, mode) {
    let normalized = prediction;
    if (baseCore.modeIncludesDirect(mode)) {
      const energy = readEnergyForm();
      if (!validGoalBand(energy.goalBand)) return "請選擇單張牌對應的 90 分鐘總進球區間。";
      if (!validDrawTendency(energy.drawTendency)) return "請選擇單張牌判斷的 90 分鐘和局傾向。";
      if (!prediction.directNotes) return "請完成單張整體能量的原始解讀。";
      if (!Number.isInteger(prediction.directConfidence) || prediction.directConfidence < 1 || prediction.directConfidence > 5) {
        return "單張整體能量的信心程度不正確。";
      }
      normalized = {
        ...prediction,
        directResult: directCodeFromTendency(energy.drawTendency),
      };
    }
    return baseCore.validatePrediction(normalized, mode);
  }

  function lockDraft(prediction, cards) {
    const mode = baseCore.getDraft()?.match?.mode;
    let normalized = { ...prediction };
    if (baseCore.modeIncludesDirect(mode)) {
      const energy = readEnergyForm();
      normalized = {
        ...normalized,
        directModel: DIRECT_MODEL,
        directGoalBand: energy.goalBand,
        directDrawTendency: energy.drawTendency,
        directResult: directCodeFromTendency(energy.drawTendency),
      };
    }

    const record = baseCore.lockDraft(normalized, cards);
    record.modelVersion = MODEL_VERSION;
    baseCore.importRecords([record]);
    return record;
  }

  /** 新版單張能量核對：O(1) 時間／O(1) 空間。 */
  function calculateEvaluation(record) {
    const evaluation = baseCore.calculateEvaluation(record);
    if (!evaluation || !isEnergyRecord(record)) return evaluation;

    const actualHome = Number(record.actual?.homeGoals);
    const actualAway = Number(record.actual?.awayGoals);
    const actualTotalGoals = actualHome + actualAway;
    const actualGoalBand = getActualGoalBand(actualTotalGoals);
    const actualDrawTendency = actualHome === actualAway ? "draw" : "decisive";
    const goalBandHit = record.prediction.directGoalBand === actualGoalBand;
    const drawTendencyHit = record.prediction.directDrawTendency === actualDrawTendency;

    const next = {
      ...evaluation,
      directModel: DIRECT_MODEL,
      directResultHit: null,
      directActualTotalGoals: actualTotalGoals,
      directActualGoalBand: actualGoalBand,
      directGoalBandHit: goalBandHit,
      directActualDrawTendency: actualDrawTendency,
      directDrawTendencyHit: drawTendencyHit,
      directEnergyEligibleCount: 2,
      directEnergyHitCount: Number(goalBandHit) + Number(drawTendencyHit),
    };

    if (baseCore.getMode(record) === "dual" && next.structureResult) {
      next.modelsAgree = (record.prediction.directDrawTendency === "draw") === (next.structureResult === "D");
      next.bothResultHit = drawTendencyHit && next.structureResultHit;
    }
    return next;
  }

  function getMarketFavorite(record) {
    const odds = record.match?.odds || {};
    if (![odds.home, odds.draw, odds.away].every(Number.isFinite)) return "";
    return [["H", odds.home], ["D", odds.draw], ["A", odds.away]].sort((a, b) => a[1] - b[1])[0][0];
  }

  /** 單次掃描所有紀錄：O(r) 時間／O(1) 額外空間。 */
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

    const records = enhancedCore.getRecords();
    stats.total = records.length;

    records.forEach((record) => {
      const evaluation = enhancedCore.calculateEvaluation(record);
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

  const enhancedData = Object.freeze({
    ...baseCore.data,
    modelVersion: MODEL_VERSION,
    modeLabels: MODE_LABELS,
  });

  const enhancedCore = Object.freeze({
    ...baseCore,
    data: enhancedData,
    createDraft,
    validatePrediction,
    lockDraft,
    calculateEvaluation,
    calculateStats,
  });

  function decorateDraft(draft) {
    ensureEnergyFields();
    const heading = Array.from(document.querySelectorAll(".football-card-group-heading")).find(
      (item) => item.querySelector("h4")?.textContent?.startsWith("A｜")
    );
    if (heading) {
      const title = heading.querySelector("h4");
      const note = heading.querySelector("p");
      if (title) title.textContent = "A｜單張整體能量模型";
      if (note) note.textContent = "這一組只看 90 分鐘整體節奏、總進球量與是否和局，不判定哪一隊獲勝。";
    }

    const summaryItems = document.querySelectorAll("#football-match-summary .football-summary-item");
    summaryItems.forEach((item) => {
      if (item.querySelector("small")?.textContent === "實驗模式") {
        const value = item.querySelector("strong");
        if (value) value.textContent = MODE_LABELS[draft.match.mode] || value.textContent;
      }
    });

    window.dispatchEvent(new CustomEvent("football-energy-render"));
  }

  const enhancedUi = Object.freeze({
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

  window.FootballLabCore = enhancedCore;
  window.FootballLabRender = enhancedUi;
  window.FootballDirectEnergy = Object.freeze({
    modelVersion: MODEL_VERSION,
    modelKey: DIRECT_MODEL,
    nonDrawCode: NON_DRAW_CODE,
    goalBands: GOAL_BANDS,
    drawTendencies: DRAW_TENDENCIES,
    isEnergyPrediction,
    isEnergyRecord,
    getActualGoalBand,
    syncHiddenDirectResult,
  });

  updatePageCopy();
  ensureEnergyFields();
})();
