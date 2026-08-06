// 塔羅X賽事驗證｜已鎖定紀錄運彩編輯轉接層
//
// 本層只負責在既有「編輯賽事與預測比分」面板中加入可修改的運彩投注，
// 並移除舊的主勝／和局／客勝十進位賠率輸入欄位。
// 投注仍直接隸屬 prediction.bets，因此自己抽牌與網站隨機抽牌各自獨立保存。
//
// 主要函式複雜度：
// - prepareEditor／renderBetList：時間／DOM 空間 O(b)，b = 目前牌源投注筆數。
// - upsertBet／removeBet：時間／空間 O(b)，使用單次陣列複製維持不可變更新。
// - handleSubmit：時間／空間 O(b + p)，p = 紀錄／淘汰賽 prediction 複製大小。
// - 單筆投注欄位讀取／驗證／收益預覽：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 暴力法：另建投注表再以隊名、日期與牌源反查，會增加搜尋與錯配風險。
// - 優化法：直接修改 record.prediction.bets，牌源關聯天然由 record.match.cardSource 決定。
// - 暴力法：每次切換項目輸出完整台灣運彩欄位；本版用「分類 → 項目」查表，
//   每次只建立目前玩法必要欄位，DOM 上限固定。

import {
  footballBettingModel,
  FOOTBALL_BET_CATEGORIES,
  FOOTBALL_BET_MARKETS,
} from "./betting-model.js";
import {
  buildUpdatedRecord,
  cloneValue,
  clean,
} from "./record-edit-model.js";
import { buildKnockoutRecord } from "./record-knockout-edit-model.js";

