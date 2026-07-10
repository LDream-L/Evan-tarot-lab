// 世足賽事驗證｜已鎖定紀錄編輯 UI 控制器
//
// 本層只負責編輯面板、欄位讀寫、事件委派與本機／雲端協調；
// 日期、比分與 knockout 路徑規則集中在 record-edit-model.js。
//
// 主要函式複雜度：
// - open／close／readValues／saveEditedMatch：時間／空間 O(1)，另有 record 深複製成本 O(p)。
// - refreshEditButtons：時間 O(r)、額外空間 O(r)，r = 紀錄數。
// - bind／init：時間／空間 O(1)，固定數量事件監聽器。
//
// 更快替代方案比較：
// - 每列獨立綁定按鈕會在每次重繪建立 O(r) 個監聽器。
// - 本控制器使用單一 tbody 事件委派；MutationObserver 只補上缺少的按鈕。

import {
  clean,
  optionalNumber,
  taipeiParts,
  resultText,
  buildUpdatedRecord,
} from "./record-edit-model.js";

/**
 * 建立可注入編輯控制器。
 * 建立時間／空間 O(1)。
 */
export function createFootballRecordEdit({
  core,
  ui,
  cloudProvider = () => window.FootballLabCloud,
  browserWindow = window,
  documentRef = document,
  autoInit = true,
} = {}) {
  if (!core || !ui || typeof core.getRecord !== "function" || typeof ui.renderRecords !== "function") {
    throw new Error("世足紀錄編輯層需要有效的核心與 Render。");
  }

  const byId = (id) => documentRef.getElementById(id);
  let observer = null;
  let refreshScheduled = false;
  let initialized = false;
  let bound = false;

  /** 文字欄位：時間／空間 O(n)。 */
  function readText(id) {
    return clean(byId(id)?.value);
  }

  /** 固定訊息：時間／空間 O(1)。 */
  function setMessage(message, type = "") {
    const element = byId("football-edit-message");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("football-hidden", "is-error", "is-success", "is-warning");
    if (type) element.classList.add(type);
  }

  /** 固定訊息：時間／空間 O(1)。 */
  function clearMessage() {
    const element = byId("football-edit-message");
    if (!element) return;
    element.textContent = "";
    element.classList.add("football-hidden");
    element.classList.remove("is-error", "is-success", "is-warning");
  }

  /** 固定 select 選項複製：時間／空間 O(o)，o 為固定選項數。 */
  function copySelectOptions(sourceId, targetId) {
    const source = byId(sourceId);
    const target = byId(targetId);
    if (!source || !target) return;
    target.replaceChildren(...Array.from(source.options).map((option) => option.cloneNode(true)));
  }

  /** 固定樣式：時間／空間 O(1)。 */
  function injectStyles() {
    if (byId("football-record-edit-style")) return;
    const style = documentRef.createElement("style");
    style.id = "football-record-edit-style";
    style.textContent = `
      .football-record-match-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}
      .football-record-match-header .football-record-match-title{min-width:0}
      .football-edit-inline-button{flex:0 0 auto;white-space:nowrap}
      #football-edit-panel{margin-top:1rem}
      .football-edit-warning{margin:0 0 1rem;padding:.8rem .95rem;border:1px solid rgba(255,205,112,.32);border-radius:12px;background:rgba(255,205,112,.07);font-size:.84rem;line-height:1.6}
      .football-edit-datetime{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(120px,.65fr);gap:.65rem}
      .football-edit-datetime input{min-width:0;width:100%}
      .football-edit-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.75rem;align-items:center}
      .football-edit-score-preview{display:grid;align-content:center;gap:.3rem;min-height:76px;padding:.75rem .85rem;border:1px solid rgba(127,232,190,.36);border-radius:14px;background:rgba(25,74,62,.15)}
      .football-edit-score-preview small{color:var(--text-soft,#bcb7d9)}
      .football-edit-score-preview strong{font-size:1rem}
      @media(max-width:620px){.football-record-match-header{align-items:stretch;flex-direction:column}.football-edit-inline-button{width:fit-content}.football-edit-datetime,.football-edit-actions{grid-template-columns:1fr}}
    `;
    documentRef.head.appendChild(style);
  }

  /**
   * 建立固定、無外部輸入的編輯表單。
   * 時間／空間 O(1)。
   */
  function ensureEditorPanel() {
    if (byId("football-edit-panel")) return true;
    const tableWrap = documentRef.querySelector("#football-records .football-table-wrap");
    if (!tableWrap) return false;

    const panel = documentRef.createElement("section");
    panel.id = "football-edit-panel";
    panel.className = "football-panel football-hidden";
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <div class="football-section-heading">
        <div><p class="football-eyebrow">修正紀錄</p><h3>編輯賽事與預測比分</h3></div>
        <button id="football-close-edit" class="football-link-button" type="button">關閉</button>
      </div>
      <p class="football-edit-warning">可修正賽事基本資料與四張攻防模型的預測比分；牌面、單張能量判讀、文字解讀及已輸入的實際賽果不會被清除。若比分改變決勝路徑，完整編輯層會要求補齊必要的延長賽／PK 牌組。</p>
      <form id="football-edit-form" class="football-form">
        <input id="football-edit-id" type="hidden" />
        <div class="football-form-grid">
          <label>賽事名稱<input id="football-edit-competition" type="text" maxlength="80" required /></label>
          <label>賽事階段<select id="football-edit-stage"></select></label>
          <label>開賽時間（台灣時間）<span class="football-edit-datetime"><input id="football-edit-kickoff-date" type="date" aria-label="開賽日期" required /><input id="football-edit-kickoff-time" type="time" step="60" aria-label="開賽時間" required /></span></label>
          <label>抽牌資訊狀態<select id="football-edit-info-state"></select></label>
          <label>主隊／隊伍 A<input id="football-edit-home-team" type="text" maxlength="60" required /></label>
          <label>客隊／隊伍 B<input id="football-edit-away-team" type="text" maxlength="60" required /></label>
          <label>主勝十進位賠率（選填）<input id="football-edit-home-odds" type="number" min="1.01" max="999" step="0.01" inputmode="decimal" /></label>
          <label>和局十進位賠率（選填）<input id="football-edit-draw-odds" type="number" min="1.01" max="999" step="0.01" inputmode="decimal" /></label>
          <label>客勝十進位賠率（選填）<input id="football-edit-away-odds" type="number" min="1.01" max="999" step="0.01" inputmode="decimal" /></label>
          <label class="football-span-2">賽前已知資訊（選填）<textarea id="football-edit-known-info" maxlength="500" rows="3"></textarea></label>
        </div>
        <fieldset id="football-edit-score-fieldset" class="football-model-fieldset football-hidden">
          <legend>四張攻防模型｜預測比分</legend>
          <p class="football-disclaimer">修改後會重新推導主勝、和局或客勝，並重新計算既有命中結果。</p>
          <div class="football-form-grid">
            <label><span id="football-edit-score-home-label">主隊 90 分鐘預測進球</span><input id="football-edit-structure-home-goals" type="number" min="0" max="20" step="1" inputmode="numeric" /></label>
            <label><span id="football-edit-score-away-label">客隊 90 分鐘預測進球</span><input id="football-edit-structure-away-goals" type="number" min="0" max="20" step="1" inputmode="numeric" /></label>
            <div class="football-edit-score-preview"><small>更新後的 90 分鐘預測</small><strong id="football-edit-score-preview">—</strong></div>
            <div aria-hidden="true"></div>
            <label id="football-edit-extra-home-wrap" class="football-hidden"><span id="football-edit-extra-home-label">主隊延長賽新增進球</span><input id="football-edit-extra-structure-home-goals" type="number" min="0" max="20" step="1" inputmode="numeric" /></label>
            <label id="football-edit-extra-away-wrap" class="football-hidden"><span id="football-edit-extra-away-label">客隊延長賽新增進球</span><input id="football-edit-extra-structure-away-goals" type="number" min="0" max="20" step="1" inputmode="numeric" /></label>
          </div>
        </fieldset>
        <div class="football-edit-actions"><button id="football-save-edit" class="btn primary full" type="submit">儲存修改</button><button id="football-cancel-edit" class="btn ghost" type="button">取消</button></div>
        <p id="football-edit-message" class="football-message football-hidden" aria-live="polite"></p>
      </form>
    `;

    tableWrap.insertAdjacentElement("afterend", panel);
    copySelectOptions("football-stage", "football-edit-stage");
    copySelectOptions("football-info-state", "football-edit-info-state");
    return true;
  }

  /** 固定欄位填值：時間／空間 O(1)。 */
  function fillValue(id, value) {
    const element = byId(id);
    if (element) element.value = value == null ? "" : String(value);
  }

  /** 比分預覽：時間／空間 O(1)。 */
  function refreshScorePreview() {
    const preview = byId("football-edit-score-preview");
    if (!preview) return;
    const homeRaw = readText("football-edit-structure-home-goals");
    const awayRaw = readText("football-edit-structure-away-goals");
    const home = homeRaw === "" ? null : Number(homeRaw);
    const away = awayRaw === "" ? null : Number(awayRaw);
    preview.textContent = resultText(
      core,
      Number.isInteger(home) && home >= 0 ? home : null,
      Number.isInteger(away) && away >= 0 ? away : null
    );
  }

  /** 固定預測欄位填值：時間／空間 O(1)。 */
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

  /** 打開單筆編輯：時間／空間 O(1)。 */
  function open(record) {
    ensureEditorPanel();
    const panel = byId("football-edit-panel");
    if (!panel || !record) return false;

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
    return true;
  }

  /** 關閉面板：時間／空間 O(1)。 */
  function close() {
    byId("football-edit-panel")?.classList.add("football-hidden");
    clearMessage();
  }

  /** 讀取固定欄位：時間／空間 O(1)。 */
  function readValues() {
    return {
      competition: readText("football-edit-competition"),
      stage: readText("football-edit-stage"),
      kickoffDate: readText("football-edit-kickoff-date"),
      kickoffTime: readText("football-edit-kickoff-time"),
      infoState: readText("football-edit-info-state"),
      homeTeam: readText("football-edit-home-team"),
      awayTeam: readText("football-edit-away-team"),
      homeOdds: readText("football-edit-home-odds"),
      drawOdds: readText("football-edit-draw-odds"),
      awayOdds: readText("football-edit-away-odds"),
      knownInfo: readText("football-edit-known-info"),
      structureHomeGoals: readText("football-edit-structure-home-goals"),
      structureAwayGoals: readText("football-edit-structure-away-goals"),
      extraStructureHomeGoals: readText("football-edit-extra-structure-home-goals"),
      extraStructureAwayGoals: readText("football-edit-extra-structure-away-goals"),
      extraFieldVisible: !byId("football-edit-extra-home-wrap")?.classList.contains("football-hidden"),
    };
  }

  /** 動態取得最終雲端包裝：時間／空間 O(1)。 */
  function getCloud() {
    return typeof cloudProvider === "function" ? cloudProvider() : null;
  }

  /** 完整紀錄同步：前端 O(1)，最多兩次網路請求。 */
  async function syncUpdatedRecord(record) {
    const cloud = getCloud();
    if (!cloud?.isConfigured?.()) return { state: "not-configured" };
    if (!cloud.hasToken?.()) return { state: "signin-required" };
    await cloud.saveRecord(record);
    if (record.actual) await cloud.updateActual(record.id, record.actual);
    return { state: "synced" };
  }

  /** 儲存基本資料／比分：時間／空間 O(p)，p = record 大小。 */
  async function saveEditedMatch(event) {
    event.preventDefault();
    clearMessage();
    const record = core.getRecord(readText("football-edit-id"));
    if (!record) {
      setMessage("找不到要修改的賽事紀錄，請重新整理後再試。", "is-error");
      return;
    }

    let updatedRecord;
    try {
      updatedRecord = buildUpdatedRecord(core, record, readValues());
    } catch (error) {
      setMessage(clean(error?.message) || "修改內容不正確。", "is-error");
      return;
    }

    const saveButton = byId("football-save-edit");
    if (saveButton) saveButton.disabled = true;
    try {
      core.importRecords([updatedRecord]);
      ui.renderRecords();
      refreshEditButtons();
      setMessage("賽事資料與預測比分已保存於本機；牌面、解讀與實際賽果均未變更。", "is-success");

      const cloudResult = await syncUpdatedRecord(updatedRecord);
      const cloud = getCloud();
      if (cloudResult.state === "synced") {
        setMessage("賽事資料與預測比分已更新，並同步到 Google 試算表。", "is-success");
        cloud?.setStatus?.(`「${updatedRecord.match.homeTeam} vs ${updatedRecord.match.awayTeam}」已更新賽事資料與預測比分。`, "is-success");
      } else if (cloudResult.state === "signin-required") {
        setMessage("已保存於本機。要同步 Google 試算表，請先登入右上角帳戶，再重新按一次「儲存修改」。", "is-warning");
      } else {
        setMessage("已保存於本機；目前未設定世足雲端 API。", "is-warning");
      }
    } catch (error) {
      const message = clean(error?.message) || "雲端更新失敗。";
      setMessage(`本機資料已保存，但 Google 試算表尚未更新：${message}`, "is-warning");
      getCloud()?.setStatus?.(`賽事與預測比分雲端更新失敗：${message}`, "is-error");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  /** 依 Render 排序補上編輯按鈕：時間 O(r)、額外空間 O(r)。 */
  function refreshEditButtons() {
    refreshScheduled = false;
    const body = byId("football-records-body");
    if (!body) return;
    const records = core
      .getRecords()
      .sort((left, right) => String(right.match?.kickoff || "").localeCompare(String(left.match?.kickoff || "")));

    Array.from(body.children).forEach((row, index) => {
      const record = records[index];
      const wrapper = row.children[1]?.querySelector(".football-record-match");
      const title = wrapper?.querySelector(".football-record-match-title");
      if (!record || !wrapper || !title) return;

      let header = wrapper.querySelector(".football-record-match-header");
      if (!header) {
        header = documentRef.createElement("div");
        header.className = "football-record-match-header";
        title.replaceWith(header);
        header.appendChild(title);
      }

      let button = header.querySelector('button[data-action="edit-match"]');
      if (!button) {
        button = documentRef.createElement("button");
        button.type = "button";
        button.className = "football-small-button football-edit-inline-button";
        button.dataset.action = "edit-match";
        button.textContent = "編輯";
        header.appendChild(button);
      }
      button.dataset.id = record.id;
      button.setAttribute(
        "aria-label",
        `編輯 ${record.match?.homeTeam || "主隊"} 對 ${record.match?.awayTeam || "客隊"} 的賽事資料與預測比分`
      );
    });
  }

  /** 合併同一 frame 的重複刷新：時間／空間 O(1)。 */
  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    browserWindow.requestAnimationFrame(refreshEditButtons);
  }

  /** 固定事件綁定：時間／空間 O(1)。 */
  function bind() {
    if (bound) return api;
    bound = true;
    byId("football-records-body")?.addEventListener("click", (event) => {
      const button = event.target.closest('button[data-action="edit-match"]');
      if (!button) return;
      const record = core.getRecord(clean(button.dataset.id));
      if (record) open(record);
    });
    byId("football-edit-form")?.addEventListener("submit", saveEditedMatch);
    byId("football-close-edit")?.addEventListener("click", close);
    byId("football-cancel-edit")?.addEventListener("click", close);
    byId("football-edit-structure-home-goals")?.addEventListener("input", refreshScorePreview);
    byId("football-edit-structure-away-goals")?.addEventListener("input", refreshScorePreview);
    return api;
  }

  /** 初始化：時間／空間 O(1)。 */
  function init() {
    if (initialized) return api;
    initialized = true;
    injectStyles();
    if (!ensureEditorPanel()) return api;
    bind();
    const body = byId("football-records-body");
    if (body) {
      observer = new browserWindow.MutationObserver(scheduleRefresh);
      observer.observe(body, { childList: true, subtree: true });
      scheduleRefresh();
    }
    return api;
  }

  /** 解除 observer：時間／空間 O(1)。 */
  function destroy() {
    observer?.disconnect();
    observer = null;
  }

  const api = Object.freeze({
    core,
    ui,
    init,
    destroy,
    bind,
    isBound: () => bound,
    ensureEditorPanel,
    open,
    close,
    refresh: scheduleRefresh,
    refreshNow: refreshEditButtons,
    refreshScorePreview,
    readValues,
    syncUpdatedRecord,
    saveEditedMatch,
  });

  if (autoInit) init();
  return api;
}
