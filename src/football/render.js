// 世足賽事驗證｜基礎呈現 ES Module
//
// 本檔只負責 DOM 建立與顯示，資料判斷來自具名評分核心。
// 能量轉接層會再包裝此 Render，但不重建基礎畫面流程。
//
// 主要函式複雜度：
// - renderDraft：時間／DOM 空間 O(p*d)，p <= 5、d = 78。
// - renderRecords：時間 O(r log r + r*p)、DOM 空間 O(r)，r = 紀錄數。
// - renderKpis：時間／DOM 空間 O(1)，固定 6 張卡片。
// - renderScorecard：時間／DOM 空間 O(c)，c 為固定核對欄位數。
//
// 更快替代方案比較：
// - 直接以 innerHTML 組字串較短，但增加轉義與注入風險。
// - 本版使用 textContent 與 DOM API；卡牌選單必須列出 78 張牌，因此 O(p*d) 是必要輸出成本。

import { scoredFootballCore } from "./scoring.js";

const core = scoredFootballCore;
const {
  resultLabels,
  modeLabels,
  cardSourceLabels,
  deck,
} = core.data;

/** DOM ID 查找：時間／空間 O(1)。 */
export function byId(id) {
  return document.getElementById(id);
}

/** 訊息更新：時間／空間 O(1)。 */
export function setMessage(id, text, type = "") {
  const element = byId(id);
  if (!element) return;
  element.textContent = text;
  element.classList.remove("football-hidden", "is-error", "is-success");
  if (type) element.classList.add(type);
}

/** 訊息清除：時間／空間 O(1)。 */
export function clearMessage(id) {
  const element = byId(id);
  if (!element) return;
  element.textContent = "";
  element.classList.add("football-hidden");
  element.classList.remove("is-error", "is-success");
}

/** 摘要節點建立：時間／DOM 空間 O(1)。 */
function addSummaryItem(container, label, value) {
  const item = document.createElement("div");
  item.className = "football-summary-item";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value || "—";
  item.append(small, strong);
  container.appendChild(item);
}

/** 牌組選單：時間／DOM 空間 O(d)，d = 78。 */
function createCardSelect(card) {
  const select = document.createElement("select");
  select.id = `football-card-${card.group}-${card.position}`;
  select.required = true;

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "選擇抽到的牌";
  select.appendChild(empty);

  deck.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === card.name;
    select.appendChild(option);
  });
  return select;
}

/** 正逆位選單：時間／DOM 空間 O(1)。 */
function createOrientationSelect(card) {
  const select = document.createElement("select");
  select.id = `football-orientation-${card.group}-${card.position}`;
  ["正位", "逆位"].forEach((orientation) => {
    const option = document.createElement("option");
    option.value = orientation;
    option.textContent = orientation;
    option.selected = orientation === card.orientation;
    select.appendChild(option);
  });
  return select;
}

/** 模型群組標題：時間／DOM 空間 O(1)。 */
function appendGroupHeading(fragment, group) {
  const heading = document.createElement("div");
  heading.className = "football-card-group-heading";
  const title = document.createElement("h4");
  title.textContent = group === "direct" ? "A｜單張結果模型" : "B｜四張攻防模型";
  const note = document.createElement("p");
  note.textContent = group === "direct"
    ? "這一組只問 90 分鐘主勝、和局或客勝。"
    : "這一組獨立抽牌，由主隊進攻＋客隊防守推估主隊進球，客隊進攻＋主隊防守推估客隊進球。";
  heading.append(title, note);
  fragment.appendChild(heading);
}

/** 卡牌輸入區：時間／DOM 空間 O(p*d)。 */
function renderCardEntries(draft) {
  const fragment = document.createDocumentFragment();
  let currentGroup = "";
  let orderInGroup = 0;

  draft.cards.forEach((card) => {
    if (card.group !== currentGroup) {
      currentGroup = card.group;
      orderInGroup = 0;
      appendGroupHeading(fragment, currentGroup);
    }
    orderInGroup += 1;

    const article = document.createElement("article");
    article.className = "football-card";
    const order = document.createElement("span");
    order.className = "football-card-order";
    order.textContent = `本組第 ${orderInGroup} 張`;
    const title = document.createElement("h4");
    title.className = "football-card-name";
    title.textContent = card.positionTitle;
    const note = document.createElement("p");
    note.className = "football-card-role";
    note.textContent = card.positionNote;

    if (draft.match.cardSource === "manual") {
      const cardLabel = document.createElement("label");
      cardLabel.textContent = "抽到的牌";
      cardLabel.appendChild(createCardSelect(card));
      const orientationLabel = document.createElement("label");
      orientationLabel.textContent = "正逆位";
      orientationLabel.appendChild(createOrientationSelect(card));
      article.append(order, title, note, cardLabel, orientationLabel);
    } else {
      const name = document.createElement("strong");
      name.className = "football-random-card-name";
      name.textContent = card.name;
      const orientation = document.createElement("span");
      orientation.className = `football-orientation${card.orientation === "逆位" ? " is-reversed" : ""}`;
      orientation.textContent = card.orientation;
      article.append(order, title, note, name, orientation);
    }
    fragment.appendChild(article);
  });

  byId("football-card-grid")?.replaceChildren(fragment);
}

