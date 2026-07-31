// 塔羅X賽事驗證｜同場雙牌源比較與運動種類擴充層
//
// 目的：同一場足球賽先鎖定「自己抽牌」，再揭示並鎖定「網站隨機抽牌」，
// 兩筆紀錄以 comparisonGroupId 成對保存，賽後結果只需輸入一次。
//
// 主要函式複雜度：
// - createDraft／lockDraft：時間／空間 O(p)，p <= 5。
// - updateActual／deleteRecord／calculateSourceComparison：時間 O(r)，空間 O(g)，
//   r = 紀錄數，g = 對照組數。
// - renderSourceComparison：時間 O(r)、DOM 空間 O(1)，固定輸出 6 張摘要卡。
//
// 更快替代方案比較：
// - 直接把兩組牌塞進同一筆舊紀錄會破壞既有 cards／prediction 契約，所有回測與雲端欄位都需重寫。
// - 本版沿用成熟的單筆紀錄流程，建立兩筆同組紀錄；查詢以 comparisonGroupId 查表，
//   保留既有模型計分、匯入匯出與 Google Sheets 相容性。

const SOURCE_COMPARE_VALUE = "compare";
const SOURCE_EXPERIMENT = "manual-vs-random";
const SPORT_FOOTBALL = "football";
const SPORT_LABELS = Object.freeze({ football: "足球" });
const INTERFACE_VERSION = "1.8.0";
const MIN_DIRECTIONAL_SAMPLE = 20;

const baseCore = window.FootballLabCore;
const baseRender = window.FootballLabRender;

if (
  !baseCore
  || !baseRender
  || typeof baseCore.createDraft !== "function"
  || typeof baseCore.lockDraft !== "function"
  || typeof baseRender.renderDraft !== "function"
  || typeof baseRender.renderRecords !== "function"
) {
  throw new Error("塔羅X賽事驗證的雙牌源比較層無法取得既有核心與呈現層。");
}

const state = {
  pendingStart: false,
  activeGroupId: "",
  phase: "idle",
  lastLockedRecordId: "",
  controlsBound: false,
};

/** DOM ID 查找：時間／空間 O(1)。 */
function byId(id) {
  return document.getElementById(id);
}

