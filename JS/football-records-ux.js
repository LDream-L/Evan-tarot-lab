// ==============================
// football-records-ux.js
// 世足賽事驗證：分流預測／待驗證／已驗證，並保留賽後分析
// ==============================
// 主要函式複雜度：
// - classifyRecords：O(r)
// - applyRecordView：O(r)
// - readReviewAnalysis：O(n)，n = 舊版備註字數
// 空間複雜度：O(r + n)
//
// 更快替代方案比較：
// - 原版：所有紀錄放在同一張表，並要求手動判定成功或失敗。
// - 本版：狀態單次分類；命中由既有核對結果自動呈現，人工只填回顧原因。
// ==============================

(function initFootballRecordsUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const MATCH_SETTLE_DELAY_MS = 150 * 60 * 1000;
  const LEGACY_REVIEW_OPEN = "[[EVAN_FOOTBALL_REVIEW_V1]]";
  const LEGACY_REVIEW_CLOSE = "[[/EVAN_FOOTBALL_REVIEW_V1]]";
  const STATUS_META = Object.freeze({
    forecast: {
      label: "預測中",
      note: "尚未完成比賽的鎖定預測。",
      empty: "目前沒有預測中的賽事。",
    },
    pending: {
      label: "待驗證",
      note: "比賽預計已結束，但尚未填入實際賽果。",
      empty: "目前沒有等待驗證的賽事。",
    },
    verified: {
      label: "已驗證",
      note: "已完成客觀核對，可補寫牌面對應、錯誤原因與下次調整。",
      empty: "目前還沒有已驗證的賽事。",
    },
  });

  let activeStatus = "forecast";
  let initializedView = false;
  let observer = null;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  /**
   * 新版直接讀 actual.reviewAnalysis；舊版標記僅作相容解析。
   * 時間複雜度 O(n)，空間複雜度 O(n)。
   */
  function readReviewAnalysis(record) {
    const actual = record?.actual || {};
    const directAnalysis = clean(actual.reviewAnalysis);
    if (directAnalysis) return directAnalysis;

    const notes = String(actual.notes || "");
    if (!notes.startsWith(LEGACY_REVIEW_OPEN)) return "";
    const closeIndex = notes.indexOf(LEGACY_REVIEW_CLOSE, LEGACY_REVIEW_OPEN.length);
    if (closeIndex < 0) return "";

    try {
      const payload = JSON.parse(notes.slice(LEGACY_REVIEW_OPEN.length, closeIndex));
      return clean(payload?.analysis);
    } catch (error) {
      console.warn("[football-records-ux] 舊版回顧資料解析失敗：", error);
      return "";
    }
  }

  function readEventNotes(record) {
    const notes = String(record?.actual?.notes || "");
    if (!notes.startsWith(LEGACY_REVIEW_OPEN)) return notes;
    const closeIndex = notes.indexOf(LEGACY_REVIEW_CLOSE, LEGACY_REVIEW_OPEN.length);
    if (closeIndex < 0) return notes;
    return notes.slice(closeIndex + LEGACY_REVIEW_CLOSE.length).replace(/^\r?\n/, "");
  }

  function getWorkflowStatus(record, now = Date.now()) {
    if (record?.actual) return "verified";
    const kickoff = Date.parse(record?.match?.kickoff || "");
    if (!Number.isFinite(kickoff)) return "forecast";
    return kickoff + MATCH_SETTLE_DELAY_MS <= now ? "pending" : "forecast";
  }

  /** 時間複雜度 O(r)，空間複雜度 O(r)。 */
  function classifyRecords() {
    const records = core
      .getRecords()
      .sort((a, b) => String(b.match?.kickoff || "").localeCompare(String(a.match?.kickoff || "")));
    const groups = { forecast: [], pending: [], verified: [] };
    records.forEach((record) => groups[getWorkflowStatus(record)].push(record));
    return { records, groups };
  }

  function injectStyles() {
    if (byId("football-records-ux-style")) return;

    const style = document.createElement("style");
    style.id = "football-records-ux-style";
    style.textContent = `
      .football-workflow-nav {
        display: grid;
        gap: 0.8rem;
        margin: 1.2rem 0 1rem;
      }
      .football-workflow-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.7rem;
      }
      .football-workflow-tab {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.7rem;
        padding: 0.85rem 1rem;
        border: 1px solid rgba(175, 166, 255, 0.25);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.025);
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        text-align: left;
      }
      .football-workflow-tab:hover,
      .football-workflow-tab.is-active {
        border-color: rgba(205, 166, 255, 0.7);
        background: rgba(150, 112, 255, 0.13);
      }
      .football-workflow-count {
        display: inline-grid;
        place-items: center;
        min-width: 2rem;
        height: 2rem;
        padding: 0 0.5rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.09);
      }
      .football-workflow-note {
        margin: 0;
        padding: 0.75rem 0.9rem;
        border-left: 3px solid rgba(175, 166, 255, 0.6);
        line-height: 1.6;
        opacity: 0.85;
      }
      .football-workflow-empty {
        margin: 1rem 0;
        padding: 1.2rem;
        border: 1px dashed rgba(175, 166, 255, 0.3);
        border-radius: 14px;
        text-align: center;
        opacity: 0.75;
      }
      .football-row-workflow-badge {
        display: inline-flex;
        width: fit-content;
        margin-top: 0.45rem;
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 800;
        line-height: 1.35;
      }
      .football-row-workflow-badge.is-forecast {
        background: rgba(126, 171, 255, 0.13);
        border: 1px solid rgba(126, 171, 255, 0.42);
      }
      .football-row-workflow-badge.is-pending {
        background: rgba(255, 205, 112, 0.12);
        border: 1px solid rgba(255, 205, 112, 0.42);
      }
      .football-row-workflow-badge.is-verified {
        background: rgba(114, 232, 164, 0.12);
        border: 1px solid rgba(114, 232, 164, 0.4);
      }
      .football-review-excerpt {
        display: -webkit-box;
        margin-top: 0.45rem;
        max-width: 230px;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        font-size: 0.82rem;
        line-height: 1.45;
        opacity: 0.72;
      }
      .football-review-fields {
        grid-column: 1 / -1;
        padding: 1rem;
        border: 1px solid rgba(175, 166, 255, 0.2);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.025);
      }
      .football-review-fields label,
      .football-review-fields textarea {
        width: 100%;
        margin: 0;
      }
      @media (max-width: 760px) {
        .football-workflow-tabs {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureWorkflowNav() {
    if (byId("football-workflow-nav")) return;
    const tableWrap = document.querySelector("#football-records .football-table-wrap");
    if (!tableWrap) return;

    const nav = document.createElement("div");
    nav.id = "football-workflow-nav";
    nav.className = "football-workflow-nav";

    const tabs = document.createElement("div");
    tabs.className = "football-workflow-tabs";
    Object.entries(STATUS_META).forEach(([status, meta]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "football-workflow-tab";
      button.dataset.status = status;
      button.innerHTML = `<span>${meta.label}</span><span class="football-workflow-count" data-count="${status}">0</span>`;
      button.addEventListener("click", () => {
        activeStatus = status;
        initializedView = true;
        applyRecordView();
      });
      tabs.appendChild(button);
    });

    const note = document.createElement("p");
    note.id = "football-workflow-note";
    note.className = "football-workflow-note";

    const empty = document.createElement("p");
    empty.id = "football-workflow-empty";
    empty.className = "football-workflow-empty football-hidden";

    nav.append(tabs, note, empty);
    tableWrap.insertAdjacentElement("beforebegin", nav);
  }

  function ensureReviewField() {
    if (byId("football-review-analysis")) return;
    const notes = byId("football-actual-notes");
    const notesLabel = notes?.closest("label");
    if (!notesLabel) return;

    const labelText = Array.from(notesLabel.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && clean(node.textContent)
    );
    if (labelText) labelText.textContent = "\n                賽事事件／特殊狀況（選填）\n                ";
    notes.placeholder = "例如：紅牌、傷退、延長賽、PK、輪換或其他影響比賽的事件。";

    const wrapper = document.createElement("div");
    wrapper.className = "football-review-fields";

    const analysisLabel = document.createElement("label");
    analysisLabel.textContent = "回顧與分析（選填）";
    const analysis = document.createElement("textarea");
    analysis.id = "football-review-analysis";
    analysis.rows = 5;
    analysis.maxLength = 1600;
    analysis.placeholder = "記錄牌面如何對應實際比賽、哪個推論錯誤，以及下次應如何調整。";
    analysisLabel.appendChild(analysis);

    wrapper.appendChild(analysisLabel);
    notesLabel.insertAdjacentElement("afterend", wrapper);
  }

  function fillReviewField() {
    const recordId = clean(byId("football-evaluation-id")?.value);
    const record = recordId ? core.getRecord(recordId) : null;
    if (!record) return;

    const notes = byId("football-actual-notes");
    const analysis = byId("football-review-analysis");
    if (notes) notes.value = readEventNotes(record);
    if (analysis) analysis.value = readReviewAnalysis(record);
  }

  function makeBadge(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function updateRow(row, record, status) {
    row.dataset.workflowStatus = status;
    row.hidden = status !== activeStatus;

    const statusCell = row.children[5];
    if (statusCell) {
      statusCell
        .querySelectorAll(".football-row-workflow-badge, .football-review-excerpt")
        .forEach((node) => node.remove());
      statusCell.appendChild(makeBadge(`football-row-workflow-badge is-${status}`, STATUS_META[status].label));

      if (status === "verified") {
        const analysis = readReviewAnalysis(record);
        if (analysis) {
          const excerpt = document.createElement("span");
          excerpt.className = "football-review-excerpt";
          excerpt.textContent = analysis;
          statusCell.appendChild(excerpt);
        }
      }
    }

    const actionButton = row.querySelector('button[data-action="evaluate"]');
    if (!actionButton) return;
    if (status === "forecast") actionButton.textContent = "賽後填寫";
    if (status === "pending") actionButton.textContent = "填入賽果";
    if (status === "verified") {
      actionButton.textContent = readReviewAnalysis(record) ? "更新回顧" : "填寫回顧";
    }
  }

  /** 時間複雜度 O(r)，空間複雜度 O(r)。 */
  function applyRecordView() {
    if (applying) return;
    const body = byId("football-records-body");
    const tableWrap = document.querySelector("#football-records .football-table-wrap");
    if (!body || !tableWrap) return;

    applying = true;
    observer?.disconnect();
    try {
      ensureWorkflowNav();
      const { records, groups } = classifyRecords();

      if (!initializedView) {
        activeStatus = ["forecast", "pending", "verified"].find((status) => groups[status].length) || "forecast";
        initializedView = true;
      }

      Object.keys(STATUS_META).forEach((status) => {
        const count = document.querySelector(`[data-count="${status}"]`);
        if (count) count.textContent = String(groups[status].length);
        const button = document.querySelector(`.football-workflow-tab[data-status="${status}"]`);
        button?.classList.toggle("is-active", status === activeStatus);
        button?.setAttribute("aria-pressed", status === activeStatus ? "true" : "false");
      });

      Array.from(body.children).forEach((row, index) => {
        const record = records[index];
        if (!record) {
          row.hidden = true;
          return;
        }
        updateRow(row, record, getWorkflowStatus(record));
      });

      const visibleCount = groups[activeStatus].length;
      const note = byId("football-workflow-note");
      const empty = byId("football-workflow-empty");
      if (note) note.textContent = STATUS_META[activeStatus].note;
      if (empty) {
        empty.textContent = STATUS_META[activeStatus].empty;
        empty.classList.toggle("football-hidden", visibleCount > 0);
      }
      tableWrap.classList.toggle("football-hidden", visibleCount === 0);
      byId("football-empty-state")?.classList.add("football-hidden");
    } finally {
      applying = false;
      observer?.observe(body, { childList: true });
    }
  }

  function bindEvents() {
    const body = byId("football-records-body");
    body?.addEventListener("click", (event) => {
      if (!event.target.closest('button[data-action="evaluate"]')) return;
      window.setTimeout(fillReviewField, 0);
    });

    byId("football-evaluation-form")?.addEventListener("submit", () => {
      window.setTimeout(() => {
        fillReviewField();
        applyRecordView();
      }, 0);
    });
  }

  function init() {
    injectStyles();
    ensureWorkflowNav();
    ensureReviewField();
    bindEvents();

    const body = byId("football-records-body");
    if (!body) return;
    observer = new MutationObserver(() => window.requestAnimationFrame(applyRecordView));
    observer.observe(body, { childList: true });
    applyRecordView();
  }

  init();
})();