/** 模式欄位切換：時間／空間 O(1)。 */
function configureReadingMode(mode) {
  byId("football-direct-reading")?.classList.toggle(
    "football-hidden",
    !core.modeIncludesDirect(mode)
  );
  byId("football-structure-reading")?.classList.toggle(
    "football-hidden",
    !core.modeIncludesStructure(mode)
  );
}

/** 草稿呈現：時間／DOM 空間 O(p*d)。 */
export function renderDraft(draft) {
  const summaryFragment = document.createDocumentFragment();
  addSummaryItem(summaryFragment, "賽事", draft.match.competition);
  addSummaryItem(summaryFragment, "對戰", `${draft.match.homeTeam} vs ${draft.match.awayTeam}`);
  addSummaryItem(summaryFragment, "實驗模式", modeLabels[draft.match.mode]);
  addSummaryItem(summaryFragment, "牌面來源", cardSourceLabels[draft.match.cardSource]);
  byId("football-match-summary")?.replaceChildren(summaryFragment);

  const manualDual = draft.match.cardSource === "manual" && draft.match.mode === "dual";
  const entryNote = byId("football-card-entry-note");
  if (entryNote) {
    entryNote.textContent = draft.match.cardSource === "manual"
      ? (manualDual
        ? "請把兩個模型視為兩次獨立抽牌：先記單張結果牌，再重新洗牌後記四張攻防牌。同名牌可跨模型再次出現，但同一組內不能重複。"
        : "請依固定位置輸入實際抽到的牌與正逆位；同一組抽牌內不能重複。")
      : "網站會讓兩個模型各自獨立洗牌；不能局部重抽或交換牌位。";
  }

  renderCardEntries(draft);
  configureReadingMode(draft.match.mode);

  const labels = [
    ["football-direct-home-label", `${draft.match.homeTeam} 勝`],
    ["football-direct-away-label", `${draft.match.awayTeam} 勝`],
    ["football-structure-home-label", `${draft.match.homeTeam} 預測進球`],
    ["football-structure-away-label", `${draft.match.awayTeam} 預測進球`],
    ["football-advance-home", `${draft.match.homeTeam} 晉級`],
    ["football-advance-away", `${draft.match.awayTeam} 晉級`],
  ];
  labels.forEach(([id, text]) => {
    const element = byId(id);
    if (element) element.textContent = text;
  });

  const panel = byId("football-reading-panel");
  panel?.classList.remove("football-hidden");
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 命中率格式化：時間／空間 O(1)。 */
function formatRate(hits, total) {
  return total ? `${Math.round((hits / total) * 1000) / 10}%` : "—";
}

/** KPI 呈現：時間／DOM 空間 O(1)。 */
function renderKpis() {
  const stats = core.calculateStats();
  const mae = stats.structureEligible
    ? Math.round((stats.structureErrorTotal / stats.structureEligible) * 100) / 100
    : null;
  const items = [
    ["總紀錄", String(stats.total), `${stats.completed} 場已核對`],
    ["單張賽果", formatRate(stats.directHits, stats.directEligible), `${stats.directHits}／${stats.directEligible}`],
    ["攻防推導賽果", formatRate(stats.structureResultHits, stats.structureEligible), `${stats.structureResultHits}／${stats.structureEligible}`],
    ["攻防確切比分", formatRate(stats.structureExactHits, stats.structureEligible), mae == null ? "—" : `平均總誤差 ${mae} 球`],
    ["雙模型一致率", formatRate(stats.dualAgreements, stats.dualEligible), `${stats.dualAgreements}／${stats.dualEligible}`],
    ["市場熱門基準", formatRate(stats.marketHits, stats.marketEligible), `${stats.marketHits}／${stats.marketEligible}`],
  ];

  const fragment = document.createDocumentFragment();
  items.forEach(([label, value, detail]) => {
    const card = document.createElement("article");
    card.className = "football-kpi";
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = detail;
    card.append(small, strong, span);
    fragment.appendChild(card);
  });
  byId("football-kpis")?.replaceChildren(fragment);
}

/** 固定最多五張牌：時間／空間 O(p)。 */
function describeCards(record) {
  return record.cards
    .map((card) => `${card.positionTitle}：${card.name}${card.orientation}`)
    .join("；");
}

/** 預測摘要：時間／空間 O(1)。 */
function describePrediction(record) {
  const mode = core.getMode(record);
  const prediction = record.prediction;
  if (mode === "legacy5") {
    return `${resultLabels[prediction.result] || "—"}｜舊版五牌位`;
  }

  const parts = [];
  if (core.modeIncludesDirect(mode)) {
    parts.push(`單張：${resultLabels[prediction.directResult]}`);
  }
  if (core.modeIncludesStructure(mode)) {
    const structureResult = core.getResult(
      prediction.structureHomeGoals,
      prediction.structureAwayGoals
    );
    parts.push(
      `攻防：${prediction.structureHomeGoals}：${prediction.structureAwayGoals}（${resultLabels[structureResult]}）`
    );
  }
  return parts.join("｜");
}

/** 表格文字格：時間／DOM 空間 O(1)。 */
function createTextCell(value, smallValue = "") {
  const cell = document.createElement("td");
  const text = document.createElement("span");
  text.textContent = value;
  cell.appendChild(text);
  if (smallValue) {
    const small = document.createElement("small");
    small.textContent = smallValue;
    cell.appendChild(small);
  }
  return cell;
}

/** 命中摘要：時間／空間 O(1)。 */
function describeHit(record, evaluation) {
  if (!evaluation) return ["—", "等待賽後核對"];
  if (evaluation.type === "legacy5") return [`${evaluation.hitCount}／5`, "舊版計分"];

  const parts = [];
  if (core.modeIncludesDirect(evaluation.type)) {
    parts.push(`單張${evaluation.directResultHit ? "命中" : "未中"}`);
  }
  if (core.modeIncludesStructure(evaluation.type)) {
    parts.push(`攻防賽果${evaluation.structureResultHit ? "命中" : "未中"}`);
  }
  const detail = core.modeIncludesStructure(evaluation.type)
    ? `比分${evaluation.structureExactHit ? "命中" : "未中"}／總誤差 ${evaluation.structureAbsoluteError} 球`
    : "";
  return [parts.join("／"), detail];
}

/**
 * 紀錄表呈現；日期排序使用 getRecords() 快照，不修改核心順序。
 * 時間複雜度：O(r log r + r*p)
 * 空間複雜度：O(r)
 */
export function renderRecords() {
  renderKpis();
  const records = core.getRecords().sort(
    (left, right) => String(right.match.kickoff).localeCompare(String(left.match.kickoff))
  );
  const fragment = document.createDocumentFragment();

  records.forEach((record) => {
    const evaluation = core.calculateEvaluation(record);
    const mode = core.getMode(record);
    const [hitText, hitDetail] = describeHit(record, evaluation);
    const row = document.createElement("tr");
    row.appendChild(
      createTextCell(
        core.formatDateTime(record.match.kickoff),
        `${record.match.competition}｜${record.match.stage}`
      )
    );
    row.appendChild(
      createTextCell(
        `${record.match.homeTeam} vs ${record.match.awayTeam}`,
        `${modeLabels[mode]}｜${describeCards(record)}`
      )
    );
    row.appendChild(
      createTextCell(
        describePrediction(record),
        cardSourceLabels[record.match.cardSource] || "舊版未標記"
      )
    );
    row.appendChild(
      createTextCell(
        record.actual ? `${record.actual.homeGoals}：${record.actual.awayGoals}` : "尚未輸入",
        record.actual ? resultLabels[evaluation.actualResult] : "等待賽後核對"
      )
    );
    row.appendChild(createTextCell(hitText, hitDetail));
    row.appendChild(
      createTextCell(
        record.actual ? "已核對" : "待核對",
        `鎖定：${core.formatDateTime(record.lockedAt)}`
      )
    );

    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "football-row-actions";
    [
      ["evaluate", record.actual ? "更新賽果" : "填入賽果", ""],
      ["delete", "刪除", " is-danger"],
    ].forEach(([action, label, extra]) => {
      const button = document.createElement("button");
      button.className = `football-small-button${extra}`;
      button.type = "button";
      button.dataset.action = action;
      button.dataset.id = record.id;
      button.textContent = label;
      actions.appendChild(button);
    });
    actionCell.appendChild(actions);
    row.appendChild(actionCell);
    fragment.appendChild(row);
  });

  byId("football-records-body")?.replaceChildren(fragment);
  byId("football-empty-state")?.classList.toggle(
    "football-hidden",
    records.length > 0
  );
}

/** 核對項目：時間／DOM 空間 O(1)。 */
function appendScoreItem(grid, label, hit, detail) {
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
}

/** 賽後核對卡：時間／DOM 空間 O(c)。 */
export function renderScorecard(record) {
  const container = byId("football-scorecard");
  if (!container) return;
  const evaluation = core.calculateEvaluation(record);
  if (!evaluation) {
    container.classList.add("football-hidden");
    return;
  }

  const title = document.createElement("h4");
  const grid = document.createElement("div");
  grid.className = "football-score-grid";

  if (evaluation.type === "legacy5") {
    title.textContent = `舊版五牌位核心命中 ${evaluation.hitCount}／5`;
    Object.entries(evaluation.checks).forEach(([key, hit]) => {
      appendScoreItem(grid, key, hit, "舊版欄位");
    });
  } else {
    title.textContent = `${modeLabels[evaluation.type]}核對`;
    if (core.modeIncludesDirect(evaluation.type)) {
      appendScoreItem(
        grid,
        "單張結果",
        evaluation.directResultHit,
        `預測 ${resultLabels[record.prediction.directResult]}／實際 ${resultLabels[evaluation.actualResult]}`
      );
    }
    if (core.modeIncludesStructure(evaluation.type)) {
      appendScoreItem(
        grid,
        "攻防推導賽果",
        evaluation.structureResultHit,
        `預測 ${resultLabels[evaluation.structureResult]}／實際 ${resultLabels[evaluation.actualResult]}`
      );
      appendScoreItem(
        grid,
        "主隊進球",
        evaluation.structureHomeGoalHit,
        `預測 ${record.prediction.structureHomeGoals}／實際 ${record.actual.homeGoals}`
      );
      appendScoreItem(
        grid,
        "客隊進球",
        evaluation.structureAwayGoalHit,
        `預測 ${record.prediction.structureAwayGoals}／實際 ${record.actual.awayGoals}`
      );
      appendScoreItem(
        grid,
        "確切比分",
        evaluation.structureExactHit,
        `總誤差 ${evaluation.structureAbsoluteError} 球`
      );
    }
  }

  container.replaceChildren(title, grid);
  container.classList.remove("football-hidden");
}

/** 賽後輸入面板：時間／DOM 空間 O(1)。 */
export function openEvaluation(record) {
  const fieldValues = [
    ["football-evaluation-id", record.id],
    ["football-actual-home", record.actual?.homeGoals ?? ""],
    ["football-actual-away", record.actual?.awayGoals ?? ""],
    ["football-extra-home", record.actual?.extraHomeGoals ?? ""],
    ["football-extra-away", record.actual?.extraAwayGoals ?? ""],
    ["football-actual-advance", record.actual?.advance || ""],
    ["football-actual-notes", record.actual?.notes || ""],
  ];
  fieldValues.forEach(([id, value]) => {
    const element = byId(id);
    if (element) element.value = value;
  });

  const homeAdvance = byId("football-actual-advance-home");
  const awayAdvance = byId("football-actual-advance-away");
  if (homeAdvance) homeAdvance.textContent = `${record.match.homeTeam} 晉級`;
  if (awayAdvance) awayAdvance.textContent = `${record.match.awayTeam} 晉級`;

  const summary = document.createDocumentFragment();
  addSummaryItem(summary, "對戰", `${record.match.homeTeam} vs ${record.match.awayTeam}`);
  addSummaryItem(summary, "模式", modeLabels[core.getMode(record)]);
  addSummaryItem(summary, "鎖定預測", describePrediction(record));
  byId("football-evaluation-summary")?.replaceChildren(summary);

  clearMessage("football-evaluation-message");
  renderScorecard(record);
  const panel = byId("football-evaluation-panel");
  panel?.classList.remove("football-hidden");
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export const footballRender = Object.freeze({
  core,
  byId,
  setMessage,
  clearMessage,
  renderDraft,
  renderRecords,
  renderScorecard,
  openEvaluation,
});

// 相容層：事件、編輯與雲端模組尚未完成具名 import 前保留公開 API。
window.FootballLabRender = footballRender;
