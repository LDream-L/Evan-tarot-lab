// 世足賽事驗證｜延長賽與 PK 編輯轉接層
//
// 本層沿用基礎 record editor 的賽事欄位、訊息、同步與重繪能力；
// 只補建決勝階段欄位、收集牌面，並在淘汰賽紀錄提交時於 capture 階段接管。
//
// 主要函式複雜度：
// - prepareEditor／refreshStageVisibility：時間 O(p+d)、空間 O(p+d)，僅缺少階段時建立牌組。
// - collectStageCards／renderStageCards：時間 O(p*d)、DOM 空間 O(p*d)，手動選牌需輸出 p*78 個 option。
// - handleSubmit：時間／空間 O(p)，另有最多兩次網路請求。
// - bind：時間／空間 O(1)，固定事件數量。
//
// 更快替代方案比較：
// - 舊版每次比分 input 都 replaceChildren 重建選牌 DOM。
// - 本版以 stage signature 查表；同一紀錄、來源與牌位不變時直接沿用現有 DOM。

import {
  EXTRA_RULE,
  PENALTY_RULE,
  KNOCKOUT_STAGES,
  specsFor,
  drawCards,
  stageCardsFromRecord,
  resultsFor,
  hasDraw,
  isKnockoutEligible,
  buildKnockoutRecord,
} from "./record-knockout-edit-model.js";

