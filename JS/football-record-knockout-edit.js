// ==============================
// football-record-knockout-edit.js
// 世足賽事驗證：單一編輯面板內補建延長賽／PK 牌組
// ==============================
// 主要函式複雜度：
// - prepareEditor：O(p + d)，p<=10、d=78（建立選牌選項）。
// - buildUpdatedRecord：O(p)，p<=10。
// - validateStageCards：O(p)，p<=5。
// 空間複雜度：O(p + d)。
//
// 更快替代方案比較：
// - 改成刪除整筆後重建：程式較簡單，但會破壞既有牌面、解讀、實際結果與紀錄 ID。
// - 本版：只在比分改為和局時補建缺少的階段，保留原紀錄並沿用同一個編輯入口。
// ==============================

(function initFootballRecordKnockoutEdit() {
  "use strict";

  const core = window.FootballLabCore;
  const ui = window.FootballLabRender;
  if (!core || !ui) return;

  const ADVANCE_SCOPE = "advance";
  const EXTRA_RULE = "extra-time-then-penalties";
  const PENALTY_RULE = "penalties-only";
  const VALID_RESULTS = new Set(["H", "D", "A"]);
  const VALID_WINNERS = new Set(["H", "A"]);
  const KNOCKOUT_STAGES = new Set(["32強", "16強", "8強", "準決賽", "季軍賽", "決賽"]);

  const EXTRA_SPECS = Object.freeze([
    ["extraResult", "延長賽單張", "direct"],
    ["extraHomeAttack", "主隊延長賽進攻", "structure"],
    ["extraAwayDefense", "客隊延長賽防守", "structure"],
    ["extraAwayAttack", "客隊延長賽進攻", "structure"],
    ["extraHomeDefense", "主隊延長賽防守", "structure"],
  ]);

  const PENALTY_SPECS = Object.freeze([
    ["homeShooters", "主隊罰球穩定度"],
    ["homeKeeper", "主隊門將表現"],
    ["awayShooters", "客隊罰球穩定度"],
    ["awayKeeper", "客隊門將表現"],
    ["penaltyResult", "PK 最終結果牌"],
  ]);

  const state = {
    recordId: "",
    source: "manual",
    mode: "dual",
    extraCards: null,
    penaltyCards: null,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function readText(id) {
    return clean(byId(id)?.value);
  }

  function readInteger(id, label) {
    const raw = readText(id);
    const value = Number(raw);
    if (raw === "" || !Number.isInteger(value) || value < 0 || value > 20) {
      throw new Error(`請填寫有效的「${label}」（0～20）。`);
    }
    return value;
  }

  function cloneValue(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function setMessage(message, type = "") {
    const element = byId("football-edit-message");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("football-hidden", "is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  function option(value, label) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }

  function secureRandomInt(maxExclusive) {
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    let value;
    do {
      window.crypto.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % maxExclusive;
  }

  /** 部分 Fisher-Yates：O(d + p) 時間／O(d) 空間。 */
  function drawCards(specs) {
    const pool = core.data.deck.slice();
    return specs.map((spec, index) => {
      const swapIndex = index + secureRandomInt(pool.length - index);
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
      return {
        position: spec[0],
        title: spec[1],
        name: pool[index],
        orientation: secureRandomInt(2) === 0 ? "正位" : "逆位",
      };
    });
  }

  function specsFor(stage) {
    if (stage === "penalty") return PENALTY_SPECS;
    return EXTRA_SPECS.filter((spec) => (
      (spec[2] === "direct" && core.modeIncludesDirect(state.mode))
      || (spec[2] === "structure" && core.modeIncludesStructure(state.mode))
    ));
  }

  function stageCardsFromRecord(record, stage) {
    const cards = stage === "extra"
      ? record?.prediction?.knockout?.stages?.extraTime?.cards
      : record?.prediction?.knockout?.stages?.penalties?.cards;
    return Array.isArray(cards) ? cloneValue(cards) : null;
  }

  function injectStyles() {
    if (byId("football-record-knockout-edit-style")) return;
    const style = document.createElement("style");
    style.id = "football-record-knockout-edit-style";
    style.textContent = `
      .football-edit-knockout-stage {
        display: grid;
        gap: 0.9rem;
        margin-top: 1rem;
        padding: 1rem;
        border: 1px solid rgba(176, 145, 255, 0.28);
        border-radius: 15px;
        background: rgba(255, 255, 255, 0.018);
      }
      .football-edit-knockout-heading {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.8rem;
        flex-wrap: wrap;
      }
      .football-edit-knockout-heading h4,
      .football-edit-knockout-heading p {
        margin: 0;
      }
      .football-edit-knockout-heading p {
        margin-top: 0.3rem;
        font-size: 0.82rem;
        opacity: 0.72;
      }
      .football-edit-stage-cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.7rem;
      }
      .football-edit-stage-card {
        display: grid;
        align-content: start;
        gap: 0.55rem;
        min-width: 0;
        padding: 0.8rem;
        border: 1px solid rgba(176, 145, 255, 0.24);
        border-radius: 13px;
        background: rgba(5, 5, 24, 0.22);
      }
      .football-edit-stage-card strong {
        overflow-wrap: anywhere;
      }
      .football-edit-stage-card select {
        min-width: 0;
        width: 100%;
      }
      .football-edit-stage-random {
        display: grid;
        gap: 0.35rem;
      }
      .football-edit-stage-random span {
        font-size: 0.75rem;
        opacity: 0.7;
      }
      .football-edit-stage-warning {
        margin: 0;
        padding: 0.7rem 0.8rem;
        border-left: 3px solid rgba(244, 190, 107, 0.76);
        border-radius: 8px;
        background: rgba(244, 190, 107, 0.07);
        font-size: 0.82rem;
        line-height: 1.55;
      }
      @media (max-width: 980px) {
        .football-edit-stage-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 620px) {
        .football-edit-stage-cards { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureStageSections() {
    const form = byId("football-edit-form");
    const scoreFieldset = byId("football-edit-score-fieldset");
    if (!form || !scoreFieldset || byId("football-edit-extra-stage")) return;

    const extra = document.createElement("section");
    extra.id = "football-edit-extra-stage";
    extra.className = "football-edit-knockout-stage football-hidden";
    extra.innerHTML = `
      <div class="football-edit-knockout-heading">
        <div>
          <h4>C｜延長賽 30 分鐘</h4>
          <p>90 分鐘任一模型判斷和局時，在同一筆紀錄內補建延長賽牌組。</p>
        </div>
      </div>
      <p class="football-edit-stage-warning">這是新增階段，不會修改原本 90 分鐘的牌面與解讀。</p>
      <div id="football-edit-extra-cards" class="football-edit-stage-cards"></div>
      <div class="football-form-grid">
        <label id="football-edit-extra-direct-result-wrap">
          延長賽單張結果
          <select id="football-edit-extra-direct-result">
            <option value="">請選擇</option>
            <option value="H">主隊勝</option>
            <option value="D">和局</option>
            <option value="A">客隊勝</option>
          </select>
        </label>
        <label id="football-edit-extra-home-score-wrap">
          主隊延長賽新增進球
          <input id="football-edit-stage-extra-home" type="number" min="0" max="20" step="1" inputmode="numeric" />
        </label>
        <label id="football-edit-extra-away-score-wrap">
          客隊延長賽新增進球
          <input id="football-edit-stage-extra-away" type="number" min="0" max="20" step="1" inputmode="numeric" />
        </label>
        <label id="football-edit-extra-direct-notes-wrap" class="football-span-2">
          延長賽單張解讀
          <textarea id="football-edit-extra-direct-notes" rows="3"></textarea>
        </label>
        <label id="football-edit-extra-structure-notes-wrap" class="football-span-2">
          延長賽攻防解讀
          <textarea id="football-edit-extra-structure-notes" rows="4"></textarea>
        </label>
      </div>
    `;

    const penalty = document.createElement("section");
    penalty.id = "football-edit-penalty-stage";
    penalty.className = "football-edit-knockout-stage football-hidden";
    penalty.innerHTML = `
      <div class="football-edit-knockout-heading">
        <div>
          <h4>D｜PK 大戰</h4>
          <p>延長賽仍為和局，或賽制為 90 分鐘後直接 PK 時補建。</p>
        </div>
      </div>
      <div id="football-edit-penalty-cards" class="football-edit-stage-cards"></div>
      <div class="football-form-grid">
        <label>
          PK 最終勝者
          <select id="football-edit-penalty-winner">
            <option value="">請選擇</option>
            <option value="H">主隊晉級</option>
            <option value="A">客隊晉級</option>
          </select>
        </label>
        <label class="football-span-2">
          PK 牌面解讀
          <textarea id="football-edit-penalty-notes" rows="4"></textarea>
        </label>
      </div>
    `;

    scoreFieldset.insertAdjacentElement("afterend", extra);
    extra.insertAdjacentElement("afterend", penalty);
  }

  function createManualCard(stage, spec, savedCard) {
    const article = document.createElement("article");
    article.className = "football-edit-stage-card";
    const title = document.createElement("strong");
    title.textContent = spec[1];

    const cardSelect = document.createElement("select");
    cardSelect.id = `football-edit-${stage}-card-${spec[0]}`;
    cardSelect.appendChild(option("", "選擇抽到的牌"));
    core.data.deck.forEach((name) => cardSelect.appendChild(option(name, name)));
    cardSelect.value = savedCard?.name || "";

    const orientation = document.createElement("select");
    orientation.id = `football-edit-${stage}-orientation-${spec[0]}`;
    orientation.append(option("正位", "正位"), option("逆位", "逆位"));
    orientation.value = savedCard?.orientation || "正位";

    article.append(title, cardSelect, orientation);
    return article;
  }

  function createRandomCard(spec, card) {
    const article = document.createElement("article");
    article.className = "football-edit-stage-card";
    const title = document.createElement("strong");
    title.textContent = spec[1];
    const random = document.createElement("div");
    random.className = "football-edit-stage-random";
    random.append(
      document.createTextNode(card?.name || "—"),
      Object.assign(document.createElement("span"), { textContent: card?.orientation || "—" })
    );
    article.append(title, random);
    return article;
  }

  function ensureStageCards(stage) {
    const specs = specsFor(stage);
    const key = stage === "extra" ? "extraCards" : "penaltyCards";
    if (!state[key] && state.source === "random") state[key] = drawCards(specs);
    if (!state[key]) state[key] = [];

    const container = byId(`football-edit-${stage}-cards`);
    if (!container) return;
    const savedByPosition = new Map(state[key].map((card) => [card.position, card]));
    const fragment = document.createDocumentFragment();
    specs.forEach((spec) => {
      const saved = savedByPosition.get(spec[0]);
      fragment.appendChild(state.source === "random"
        ? createRandomCard(spec, saved)
        : createManualCard(stage, spec, saved));
    });
    container.replaceChildren(fragment);
  }

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

  function resultsFor(mode, directResult, home, away) {
    const results = [];
    if (core.modeIncludesDirect(mode) && VALID_RESULTS.has(directResult)) results.push(directResult);
    if (core.modeIncludesStructure(mode) && Number.isInteger(home) && Number.isInteger(away)) {
      results.push(core.getResult(home, away));
    }
    return results;
  }

  function hasDraw(results) {
    return results.includes("D");
  }

  function consensusWinner(results) {
    const decided = results.filter((result) => result !== "D");
    return decided.length && decided.every((result) => result === decided[0]) ? decided[0] : "";
  }

  function baseResults(record) {
    const home = Number(readText("football-edit-structure-home-goals"));
    const away = Number(readText("football-edit-structure-away-goals"));
    return resultsFor(
      state.mode,
      record.prediction?.directResult,
      Number.isInteger(home) ? home : null,
      Number.isInteger(away) ? away : null
    );
  }

  function extraResults() {
    const home = Number(readText("football-edit-stage-extra-home"));
    const away = Number(readText("football-edit-stage-extra-away"));
    return resultsFor(
      state.mode,
      readText("football-edit-extra-direct-result"),
      Number.isInteger(home) ? home : null,
      Number.isInteger(away) ? away : null
    );
  }

  function refreshStageVisibility() {
    const record = core.getRecord(state.recordId);
    if (!record) return;

    const knockoutEligible = record.match?.predictionScope === ADVANCE_SCOPE
      || Boolean(record.prediction?.knockout)
      || KNOCKOUT_STAGES.has(readText("football-edit-stage"));
    const baseDraw = knockoutEligible && hasDraw(baseResults(record));
    const rule = record.match?.knockoutRule || record.prediction?.knockout?.rule || EXTRA_RULE;
    const showExtra = baseDraw && rule !== PENALTY_RULE;

    byId("football-edit-extra-stage")?.classList.toggle("football-hidden", !showExtra);
    if (showExtra) ensureStageCards("extra");

    const showPenalty = baseDraw && (rule === PENALTY_RULE || (showExtra && hasDraw(extraResults())));
    byId("football-edit-penalty-stage")?.classList.toggle("football-hidden", !showPenalty);
    if (showPenalty) ensureStageCards("penalty");
  }

  function fillStageValues(record) {
    const extra = record.prediction?.knockout?.stages?.extraTime || {};
    const penalties = record.prediction?.knockout?.stages?.penalties || {};

    byId("football-edit-extra-direct-result").value = extra.directResult || "";
    byId("football-edit-stage-extra-home").value = Number.isInteger(extra.structureHomeGoals) ? extra.structureHomeGoals : "";
    byId("football-edit-stage-extra-away").value = Number.isInteger(extra.structureAwayGoals) ? extra.structureAwayGoals : "";
    byId("football-edit-extra-direct-notes").value = extra.directNotes || "";
    byId("football-edit-extra-structure-notes").value = extra.structureNotes || "";
    byId("football-edit-penalty-winner").value = penalties.winner || "";
    byId("football-edit-penalty-notes").value = penalties.notes || "";

    byId("football-edit-extra-direct-result-wrap")?.classList.toggle("football-hidden", !core.modeIncludesDirect(state.mode));
    byId("football-edit-extra-direct-notes-wrap")?.classList.toggle("football-hidden", !core.modeIncludesDirect(state.mode));
    byId("football-edit-extra-home-score-wrap")?.classList.toggle("football-hidden", !core.modeIncludesStructure(state.mode));
    byId("football-edit-extra-away-score-wrap")?.classList.toggle("football-hidden", !core.modeIncludesStructure(state.mode));
    byId("football-edit-extra-structure-notes-wrap")?.classList.toggle("football-hidden", !core.modeIncludesStructure(state.mode));
  }

  /** 單一編輯面板初始化：O(p+d) 時間／O(p+d) 空間。 */
  function prepareEditor(record) {
    if (!record) return;
    ensureStageSections();

    state.recordId = record.id;
    state.source = record.match?.cardSource || "manual";
    state.mode = core.getMode(record);
    state.extraCards = stageCardsFromRecord(record, "extra");
    state.penaltyCards = stageCardsFromRecord(record, "penalty");

    setStageLabels(record);
    fillStageValues(record);
    if (state.extraCards) ensureStageCards("extra");
    if (state.penaltyCards) ensureStageCards("penalty");
    refreshStageVisibility();
  }

  function collectStageCards(stage) {
    const specs = specsFor(stage);
    const key = stage === "extra" ? "extraCards" : "penaltyCards";
    if (state.source === "random") return cloneValue(state[key] || []);

    return specs.map((spec) => ({
      position: spec[0],
      title: spec[1],
      name: readText(`football-edit-${stage}-card-${spec[0]}`),
      orientation: readText(`football-edit-${stage}-orientation-${spec[0]}`),
    }));
  }

  /** 同階段查表驗證：O(p) 時間／O(p) 空間，p<=5。 */
  function validateStageCards(cards, stageLabel) {
    const used = new Set();
    for (const card of cards) {
      if (!core.data.deck.includes(card.name)) throw new Error(`請完整記錄「${card.title}」。`);
      if (card.orientation !== "正位" && card.orientation !== "逆位") throw new Error(`請選擇「${card.title}」正逆位。`);
      if (used.has(card.name)) throw new Error(`「${card.name}」在${stageLabel}牌組中重複出現。`);
      used.add(card.name);
    }
  }

  function buildUpdatedMatch(record) {
    const date = readText("football-edit-kickoff-date");
    const time = readText("football-edit-kickoff-time");
    const kickoffDate = new Date(`${date}T${time}:00+08:00`);
    const numberOrNull = (id) => {
      const raw = readText(id);
      const value = Number(raw);
      return raw === "" || !Number.isFinite(value) ? null : value;
    };

    return {
      ...record.match,
      competition: readText("football-edit-competition"),
      stage: readText("football-edit-stage"),
      kickoff: Number.isNaN(kickoffDate.getTime()) ? "" : kickoffDate.toISOString(),
      infoState: readText("football-edit-info-state"),
      homeTeam: readText("football-edit-home-team"),
      awayTeam: readText("football-edit-away-team"),
      odds: {
        home: numberOrNull("football-edit-home-odds"),
        draw: numberOrNull("football-edit-draw-odds"),
        away: numberOrNull("football-edit-away-odds"),
      },
      knownInfo: readText("football-edit-known-info"),
    };
  }

  function buildExtraStage() {
    const cards = collectStageCards("extra");
    validateStageCards(cards, "延長賽");
    const extra = { cards };

    if (core.modeIncludesDirect(state.mode)) {
      extra.directResult = readText("football-edit-extra-direct-result");
      extra.directNotes = readText("football-edit-extra-direct-notes");
      if (!VALID_RESULTS.has(extra.directResult) || !extra.directNotes) {
        throw new Error("請完成延長賽單張結果與解讀。");
      }
    }
    if (core.modeIncludesStructure(state.mode)) {
      extra.structureHomeGoals = readInteger("football-edit-stage-extra-home", "延長賽主隊新增進球");
      extra.structureAwayGoals = readInteger("football-edit-stage-extra-away", "延長賽客隊新增進球");
      extra.structureNotes = readText("football-edit-extra-structure-notes");
      if (!extra.structureNotes) throw new Error("請完成延長賽攻防解讀。");
    }
    return extra;
  }

  function buildPenaltyStage() {
    const cards = collectStageCards("penalty");
    validateStageCards(cards, "PK");
    const winner = readText("football-edit-penalty-winner");
    const notes = readText("football-edit-penalty-notes");
    if (!VALID_WINNERS.has(winner) || !notes) throw new Error("請完成 PK 最終勝者與牌面解讀。");
    return { cards, winner, notes };
  }

  /** 依目前比分建立完整階段資料：O(p) 時間／O(p) 空間。 */
  function buildUpdatedRecord(record) {
    const match = buildUpdatedMatch(record);
    const matchError = core.validateMatch(match);
    if (matchError) throw new Error(matchError);

    const prediction = cloneValue(record.prediction || {});
    if (core.modeIncludesStructure(state.mode)) {
      prediction.structureHomeGoals = readInteger("football-edit-structure-home-goals", "90 分鐘主隊預測進球");
      prediction.structureAwayGoals = readInteger("football-edit-structure-away-goals", "90 分鐘客隊預測進球");
    }

    const knockoutEligible = match.predictionScope === ADVANCE_SCOPE
      || Boolean(prediction.knockout)
      || KNOCKOUT_STAGES.has(match.stage);
    if (!knockoutEligible) {
      delete prediction.knockout;
      return { ...record, match, prediction, updatedAt: new Date().toISOString() };
    }

    match.predictionScope = ADVANCE_SCOPE;
    match.knockoutRule = match.knockoutRule || prediction.knockout?.rule || EXTRA_RULE;
    const baseStageResults = resultsFor(
      state.mode,
      prediction.directResult,
      prediction.structureHomeGoals,
      prediction.structureAwayGoals
    );
    const stages = {};
    const route = ["regulation"];
    let resolvedBy = "regulation";
    let finalAdvance = consensusWinner(baseStageResults) || prediction.advance || prediction.knockout?.finalAdvance || "";

    if (hasDraw(baseStageResults)) {
      if (match.knockoutRule === PENALTY_RULE) {
        const penalties = buildPenaltyStage();
        stages.penalties = penalties;
        route.push("penalties");
        resolvedBy = "penalties";
        finalAdvance = penalties.winner;
      } else {
        const extraTime = buildExtraStage();
        stages.extraTime = extraTime;
        route.push("extraTime");
        resolvedBy = "extraTime";
        const extraStageResults = resultsFor(
          state.mode,
          extraTime.directResult,
          extraTime.structureHomeGoals,
          extraTime.structureAwayGoals
        );
        finalAdvance = consensusWinner(extraStageResults) || finalAdvance;

        if (hasDraw(extraStageResults)) {
          const penalties = buildPenaltyStage();
          stages.penalties = penalties;
          route.push("penalties");
          resolvedBy = "penalties";
          finalAdvance = penalties.winner;
        }
      }
    }

    prediction.advance = finalAdvance;
    prediction.knockout = {
      version: prediction.knockout?.version || "1.0.0",
      rule: match.knockoutRule,
      route,
      stages,
      finalAdvance,
      resolvedBy,
    };

    return { ...record, match, prediction, updatedAt: new Date().toISOString() };
  }

  async function syncRecord(record) {
    const cloud = window.FootballLabCloud;
    if (!cloud?.isConfigured?.()) return "not-configured";
    if (!cloud.hasToken?.()) return "signin-required";
    await cloud.saveRecord(record);
    if (record.actual) await cloud.updateActual(record.id, record.actual);
    return "synced";
  }

  async function handleSubmit(event) {
    const form = byId("football-edit-form");
    if (!form || event.target !== form || !state.recordId) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const record = core.getRecord(state.recordId);
    if (!record) {
      setMessage("找不到要修改的賽事紀錄，請重新整理後再試。", "is-error");
      return;
    }

    let updatedRecord;
    try {
      updatedRecord = buildUpdatedRecord(record);
    } catch (error) {
      setMessage(clean(error?.message) || "修改內容不正確。", "is-error");
      return;
    }

    const saveButton = byId("football-save-edit");
    if (saveButton) saveButton.disabled = true;
    try {
      core.importRecords([updatedRecord]);
      ui.renderRecords();
      window.FootballLabRecordEdit?.refresh?.();
      prepareEditor(updatedRecord);

      const cloudState = await syncRecord(updatedRecord);
      if (cloudState === "synced") {
        setMessage("賽事資料、預測比分與後續牌組已更新，並同步到 Google 試算表。", "is-success");
      } else if (cloudState === "signin-required") {
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

  function bindEvents() {
    const body = byId("football-records-body");
    body?.addEventListener("click", (event) => {
      const button = event.target.closest('button[data-action="edit-match"]');
      if (!button) return;
      const recordId = clean(button.dataset.id);
      window.setTimeout(() => prepareEditor(core.getRecord(recordId)), 0);
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
  }

  function init() {
    injectStyles();
    ensureStageSections();
    bindEvents();
  }

  init();
})();