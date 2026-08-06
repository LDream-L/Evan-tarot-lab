// 塔羅X賽事驗證｜足球運彩單注 UI 與流程轉接層
//
// 投注直接隸屬目前牌源紀錄：自己抽牌與網站隨機抽牌各自保存 prediction.bets。
// 實際比分仍沿用雙牌源同步；結算不寫入 actual，而由鎖定投注 + 90 分鐘比分純計算，
// 避免同場兩個牌源互相覆蓋損益。
//
// 主要函式複雜度：
// - renderBetEditor：時間／DOM 空間 O(b)，b = 目前草稿下注數。
// - renderEvaluationBets：時間／DOM 空間 O(b + s)，s <= 2 為同場牌源數。
// - decorateRecordRows：時間 O(r + b)、額外空間 O(r)，r = 紀錄數。
// - lockDraft wrapper：時間／空間 O(b)。
//
// 更快替代方案比較：
// - 暴力法：投注另建獨立賽事表，再用隊名／日期反查來源，會重複搜尋且可能錯配。
// - 優化法：投注直接存在 prediction.bets，牌源關聯天然由 record.match.cardSource 決定。
// - 暴力法：每次比分輸入重畫整個 STEP 3；本版只重畫投注結算區，成本 O(b)。

import {
  footballBettingModel,
  FOOTBALL_BET_CATEGORIES,
  FOOTBALL_BET_MARKETS,
} from "./betting-model.js";

const baseCore = window.FootballLabCore;
const baseRender = window.FootballLabRender;
const SOURCE_EXPERIMENT = "manual-vs-random";

if (
  !baseCore
  || !baseRender
  || typeof baseCore.lockDraft !== "function"
  || typeof baseCore.getRecords !== "function"
  || typeof baseRender.renderDraft !== "function"
  || typeof baseRender.renderRecords !== "function"
  || typeof baseRender.openEvaluation !== "function"
) {
  throw new Error("運彩轉接層無法取得塔羅X賽事驗證核心。");
}

let draftBets = [];
let activeDraftKey = "";
let recordsObserver = null;
let decoratingRecords = false;

/** DOM ID 查找：時間／空間 O(1)。 */
function byId(id) {
  return document.getElementById(id);
}