/** 建立對照組識別碼：時間／空間 O(1)。 */
function createComparisonGroupId() {
  return window.crypto?.randomUUID?.()
    || `source_compare_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 讀取運動種類；目前只開放足球。時間／空間 O(1)。 */
function getSelectedSport() {
  const value = String(byId("football-sport-type")?.value || SPORT_FOOTBALL);
  return SPORT_LABELS[value] ? value : SPORT_FOOTBALL;
}

/** 判斷是否為同場雙牌源紀錄：時間／空間 O(1)。 */
function isSourceComparisonRecord(record) {
  return Boolean(
    record?.match?.sourceExperiment === SOURCE_EXPERIMENT
    && record.match.comparisonGroupId
  );
}

/** 補齊運動與對照欄位：時間／空間 O(1)。 */
function normalizeMatch(match, overrides = {}) {
  const sportType = overrides.sportType || match?.sportType || getSelectedSport();
  return {
    ...match,
    sportType,
    sportLabel: SPORT_LABELS[sportType] || SPORT_LABELS[SPORT_FOOTBALL],
    ...overrides,
  };
}

/** 驗證既有欄位並限制目前運動種類：時間／空間 O(1)。 */
function validateMatch(match) {
  const normalized = match?.cardSource === SOURCE_COMPARE_VALUE
    ? normalizeMatch(match, { cardSource: "manual" })
    : normalizeMatch(match);
  if (normalized.sportType !== SPORT_FOOTBALL) {
    return "目前只開放足球驗證；其他運動會在足球樣本完成後再加入。";
  }
  return baseCore.validateMatch(normalized);
}

/**
 * 建立草稿；同場對照固定先自己抽牌，再網站隨機抽牌。
 * 手動模式時間／空間 O(p)，隨機模式時間／空間 O(n)，n = 78。
 */
function createDraft(match) {
  let normalized = normalizeMatch(match);

  if (state.pendingStart || match?.cardSource === SOURCE_COMPARE_VALUE) {
    const comparisonGroupId = state.activeGroupId || createComparisonGroupId();
    normalized = normalizeMatch(match, {
      cardSource: "manual",
      sourceExperiment: SOURCE_EXPERIMENT,
      comparisonGroupId,
      comparisonSequence: 1,
    });
    state.pendingStart = false;
    state.activeGroupId = comparisonGroupId;
    state.phase = "manual";
  } else if (match?.sourceExperiment === SOURCE_EXPERIMENT && match?.comparisonGroupId) {
    normalized = normalizeMatch(match);
    state.activeGroupId = match.comparisonGroupId;
    state.phase = match.cardSource === "random" ? "random" : "manual";
  }

  return baseCore.createDraft(normalized);
}

/** 鎖定草稿並更新雙牌源流程狀態：時間／空間 O(p)，p <= 5。 */
function lockDraft(prediction, submittedCards) {
  const draft = baseCore.getDraft();
  const record = baseCore.lockDraft(prediction, submittedCards);
  if (isSourceComparisonRecord(record)) {
    state.activeGroupId = record.match.comparisonGroupId;
    state.lastLockedRecordId = record.id;
    state.phase = draft?.match?.cardSource === "manual" ? "manual-locked" : "complete";
  }
  return record;
}

/**
 * 賽果只輸入一次，固定同步到同 comparisonGroupId 的另一牌源紀錄。
 * 時間 O(r)，額外空間 O(1)。
 */
function updateActual(recordId, actual) {
  const target = baseCore.getRecord(recordId);
  const updated = baseCore.updateActual(recordId, actual);
  const groupId = target?.match?.comparisonGroupId;
  if (!groupId || target?.match?.sourceExperiment !== SOURCE_EXPERIMENT) return updated;

  const sibling = baseCore.getRecords().find((record) => (
    record.id !== recordId
    && record.match?.sourceExperiment === SOURCE_EXPERIMENT
    && record.match?.comparisonGroupId === groupId
  ));
  if (sibling) baseCore.updateActual(sibling.id, actual);
  return updated;
}

/** 成對刪除，避免留下無法比較的半組資料：時間 O(r)，額外空間 O(1)。 */
function deleteRecord(recordId) {
  const target = baseCore.getRecord(recordId);
  const groupId = target?.match?.comparisonGroupId;
  if (!groupId || target?.match?.sourceExperiment !== SOURCE_EXPERIMENT) {
    baseCore.deleteRecord(recordId);
    return;
  }

  const sibling = baseCore.getRecords().find((record) => (
    record.id !== recordId
    && record.match?.sourceExperiment === SOURCE_EXPERIMENT
    && record.match?.comparisonGroupId === groupId
  ));
  baseCore.deleteRecord(recordId);
  if (sibling) baseCore.deleteRecord(sibling.id);
}

const comparisonCore = Object.freeze({
  ...baseCore,
  validateMatch,
  createDraft,
  lockDraft,
  updateActual,
  deleteRecord,
  sourceComparison: Object.freeze({
    value: SOURCE_COMPARE_VALUE,
    experiment: SOURCE_EXPERIMENT,
    sportLabels: SPORT_LABELS,
    isRecord: isSourceComparisonRecord,
  }),
});

window.FootballLabCore = comparisonCore;

/** 百分比格式：時間／空間 O(1)。 */
function formatRate(hits, eligible) {
  return eligible ? `${Math.round((hits / eligible) * 1000) / 10}%` : "—";
}

/**
 * 單次掃描建立對照組查表與來源統計。
 * 時間 O(r)，空間 O(g)，g = 對照組數。
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
    manual: {
      directEligible: 0,
      directHits: 0,
      structureEligible: 0,
      structureHits: 0,
      exactHits: 0,
      absoluteErrorTotal: 0,
    },
    random: {
      directEligible: 0,
      directHits: 0,
      structureEligible: 0,
      structureHits: 0,
      exactHits: 0,
      absoluteErrorTotal: 0,
    },
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
        bucket.directEligible += 1;
        bucket.directHits += evaluation.directResultHit ? 1 : 0;
      }
      if (baseCore.modeIncludesStructure(evaluation.type)) {
        bucket.structureEligible += 1;
        bucket.structureHits += evaluation.structureResultHit ? 1 : 0;
        bucket.exactHits += evaluation.structureExactHit ? 1 : 0;
        bucket.absoluteErrorTotal += evaluation.structureAbsoluteError;
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

/** 固定 6 張摘要卡：時間 O(r)，DOM 空間 O(1)。 */
function renderSourceComparison() {
  const kpis = byId("football-kpis");
  if (!kpis?.parentElement) return;

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
      "自己抽牌｜單張賽果",
      formatRate(summary.manual.directHits, summary.manual.directEligible),
      `${summary.manual.directHits}／${summary.manual.directEligible}`
    ),
    createMetricCard(
      "網站抽牌｜單張賽果",
      formatRate(summary.random.directHits, summary.random.directEligible),
      `${summary.random.directHits}／${summary.random.directEligible}`
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

  panel.replaceChildren(heading, grid);
}

/** 草稿階段文案：時間／空間 O(1)。 */
function decorateDraft(draft) {
  if (!isSourceComparisonRecord({ match: draft.match })) return;
  const isManual = draft.match.cardSource === "manual";
  const note = byId("football-card-entry-note");
  const lockButton = byId("football-lock-button");
  const source = byId("football-card-source");
  if (source) source.value = SOURCE_COMPARE_VALUE;

  let banner = byId("football-source-phase-banner");
  if (!banner) {
    banner = document.createElement("p");
    banner.id = "football-source-phase-banner";
    banner.className = "football-message is-success football-source-phase-banner";
    byId("football-card-grid")?.parentElement?.insertBefore(banner, byId("football-card-grid"));
  }
  if (banner) {
    banner.textContent = isManual
      ? "第 1／2 階段｜自己抽牌：完成鎖定前不會顯示網站牌。"
      : "第 2／2 階段｜網站隨機抽牌：請維持獨立判讀，不修改第一份紀錄。";
  }

  if (note) {
    note.textContent = isManual
      ? "第 1／2 階段：先輸入你自己實際抽到的牌並完成判讀。網站隨機牌尚未揭示，避免交叉影響。"
      : "第 2／2 階段：網站已固定隨機牌。請獨立完成判讀，不回頭修改自己抽牌的紀錄。";
  }
  if (lockButton) {
    lockButton.textContent = isManual
      ? "鎖定自己抽牌，接著揭示網站牌"
      : "鎖定網站抽牌，完成同場對照";
  }

  window.queueMicrotask(() => {
    baseRender.setMessage(
      "football-match-message",
      isManual
        ? "雙牌源對照第 1／2 階段：請先完成並鎖定自己抽牌的牌面與判讀。"
        : "雙牌源對照第 2／2 階段：網站隨機牌已抽出並固定，請完成第二份判讀。",
      "is-success"
    );
  });
}

/** 在既有表格補上運動與對照標記：時間 O(r log r)，額外空間 O(r)。 */
function decorateRecordRows() {
  const records = baseCore.getRecords().sort(
    (left, right) => String(right.match.kickoff).localeCompare(String(left.match.kickoff))
  );
  const rows = byId("football-records-body")?.querySelectorAll("tr") || [];
  rows.forEach((row, index) => {
    const record = records[index];
    if (!record) return;
    const firstDetail = row.cells?.[0]?.querySelector("small");
    if (firstDetail && !firstDetail.dataset.sportDecorated) {
      firstDetail.textContent = `${record.match.sportLabel || "足球"}｜${firstDetail.textContent}`;
      firstDetail.dataset.sportDecorated = "true";
    }
    if (!isSourceComparisonRecord(record)) return;
    const sourceDetail = row.cells?.[2]?.querySelector("small");
    if (sourceDetail) {
      sourceDetail.textContent = record.match.cardSource === "manual"
        ? "自己抽牌｜同場雙牌源對照"
        : "網站隨機抽牌｜同場雙牌源對照";
    }
  });
}

const comparisonRender = Object.freeze({
  ...baseRender,
  renderDraft(draft) {
    baseRender.renderDraft(draft);
    decorateDraft(draft);
  },
  renderRecords() {
    baseRender.renderRecords();
    renderSourceComparison();
    decorateRecordRows();
  },
});

window.FootballLabRender = comparisonRender;

/** 注入固定樣式：時間／空間 O(1)。 */
function injectStyles() {
  if (byId("football-source-comparison-style")) return;
  const style = document.createElement("style");
  style.id = "football-source-comparison-style";
  style.textContent = `
    .football-source-inline-note {
      display: block;
      margin-top: .38rem;
      color: var(--muted, #aaa3c8);
      font-size: .76rem;
      line-height: 1.5;
    }
    .football-source-phase-banner { margin: .75rem 0; }
    .football-source-comparison { margin: 1rem 0; }
    .football-source-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: .9rem;
    }
    .football-source-heading h3,
    .football-source-heading p { margin-top: 0; }
    .football-source-heading h3 { margin-bottom: .32rem; }
    .football-source-heading p:last-child {
      margin-bottom: 0;
      color: var(--muted, #aaa3c8);
      line-height: 1.55;
    }
    .football-source-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: .72rem;
    }
    .football-source-metric {
      display: grid;
      gap: .28rem;
      min-width: 0;
      padding: .82rem .88rem;
      border: 1px solid rgba(142, 125, 255, .32);
      border-radius: 14px;
      background: rgba(16, 12, 47, .55);
    }
    .football-source-metric small { color: var(--muted, #aaa3c8); }
    .football-source-metric strong { font-size: 1.08rem; line-height: 1.25; }
    .football-source-metric span { font-size: .78rem; line-height: 1.5; }
    @media (max-width: 920px) {
      .football-source-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 620px) {
      .football-source-heading { display: grid; }
      .football-source-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}

/** 加入運動種類與雙牌源選項：時間／空間 O(1)。 */
function installFormControls() {
  const source = byId("football-card-source");
  const competition = byId("football-competition");
  const grid = competition?.closest(".football-form-grid");

  if (source && !source.querySelector(`option[value="${SOURCE_COMPARE_VALUE}"]`)) {
    const option = document.createElement("option");
    option.value = SOURCE_COMPARE_VALUE;
    option.textContent = "自己抽牌＋網站隨機抽牌（同場對照）";
    source.insertBefore(option, source.firstChild);
  }
  if (source) {
    source.value = SOURCE_COMPARE_VALUE;
    const label = source.closest("label");
    if (label && !label.querySelector(".football-source-inline-note")) {
      const note = document.createElement("small");
      note.className = "football-source-inline-note";
      note.textContent = "依序鎖定兩份判讀：先自己抽牌，再揭示網站牌。";
      label.appendChild(note);
    }
  }

  if (grid && !byId("football-sport-type")) {
    const label = document.createElement("label");
    label.textContent = "運動種類";
    const select = document.createElement("select");
    select.id = "football-sport-type";
    const football = document.createElement("option");
    football.value = SPORT_FOOTBALL;
    football.textContent = "足球";
    football.selected = true;
    const future = document.createElement("option");
    future.value = "future";
    future.textContent = "其他運動（待足球驗證完成後新增）";
    future.disabled = true;
    select.append(football, future);
    label.appendChild(select);
    grid.insertBefore(label, competition.closest("label"));
  }

  const button = byId("football-draw-button");
  if (button) button.textContent = "建立同場雙牌源對照";
  const disclaimer = byId("football-match-form")?.querySelector(".football-disclaimer");
  if (disclaimer) {
    disclaimer.textContent = "同場對照固定先鎖定自己抽牌，再揭示網站隨機牌；兩個來源都會各自完成單張與攻防判讀。";
  }
}

/** 更新頁面標題與驗證原則：時間／空間 O(1)。 */
function applyPageCopy() {
  document.title = `Evan Tarot｜塔羅X賽事驗證｜介面 v${INTERFACE_VERSION}`;
  const heroTitle = document.querySelector(".subpage-hero .hero-text h1");
  if (heroTitle) heroTitle.textContent = "塔羅X賽事驗證。";
  const breadcrumb = document.querySelector(".lab-breadcrumb");
  if (breadcrumb) breadcrumb.textContent = "← 塔羅實驗室 / 塔羅X賽事驗證";
  const heroCopy = document.querySelector(".subpage-hero .hero-text > p");
  if (heroCopy) {
    heroCopy.textContent = "目前先以足球驗證：同一場賽事分別保存自己抽牌與網站隨機抽牌，賽後比較兩者準確率。";
  }
  const version = document.querySelector("#football-match-form .football-version");
  if (version) version.textContent = `模型 v${baseCore.data.modelVersion}｜介面 v${INTERFACE_VERSION}`;

  const principleItems = document.querySelectorAll(".subpage-hero .hero-card li");
  const copies = [
    "同一場賽事同時保留自己抽牌與網站隨機抽牌",
    "先鎖定自己抽牌，再揭示網站牌，避免兩份判讀互相污染",
    "賽果輸入一次，自動套用到同組兩筆紀錄",
  ];
  principleItems.forEach((item, index) => {
    if (copies[index]) item.textContent = copies[index];
  });
}

/** 手動紀錄完成後建立同組網站隨機草稿：時間 O(r+n)，空間 O(n)，n = 78。 */
function startRandomPhase(groupId) {
  const records = baseCore.getRecords();
  const manualRecord = records.find((record) => (
    record.match?.comparisonGroupId === groupId
    && record.match?.sourceExperiment === SOURCE_EXPERIMENT
    && record.match?.cardSource === "manual"
  ));
  const randomExists = records.some((record) => (
    record.match?.comparisonGroupId === groupId
    && record.match?.sourceExperiment === SOURCE_EXPERIMENT
    && record.match?.cardSource === "random"
  ));
  if (!manualRecord || randomExists || comparisonCore.getDraft()) return false;

  const randomMatch = normalizeMatch(manualRecord.match, {
    cardSource: "random",
    sourceExperiment: SOURCE_EXPERIMENT,
    comparisonGroupId: groupId,
    comparisonSequence: 2,
  });
  const draft = comparisonCore.createDraft(randomMatch);
  comparisonRender.renderDraft(draft);
  return true;
}

/** 將同組另一筆賽果補同步到雲端：前端時間 O(r)，網路成本另計。 */
async function syncSiblingActual(recordId) {
  const record = baseCore.getRecord(recordId);
  const groupId = record?.match?.comparisonGroupId;
  if (!groupId || record?.match?.sourceExperiment !== SOURCE_EXPERIMENT) return;
  const sibling = baseCore.getRecords().find((item) => (
    item.id !== recordId
    && item.match?.comparisonGroupId === groupId
    && item.match?.sourceExperiment === SOURCE_EXPERIMENT
    && item.actual
  ));
  const cloud = window.FootballLabCloud;
  if (!sibling || !cloud?.isConfigured?.() || !cloud?.hasToken?.()) return;
  try {
    await cloud.updateActual(sibling.id, sibling.actual);
  } catch (error) {
    console.warn("[source-comparison] 同組另一牌源賽果雲端同步失敗：", error);
  }
}

/** 綁定雙階段流程；固定監聽器數量，時間／空間 O(1)。 */
function bindControls() {
  if (state.controlsBound) return true;
  const matchForm = byId("football-match-form");
  const readingForm = byId("football-reading-form");
  const evaluationForm = byId("football-evaluation-form");
  const recordsBody = byId("football-records-body");
  if (!matchForm || !readingForm || !window.FootballLabEvents?.isBound?.()) return false;

  state.controlsBound = true;

  matchForm.addEventListener("submit", () => {
    const source = byId("football-card-source");
    if (!source || source.value !== SOURCE_COMPARE_VALUE) return;
    state.pendingStart = true;
    state.activeGroupId = createComparisonGroupId();
    state.phase = "starting";
    source.value = "manual";

    window.queueMicrotask(() => {
      source.value = SOURCE_COMPARE_VALUE;
      if (!comparisonCore.getDraft() && state.phase === "starting") {
        state.pendingStart = false;
        state.activeGroupId = "";
        state.phase = "idle";
      }
    });
  }, true);

  readingForm.addEventListener("submit", () => {
    const submittedDraft = comparisonCore.getDraft();
    const groupId = submittedDraft?.match?.comparisonGroupId || "";
    const source = submittedDraft?.match?.cardSource || "";
    if (!groupId || submittedDraft?.match?.sourceExperiment !== SOURCE_EXPERIMENT) return;

    window.setTimeout(() => {
      if (comparisonCore.getDraft()) return;
      if (source === "manual") {
        try {
          if (startRandomPhase(groupId)) {
            state.phase = "random";
            return;
          }
        } catch (error) {
          baseRender.setMessage(
            "football-match-message",
            `自己抽牌已保存，但網站牌建立失敗：${error.message}`,
            "is-error"
          );
          return;
        }
      }

      if (source === "random") {
        state.phase = "complete";
        state.activeGroupId = "";
        const sourceSelect = byId("football-card-source");
        if (sourceSelect) sourceSelect.value = SOURCE_COMPARE_VALUE;
        comparisonRender.renderRecords();
        baseRender.setMessage(
          "football-match-message",
          "同場雙牌源對照已完成：自己抽牌與網站隨機抽牌都已鎖定。",
          "is-success"
        );
      }
    }, 0);
  }, true);

  evaluationForm?.addEventListener("submit", () => {
    const recordId = String(byId("football-evaluation-id")?.value || "");
    window.setTimeout(() => {
      syncSiblingActual(recordId);
      comparisonRender.renderRecords();
    }, 0);
  });

  recordsBody?.addEventListener("click", (event) => {
    const button = event.target.closest('button[data-action="delete"]');
    if (!button) return;
    const record = baseCore.getRecord(button.dataset.id);
    if (!isSourceComparisonRecord(record)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const confirmed = window.confirm(
      `這是同場雙牌源對照。確定同時刪除「${record.match.homeTeam} vs ${record.match.awayTeam}」的自己抽牌與網站抽牌紀錄？`
    );
    if (!confirmed) return;
    comparisonCore.deleteRecord(record.id);
    byId("football-evaluation-panel")?.classList.add("football-hidden");
    comparisonRender.renderRecords();
  }, true);

  return true;
}

/** 等待正式事件層完成後綁定，最多約 10 秒：時間 O(t)，空間 O(1)。 */
function bindWhenReady(attempt = 0) {
  if (bindControls()) return;
  if (attempt >= 200) {
    console.warn("[source-comparison] 無法在時限內綁定雙牌源流程。");
    return;
  }
  window.setTimeout(() => bindWhenReady(attempt + 1), 50);
}

injectStyles();
installFormControls();
comparisonRender.renderRecords();
window.setTimeout(() => {
  applyPageCopy();
  installFormControls();
  renderSourceComparison();
  bindWhenReady();
}, 0);

window.FootballSourceComparisonRuntime = Object.freeze({
  version: INTERFACE_VERSION,
  core: comparisonCore,
  render: comparisonRender,
  calculateSourceComparison,
  renderSourceComparison,
  getState: () => ({ ...state }),
});
