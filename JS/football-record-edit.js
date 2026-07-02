// 世足賽事驗證 v1.6.1｜已鎖定賽事基本資料編輯
//
// 主要函式複雜度：
// - refreshEditButtons：O(r) 時間／O(r) DOM 對照空間，r=目前紀錄數。
// - openEditor、buildUpdatedMatch、saveEditedMatch：O(1) 時間／O(1) 額外空間。
//
// 更快替代方案比較：
// - 逐列綁定事件：每次重繪都要重新建立 r 個監聽器。
// - 本版：使用單一事件委派與 MutationObserver，只補上缺少的編輯按鈕，避免重複綁定。
(function initFootballRecordEdit() {
  "use strict";

  const core = window.FootballLabCore;
  const ui = window.FootballLabRender;
  if (!core || !ui) return;

  const byId = (id) => document.getElementById(id);
  const TAIPEI_TIME_ZONE = "Asia/Taipei";
  const TAIPEI_OFFSET = "+08:00";
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
          <h3>編輯賽事基本資料</h3>
        </div>
        <button id="football-close-edit" class="football-link-button" type="button">關閉</button>
      </div>
      <p class="football-edit-warning">只會修正賽事名稱、階段、時間、隊名、賠率與賽前資訊；已鎖定牌面、預測，以及已輸入的 90 分鐘、120 分鐘與 PK 結果都不會被清除。請勿在這裡對調主客隊；若原本主客順序填反，應刪除後重新建立。</p>
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

  async function parseCloudResponse(response) {
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`雲端回應不是有效 JSON（HTTP ${response.status}）。`);
    }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `雲端請求失敗（HTTP ${response.status}）。`);
    }
    return payload;
  }

  async function updateCloudMatch(recordId, match) {
    const config = window.EVAN_CLOUD_CONFIG || {};
    const apiUrl = clean(config.footballApiUrl);
    const idToken = clean(window.EvanGoogleAuth?.getCredential?.());
    if (!apiUrl) return { state: "not-configured" };
    if (!idToken) return { state: "signin-required" };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "updateMatch", idToken, recordId, match }),
      redirect: "follow",
    });
    const payload = await parseCloudResponse(response);
    return { state: "synced", result: payload.result };
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

    const updatedMatch = buildUpdatedMatch(record);
    const validationError = core.validateMatch(updatedMatch);
    if (validationError) {
      setMessage(validationError, "is-error");
      return;
    }

    const saveButton = byId("football-save-edit");
    if (saveButton) saveButton.disabled = true;

    try {
      const updatedRecord = {
        ...record,
        match: updatedMatch,
        updatedAt: new Date().toISOString(),
      };
      core.importRecords([updatedRecord]);
      ui.renderRecords();
      refreshEditButtons();

      setMessage("賽事基本資料已保存於本機；牌面、預測與賽果均未變更。", "is-success");
      const cloudResult = await updateCloudMatch(recordId, updatedMatch);
      if (cloudResult.state === "synced") {
        setMessage("賽事基本資料已更新，並同步到 Google 試算表；牌面、預測與賽果均未變更。", "is-success");
        window.FootballLabCloud?.setStatus?.(`「${updatedMatch.homeTeam} vs ${updatedMatch.awayTeam}」的賽事基本資料已更新。`, "is-success");
      } else if (cloudResult.state === "signin-required") {
        setMessage("已保存於本機。要同步 Google 試算表，請先登入右上角帳戶，再重新按一次「儲存修改」。", "is-warning");
      } else {
        setMessage("已保存於本機；目前未設定世足雲端 API。", "is-warning");
      }
    } catch (error) {
      const message = clean(error?.message) || "雲端更新失敗。";
      setMessage(`本機資料已保存，但 Google 試算表尚未更新：${message}`, "is-warning");
      window.FootballLabCloud?.setStatus?.(`賽事基本資料雲端更新失敗：${message}`, "is-error");
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
        button.setAttribute("aria-label", `編輯 ${record.match?.homeTeam || "主隊"} 對 ${record.match?.awayTeam || "客隊"} 的賽事基本資料`);
        header.appendChild(button);
      }
      button.dataset.id = record.id;
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
