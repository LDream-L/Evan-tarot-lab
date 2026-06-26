// ==============================
// football-records-ux.js
// 世足賽事驗證：分流預測／待驗證／已驗證，並加入賽後回顧
// ==============================
// 主要函式複雜度：
// - classifyRecords：O(r)
// - applyRecordView：O(r)
// - parseReview / encodeReview：O(n)，n = 備註字數
// 空間複雜度：O(r + n)
//
// 更快替代方案比較：
// - 原版：所有紀錄放在同一張表，使用者逐列辨認狀態。
// - 本版：單次掃描建立狀態索引，切換分頁只改現有列的顯示，不重建整張表。
// ==============================

(function initFootballRecordsUx() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const REVIEW_OPEN = "[[EVAN_FOOTBALL_REVIEW_V1]]";
  const REVIEW_CLOSE = "[[/EVAN_FOOTBALL_REVIEW_V1]]";
  const STATUS_META = Object.freeze({
    forecast: {
      label: "預測中",
      note: "尚未開賽或仍在等待比賽結束的鎖定預測。",
      empty: "目前沒有預測中的賽事。",
    },
    pending: {
      label: "待驗證",
      note: "已到開賽時間，但尚未填入實際賽果。",
      empty: "目前沒有等待驗證的賽事。",
    },
    verified: {
      label: "已驗證",
      note: "已完成賽果核對，可補寫成功、部分成功或失敗的回顧。",
      empty: "目前還沒有已驗證的賽事。",
    },
  });

  let activeStatus = "forecast";
  let observer = null;
  let applying = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  /** 時間複雜度 O(n)，空間複雜度 O(n)。 */
  function parseReview(rawNotes) {
    const notes = String(rawNotes || "");
    if (!notes.startsWith(REVIEW_OPEN)) {
      return { verdict: "", analysis: "", notes };
    }

    const closeIndex = notes.indexOf(REVIEW_CLOSE, REVIEW_OPEN.length);
    if (closeIndex < 0) return { verdict: "", analysis: "", notes };

    const jsonText = notes.slice(REVIEW_OPEN.length, closeIndex);
    const remaining = notes.slice(closeIndex + REVIEW_CLOSE.length).replace(/^\r?\n/, "");
    try {
      const payload = JSON.parse(jsonText);
      return {
        verdict: clean(payload?.verdict),
        analysis: clean(payload?.analysis),
        notes: remaining,
      };
    } catch (error) {
      console.warn("[football-records-ux] 回顧資料解析失敗：", error);
      return { verdict: "", analysis: "", notes };
    }
  }

  /** 時間複雜度 O(n)，空間複雜度 O(n)。 */
  function encodeReview(notes, verdict, analysis) {
    const cleanNotes = String(notes || "").trim();
    const payload = {
      verdict: clean(verdict),
      analysis: clean(analysis),
    };
    if (!payload.verdict && !payload.analysis) return cleanNotes;
    return `${REVIEW_OPEN}${JSON.stringify(payload)}${REVIEW_CLOSE}${cleanNotes ? `\n${cleanNotes}` : ""}`;
  }

  function getWorkflowStatus(record, now = Date.now()) {
    if (record?.actual) return "verified";
    const kickoff = Date.parse(record?.match?.kickoff || "");
    return Number.isFinite(kickoff) && kickoff <= now ? "pending" : "forecast";
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
      .football-row-workflow-badge,
      .football-review-badge {
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
      .football-review-badge.is-success {
        background: rgba(114, 232, 164, 0.14);
        border: 1px solid rgba(114, 232, 164, 0.42);
      }
      .football-review-badge.is-partial {
        background: rgba(255, 205, 112, 0.13);
        border: 1px solid rgba(255, 205, 112, 0.42);
      }
      .football-review-badge.is-fail {
        background: rgba(255, 130, 145, 0.12);
        border: 1px solid rgba(255, 130, 145, 0.4);
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
        display: grid;
        grid-template-columns: minmax(180px, 0.55fr) minmax(0, 1.45fr);
        gap: 1rem;
        padding: 1rem;
        border: 1px solid rgba(175, 166, 255, 0.2);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.025);
      }
      .football-review-fields label {
        margin: 0;
      }
      .football-review-fields select,
      .football-review-fields textarea {
        width: 100%;
      }
      @media (max-width: 760px) {
        .football-workflow-tabs,
        .football-review-fields {
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

  function ensureReviewFields() {
    if (byId("football-review-verdict")) return;
    const formGrid = document.querySelector("#football-evaluation-form .football-form-grid");
    const notes = byId("football-actual-notes");
    const notesLabel = notes?.closest("label");
    if (!formGrid || !notesLabel) return;

    const labelText = Array.from(notesLabel.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && clean(node.textContent)
    );
    if (labelText) labelText.textContent = "\n                賽事事件／特殊狀況（選填）\n                ";
    notes.placeholder = "例如：紅牌、傷退、延長賽、PK、輪換或其他影響比賽的事件。";

    const wrapper = document.createElement("div");
    wrapper.className = "football-review-fields";

    const verdictLabel = document.createElement("label");
    verdictLabel.textContent = "整體回顧";
    const verdict = document.createElement("select");
    verdict.id = "football-review-verdict";
    [
      ["", "尚未回顧"],
      ["success", "預測成功"],
      ["partial", "部分成功"],
      ["fail", "預測失敗"],
    ].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      verdict.appendChild(option);
    });
    verdictLabel.appendChild(verdict);

    const analysisLabel = document.createElement("label");
    analysisLabel.textContent = "回顧與分析";
    const analysis = document.createElement("textarea");
    analysis.id = "football-review-analysis";
    analysis.rows = 4;
    analysis.maxLength = 1600;
    analysis.placeholder = "記錄成功或失敗的原因：哪張牌如何對應實際比賽、哪個推論錯誤、下次應如何調整。";
    analysisLabel.appendChild(analysis);

    wrapper.append(verdictLabel, analysisLabel);
    notesLabel.insertAdjacentElement("afterend", wrapper);
  }

  function fillReviewFields() {
    const recordId = clean(byId("football-evaluation-id")?.value);
    const record = recordId ? core.getRecord(recordId) : null;
    if (!record) return;

    const parsed = parseReview(record.actual?.notes || "");
    const notes = byId("football-actual-notes");
    const verdict = byId("football-review-verdict");
    const analysis = byId("football-review-analysis");
    if (notes) notes.value = parsed.notes;
    if (verdict) verdict.value = parsed.verdict;
    if (analysis) analysis.value = parsed.analysis;
  }

  function prepareReviewBeforeSubmit() {
    const notes = byId("football-actual-notes");
    if (!notes) return;
    notes.value = encodeReview(
      notes.value,
      byId("football-review-verdict")?.value,
      byId("football-review-analysis")?.value
    );
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
      statusCell.querySelectorAll(".football-row-workflow-badge, .football-review-badge, .football-review-excerpt").forEach((node) => node.remove());
      statusCell.appendChild(makeBadge(`football-row-workflow-badge is-${status}`, STATUS_META[status].label));

      if (status === "verified") {
        const review = parseReview(record.actual?.notes || "");
        const reviewLabels = { success: "預測成功", partial: "部分成功", fail: "預測失敗" };
        if (reviewLabels[review.verdict]) {
          statusCell.appendChild(makeBadge(`football-review-badge is-${review.verdict}`, reviewLabels[review.verdict]));
        }
        if (review.analysis) {
          const excerpt = document.createElement("span");
          excerpt.className = "football-review-excerpt";
          excerpt.textContent = review.analysis;
          statusCell.appendChild(excerpt);
        }
      }
    }

    const actionButton = row.querySelector('button[data-action="evaluate"]');
    if (actionButton) {
      if (status === "forecast") actionButton.textContent = "賽後填寫";
      if (status === "pending") actionButton.textContent = "填入賽果";
      if (status === "verified") {
        const review = parseReview(record.actual?.notes || "");
        actionButton.textContent = review.verdict || review.analysis ? "更新回顧" : "填寫回顧";
      }
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
      if (!groups[activeStatus]?.length) {
        activeStatus = ["forecast", "pending", "verified"].find((status) => groups[status].length) || "forecast";
      }

      Object.keys(STATUS_META).forEach((status) => {
        const count = document.querySelector(`[data-count="${status}"]`);
        if (count) count.textContent = String(groups[status].length);
        const button = document.querySelector(`.football-workflow-tab[data-status="${status}"]`);
        button?.classList.toggle("is-active", status === activeStatus);
        button?.setAttribute("aria-pressed", status === activeStatus ? "true" : "false");
      });

      const rows = Array.from(body.children);
      rows.forEach((row, index) => {
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

      const oldEmpty = byId("football-empty-state");
      oldEmpty?.classList.add("football-hidden");
    } finally {
      applying = false;
      observer?.observe(body, { childList: true });
    }
  }

  function bindEvents() {
    const body = byId("football-records-body");
    body?.addEventListener("click", (event) => {
      if (!event.target.closest('button[data-action="evaluate"]')) return;
      window.setTimeout(fillReviewFields, 0);
    });

    const form = byId("football-evaluation-form");
    form?.addEventListener("submit", prepareReviewBeforeSubmit, true);
    form?.addEventListener("submit", () => {
      window.setTimeout(() => {
        fillReviewFields();
        applyRecordView();
      }, 0);
    });
  }

  function init() {
    injectStyles();
    ensureWorkflowNav();
    ensureReviewFields();
    bindEvents();

    const body = byId("football-records-body");
    if (!body) return;
    observer = new MutationObserver(() => window.requestAnimationFrame(applyRecordView));
    observer.observe(body, { childList: true });
    applyRecordView();
  }

  init();
})();