/** 建立已鎖定紀錄的運彩編輯器。建立時間／空間 O(1)。 */
export function createFootballRecordBettingEdit({
  core,
  ui,
  baseEditor,
  knockoutEditor,
  documentRef = document,
  browserWindow = window,
  autoInit = true,
} = {}) {
  if (
    !core
    || !ui
    || !baseEditor
    || !knockoutEditor
    || typeof core.getRecord !== "function"
    || typeof core.importRecords !== "function"
    || typeof ui.renderRecords !== "function"
    || typeof baseEditor.readValues !== "function"
    || typeof baseEditor.syncUpdatedRecord !== "function"
    || typeof knockoutEditor.shouldHandle !== "function"
    || typeof knockoutEditor.readStageInput !== "function"
  ) {
    throw new Error("運彩紀錄編輯層需要核心、Render、基礎編輯器與決勝編輯器。");
  }

  const state = {
    recordId: "",
    bets: [],
    editingBetId: "",
  };
  let initialized = false;
  let bound = false;

  const byId = (id) => documentRef.getElementById(id);

  /** 安全建立下注 ID：時間／空間 O(1)。 */
  function createBetId() {
    return browserWindow.crypto?.randomUUID?.()
      || `bet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /** 金額格式：時間／空間 O(1)。 */
  function formatMoney(value, signed = false) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    const normalized = footballBettingModel.roundMoney(number);
    const prefix = signed && normalized > 0 ? "+" : "";
    return `${prefix}$${normalized.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
  }

  /** DOM 文字值：時間／空間 O(1)。 */
  function readValue(id) {
    return clean(byId(id)?.value);
  }

  /** 數字欄位：時間／空間 O(1)。 */
  function readNumber(id) {
    const raw = readValue(id);
    return raw === "" ? Number.NaN : Number(raw);
  }

  /** 固定訊息：時間／空間 O(1)。 */
  function setMessage(message, type = "") {
    const element = byId("football-edit-message");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("football-hidden", "is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  /** 投注區訊息：時間／空間 O(1)。 */
  function setBetMessage(message, type = "") {
    const element = byId("football-edit-betting-message");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("football-hidden", !message);
    element.classList.remove("is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  /** 目前編輯紀錄：時間／空間 O(1)。 */
  function currentRecord() {
    return core.getRecord(state.recordId);
  }

  /** 移除舊賽事層級賠率欄位。時間／空間 O(1)。 */
  function removeLegacyOddsFields() {
    [
      "football-edit-home-odds",
      "football-edit-draw-odds",
      "football-edit-away-odds",
    ].forEach((id) => byId(id)?.closest("label")?.remove());
  }

  /** 固定樣式：時間／空間 O(1)。 */
  function injectStyles() {
    if (byId("football-record-betting-edit-style")) return;
    const style = documentRef.createElement("style");
    style.id = "football-record-betting-edit-style";
    style.textContent = `
      #football-edit-betting-fieldset{display:grid;gap:.9rem;margin-top:1rem}
      .football-edit-betting-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
      .football-edit-betting-heading p{margin:.3rem 0 0;font-size:.8rem;color:var(--text-soft,#bcb7d9);line-height:1.55}
      .football-edit-betting-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem;align-items:end}
      .football-edit-betting-grid label,.football-edit-betting-fields label{display:grid;gap:.35rem;min-width:0}
      .football-edit-betting-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;grid-column:1/-1}
      .football-edit-betting-actions{display:flex;justify-content:space-between;align-items:center;gap:.7rem;grid-column:1/-1;flex-wrap:wrap}
      .football-edit-betting-actions-buttons{display:flex;gap:.55rem;flex-wrap:wrap}
      .football-edit-betting-potential{font-size:.8rem;color:var(--text-soft,#bcb7d9)}
      .football-edit-betting-list{display:grid;gap:.55rem}
      .football-edit-betting-empty{margin:0;padding:.72rem .8rem;border:1px dashed rgba(142,125,255,.28);border-radius:12px;color:var(--text-soft,#bcb7d9);font-size:.82rem}
      .football-edit-bet-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem;padding:.72rem .8rem;border:1px solid rgba(142,125,255,.24);border-radius:12px;background:rgba(8,7,30,.3)}
      .football-edit-bet-item strong,.football-edit-bet-item small{display:block}
      .football-edit-bet-item small{margin-top:.22rem;color:var(--text-soft,#bcb7d9);line-height:1.45}
      .football-edit-bet-buttons{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}
      .football-edit-bet-buttons button{white-space:nowrap}
      .football-edit-betting-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}
      .football-edit-betting-total{display:grid;gap:.2rem;padding:.65rem .72rem;border-radius:12px;background:rgba(142,125,255,.08)}
      .football-edit-betting-total small{color:var(--text-soft,#bcb7d9)}
      @media(max-width:820px){.football-edit-betting-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.football-edit-betting-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.football-edit-betting-grid,.football-edit-betting-fields,.football-edit-betting-totals{grid-template-columns:1fr}.football-edit-bet-item{grid-template-columns:1fr}.football-edit-betting-actions{display:grid}}
    `;
    documentRef.head.appendChild(style);
  }

  /** option：時間／空間 O(1)。 */
  function appendOption(select, value, label, selected = false) {
    const option = documentRef.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    select.appendChild(option);
  }

  /** label + select：時間／空間 O(o)，o 為固定選項數。 */
  function createSelectField(labelText, id, options) {
    const label = documentRef.createElement("label");
    label.textContent = labelText;
    const select = documentRef.createElement("select");
    select.id = id;
    options.forEach(([value, text], index) => appendOption(select, value, text, index === 0));
    label.appendChild(select);
    return label;
  }

  /** label + number：時間／空間 O(1)。 */
  function createNumberField(labelText, id, { min = 0, max = 999, step = 1, value = "" } = {}) {
    const label = documentRef.createElement("label");
    label.textContent = labelText;
    const input = documentRef.createElement("input");
    input.id = id;
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.inputMode = step === 1 ? "numeric" : "decimal";
    input.value = String(value);
    label.appendChild(input);
    return label;
  }

  /** 賽果選項：時間／空間 O(1)。 */
  function resultOptions(record) {
    return [
      ["H", `主勝｜${record?.match?.homeTeam || "主隊"}`],
      ["D", "和局"],
      ["A", `客勝｜${record?.match?.awayTeam || "客隊"}`],
    ];
  }

  /** 球隊選項：時間／空間 O(1)。 */
  function teamOptions(record) {
    return [
      ["H", `主隊｜${record?.match?.homeTeam || "主隊"}`],
      ["A", `客隊｜${record?.match?.awayTeam || "客隊"}`],
    ];
  }

  /** 固定 0–5 + 6+：時間／空間 O(1)。 */
  function goalCountOptions() {
    return [0, 1, 2, 3, 4, 5, 6].map((value) => [String(value), value === 6 ? "6 球+" : `${value} 球`]);
  }

  /** 設欄位值：時間／空間 O(1)。 */
  function setValue(id, value) {
    const element = byId(id);
    if (element) element.value = value == null ? "" : String(value);
  }

  /**
   * 依玩法建立必要欄位。
   * 時間／空間 O(1)，每種玩法最多固定 3 欄。
   */
  function renderMarketFields(savedBet = null) {
    const container = byId("football-edit-betting-fields");
    const marketType = readValue("football-edit-betting-market") || "match_result";
    if (!container) return;
    const record = currentRecord();
    const fields = [];

    if (marketType === "match_result") {
      fields.push(createSelectField("投注選項", "football-edit-betting-selection", resultOptions(record)));
    } else if (marketType === "handicap_result") {
      fields.push(
        createNumberField(`讓分（客｜${record?.match?.awayTeam || "客隊"}）`, "football-edit-betting-away-bonus", { min: 0, max: 20, value: 0 }),
        createNumberField(`讓分（主｜${record?.match?.homeTeam || "主隊"}）`, "football-edit-betting-home-bonus", { min: 0, max: 20, value: 1 }),
        createSelectField("讓分後結果", "football-edit-betting-selection", resultOptions(record))
      );
    } else if (marketType === "double_chance") {
      fields.push(createSelectField("投注選項", "football-edit-betting-selection", [["AD", "客勝或和局"], ["DH", "和局或主勝"], ["AH", "客勝或主勝"]]));
    } else if (marketType === "total_over_under") {
      fields.push(
        createNumberField("盤口", "football-edit-betting-line", { min: 0, max: 30, step: 0.5, value: 2.5 }),
        createSelectField("方向", "football-edit-betting-selection", [["OVER", "大"], ["UNDER", "小"]])
      );
    } else if (marketType === "team_total_over_under") {
      fields.push(
        createSelectField("球隊", "football-edit-betting-team", teamOptions(record)),
        createNumberField("盤口", "football-edit-betting-line", { min: 0, max: 20, step: 0.5, value: 1.5 }),
        createSelectField("方向", "football-edit-betting-selection", [["OVER", "大"], ["UNDER", "小"]])
      );
    } else if (marketType === "odd_even") {
      fields.push(createSelectField("投注選項", "football-edit-betting-selection", [["ODD", "單"], ["EVEN", "雙"]]));
    } else if (marketType === "team_odd_even") {
      fields.push(
        createSelectField("球隊", "football-edit-betting-team", teamOptions(record)),
        createSelectField("投注選項", "football-edit-betting-selection", [["ODD", "單"], ["EVEN", "雙"]])
      );
    } else if (marketType === "total_goal_range") {
      fields.push(createSelectField("總進球區間", "football-edit-betting-selection", [["R01", "0–1 球"], ["R23", "2–3 球"], ["R45", "4–5 球"], ["R6P", "6 球+"]]));
    } else if (marketType === "exact_total_goals") {
      fields.push(createSelectField("正確進球數", "football-edit-betting-goal-count", goalCountOptions()));
    } else if (marketType === "exact_team_goals") {
      fields.push(
        createSelectField("球隊", "football-edit-betting-team", teamOptions(record)),
        createSelectField("正確進球數", "football-edit-betting-goal-count", goalCountOptions())
      );
    } else if (marketType === "exact_score") {
      fields.push(
        createNumberField(`${record?.match?.homeTeam || "主隊"}進球`, "football-edit-betting-home-goals", { min: 0, max: 20, value: 1 }),
        createNumberField(`${record?.match?.awayTeam || "客隊"}進球`, "football-edit-betting-away-goals", { min: 0, max: 20, value: 0 })
      );
    } else if (marketType === "both_teams_score") {
      fields.push(createSelectField("兩隊是否都進球", "football-edit-betting-selection", [["YES", "是"], ["NO", "否"]]));
    } else if (marketType === "result_btts") {
      fields.push(
        createSelectField("不讓分結果", "football-edit-betting-selection", resultOptions(record)),
        createSelectField("兩隊是否都進球", "football-edit-betting-btts", [["YES", "是"], ["NO", "否"]])
      );
    }

    container.replaceChildren(...fields);
    if (!savedBet || savedBet.marketType !== marketType) return;
    [
      ["football-edit-betting-selection", savedBet.selection],
      ["football-edit-betting-away-bonus", savedBet.awayBonus],
      ["football-edit-betting-home-bonus", savedBet.homeBonus],
      ["football-edit-betting-line", savedBet.line],
      ["football-edit-betting-team", savedBet.team],
      ["football-edit-betting-goal-count", savedBet.goalCount],
      ["football-edit-betting-home-goals", savedBet.homeGoals],
      ["football-edit-betting-away-goals", savedBet.awayGoals],
      ["football-edit-betting-btts", savedBet.btts],
    ].forEach(([id, value]) => {
      if (value != null) setValue(id, value);
    });
  }

  /** 類別 → 項目查表：時間 O(m)，m <= 7。 */
  function renderMarketOptions(preferredMarket = "") {
    const categoryId = readValue("football-edit-betting-category") || FOOTBALL_BET_CATEGORIES[0].id;
    const category = FOOTBALL_BET_CATEGORIES.find((item) => item.id === categoryId) || FOOTBALL_BET_CATEGORIES[0];
    const select = byId("football-edit-betting-market");
    if (!select) return;
    const options = category.markets.map((marketType) => {
      const option = documentRef.createElement("option");
      option.value = marketType;
      option.textContent = FOOTBALL_BET_MARKETS[marketType].label;
      return option;
    });
    select.replaceChildren(...options);
    if (preferredMarket && category.markets.includes(preferredMarket)) select.value = preferredMarket;
    renderMarketFields();
  }

  /** 由目前表單建立投注：時間／空間 O(1)。 */
  function buildBetFromForm() {
    const marketType = readValue("football-edit-betting-market");
    const bet = {
      id: state.editingBetId || createBetId(),
      marketType,
      odds: readNumber("football-edit-betting-odds"),
      stake: readNumber("football-edit-betting-stake"),
    };

    if (["match_result", "double_chance", "odd_even", "total_goal_range", "both_teams_score"].includes(marketType)) {
      bet.selection = readValue("football-edit-betting-selection");
    }
    if (marketType === "handicap_result") {
      bet.selection = readValue("football-edit-betting-selection");
      bet.awayBonus = readNumber("football-edit-betting-away-bonus");
      bet.homeBonus = readNumber("football-edit-betting-home-bonus");
    }
    if (marketType === "total_over_under") {
      bet.selection = readValue("football-edit-betting-selection");
      bet.line = readNumber("football-edit-betting-line");
    }
    if (marketType === "team_total_over_under") {
      bet.team = readValue("football-edit-betting-team");
      bet.selection = readValue("football-edit-betting-selection");
      bet.line = readNumber("football-edit-betting-line");
    }
    if (marketType === "team_odd_even") {
      bet.team = readValue("football-edit-betting-team");
      bet.selection = readValue("football-edit-betting-selection");
    }
    if (marketType === "exact_total_goals") bet.goalCount = readNumber("football-edit-betting-goal-count");
    if (marketType === "exact_team_goals") {
      bet.team = readValue("football-edit-betting-team");
      bet.goalCount = readNumber("football-edit-betting-goal-count");
    }
    if (marketType === "exact_score") {
      bet.homeGoals = readNumber("football-edit-betting-home-goals");
      bet.awayGoals = readNumber("football-edit-betting-away-goals");
    }
    if (marketType === "result_btts") {
      bet.selection = readValue("football-edit-betting-selection");
      bet.btts = readValue("football-edit-betting-btts");
    }
    return bet;
  }

  /** 潛在收益：時間／空間 O(1)。 */
  function updatePotentialPreview() {
    const output = byId("football-edit-betting-potential");
    if (!output) return;
    const potential = footballBettingModel.calculatePotentialProfit(
      readNumber("football-edit-betting-stake"),
      readNumber("football-edit-betting-odds")
    );
    output.textContent = potential == null ? "潛在收益：—" : `潛在收益：${formatMoney(potential, true)}（不含本金）`;
  }

  /** 建立總計卡：時間／空間 O(1)。 */
  function createTotal(label, value) {
    const item = documentRef.createElement("div");
    item.className = "football-edit-betting-total";
    const small = documentRef.createElement("small");
    small.textContent = label;
    const strong = documentRef.createElement("strong");
    strong.textContent = value;
    item.append(small, strong);
    return item;
  }

  /**
   * 投注清單與總計。
   * 時間／DOM 空間 O(b)。
   */
  function renderBetList() {
    const list = byId("football-edit-betting-list");
    const totals = byId("football-edit-betting-totals");
    if (!list || !totals) return;
    const record = currentRecord();
    if (!state.bets.length) {
      const empty = documentRef.createElement("p");
      empty.className = "football-edit-betting-empty";
      empty.textContent = "目前沒有投注紀錄。可留白，不影響塔羅驗證。";
      list.replaceChildren(empty);
    } else {
      const items = state.bets.map((bet) => {
        const item = documentRef.createElement("article");
        item.className = "football-edit-bet-item";
        const copy = documentRef.createElement("div");
        const title = documentRef.createElement("strong");
        title.textContent = footballBettingModel.describeBet(bet, record?.match || {});
        const detail = documentRef.createElement("small");
        const settlement = footballBettingModel.settleBet(bet, record?.actual);
        const profitText = ["won", "lost", "void"].includes(settlement.status)
          ? `實際損益 ${formatMoney(settlement.profit, true)}`
          : `潛在收益 ${formatMoney(footballBettingModel.calculatePotentialProfit(bet.stake, bet.odds), true)}`;
        detail.textContent = `成本 ${formatMoney(bet.stake)}｜倍率 ${Number(bet.odds)}｜${profitText}`;
        copy.append(title, detail);

        const buttons = documentRef.createElement("div");
        buttons.className = "football-edit-bet-buttons";
        const edit = documentRef.createElement("button");
        edit.type = "button";
        edit.className = "football-small-button";
        edit.dataset.action = "edit-bet";
        edit.dataset.betId = bet.id;
        edit.textContent = "修改";
        const remove = documentRef.createElement("button");
        remove.type = "button";
        remove.className = "football-small-button";
        remove.dataset.action = "delete-bet";
        remove.dataset.betId = bet.id;
        remove.textContent = "刪除";
        buttons.append(edit, remove);
        item.append(copy, buttons);
        return item;
      });
      list.replaceChildren(...items);
    }

    const summary = footballBettingModel.summarizeBets(state.bets, record?.actual);
    const secondLabel = summary.settled ? "總損益" : "總潛在收益";
    const secondValue = summary.settled ? summary.actualProfit : summary.potentialProfit;
    totals.replaceChildren(
      createTotal("總成本", formatMoney(summary.totalStake)),
      createTotal(secondLabel, formatMoney(secondValue, true))
    );
  }

  /** 重設投注輸入：時間／空間 O(1)。 */
  function resetBetForm() {
    state.editingBetId = "";
    setValue("football-edit-betting-category", FOOTBALL_BET_CATEGORIES[0].id);
    renderMarketOptions();
    setValue("football-edit-betting-odds", 2);
    setValue("football-edit-betting-stake", 100);
    const save = byId("football-edit-betting-upsert");
    if (save) save.textContent = "＋ 新增投注";
    byId("football-edit-betting-cancel")?.classList.add("football-hidden");
    updatePotentialPreview();
    setBetMessage("");
  }

  /** 載入單筆投注進表單：時間／空間 O(1)。 */
  function loadBetIntoForm(bet) {
    if (!bet) return;
    state.editingBetId = bet.id;
    const category = FOOTBALL_BET_MARKETS[bet.marketType]?.category || FOOTBALL_BET_CATEGORIES[0].id;
    setValue("football-edit-betting-category", category);
    renderMarketOptions(bet.marketType);
    setValue("football-edit-betting-market", bet.marketType);
    renderMarketFields(bet);
    setValue("football-edit-betting-odds", bet.odds);
    setValue("football-edit-betting-stake", bet.stake);
    const save = byId("football-edit-betting-upsert");
    if (save) save.textContent = "更新投注";
    byId("football-edit-betting-cancel")?.classList.remove("football-hidden");
    updatePotentialPreview();
    setBetMessage("正在修改這筆投注；完成後仍需按最下方「儲存修改」才會寫入紀錄。", "is-warning");
  }

  /** 新增／更新單筆投注：時間 O(b)、空間 O(b)。 */
  function upsertBet() {
    const bet = buildBetFromForm();
    const error = footballBettingModel.validateBet(bet);
    if (error) {
      setBetMessage(error, "is-error");
      return;
    }
    if (state.editingBetId) {
      state.bets = state.bets.map((item) => item.id === state.editingBetId ? bet : item);
      setBetMessage("投注已更新；按最下方「儲存修改」後才會正式保存。", "is-success");
    } else {
      state.bets = [...state.bets, bet];
      setBetMessage("投注已加入；按最下方「儲存修改」後才會正式保存。", "is-success");
    }
    renderBetList();
    resetBetForm();
  }

  /** 刪除單筆投注：時間／空間 O(b)。 */
  function removeBet(id) {
    state.bets = state.bets.filter((bet) => bet.id !== id);
    if (state.editingBetId === id) resetBetForm();
    renderBetList();
    setBetMessage("投注已移除；按最下方「儲存修改」後才會正式保存。", "is-warning");
  }

  /**
   * 建立一次投注編輯區。
   * 時間 O(c + m)，c=4、m<=7；DOM 空間同階。
   */
  function ensureBettingSection() {
    removeLegacyOddsFields();
    if (byId("football-edit-betting-fieldset")) return true;
    const scoreFieldset = byId("football-edit-score-fieldset");
    if (!scoreFieldset) return false;

    const fieldset = documentRef.createElement("fieldset");
    fieldset.id = "football-edit-betting-fieldset";
    fieldset.className = "football-model-fieldset";
    const legend = documentRef.createElement("legend");
    legend.textContent = "運彩投注（選填）";

    const heading = documentRef.createElement("div");
    heading.className = "football-edit-betting-heading";
    const copy = documentRef.createElement("div");
    const note = documentRef.createElement("p");
    note.textContent = "投注直接屬於目前牌源，可新增、修改或刪除。成本、倍率與損益皆不含本金返還；實際比分已存在時會直接顯示結算損益。";
    copy.appendChild(note);
    const badge = documentRef.createElement("span");
    badge.id = "football-edit-betting-source";
    badge.className = "football-version";
    heading.append(copy, badge);

    const grid = documentRef.createElement("div");
    grid.className = "football-edit-betting-grid";
    const category = createSelectField("分類", "football-edit-betting-category", FOOTBALL_BET_CATEGORIES.map((item) => [item.id, item.label]));
    const marketLabel = documentRef.createElement("label");
    marketLabel.textContent = "投注項目";
    const market = documentRef.createElement("select");
    market.id = "football-edit-betting-market";
    marketLabel.appendChild(market);
    const odds = createNumberField("倍率", "football-edit-betting-odds", { min: 1.01, max: 999, step: 0.01, value: 2 });
    const stake = createNumberField("成本", "football-edit-betting-stake", { min: 1, max: 100000000, step: 1, value: 100 });
    const fields = documentRef.createElement("div");
    fields.id = "football-edit-betting-fields";
    fields.className = "football-edit-betting-fields";

    const actionRow = documentRef.createElement("div");
    actionRow.className = "football-edit-betting-actions";
    const potential = documentRef.createElement("span");
    potential.id = "football-edit-betting-potential";
    potential.className = "football-edit-betting-potential";
    const actionButtons = documentRef.createElement("div");
    actionButtons.className = "football-edit-betting-actions-buttons";
    const upsert = documentRef.createElement("button");
    upsert.id = "football-edit-betting-upsert";
    upsert.type = "button";
    upsert.className = "btn ghost";
    upsert.textContent = "＋ 新增投注";
    const cancel = documentRef.createElement("button");
    cancel.id = "football-edit-betting-cancel";
    cancel.type = "button";
    cancel.className = "btn ghost football-hidden";
    cancel.textContent = "取消修改投注";
    actionButtons.append(upsert, cancel);
    actionRow.append(potential, actionButtons);

    const message = documentRef.createElement("p");
    message.id = "football-edit-betting-message";
    message.className = "football-message football-hidden";
    message.setAttribute("aria-live", "polite");
    const list = documentRef.createElement("div");
    list.id = "football-edit-betting-list";
    list.className = "football-edit-betting-list";
    const totals = documentRef.createElement("div");
    totals.id = "football-edit-betting-totals";
    totals.className = "football-edit-betting-totals";

    grid.append(category, marketLabel, odds, stake, fields, actionRow);
    fieldset.append(legend, heading, grid, message, list, totals);
    scoreFieldset.insertAdjacentElement("afterend", fieldset);
    renderMarketOptions();
    updatePotentialPreview();
    renderBetList();
    return true;
  }

  /** 載入目前牌源投注：時間／空間 O(b)。 */
  function prepareEditor(record) {
    if (!record) return;
    ensureBettingSection();
    state.recordId = record.id;
    state.bets = cloneValue(Array.isArray(record.prediction?.bets) ? record.prediction.bets : []);
    state.editingBetId = "";
    const source = byId("football-edit-betting-source");
    if (source) source.textContent = record.match?.cardSource === "random" ? "網站隨機抽牌" : "自己抽牌";
    resetBetForm();
    renderBetList();
  }

  /** 驗證整組投注：時間 O(b)、空間 O(1)。 */
  function validateBets() {
    for (let index = 0; index < state.bets.length; index += 1) {
      const error = footballBettingModel.validateBet(state.bets[index]);
      if (error) return `第 ${index + 1} 筆投注：${error}`;
    }
    return "";
  }

  /**
   * 由完整編輯表單建立更新紀錄，並覆蓋目前牌源投注。
   * 時間／空間 O(b + p)。
   */
  function buildEditedRecord(record) {
    const values = { ...baseEditor.readValues() };
    const legacyOdds = record.match?.odds || {};
    // 舊賠率欄位已從 UI 移除；保留歷史值只為相容舊資料，不再允許編輯。
    values.homeOdds = legacyOdds.home ?? "";
    values.drawOdds = legacyOdds.draw ?? "";
    values.awayOdds = legacyOdds.away ?? "";

    const updated = knockoutEditor.shouldHandle(record, values)
      ? buildKnockoutRecord(core, record, values, knockoutEditor.readStageInput())
      : buildUpdatedRecord(core, record, values);

    return {
      ...updated,
      prediction: {
        ...updated.prediction,
        bets: cloneValue(state.bets),
      },
    };
  }

  /**
   * 在 document capture 階段接管編輯表單，確保比決勝層 form capture 更早執行。
   * 時間／空間 O(b + p)，另有最多兩次網路請求。
   */
  async function handleSubmit(event) {
    const form = byId("football-edit-form");
    if (!form || event.target !== form) return;
    const recordId = readValue("football-edit-id") || state.recordId;
    const record = core.getRecord(recordId);
    if (!record) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const betsError = validateBets();
    if (betsError) {
      setMessage(betsError, "is-error");
      return;
    }

    let updatedRecord;
    try {
      updatedRecord = buildEditedRecord(record);
    } catch (error) {
      setMessage(clean(error?.message) || "修改內容不正確。", "is-error");
      return;
    }

    const saveButton = byId("football-save-edit");
    if (saveButton) saveButton.disabled = true;
    try {
      core.importRecords([updatedRecord]);
      ui.renderRecords();
      baseEditor.refresh();
      knockoutEditor.prepareEditor(updatedRecord);
      prepareEditor(updatedRecord);

      const cloudResult = await baseEditor.syncUpdatedRecord(updatedRecord);
      if (cloudResult.state === "synced") {
        setMessage("賽事資料、預測比分與運彩投注已更新，並同步到 Google 試算表。", "is-success");
      } else if (cloudResult.state === "signin-required") {
        setMessage("已保存於本機。要同步 Google 試算表，請先登入右上角帳戶，再重新按一次「儲存修改」。", "is-warning");
      } else {
        setMessage("賽事資料、預測比分與運彩投注已保存於本機。", "is-success");
      }
    } catch (error) {
      setMessage(`本機資料已保存，但雲端尚未更新：${clean(error?.message) || "同步失敗"}`, "is-warning");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  /** 固定事件綁定：時間／空間 O(1)。 */
  function bind() {
    if (bound) return api;
    bound = true;
    byId("football-records-body")?.addEventListener("click", (event) => {
      const editMatch = event.target.closest?.('button[data-action="edit-match"]');
      if (editMatch) {
        const recordId = clean(editMatch.dataset.id);
        browserWindow.setTimeout(() => prepareEditor(core.getRecord(recordId)), 0);
        return;
      }
      const action = event.target.closest?.("[data-action][data-bet-id]");
      if (!action) return;
    });

    byId("football-edit-betting-category")?.addEventListener("change", () => renderMarketOptions());
    byId("football-edit-betting-market")?.addEventListener("change", () => renderMarketFields());
    byId("football-edit-betting-odds")?.addEventListener("input", updatePotentialPreview);
    byId("football-edit-betting-stake")?.addEventListener("input", updatePotentialPreview);
    byId("football-edit-betting-upsert")?.addEventListener("click", upsertBet);
    byId("football-edit-betting-cancel")?.addEventListener("click", resetBetForm);
    byId("football-edit-betting-list")?.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-action][data-bet-id]");
      if (!target) return;
      const id = clean(target.dataset.betId);
      if (target.dataset.action === "edit-bet") {
        loadBetIntoForm(state.bets.find((bet) => bet.id === id));
      } else if (target.dataset.action === "delete-bet") {
        removeBet(id);
      }
    });
    documentRef.addEventListener("submit", handleSubmit, true);
    return api;
  }

  /** 初始化：時間／空間 O(1)。 */
  function init() {
    if (initialized) return api;
    initialized = true;
    injectStyles();
    ensureBettingSection();
    const heading = byId("football-edit-panel")?.querySelector(".football-section-heading h3");
    if (heading) heading.textContent = "編輯賽事、預測比分與運彩投注";
    const warning = byId("football-edit-panel")?.querySelector(".football-edit-warning");
    if (warning) {
      warning.textContent = "可修正賽事基本資料、四張攻防模型的預測比分與目前牌源的運彩投注；牌面、單張能量判讀、文字解讀及已輸入的實際賽果不會被清除。投注可新增、修改或刪除，最後需按「儲存修改」才會寫入紀錄。";
    }
    bind();
    return api;
  }

  const api = Object.freeze({
    core,
    ui,
    baseEditor,
    knockoutEditor,
    modelLayer: "record-betting-edit",
    init,
    bind,
    isBound: () => bound,
    ensureBettingSection,
    prepareEditor,
    renderBetList,
    renderMarketOptions,
    renderMarketFields,
    buildEditedRecord,
    handleSubmit,
  });

  if (autoInit) init();
  return api;
}