/** 安全建立識別碼：時間／空間 O(1)。 */
function createBetId() {
  return window.crypto?.randomUUID?.()
    || `bet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 金額顯示：時間／空間 O(1)。 */
function formatMoney(value, signed = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const normalized = footballBettingModel.roundMoney(number);
  const prefix = signed && normalized > 0 ? "+" : "";
  return `${prefix}$${normalized.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
}

/** 固定牌源名稱：時間／空間 O(1)。 */
function sourceLabel(recordOrDraft) {
  return recordOrDraft?.match?.cardSource === "random" ? "網站隨機抽牌" : "自己抽牌";
}

/** 草稿唯一鍵：時間／空間 O(1)。 */
function getDraftKey(draft) {
  if (!draft) return "";
  return [
    draft.match?.comparisonGroupId || "single",
    draft.match?.cardSource || "unknown",
    draft.drawnAt || "",
  ].join("|");
}

/**
 * 固定注入運彩區樣式。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 更快替代方案比較：分散修改多個舊 CSS 檔會增加耦合；
 * 本模組只注入一份具名前綴樣式，回滾與定位都更快。
 */
function injectStyles() {
  if (byId("football-betting-style")) return;
  const style = document.createElement("style");
  style.id = "football-betting-style";
  style.textContent = `
    .football-betting-panel {
      display: grid;
      gap: .85rem;
      margin: 1rem 0;
      padding: 1rem;
      border: 1px solid rgba(142, 125, 255, .3);
      border-radius: 16px;
      background: rgba(16, 12, 47, .42);
    }
    .football-betting-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: .8rem;
    }
    .football-betting-heading h4,
    .football-betting-heading p { margin: 0; }
    .football-betting-heading p {
      margin-top: .25rem;
      color: var(--muted, #aaa3c8);
      font-size: .78rem;
      line-height: 1.55;
    }
    .football-betting-form-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: .65rem;
      align-items: end;
    }
    .football-betting-market-fields {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: .65rem;
      grid-column: 1 / -1;
    }
    .football-betting-form-grid label,
    .football-betting-market-fields label {
      display: grid;
      gap: .35rem;
      min-width: 0;
    }
    .football-betting-add-row {
      display: flex;
      justify-content: space-between;
      gap: .75rem;
      align-items: center;
      grid-column: 1 / -1;
    }
    .football-betting-potential {
      color: var(--muted, #aaa3c8);
      font-size: .82rem;
    }
    .football-betting-list {
      display: grid;
      gap: .55rem;
    }
    .football-betting-empty {
      margin: 0;
      padding: .72rem .8rem;
      border: 1px dashed rgba(142, 125, 255, .26);
      border-radius: 12px;
      color: var(--muted, #aaa3c8);
      font-size: .82rem;
    }
    .football-bet-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: .6rem .9rem;
      padding: .72rem .8rem;
      border: 1px solid rgba(142, 125, 255, .22);
      border-radius: 12px;
      background: rgba(8, 7, 30, .35);
    }
    .football-bet-copy { min-width: 0; }
    .football-bet-copy strong,
    .football-bet-copy small { display: block; }
    .football-bet-copy small {
      margin-top: .22rem;
      color: var(--muted, #aaa3c8);
      line-height: 1.45;
    }
    .football-bet-remove {
      align-self: center;
      border: 1px solid rgba(255, 129, 161, .42);
      border-radius: 999px;
      background: transparent;
      padding: .36rem .64rem;
      cursor: pointer;
    }
    .football-betting-totals {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: .55rem;
    }
    .football-betting-total {
      display: grid;
      gap: .2rem;
      padding: .65rem .72rem;
      border-radius: 12px;
      background: rgba(142, 125, 255, .08);
    }
    .football-betting-total small { color: var(--muted, #aaa3c8); }
    .football-betting-total strong { font-size: 1.02rem; }
    .football-betting-evaluation {
      display: grid;
      gap: .75rem;
      margin: .8rem 0 1rem;
    }
    .football-betting-source-card {
      display: grid;
      gap: .6rem;
      padding: .82rem;
      border: 1px solid rgba(142, 125, 255, .26);
      border-radius: 14px;
      background: rgba(16, 12, 47, .35);
    }
    .football-betting-source-card header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: .7rem;
    }
    .football-bet-status {
      font-size: .76rem;
      white-space: nowrap;
    }
    .football-bet-status.is-won { color: #75e6b3; }
    .football-bet-status.is-lost { color: #ff9cb6; }
    .football-bet-status.is-void { color: #e7d8a2; }
    .football-record-bet-summary {
      display: block;
      margin-top: .32rem;
      font-size: .72rem;
      line-height: 1.45;
      color: var(--muted, #aaa3c8);
    }
    @media (max-width: 820px) {
      .football-betting-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .football-betting-market-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .football-betting-heading,
      .football-betting-add-row { display: grid; }
      .football-betting-form-grid,
      .football-betting-market-fields,
      .football-betting-totals { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}

/** 選單 option：時間／DOM 空間 O(1)。 */
function appendOption(select, value, label, selected = false) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  select.appendChild(option);
}

/** 建立 label + select：時間／DOM 空間 O(o)，o 為固定少量選項。 */
function createSelectField(labelText, id, options) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.id = id;
  options.forEach(([value, text], index) => appendOption(select, value, text, index === 0));
  label.appendChild(select);
  return label;
}

/** 建立 label + number input：時間／DOM 空間 O(1)。 */
function createNumberField(labelText, id, { min = 0, max = 999, step = "1", value = "" } = {}) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.id = id;
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  label.appendChild(input);
  return label;
}

/** 目前草稿賽事：時間／空間 O(1)。 */
function currentMatch() {
  return baseCore.getDraft()?.match || {};
}

/** 賽果選項：時間／空間 O(1)。 */
function resultOptions(match) {
  return [
    ["H", `主勝｜${match.homeTeam || "主隊"}`],
    ["D", "和局"],
    ["A", `客勝｜${match.awayTeam || "客隊"}`],
  ];
}

/** 球隊選項：時間／空間 O(1)。 */
function teamOptions(match) {
  return [
    ["H", `主隊｜${match.homeTeam || "主隊"}`],
    ["A", `客隊｜${match.awayTeam || "客隊"}`],
  ];
}

/** 0–5 + 6+：時間／DOM 空間 O(1)，固定 7 項。 */
function goalCountOptions() {
  return [0, 1, 2, 3, 4, 5, 6].map((value) => [String(value), value === 6 ? "6 球+" : `${value} 球`]);
}

/**
 * 依投注種類只建立必要欄位，避免一次攤開完整玩法。
 * 時間複雜度：O(1)
 * DOM 空間複雜度：O(1)，每種玩法最多固定 3 欄。
 *
 * 更快替代方案比較：完整玩法一次輸出雖不用切換，但 DOM 與視覺噪音都更高；
 * 本版以「分類 → 項目」查表後只輸出目前欄位。
 */
function renderMarketFields() {
  const container = byId("football-betting-market-fields");
  const marketType = byId("football-betting-market")?.value || "match_result";
  if (!container) return;
  const match = currentMatch();
  const fields = [];

  if (marketType === "match_result") {
    fields.push(createSelectField("投注選項", "football-betting-selection", resultOptions(match)));
  } else if (marketType === "handicap_result") {
    fields.push(
      createNumberField(`讓分（客｜${match.awayTeam || "客隊"}）`, "football-betting-away-bonus", { min: 0, max: 20, value: 0 }),
      createNumberField(`讓分（主｜${match.homeTeam || "主隊"}）`, "football-betting-home-bonus", { min: 0, max: 20, value: 1 }),
      createSelectField("讓分後結果", "football-betting-selection", resultOptions(match))
    );
  } else if (marketType === "double_chance") {
    fields.push(createSelectField("投注選項", "football-betting-selection", [
      ["AD", "客勝或和局"],
      ["DH", "和局或主勝"],
      ["AH", "客勝或主勝"],
    ]));
  } else if (marketType === "total_over_under") {
    fields.push(
      createNumberField("盤口", "football-betting-line", { min: 0, max: 30, step: 0.5, value: 2.5 }),
      createSelectField("方向", "football-betting-selection", [["OVER", "大"], ["UNDER", "小"]])
    );
  } else if (marketType === "team_total_over_under") {
    fields.push(
      createSelectField("球隊", "football-betting-team", teamOptions(match)),
      createNumberField("盤口", "football-betting-line", { min: 0, max: 20, step: 0.5, value: 1.5 }),
      createSelectField("方向", "football-betting-selection", [["OVER", "大"], ["UNDER", "小"]])
    );
  } else if (marketType === "odd_even") {
    fields.push(createSelectField("投注選項", "football-betting-selection", [["ODD", "單"], ["EVEN", "雙"]]));
  } else if (marketType === "team_odd_even") {
    fields.push(
      createSelectField("球隊", "football-betting-team", teamOptions(match)),
      createSelectField("投注選項", "football-betting-selection", [["ODD", "單"], ["EVEN", "雙"]])
    );
  } else if (marketType === "total_goal_range") {
    fields.push(createSelectField("總進球區間", "football-betting-selection", [
      ["R01", "0–1 球"], ["R23", "2–3 球"], ["R45", "4–5 球"], ["R6P", "6 球+"],
    ]));
  } else if (marketType === "exact_total_goals") {
    fields.push(createSelectField("正確進球數", "football-betting-goal-count", goalCountOptions()));
  } else if (marketType === "exact_team_goals") {
    fields.push(
      createSelectField("球隊", "football-betting-team", teamOptions(match)),
      createSelectField("正確進球數", "football-betting-goal-count", goalCountOptions())
    );
  } else if (marketType === "exact_score") {
    fields.push(
      createNumberField(`${match.homeTeam || "主隊"}進球`, "football-betting-home-goals", { min: 0, max: 20, value: 1 }),
      createNumberField(`${match.awayTeam || "客隊"}進球`, "football-betting-away-goals", { min: 0, max: 20, value: 0 })
    );
  } else if (marketType === "both_teams_score") {
    fields.push(createSelectField("兩隊是否都進球", "football-betting-selection", [["YES", "是"], ["NO", "否"]]));
  } else if (marketType === "result_btts") {
    fields.push(
      createSelectField("不讓分結果", "football-betting-selection", resultOptions(match)),
      createSelectField("兩隊是否都進球", "football-betting-btts", [["YES", "是"], ["NO", "否"]])
    );
  }

  container.replaceChildren(...fields);
}

/** 類別切換後重建項目查表：時間／DOM 空間 O(m)，m <= 7。 */
function renderMarketOptions() {
  const categoryId = byId("football-betting-category")?.value || FOOTBALL_BET_CATEGORIES[0].id;
  const category = FOOTBALL_BET_CATEGORIES.find((item) => item.id === categoryId) || FOOTBALL_BET_CATEGORIES[0];
  const select = byId("football-betting-market");
  if (!select) return;
  const options = category.markets.map((marketType) => {
    const option = document.createElement("option");
    option.value = marketType;
    option.textContent = FOOTBALL_BET_MARKETS[marketType].label;
    return option;
  });
  select.replaceChildren(...options);
  renderMarketFields();
}

/** 讀取輸入值：時間／空間 O(1)。 */
function readValue(id) {
  return String(byId(id)?.value ?? "").trim();
}

/**
 * 由目前可見欄位建立單筆投注物件。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function buildBetFromForm() {
  const marketType = readValue("football-betting-market");
  const bet = {
    id: createBetId(),
    marketType,
    odds: Number(readValue("football-betting-odds")),
    stake: Number(readValue("football-betting-stake")),
  };

  if (["match_result", "double_chance", "odd_even", "total_goal_range", "both_teams_score"].includes(marketType)) {
    bet.selection = readValue("football-betting-selection");
  }
  if (marketType === "handicap_result") {
    bet.selection = readValue("football-betting-selection");
    bet.awayBonus = Number(readValue("football-betting-away-bonus"));
    bet.homeBonus = Number(readValue("football-betting-home-bonus"));
  }
  if (marketType === "total_over_under") {
    bet.selection = readValue("football-betting-selection");
    bet.line = Number(readValue("football-betting-line"));
  }
  if (marketType === "team_total_over_under") {
    bet.team = readValue("football-betting-team");
    bet.selection = readValue("football-betting-selection");
    bet.line = Number(readValue("football-betting-line"));
  }
  if (marketType === "team_odd_even") {
    bet.team = readValue("football-betting-team");
    bet.selection = readValue("football-betting-selection");
  }
  if (marketType === "exact_total_goals") {
    bet.goalCount = Number(readValue("football-betting-goal-count"));
  }
  if (marketType === "exact_team_goals") {
    bet.team = readValue("football-betting-team");
    bet.goalCount = Number(readValue("football-betting-goal-count"));
  }
  if (marketType === "exact_score") {
    bet.homeGoals = Number(readValue("football-betting-home-goals"));
    bet.awayGoals = Number(readValue("football-betting-away-goals"));
  }
  if (marketType === "result_btts") {
    bet.selection = readValue("football-betting-selection");
    bet.btts = readValue("football-betting-btts");
  }
  return bet;
}

/** 潛在收益預覽：時間／空間 O(1)。 */
function updatePotentialPreview() {
  const output = byId("football-betting-potential");
  if (!output) return;
  const potential = footballBettingModel.calculatePotentialProfit(
    Number(readValue("football-betting-stake")),
    Number(readValue("football-betting-odds"))
  );
  output.textContent = potential == null ? "潛在收益：—" : `潛在收益：${formatMoney(potential, true)}（不含本金）`;
}

/** 單筆賽前項目：時間／DOM 空間 O(1)。 */
function createDraftBetItem(bet, match) {
  const item = document.createElement("article");
  item.className = "football-bet-item";
  const copy = document.createElement("div");
  copy.className = "football-bet-copy";
  const title = document.createElement("strong");
  title.textContent = footballBettingModel.describeBet(bet, match);
  const detail = document.createElement("small");
  detail.textContent = `成本 ${formatMoney(bet.stake)}｜倍率 ${Number(bet.odds)}｜潛在收益 ${formatMoney(footballBettingModel.calculatePotentialProfit(bet.stake, bet.odds), true)}`;
  copy.append(title, detail);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "football-bet-remove";
  remove.dataset.betId = bet.id;
  remove.textContent = "刪除";
  item.append(copy, remove);
  return item;
}

/**
 * 重畫目前草稿下注清單與總計。
 * 時間複雜度：O(b)
 * DOM 空間複雜度：O(b)
 */
function renderDraftBetList() {
  const list = byId("football-betting-list");
  const totals = byId("football-betting-draft-totals");
  if (!list || !totals) return;
  const match = currentMatch();
  if (!draftBets.length) {
    const empty = document.createElement("p");
    empty.className = "football-betting-empty";
    empty.textContent = "目前沒有下注紀錄。可留白，不影響塔羅驗證。";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...draftBets.map((bet) => createDraftBetItem(bet, match)));
  }

  const summary = footballBettingModel.summarizeBets(draftBets);
  totals.replaceChildren(
    createTotal("總成本", formatMoney(summary.totalStake)),
    createTotal("總潛在收益", formatMoney(summary.potentialProfit, true))
  );
}

/** 總計卡：時間／DOM 空間 O(1)。 */
function createTotal(label, value) {
  const item = document.createElement("div");
  item.className = "football-betting-total";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  item.append(small, strong);
  return item;
}

/**
 * 建立一次下注編輯器。
 * 時間複雜度：O(c + m)，c=4 個分類、m<=7。
 * DOM 空間複雜度：O(c + m)。
 */
function ensureBetEditor() {
  if (byId("football-betting-editor")) return true;
  const form = byId("football-reading-form");
  const actions = form?.querySelector(".football-actions");
  if (!form || !actions) return false;

  injectStyles();
  const section = document.createElement("section");
  section.id = "football-betting-editor";
  section.className = "football-betting-panel";

  const heading = document.createElement("div");
  heading.className = "football-betting-heading";
  const headingCopy = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = "運彩投注（選填）";
  const note = document.createElement("p");
  note.textContent = "投注會跟目前牌源一起鎖定。第一版只開放可由 90 分鐘正式比分自動結算的台灣運彩足球玩法；半場、首球、角球等需要額外賽況的玩法後續再加。";
  headingCopy.append(title, note);
  const badge = document.createElement("span");
  badge.id = "football-betting-source-badge";
  badge.className = "football-version";
  heading.append(headingCopy, badge);

  const grid = document.createElement("div");
  grid.className = "football-betting-form-grid";
  const category = createSelectField(
    "分類",
    "football-betting-category",
    FOOTBALL_BET_CATEGORIES.map((item) => [item.id, item.label])
  );
  const marketLabel = document.createElement("label");
  marketLabel.textContent = "投注項目";
  const market = document.createElement("select");
  market.id = "football-betting-market";
  marketLabel.appendChild(market);
  const odds = createNumberField("倍率", "football-betting-odds", { min: 1.01, max: 999, step: 0.01, value: 2 });
  const stake = createNumberField("成本", "football-betting-stake", { min: 1, max: 100000000, step: 1, value: 100 });
  const fields = document.createElement("div");
  fields.id = "football-betting-market-fields";
  fields.className = "football-betting-market-fields";

  const addRow = document.createElement("div");
  addRow.className = "football-betting-add-row";
  const potential = document.createElement("span");
  potential.id = "football-betting-potential";
  potential.className = "football-betting-potential";
  const add = document.createElement("button");
  add.id = "football-betting-add";
  add.type = "button";
  add.className = "btn ghost";
  add.textContent = "＋ 新增投注";
  addRow.append(potential, add);

  grid.append(category, marketLabel, odds, stake, fields, addRow);
  const message = document.createElement("p");
  message.id = "football-betting-message";
  message.className = "football-message football-hidden";
  message.setAttribute("aria-live", "polite");
  const list = document.createElement("div");
  list.id = "football-betting-list";
  list.className = "football-betting-list";
  const totals = document.createElement("div");
  totals.id = "football-betting-draft-totals";
  totals.className = "football-betting-totals";

  section.append(heading, grid, message, list, totals);
  actions.parentElement.insertBefore(section, actions);

  byId("football-betting-category")?.addEventListener("change", renderMarketOptions);
  byId("football-betting-market")?.addEventListener("change", renderMarketFields);
  byId("football-betting-odds")?.addEventListener("input", updatePotentialPreview);
  byId("football-betting-stake")?.addEventListener("input", updatePotentialPreview);
  byId("football-betting-add")?.addEventListener("click", addDraftBet);
  list.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-bet-id]") : null;
    if (!target) return;
    draftBets = draftBets.filter((bet) => bet.id !== target.dataset.betId);
    renderDraftBetList();
  });

  renderMarketOptions();
  updatePotentialPreview();
  renderDraftBetList();
  return true;
}

/** 加入單筆投注：驗證 O(1)，陣列複製 O(b)。 */
function addDraftBet() {
  const message = byId("football-betting-message");
  const bet = buildBetFromForm();
  const error = footballBettingModel.validateBet(bet);
  if (error) {
    if (message) {
      message.textContent = error;
      message.classList.remove("football-hidden", "is-success");
      message.classList.add("is-error");
    }
    return;
  }
  draftBets = [...draftBets, bet];
  if (message) {
    message.textContent = "投注已加入本牌源，會在鎖定判讀時一起保存。";
    message.classList.remove("football-hidden", "is-error");
    message.classList.add("is-success");
  }
  renderDraftBetList();
}

/**
 * 對應目前草稿；換牌源時清空未鎖定下注。
 * 時間複雜度：O(b)
 * DOM 空間複雜度：O(b)
 */
function renderBetEditor(draft) {
  if (!ensureBetEditor()) return;
  const key = getDraftKey(draft);
  if (key !== activeDraftKey) {
    activeDraftKey = key;
    draftBets = [];
  }
  const badge = byId("football-betting-source-badge");
  if (badge) badge.textContent = sourceLabel(draft);
  renderMarketOptions();
  updatePotentialPreview();
  renderDraftBetList();
}

/** 取得有效輸入比分；時間／空間 O(1)。 */
function readEvaluationActual() {
  const home = Number(byId("football-actual-home")?.value);
  const away = Number(byId("football-actual-away")?.value);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return null;
  return { homeGoals: home, awayGoals: away };
}

/** 同場雙牌源最多兩筆，排序固定自己抽牌在前：時間 O(r)，空間 O(1)。 */
function getEvaluationRecords(record) {
  if (
    record?.match?.sourceExperiment !== SOURCE_EXPERIMENT
    || !record.match.comparisonGroupId
  ) return [record];
  const groupId = record.match.comparisonGroupId;
  const records = baseCore.getRecords().filter((item) => item.match?.comparisonGroupId === groupId);
  const manual = records.find((item) => item.match?.cardSource === "manual");
  const random = records.find((item) => item.match?.cardSource === "random");
  return [manual, random].filter(Boolean);
}

/** 單筆賽後下注列：時間／DOM 空間 O(1)。 */
function createSettledBetItem(bet, record, actual) {
  const settlement = footballBettingModel.settleBet(bet, actual);
  const item = document.createElement("article");
  item.className = "football-bet-item";
  const copy = document.createElement("div");
  copy.className = "football-bet-copy";
  const title = document.createElement("strong");
  title.textContent = footballBettingModel.describeBet(bet, record.match);
  const detail = document.createElement("small");
  const profitText = settlement.status === "pending"
    ? `潛在收益 ${formatMoney(footballBettingModel.calculatePotentialProfit(bet.stake, bet.odds), true)}`
    : `實際損益 ${formatMoney(settlement.profit, true)}`;
  detail.textContent = `成本 ${formatMoney(bet.stake)}｜倍率 ${Number(bet.odds)}｜${profitText}`;
  copy.append(title, detail);

  const status = document.createElement("span");
  status.className = `football-bet-status${settlement.status === "won" ? " is-won" : settlement.status === "lost" ? " is-lost" : settlement.status === "void" ? " is-void" : ""}`;
  status.textContent = settlement.status === "won"
    ? "命中"
    : settlement.status === "lost" ? "未中" : settlement.status === "void" ? "退款／損益 0" : "等待比分";
  item.append(copy, status);
  return item;
}

/**
 * 建立單一牌源的賽後投注摘要。
 * 時間複雜度：O(b)
 * DOM 空間複雜度：O(b)
 */
function createSourceSettlementCard(record, actual) {
  const card = document.createElement("section");
  card.className = "football-betting-source-card";
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = `${sourceLabel(record)}｜運彩`;
  const badge = document.createElement("span");
  badge.className = "football-version";
  const bets = Array.isArray(record.prediction?.bets) ? record.prediction.bets : [];
  badge.textContent = `${bets.length} 筆`;
  header.append(title, badge);
  card.appendChild(header);

  if (!bets.length) {
    const empty = document.createElement("p");
    empty.className = "football-betting-empty";
    empty.textContent = "此牌源沒有運彩投注紀錄。";
    card.appendChild(empty);
    return card;
  }

  const list = document.createElement("div");
  list.className = "football-betting-list";
  bets.forEach((bet) => list.appendChild(createSettledBetItem(bet, record, actual)));
  const summary = footballBettingModel.summarizeBets(bets, actual);
  const totals = document.createElement("div");
  totals.className = "football-betting-totals";
  totals.append(
    createTotal("總成本", formatMoney(summary.totalStake)),
    createTotal(actual ? "總損益" : "總潛在收益", formatMoney(actual ? summary.actualProfit : summary.potentialProfit, true))
  );
  card.append(list, totals);
  return card;
}

/**
 * STEP 3 同時顯示同場兩個牌源的獨立投注與損益。
 * 時間複雜度：O(r + b)，r 為紀錄數（找同組 sibling）、b 為兩牌源投注總數。
 * DOM 空間複雜度：O(b)。
 *
 * 更快替代方案比較：重新建立兩套賽果表單會讓比分重複輸入；
 * 本版共用比分，只分流兩組投注結算與回顧。
 */
function renderEvaluationBets(record, actualOverride = undefined) {
  const form = byId("football-evaluation-form");
  const summary = byId("football-evaluation-summary");
  if (!form || !summary || !record) return;
  injectStyles();
  let container = byId("football-betting-evaluation");
  if (!container) {
    container = document.createElement("section");
    container.id = "football-betting-evaluation";
    container.className = "football-betting-evaluation";
    summary.insertAdjacentElement("afterend", container);
  }
  const actual = actualOverride === undefined ? record.actual : actualOverride;
  const records = getEvaluationRecords(record);
  container.replaceChildren(...records.map((item) => createSourceSettlementCard(item, actual)));
}

/**
 * 紀錄列加入牌源自己的投注摘要。
 * 時間複雜度：O(r + b)
 * 額外空間複雜度：O(r)
 *
 * 更快替代方案比較：每列用 getRecord 線性找會退化為 O(r²)；
 * 本版先建 id→record Map，再逐列 O(1) 查表。
 */
function decorateRecordRows() {
  if (decoratingRecords) return;
  const body = byId("football-records-body");
  if (!body) return;
  decoratingRecords = true;
  try {
    const records = baseCore.getRecords();
    const recordMap = new Map(records.map((record) => [String(record.id), record]));
    body.querySelectorAll('button[data-action="evaluate"][data-id]').forEach((button) => {
      const row = button.closest("tr");
      const record = recordMap.get(String(button.dataset.id));
      if (!row || !record || row.querySelector(".football-record-bet-summary")) return;
      const bets = Array.isArray(record.prediction?.bets) ? record.prediction.bets : [];
      if (!bets.length) return;
      const summary = footballBettingModel.summarizeBets(bets, record.actual);
      const note = document.createElement("span");
      note.className = "football-record-bet-summary";
      note.textContent = record.actual
        ? `運彩 ${summary.count} 筆｜成本 ${formatMoney(summary.totalStake)}｜損益 ${formatMoney(summary.actualProfit, true)}`
        : `運彩 ${summary.count} 筆｜成本 ${formatMoney(summary.totalStake)}｜潛在 ${formatMoney(summary.potentialProfit, true)}`;
      const predictionCell = row.children[2] || row.children[1];
      predictionCell?.appendChild(note);
    });
  } finally {
    decoratingRecords = false;
  }
}

/** DOM 被舊相容層重畫後補回投注摘要：每次 O(r + b)，只在 childList 變動時觸發。 */
function observeRecordRenders() {
  if (recordsObserver) return;
  const body = byId("football-records-body");
  if (!body) return;
  recordsObserver = new MutationObserver(() => window.queueMicrotask(decorateRecordRows));
  recordsObserver.observe(body, { childList: true, subtree: true });
}

/** 鎖定投注 wrapper：時間／空間 O(b)。 */
function lockDraft(prediction, cards) {
  const lockedBets = footballBettingModel.normalizeLockedBets(draftBets, {
    createId: createBetId,
    lockedAt: new Date().toISOString(),
  });
  const record = baseCore.lockDraft({ ...prediction, bets: lockedBets }, cards);
  draftBets = [];
  activeDraftKey = "";
  return record;
}

const bettingCore = Object.freeze({
  ...baseCore,
  lockDraft,
  betting: footballBettingModel,
  settleBet: footballBettingModel.settleBet,
  summarizeBets: footballBettingModel.summarizeBets,
});

const bettingRender = Object.freeze({
  ...baseRender,
  renderDraft(draft) {
    const result = baseRender.renderDraft(draft);
    renderBetEditor(draft);
    return result;
  },
  renderRecords() {
    const result = baseRender.renderRecords();
    decorateRecordRows();
    return result;
  },
  openEvaluation(record) {
    const result = baseRender.openEvaluation(record);
    renderEvaluationBets(record);
    return result;
  },
});

/**
 * 固定事件委派與比分即時結算。
 * 時間／空間複雜度：O(1) 綁定；每次比分輸入重畫 O(b)。
 */
function bind() {
  const readingForm = byId("football-reading-form");
  const evaluationForm = byId("football-evaluation-form");
  const actualHome = byId("football-actual-home");
  const actualAway = byId("football-actual-away");
  const abandon = byId("football-abandon-draft");

  // 雙牌源相容層會在手動鎖定後用較早的 Render 建立網站牌；
  // 同一個 submit task 的下一輪 timer 再讀核心草稿，就能只補運彩編輯器，不重畫牌面。
  readingForm?.addEventListener("submit", () => {
    window.setTimeout(() => {
      const draft = bettingCore.getDraft();
      if (draft) renderBetEditor(draft);
    }, 0);
  }, true);

  const refreshEvaluation = () => {
    const recordId = String(byId("football-evaluation-id")?.value || "");
    const record = recordId ? bettingCore.getRecord(recordId) : null;
    if (record) renderEvaluationBets(record, readEvaluationActual());
  };
  actualHome?.addEventListener("input", refreshEvaluation);
  actualAway?.addEventListener("input", refreshEvaluation);
  evaluationForm?.addEventListener("submit", () => window.setTimeout(() => {
    const recordId = String(byId("football-evaluation-id")?.value || "");
    const record = recordId ? bettingCore.getRecord(recordId) : null;
    if (record) renderEvaluationBets(record);
    decorateRecordRows();
  }, 0));
  abandon?.addEventListener("click", () => window.setTimeout(() => {
    if (!bettingCore.getDraft()) {
      draftBets = [];
      activeDraftKey = "";
      renderDraftBetList();
    }
  }, 0));

  observeRecordRenders();
  decorateRecordRows();
}

window.FootballLabCore = bettingCore;
window.FootballLabRender = bettingRender;

export const footballBettingRuntime = Object.freeze({
  stage: "betting-ready",
  model: footballBettingModel,
  core: bettingCore,
  render: bettingRender,
  getDraftBets: () => draftBets.map((bet) => ({ ...bet })),
  renderBetEditor,
  renderEvaluationBets,
});

window.FootballBettingModel = footballBettingModel;
window.FootballBettingRuntime = footballBettingRuntime;

injectStyles();
ensureBetEditor();
bind();
