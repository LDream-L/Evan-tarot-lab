// 世足賽事驗證 v1.6.3｜已鎖定賽事基本資料與預測比分編輯
//
// 主要函式複雜度：
// - refreshEditButtons：O(r) 時間／O(r) DOM 對照空間，r=目前紀錄數。
// - openEditor、buildUpdatedMatch、buildUpdatedPrediction、saveEditedMatch：O(1) 時間／O(1) 額外空間。
//
// 更快替代方案比較：
// - 逐列綁定事件：每次重繪都要重新建立 r 個監聽器。
// - 本版：使用單一事件委派與 MutationObserver，只補上缺少的編輯按鈕；比分修改直接更新結構化 prediction，不解析畫面文字。
(function initFootballRecordEdit() {
  "use strict";

  const core = window.FootballLabCore;
  const ui = window.FootballLabRender;
  if (!core || !ui) return;

  const byId = (id) => document.getElementById(id);
  const TAIPEI_TIME_ZONE = "Asia/Taipei";
  const TAIPEI_OFFSET = "+08:00";
  const VALID_RESULTS = new Set(["H", "D", "A"]);
  let observer = null;
  let refreshScheduled = false;

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function readText(id) {
    return clean(byId(id)?.value);
  }

  function readOptionalNumber(id) {
    const raw = readText(id);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function readNonNegativeInteger(id, label) {
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

  function clearMessage() {
    const element = byId("football-edit-message");
    if (!element) return;
    element.textContent = "";
    element.classList.add("football-hidden");
    element.classList.remove("is-error", "is-success", "is-warning");
  }

  function copySelectOptions(sourceId, targetId) {
    const source = byId(sourceId);
    const target = byId(targetId);
    if (!source || !target) return;
    target.replaceChildren(...Array.from(source.options).map((option) => option.cloneNode(true)));
  }

  function injectStyles() {
    if (byId("football-record-edit-style")) return;
    const style = document.createElement("style");
    style.id = "football-record-edit-style";
    style.textContent = `
      .football-record-match-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .football-record-match-header .football-record-match-title {
        min-width: 0;
      }
      .football-edit-inline-button {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      #football-edit-panel {
        margin-top: 1rem;
      }
      .football-edit-warning {
        margin: 0 0 1rem;
        padding: 0.8rem 0.95rem;
        border: 1px solid rgba(255, 205, 112, 0.32);
        border-radius: 12px;
        background: rgba(255, 205, 112, 0.07);
        font-size: 0.84rem;
        line-height: 1.6;
      }
      .football-edit-datetime {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(120px, 0.65fr);
        gap: 0.65rem;
      }
      .football-edit-datetime input {
        min-width: 0;
        width: 100%;
      }
      .football-edit-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.75rem;
        align-items: center;
      }
      .football-edit-score-preview {
        display: grid;
        align-content: center;
        gap: 0.3rem;
        min-height: 76px;
        padding: 0.75rem 0.85rem;
        border: 1px solid rgba(127, 232, 190, 0.36);
        border-radius: 14px;
        background: rgba(25, 74, 62, 0.15);
      }
      .football-edit-score-preview small {
        color: var(--text-soft, #bcb7d9);
      }
      .football-edit-score-preview strong {
        font-size: 1rem;
      }
      @media (max-width: 620px) {
        .football-record-match-header {
          align-items: stretch;
          flex-direction: column;
        }
        .football-edit-inline-button {
          width: fit-content;
        }
        .football-edit-datetime,
        .football-edit-actions {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureEditorPanel() {
    if (byId("football-edit-panel")) return;
    const tableWrap = document.querySelector("#football-records .football-table-wrap");
    if (!tableWrap) return;

    const panel = document.createElement("section");
    panel.id = "football-edit-panel";
    panel.className = "football-panel football-hidden";
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <div class="football-section-heading">
        <div>
          <p class="football-eyebrow">修正紀錄</p>
          <h3>編輯賽事與預測比分</h3>
        </div>
        <button id="football-close-edit" class="football-link-button" type="button">關閉</button>
      </div>
      <p class="football-edit-warning">可修正賽事基本資料與四張攻防模型的預測比分；牌面、單張能量判讀、文字解讀及已輸入的實際賽果不會被清除。若把原本需要延長賽的預測改成 90 分鐘分勝負，未啟動的延長賽／PK 預測會依新比分移除。</p>
      <form id="football-edit-form" class="football-form">
        <input id="football-edit-id" type="hidden" />
        <div class="football-form-grid">
          <label>
            賽事名稱
            <input id="football-edit-competition" type="text" maxlength="80" required />
          </label>
          <label>
            賽事階段
            <select id="football-edit-stage"></select>
          </label>
          <label>
            開賽時間（台灣時間）
            <span class="football-edit-datetime">
              <input id="football-edit-kickoff-date" type="date" aria-label="開賽日期" required />
              <input id="football-edit-kickoff-time" type="time" step="60" aria-label="開賽時間" required />
            </span>
          </label>
          <label>
            抽牌資訊狀態
            <select id="football-edit-info-state"></select>
          </label>
          <label>
            主隊／隊伍 A
            <input id="football-edit-home-team" type="text" maxlength="60" required />
          </label>
          <label>
            客隊／隊伍 B
            <input id="football-edit-away-team" type="text" maxlength="60" required />
          </label>
          <label>
            主勝十進位賠率（選填）
            <input id="football-edit-home-odds" type="number" min="1.01" max="999" step="0.01" inputmode="decimal" />
          </label>
          <label>
            和局十進位賠率（選填）
            <input id="football-edit-draw-odds" type="number" min="1.01" max="999" step="0.01" inputmode="decimal" />
          </label>
          <label>
            客勝十進位賠率（選填）
            <input id="football-edit-away-odds" type="number" min="1.01" max="999" step="0.01" inputmode="decimal" />
          </label>
          <label class="football-span-2">
            賽前已知資訊（選填）
            <textarea id="football-edit-known-info" maxlength="500" rows="3"></textarea>
          </label>
        </div>

        <fieldset id="football-edit-score-fieldset" class="football-model-fieldset football-hidden">
          <legend>四張攻防模型｜預測比分</legend>
          <p class="football-disclaimer">修改後會重新推導主勝、和局或客勝，並重新計算既有命中結果。</p>
          <div class="football-form-grid">
            <label>
              <span id="football-edit-score-home-label">主隊 90 分鐘預測進球</span>
              <input id="football-edit-structure-home-goals" type="number" min="0" max="20" step="1" inputmode="numeric" />
            </label>
            <label>
              <span id="football-edit-score-away-label">客隊 90 分鐘預測進球</span>
              <input id="football-edit-structure-away-goals" type="number" min="0" max="20" step="1" inputmode="numeric" />
            </label>
            <div class="football-edit-score-preview">
              <small>更新後的 90 分鐘預測</small>
              <strong id="football-edit-score-preview">—</strong>
            </div>
            <div aria-hidden="true"></div>
            <label id="football-edit-extra-home-wrap" class="football-hidden">
              <span id="football-edit-extra-home-label">主隊延長賽新增進球</span>
              <input id="football-edit-extra-structure-home-goals" type="number" min="0" max="20" step="1" inputmode="numeric" />
            </label>
            <label id="football-edit-extra-away-wrap" class="football-hidden">
              <span id="football-edit-extra-away-label">客隊延長賽新增進球</span>
              <input id="football-edit-extra-structure-away-goals" type="number" min="0" max="20" step="1" inputmode="numeric" />
            </label>
          </div>
        </fieldset>

        <div class="football-edit-actions">
          <button id="football-save-edit" class="btn primary full" type="submit">儲存修改</button>
          <button id="football-cancel-edit" class="btn ghost" type="button">取消</button>
        </div>
        <p id="football-edit-message" class="football-message football-hidden" aria-live="polite"></p>
      </form>
    `;

    tableWrap.insertAdjacentElement("afterend", panel);
    copySelectOptions("football-stage", "football-edit-stage");
    copySelectOptions("football-info-state", "football-edit-info-state");
  }

  function taipeiParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: "", time: "" };
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TAIPEI_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      time: `${map.hour}:${map.minute}`,
    };
  }

  function taipeiInputToIso(dateValue, timeValue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) return "";
    const date = new Date(`${dateValue}T${timeValue}:00${TAIPEI_OFFSET}`);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function fillValue(id, value) {
    const element = byId(id);
    if (element) element.value = value == null ? "" : String(value);
  }

  function resultText(home, away) {
    if (!Number.isInteger(home) || !Number.isInteger(away)) return "請填寫兩隊進球";
    const result = core.getResult(home, away);
    return `${home}：${away}｜${core.data.resultLabels[result] || "—"}`;
  }

  function refreshScorePreview() {
    const preview = byId("football-edit-score-preview");
    if (!preview) return;
    const homeRaw = readText("football-edit-structure-home-goals");
    const awayRaw = readText("football-edit-structure-away-goals");
    const home = homeRaw === "" ? null : Number(homeRaw);
    const away = awayRaw === "" ? null : Number(awayRaw);
    preview.textContent = resultText(
      Number.isInteger(home) && home >= 0 ? home : null,
      Number.isInteger(away) && away >= 0 ? away : null
    );
  }

  /** 固定欄位填值：O(1) 時間／O(1) 空間。 */
  function fillPredictionFields(record) {
    const fieldset = byId("football-edit-score-fieldset");
    const prediction = record?.prediction || {};
    const mode = core.getMode(record);
    const editable = mode !== "legacy5"
      && core.modeIncludesStructure(mode)
      && Number.isInteger(prediction.structureHomeGoals)
      && Number.isInteger(prediction.structureAwayGoals);

    fieldset?.classList.toggle("football-hidden", !editable);
    if (!editable) return;

    const homeTeam = record.match?.homeTeam || "主隊";
    const awayTeam = record.match?.awayTeam || "客隊";
    byId("football-edit-score-home-label").textContent = `${homeTeam} 90 分鐘預測進球`;
    byId("football-edit-score-away-label").textContent = `${awayTeam} 90 分鐘預測進球`;
    fillValue("football-edit-structure-home-goals", prediction.structureHomeGoals);
    fillValue("football-edit-structure-away-goals", prediction.structureAwayGoals);

    const extra = prediction.knockout?.stages?.extraTime;
    const hasExtraStructure = Number.isInteger(extra?.structureHomeGoals)
      && Number.isInteger(extra?.structureAwayGoals);
    byId("football-edit-extra-home-wrap")?.classList.toggle("football-hidden", !hasExtraStructure);
    byId("football-edit-extra-away-wrap")?.classList.toggle("football-hidden", !hasExtraStructure);
    byId("football-edit-extra-home-label").textContent = `${homeTeam} 延長賽新增進球`;
    byId("football-edit-extra-away-label").textContent = `${awayTeam} 延長賽新增進球`;
    fillValue("football-edit-extra-structure-home-goals", hasExtraStructure ? extra.structureHomeGoals : "");
    fillValue("football-edit-extra-structure-away-goals", hasExtraStructure ? extra.structureAwayGoals : "");
    refreshScorePreview();
  }

  function openEditor(record) {
    ensureEditorPanel();
    const panel = byId("football-edit-panel");
    if (!panel || !record) return;

    const kickoff = taipeiParts(record.match?.kickoff);
    const odds = record.match?.odds || {};
    fillValue("football-edit-id", record.id);
    fillValue("football-edit-competition", record.match?.competition);
    fillValue("football-edit-stage", record.match?.stage);
    fillValue("football-edit-kickoff-date", kickoff.date);
    fillValue("football-edit-kickoff-time", kickoff.time);
    fillValue("football-edit-info-state", record.match?.infoState);
    fillValue("football-edit-home-team", record.match?.homeTeam);
    fillValue("football-edit-away-team", record.match?.awayTeam);
    fillValue("football-edit-home-odds", odds.home);
    fillValue("football-edit-draw-odds", odds.draw);
    fillValue("football-edit-away-odds", odds.away);
    fillValue("football-edit-known-info", record.match?.knownInfo);
    fillPredictionFields(record);
    clearMessage();
    panel.classList.remove("football-hidden");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor() {
    byId("football-edit-panel")?.classList.add("football-hidden");
    clearMessage();
  }

  function buildUpdatedMatch(record) {
    const kickoff = taipeiInputToIso(
      readText("football-edit-kickoff-date"),
      readText("football-edit-kickoff-time")
    );
    return {
      ...record.match,
      competition: readText("football-edit-competition"),
      stage: readText("football-edit-stage"),
      kickoff,
      infoState: readText("football-edit-info-state"),
      homeTeam: readText("football-edit-home-team"),
      awayTeam: readText("football-edit-away-team"),
      odds: {
        home: readOptionalNumber("football-edit-home-odds"),
        draw: readOptionalNumber("football-edit-draw-odds"),
        away: readOptionalNumber("football-edit-away-odds"),
      },
      knownInfo: readText("football-edit-known-info"),
    };
  }

  function stageResults(mode, prediction, structureHomeGoals, structureAwayGoals, stage = "regulation") {
    const results = [];
    const directResult = stage === "regulation"
      ? prediction.directResult
      : prediction.knockout?.stages?.extraTime?.directResult;
    if (core.modeIncludesDirect(mode) && VALID_RESULTS.has(directResult)) results.push(directResult);
    if (core.modeIncludesStructure(mode)) results.push(core.getResult(structureHomeGoals, structureAwayGoals));
    return results;
  }

  function consensusWinner(results) {
    const decided = results.filter((result) => result !== "D");
    return decided.length && decided.every((result) => result === decided[0]) ? decided[0] : "";
  }

  function normalizeRegulationRoute(prediction, mode, homeGoals, awayGoals) {
    const knockout = prediction.knockout;
    if (!knockout) return;

    const results = stageResults(mode, prediction, homeGoals, awayGoals);
    if (results.includes("D")) {
      const hasExtra = Boolean(knockout.stages?.extraTime);
      const hasPenalties = Boolean(knockout.stages?.penalties);
      if (!hasExtra && !hasPenalties) {
        throw new Error("將 90 分鐘預測改成和局會啟動延長賽／PK，但這筆紀錄沒有後續牌組；請刪除後重新建立該場預測。");
      }
      knockout.route = ["regulation", ...(hasExtra ? ["extraTime"] : []), ...(hasPenalties ? ["penalties"] : [])];
      knockout.resolvedBy = hasPenalties ? "penalties" : "extraTime";
      return;
    }

    const winner = consensusWinner(results);
    knockout.route = ["regulation"];
    knockout.stages = {};
    knockout.resolvedBy = "regulation";
    if (winner) {
      knockout.finalAdvance = winner;
      prediction.advance = winner;
    }
  }

  function normalizeExtraTimeRoute(prediction, mode, homeGoals, awayGoals) {
    const knockout = prediction.knockout;
    const extra = knockout?.stages?.extraTime;
    if (!knockout || !extra) return;

    const results = stageResults(mode, prediction, homeGoals, awayGoals, "extraTime");
    if (results.includes("D")) {
      const penalties = knockout.stages?.penalties;
      if (!penalties) {
        throw new Error("將延長賽預測改成和局會啟動 PK，但這筆紀錄沒有 PK 牌組；請刪除後重新建立該場預測。");
      }
      knockout.route = ["regulation", "extraTime", "penalties"];
      knockout.resolvedBy = "penalties";
      if (VALID_RESULTS.has(penalties.winner) && penalties.winner !== "D") {
        knockout.finalAdvance = penalties.winner;
        prediction.advance = penalties.winner;
      }
      return;
    }

    const winner = consensusWinner(results);
    delete knockout.stages.penalties;
    knockout.route = ["regulation", "extraTime"];
    knockout.resolvedBy = "extraTime";
    if (winner) {
      knockout.finalAdvance = winner;
      prediction.advance = winner;
    }
  }

  /** 只修改結構化比分，牌面與解讀原文保留：O(1) 時間／O(1) 空間。 */
  function buildUpdatedPrediction(record) {
    const prediction = cloneValue(record.prediction || {});
    const mode = core.getMode(record);
    if (mode === "legacy5" || !core.modeIncludesStructure(mode)) return prediction;

    const homeGoals = readNonNegativeInteger("football-edit-structure-home-goals", "90 分鐘主隊預測進球");
    const awayGoals = readNonNegativeInteger("football-edit-structure-away-goals", "90 分鐘客隊預測進球");
    prediction.structureHomeGoals = homeGoals;
    prediction.structureAwayGoals = awayGoals;
    normalizeRegulationRoute(prediction, mode, homeGoals, awayGoals);

    const extra = prediction.knockout?.stages?.extraTime;
    const extraFieldVisible = !byId("football-edit-extra-home-wrap")?.classList.contains("football-hidden");
    if (extra && extraFieldVisible) {
      const extraHome = readNonNegativeInteger("football-edit-extra-structure-home-goals", "延長賽主隊新增進球");
      const extraAway = readNonNegativeInteger("football-edit-extra-structure-away-goals", "延長賽客隊新增進球");
      extra.structureHomeGoals = extraHome;
      extra.structureAwayGoals = extraAway;
      normalizeExtraTimeRoute(prediction, mode, extraHome, extraAway);
    }

    return prediction;
  }

  /** 完整紀錄同步：O(1) 前端運算／最多兩次網路請求。 */
  async function syncUpdatedRecord(record) {
    const cloud = window.FootballLabCloud;
    if (!cloud?.isConfigured?.()) return { state: "not-configured" };
    if (!cloud.hasToken?.()) return { state: "signin-required" };
    await cloud.saveRecord(record);
    if (record.actual) await cloud.updateActual(record.id, record.actual);
    return { state: "synced" };
  }

  async function saveEditedMatch(event) {
    event.preventDefault();
    clearMessage();

    const recordId = readText("football-edit-id");
    const record = core.getRecord(recordId);
    if (!record) {
      setMessage("找不到要修改的賽事紀錄，請重新整理後再試。", "is-error");
      return;
    }

    let updatedMatch;
    let updatedPrediction;
    try {
      updatedMatch = buildUpdatedMatch(record);
      const validationError = core.validateMatch(updatedMatch);
      if (validationError) throw new Error(validationError);
      updatedPrediction = buildUpdatedPrediction(record);
    } catch (error) {
      setMessage(clean(error?.message) || "修改內容不正確。", "is-error");
      return;
    }

    const saveButton = byId("football-save-edit");
    if (saveButton) saveButton.disabled = true;

    const updatedRecord = {
      ...record,
      match: updatedMatch,
      prediction: updatedPrediction,
      updatedAt: new Date().toISOString(),
    };

    try {
      core.importRecords([updatedRecord]);
      ui.renderRecords();
      refreshEditButtons();

      setMessage("賽事資料與預測比分已保存於本機；牌面、解讀與實際賽果均未變更。", "is-success");
      const cloudResult = await syncUpdatedRecord(updatedRecord);
      if (cloudResult.state === "synced") {
        setMessage("賽事資料與預測比分已更新，並同步到 Google 試算表。", "is-success");
        window.FootballLabCloud?.setStatus?.(`「${updatedMatch.homeTeam} vs ${updatedMatch.awayTeam}」已更新賽事資料與預測比分。`, "is-success");
      } else if (cloudResult.state === "signin-required") {
        setMessage("已保存於本機。要同步 Google 試算表，請先登入右上角帳戶，再重新按一次「儲存修改」。", "is-warning");
      } else {
        setMessage("已保存於本機；目前未設定世足雲端 API。", "is-warning");
      }
    } catch (error) {
      const message = clean(error?.message) || "雲端更新失敗。";
      setMessage(`本機資料已保存，但 Google 試算表尚未更新：${message}`, "is-warning");
      window.FootballLabCloud?.setStatus?.(`賽事與預測比分雲端更新失敗：${message}`, "is-error");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  /** 單次依現有排序補上編輯按鈕：O(r) 時間／O(r) 對照空間。 */
  function refreshEditButtons() {
    refreshScheduled = false;
    const body = byId("football-records-body");
    if (!body) return;

    const records = core
      .getRecords()
      .sort((a, b) => String(b.match?.kickoff || "").localeCompare(String(a.match?.kickoff || "")));

    Array.from(body.children).forEach((row, index) => {
      const record = records[index];
      const wrapper = row.children[1]?.querySelector(".football-record-match");
      const title = wrapper?.querySelector(".football-record-match-title");
      if (!record || !wrapper || !title) return;

      let header = wrapper.querySelector(".football-record-match-header");
      if (!header) {
        header = document.createElement("div");
        header.className = "football-record-match-header";
        title.replaceWith(header);
        header.appendChild(title);
      }

      let button = header.querySelector('button[data-action="edit-match"]');
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "football-small-button football-edit-inline-button";
        button.dataset.action = "edit-match";
        button.textContent = "編輯";
        header.appendChild(button);
      }
      button.dataset.id = record.id;
      button.setAttribute("aria-label", `編輯 ${record.match?.homeTeam || "主隊"} 對 ${record.match?.awayTeam || "客隊"} 的賽事資料與預測比分`);
    });
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    window.requestAnimationFrame(refreshEditButtons);
  }

  function bindEvents() {
    byId("football-records-body")?.addEventListener("click", (event) => {
      const button = event.target.closest('button[data-action="edit-match"]');
      if (!button) return;
      const record = core.getRecord(clean(button.dataset.id));
      if (record) openEditor(record);
    });

    byId("football-edit-form")?.addEventListener("submit", saveEditedMatch);
    byId("football-close-edit")?.addEventListener("click", closeEditor);
    byId("football-cancel-edit")?.addEventListener("click", closeEditor);
    byId("football-edit-structure-home-goals")?.addEventListener("input", refreshScorePreview);
    byId("football-edit-structure-away-goals")?.addEventListener("input", refreshScorePreview);
  }

  function init() {
    injectStyles();
    ensureEditorPanel();
    bindEvents();

    const body = byId("football-records-body");
    if (!body) return;
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(body, { childList: true, subtree: true });
    scheduleRefresh();
  }

  window.FootballLabRecordEdit = Object.freeze({
    open: (recordId) => openEditor(core.getRecord(recordId)),
    close: closeEditor,
    refresh: scheduleRefresh,
  });

  init();
})();