/** 建立可注入的決勝階段編輯器。建立時間／空間 O(1)。 */
export function createFootballRecordKnockoutEdit({
  core,
  ui,
  baseEditor,
  browserWindow = window,
  documentRef = document,
  cryptoProvider = () => browserWindow.crypto,
  autoInit = true,
} = {}) {
  if (
    !core
    || !ui
    || !baseEditor
    || typeof baseEditor.readValues !== "function"
    || typeof baseEditor.syncUpdatedRecord !== "function"
  ) {
    throw new Error("世足決勝編輯層需要核心、Render 與基礎編輯器。");
  }

  const state = {
    recordId: "",
    source: "manual",
    mode: "dual",
    extraCards: null,
    penaltyCards: null,
  };
  let initialized = false;
  let bound = false;

  const byId = (id) => documentRef.getElementById(id);
  const clean = (value) => String(value == null ? "" : value).trim();
  const readText = (id) => clean(byId(id)?.value);

  /** 無偏差安全整數：期望時間 O(1)、空間 O(1)。 */
  function secureRandomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("亂數上限必須是正整數。");
    }
    const cryptoObject = cryptoProvider();
    if (!cryptoObject?.getRandomValues) throw new Error("瀏覽器不支援安全亂數。");
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    let value;
    do {
      cryptoObject.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % maxExclusive;
  }

  /** 訊息更新：時間／空間 O(1)。 */
  function setMessage(message, type = "") {
    const element = byId("football-edit-message");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("football-hidden", "is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  /** 固定 option：時間／空間 O(1)。 */
  function option(value, label) {
    const element = documentRef.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }

  /** 固定樣式：時間／空間 O(1)。 */
  function injectStyles() {
    if (byId("football-record-knockout-edit-style")) return;
    const style = documentRef.createElement("style");
    style.id = "football-record-knockout-edit-style";
    style.textContent = `
      .football-edit-knockout-stage{display:grid;gap:.9rem;margin-top:1rem;padding:1rem;border:1px solid rgba(176,145,255,.28);border-radius:15px;background:rgba(255,255,255,.018)}
      .football-edit-knockout-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;flex-wrap:wrap}
      .football-edit-knockout-heading h4,.football-edit-knockout-heading p{margin:0}
      .football-edit-knockout-heading p{margin-top:.3rem;font-size:.82rem;opacity:.72}
      .football-edit-stage-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem}
      .football-edit-stage-card{display:grid;align-content:start;gap:.55rem;min-width:0;padding:.8rem;border:1px solid rgba(176,145,255,.24);border-radius:13px;background:rgba(5,5,24,.22)}
      .football-edit-stage-card strong{overflow-wrap:anywhere}
      .football-edit-stage-card select{min-width:0;width:100%}
      .football-edit-stage-random{display:grid;gap:.35rem}
      .football-edit-stage-random span{font-size:.75rem;opacity:.7}
      .football-edit-stage-warning{margin:0;padding:.7rem .8rem;border-left:3px solid rgba(244,190,107,.76);border-radius:8px;background:rgba(244,190,107,.07);font-size:.82rem;line-height:1.55}
      @media(max-width:980px){.football-edit-stage-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.football-edit-stage-cards{grid-template-columns:1fr}}
    `;
    documentRef.head.appendChild(style);
  }

  /** 建立固定決勝欄位：時間／空間 O(1)。 */
  function ensureStageSections() {
    const scoreFieldset = byId("football-edit-score-fieldset");
    if (!scoreFieldset || byId("football-edit-extra-stage")) return Boolean(scoreFieldset);

    const extra = documentRef.createElement("section");
    extra.id = "football-edit-extra-stage";
    extra.className = "football-edit-knockout-stage football-hidden";
    extra.innerHTML = `
      <div class="football-edit-knockout-heading"><div><h4>C｜延長賽 30 分鐘</h4><p>90 分鐘任一模型判斷和局時，在同一筆紀錄內補建延長賽牌組。</p></div></div>
      <p class="football-edit-stage-warning">這是新增階段，不會修改原本 90 分鐘的牌面與解讀。</p>
      <div id="football-edit-extra-cards" class="football-edit-stage-cards"></div>
      <div class="football-form-grid">
        <label id="football-edit-extra-direct-result-wrap">延長賽單張結果<select id="football-edit-extra-direct-result"><option value="">請選擇</option><option value="H">主隊勝</option><option value="D">和局</option><option value="A">客隊勝</option></select></label>
        <label id="football-edit-extra-home-score-wrap">主隊延長賽新增進球<input id="football-edit-stage-extra-home" type="number" min="0" max="20" step="1" inputmode="numeric" /></label>
        <label id="football-edit-extra-away-score-wrap">客隊延長賽新增進球<input id="football-edit-stage-extra-away" type="number" min="0" max="20" step="1" inputmode="numeric" /></label>
        <label id="football-edit-extra-direct-notes-wrap" class="football-span-2">延長賽單張解讀<textarea id="football-edit-extra-direct-notes" rows="3"></textarea></label>
        <label id="football-edit-extra-structure-notes-wrap" class="football-span-2">延長賽攻防解讀<textarea id="football-edit-extra-structure-notes" rows="4"></textarea></label>
      </div>
    `;

    const penalty = documentRef.createElement("section");
    penalty.id = "football-edit-penalty-stage";
    penalty.className = "football-edit-knockout-stage football-hidden";
    penalty.innerHTML = `
      <div class="football-edit-knockout-heading"><div><h4>D｜PK 大戰</h4><p>延長賽仍為和局，或賽制為 90 分鐘後直接 PK 時補建。</p></div></div>
      <div id="football-edit-penalty-cards" class="football-edit-stage-cards"></div>
      <div class="football-form-grid">
        <label>PK 最終勝者<select id="football-edit-penalty-winner"><option value="">請選擇</option><option value="H">主隊晉級</option><option value="A">客隊晉級</option></select></label>
        <label class="football-span-2">PK 牌面解讀<textarea id="football-edit-penalty-notes" rows="4"></textarea></label>
      </div>
    `;

    scoreFieldset.insertAdjacentElement("afterend", extra);
    extra.insertAdjacentElement("afterend", penalty);
    return true;
  }

  /** 手動牌欄：時間／空間 O(d)，d=78 options。 */
  function createManualCard(stage, spec, savedCard) {
    const article = documentRef.createElement("article");
    article.className = "football-edit-stage-card";
    const title = documentRef.createElement("strong");
    title.textContent = spec[1];
    const cardSelect = documentRef.createElement("select");
    cardSelect.id = `football-edit-${stage}-card-${spec[0]}`;
    cardSelect.appendChild(option("", "選擇抽到的牌"));
    core.data.deck.forEach((name) => cardSelect.appendChild(option(name, name)));
    cardSelect.value = savedCard?.name || "";
    const orientation = documentRef.createElement("select");
    orientation.id = `football-edit-${stage}-orientation-${spec[0]}`;
    orientation.append(option("正位", "正位"), option("逆位", "逆位"));
    orientation.value = savedCard?.orientation || "正位";
    article.append(title, cardSelect, orientation);
    return article;
  }

  /** 隨機牌顯示：時間／空間 O(1)。 */
  function createRandomCard(spec, card) {
    const article = documentRef.createElement("article");
    article.className = "football-edit-stage-card";
    const title = documentRef.createElement("strong");
    title.textContent = spec[1];
    const random = documentRef.createElement("div");
    random.className = "football-edit-stage-random";
    const orientation = documentRef.createElement("span");
    orientation.textContent = card?.orientation || "—";
    random.append(documentRef.createTextNode(card?.name || "—"), orientation);
    article.append(title, random);
    return article;
  }

  /** 只在 signature 改變時建立階段 DOM：時間 O(p*d)、空間 O(p*d)。 */
  function renderStageCards(stage) {
    const specs = specsFor(core, state.mode, stage);
    const key = stage === "extra" ? "extraCards" : "penaltyCards";
    if (!state[key] && state.source === "random") {
      state[key] = drawCards(core.data.deck, specs, secureRandomInt);
    }
    if (!state[key]) state[key] = [];

    const container = byId(`football-edit-${stage}-cards`);
    if (!container) return;
    const signature = `${state.recordId}|${state.source}|${state.mode}|${specs.map((spec) => spec[0]).join(",")}`;
    if (container.dataset.renderSignature === signature && container.children.length === specs.length) return;

    const savedByPosition = new Map(state[key].map((card) => [card.position, card]));
    const fragment = documentRef.createDocumentFragment();
    specs.forEach((spec) => {
      const saved = savedByPosition.get(spec[0]);
      fragment.appendChild(
        state.source === "random"
          ? createRandomCard(spec, saved)
          : createManualCard(stage, spec, saved)
      );
    });
    container.replaceChildren(fragment);
    container.dataset.renderSignature = signature;
  }

  /** 依隊名更新固定選項：時間／空間 O(1)。 */
  function setStageLabels(record) {
    const home = record.match?.homeTeam || "主隊";
    const away = record.match?.awayTeam || "客隊";
    const direct = byId("football-edit-extra-direct-result");
    if (direct?.options[1]) direct.options[1].textContent = `${home} 勝`;
    if (direct?.options[3]) direct.options[3].textContent = `${away} 勝`;
    const penalty = byId("football-edit-penalty-winner");
    if (penalty?.options[1]) penalty.options[1].textContent = `${home} 晉級`;
    if (penalty?.options[2]) penalty.options[2].textContent = `${away} 晉級`;
  }

  /** 讀取整數或 null：時間／空間 O(1)。 */
  function integerOrNull(id) {
    const raw = readText(id);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isInteger(value) ? value : null;
  }

  /** 目前 90 分鐘模型結果：時間／空間 O(1)。 */
  function regulationResults(record) {
    return resultsFor(
      core,
      state.mode,
      record.prediction?.directResult,
      integerOrNull("football-edit-structure-home-goals"),
      integerOrNull("football-edit-structure-away-goals")
    );
  }

  /** 目前延長賽模型結果：時間／空間 O(1)。 */
  function extraResults() {
    return resultsFor(
      core,
      state.mode,
      readText("football-edit-extra-direct-result"),
      integerOrNull("football-edit-stage-extra-home"),
      integerOrNull("football-edit-stage-extra-away")
    );
  }

  /** 只在必要時顯示並建立後續階段：時間 O(p+d)、空間 O(p+d)。 */
  function refreshStageVisibility() {
    const record = core.getRecord(state.recordId);
    if (!record) return;
    const editedMatch = { ...record.match, stage: readText("football-edit-stage") };
    const eligible = isKnockoutEligible(editedMatch, record.prediction);
    const baseDraw = eligible && hasDraw(regulationResults(record));
    const rule = record.match?.knockoutRule || record.prediction?.knockout?.rule || EXTRA_RULE;
    const showExtra = baseDraw && rule !== PENALTY_RULE;
    byId("football-edit-extra-stage")?.classList.toggle("football-hidden", !showExtra);
    if (showExtra) renderStageCards("extra");

    const showPenalty = baseDraw && (
      rule === PENALTY_RULE
      || (showExtra && hasDraw(extraResults()))
    );
    byId("football-edit-penalty-stage")?.classList.toggle("football-hidden", !showPenalty);
    if (showPenalty) renderStageCards("penalty");
  }

  /** 填入既有階段資料：時間／空間 O(1)。 */
  function fillStageValues(record) {
    const extra = record.prediction?.knockout?.stages?.extraTime || {};
    const penalties = record.prediction?.knockout?.stages?.penalties || {};
    byId("football-edit-extra-direct-result").value = extra.directResult || "";
    byId("football-edit-stage-extra-home").value = Number.isInteger(extra.structureHomeGoals)
      ? extra.structureHomeGoals
      : "";
    byId("football-edit-stage-extra-away").value = Number.isInteger(extra.structureAwayGoals)
      ? extra.structureAwayGoals
      : "";
    byId("football-edit-extra-direct-notes").value = extra.directNotes || "";
    byId("football-edit-extra-structure-notes").value = extra.structureNotes || "";
    byId("football-edit-penalty-winner").value = penalties.winner || "";
    byId("football-edit-penalty-notes").value = penalties.notes || "";

    const direct = core.modeIncludesDirect(state.mode);
    const structure = core.modeIncludesStructure(state.mode);
    byId("football-edit-extra-direct-result-wrap")?.classList.toggle("football-hidden", !direct);
    byId("football-edit-extra-direct-notes-wrap")?.classList.toggle("football-hidden", !direct);
    byId("football-edit-extra-home-score-wrap")?.classList.toggle("football-hidden", !structure);
    byId("football-edit-extra-away-score-wrap")?.classList.toggle("football-hidden", !structure);
    byId("football-edit-extra-structure-notes-wrap")?.classList.toggle("football-hidden", !structure);
  }

  /** 準備同一編輯面板：時間 O(p+d)、空間 O(p+d)。 */
  function prepareEditor(record) {
    if (!record || !ensureStageSections()) return false;
    state.recordId = record.id;
    state.source = record.match?.cardSource || "manual";
    state.mode = core.getMode(record);
    state.extraCards = stageCardsFromRecord(record, "extra");
    state.penaltyCards = stageCardsFromRecord(record, "penalty");

    ["extra", "penalty"].forEach((stage) => {
      const container = byId(`football-edit-${stage}-cards`);
      if (container) container.dataset.renderSignature = "";
    });
    setStageLabels(record);
    fillStageValues(record);
    if (state.extraCards) renderStageCards("extra");
    if (state.penaltyCards) renderStageCards("penalty");
    refreshStageVisibility();
    return true;
  }

  /** 收集單一階段牌組：時間／空間 O(p)。 */
  function collectStageCards(stage) {
    const specs = specsFor(core, state.mode, stage);
    const key = stage === "extra" ? "extraCards" : "penaltyCards";
    if (state.source === "random") return structuredClone(state[key] || []);
    return specs.map((spec) => ({
      position: spec[0],
      title: spec[1],
      name: readText(`football-edit-${stage}-card-${spec[0]}`),
      orientation: readText(`football-edit-${stage}-orientation-${spec[0]}`),
    }));
  }

  /** 建立模型所需階段輸入：時間／空間 O(p)。 */
  function readStageInput() {
    return {
      extra: {
        cards: collectStageCards("extra"),
        directResult: readText("football-edit-extra-direct-result"),
        directNotes: readText("football-edit-extra-direct-notes"),
        structureHomeGoals: readText("football-edit-stage-extra-home"),
        structureAwayGoals: readText("football-edit-stage-extra-away"),
        structureNotes: readText("football-edit-extra-structure-notes"),
      },
      penalty: {
        cards: collectStageCards("penalty"),
        winner: readText("football-edit-penalty-winner"),
        notes: readText("football-edit-penalty-notes"),
      },
    };
  }

  /** 判斷這次提交是否應由決勝層接管：時間／空間 O(1)。 */
  function shouldHandle(record, baseValues) {
    const editedMatch = { ...record.match, stage: baseValues.stage };
    return isKnockoutEligible(editedMatch, record.prediction);
  }

  /** 決勝紀錄提交：時間／空間 O(p)，另有最多兩次網路請求。 */
  async function handleSubmit(event) {
    const form = byId("football-edit-form");
    if (!form || event.target !== form || !state.recordId) return;
    const record = core.getRecord(state.recordId);
    if (!record) return;
    const baseValues = baseEditor.readValues();
    if (!shouldHandle(record, baseValues)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    let updatedRecord;
    try {
      updatedRecord = buildKnockoutRecord(core, record, baseValues, readStageInput());
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
      prepareEditor(updatedRecord);
      const cloudResult = await baseEditor.syncUpdatedRecord(updatedRecord);
      if (cloudResult.state === "synced") {
        setMessage("賽事資料、預測比分與後續牌組已更新，並同步到 Google 試算表。", "is-success");
      } else if (cloudResult.state === "signin-required") {
        setMessage("已保存於本機。要同步 Google 試算表，請先登入右上角帳戶。", "is-warning");
      } else {
        setMessage("賽事資料、預測比分與後續牌組已保存於本機。", "is-success");
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
      const button = event.target.closest('button[data-action="edit-match"]');
      if (!button) return;
      const recordId = clean(button.dataset.id);
      browserWindow.setTimeout(() => prepareEditor(core.getRecord(recordId)), 0);
    });

    [
      "football-edit-structure-home-goals",
      "football-edit-structure-away-goals",
      "football-edit-extra-direct-result",
      "football-edit-stage-extra-home",
      "football-edit-stage-extra-away",
      "football-edit-stage",
    ].forEach((id) => {
      byId(id)?.addEventListener("input", refreshStageVisibility);
      byId(id)?.addEventListener("change", refreshStageVisibility);
    });
    byId("football-edit-form")?.addEventListener("submit", handleSubmit, true);
    return api;
  }

  /** 初始化：時間／空間 O(1)。 */
  function init() {
    if (initialized) return api;
    initialized = true;
    injectStyles();
    ensureStageSections();
    bind();
    return api;
  }

  const api = Object.freeze({
    core,
    ui,
    baseEditor,
    modelLayer: "record-knockout-edit",
    init,
    bind,
    isBound: () => bound,
    prepareEditor,
    refreshStageVisibility,
    collectStageCards,
    readStageInput,
    shouldHandle,
    handleSubmit,
  });

  if (autoInit) init();
  return api;
}
