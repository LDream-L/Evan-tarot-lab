// ==============================
// football-source-review-ux.js
// 塔羅X賽事驗證：雙牌源賽後回顧分欄
// ==============================
//
// 客觀賽果與賽事事件維持同場同步；牌面回顧依自己抽牌／網站隨機抽牌各自保存。
//
// 主要函式複雜度：
// - configureReviewFields：時間 O(r)，額外空間 O(1)，r = 紀錄數。
// - ensurePairedReviewField／bind：時間／空間 O(1)。
//
// 更快替代方案比較：
// - 暴力法：為雙牌源建立第二套完整賽後表單，會重複比分、延長賽與事件欄位，也容易造成兩份客觀結果不一致。
// - 優化法：只增加第二個「回顧與分析」欄位；共用結果照舊同步，主觀牌面分析才分流。
// - 僅在 tbody 冒泡階段監聽按鈕，可能被既有流程 stopPropagation 截斷；本版改用 document capture 單次委派，
//   再延後到既有 openEvaluation 完成後更新欄位，無須重綁每列按鈕。

(function initFootballSourceReviewUx() {
  "use strict";

  if (window.__footballSourceReviewUxInitialized) return;
  window.__footballSourceReviewUxInitialized = true;

  const SOURCE_EXPERIMENT = "manual-vs-random";
  const core = window.FootballLabCore;
  if (!core || typeof core.getRecord !== "function" || typeof core.getRecords !== "function") return;

  const byId = (id) => document.getElementById(id);

  /** 同場雙牌源判斷：時間／空間 O(1)。 */
  function isComparisonRecord(record) {
    return Boolean(
      record?.match?.sourceExperiment === SOURCE_EXPERIMENT
      && record.match.comparisonGroupId
      && (record.match.cardSource === "manual" || record.match.cardSource === "random")
    );
  }

  /** 固定牌源標籤：時間／空間 O(1)。 */
  function sourceLabel(record) {
    return record?.match?.cardSource === "random" ? "網站隨機抽牌" : "自己抽牌";
  }

  /** 只修改 label 的文字節點，不重建 textarea。時間／空間 O(1)。 */
  function setLabelText(label, text) {
    if (!label) return;
    const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) {
      textNode.textContent = `\n                ${text}\n                `;
      return;
    }
    label.prepend(document.createTextNode(`${text} `));
  }

  /**
   * 建立第二份牌源回顧欄位；固定只建一次。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function ensurePairedReviewField() {
    const primary = byId("football-review-analysis");
    const primaryLabel = primary?.closest("label");
    const wrapper = primaryLabel?.closest(".football-review-fields");
    if (!primary || !primaryLabel || !wrapper) return false;

    primaryLabel.id = "football-review-analysis-primary-field";

    if (!byId("football-source-review-note")) {
      const note = document.createElement("p");
      note.id = "football-source-review-note";
      note.className = "football-source-review-note football-hidden";
      note.textContent = "實際比分、延長賽／PK 與賽事事件共用；以下兩份牌面回顧分開保存，不會互相覆蓋。";
      wrapper.insertBefore(note, primaryLabel);
    }

    if (!byId("football-review-analysis-sibling")) {
      const siblingLabel = document.createElement("label");
      siblingLabel.id = "football-review-analysis-sibling-field";
      siblingLabel.className = "football-hidden";
      siblingLabel.textContent = "另一牌源｜回顧與分析（選填）";

      const sibling = document.createElement("textarea");
      sibling.id = "football-review-analysis-sibling";
      sibling.rows = 5;
      sibling.maxLength = 1600;
      sibling.placeholder = "只記錄這一組牌面如何對應實際比賽、錯誤原因，以及下次應如何調整。";
      siblingLabel.appendChild(sibling);
      wrapper.appendChild(siblingLabel);
    }

    if (!byId("football-source-review-style")) {
      const style = document.createElement("style");
      style.id = "football-source-review-style";
      style.textContent = `
        .football-source-review-note {
          margin: 0 0 .7rem;
          padding: .58rem .68rem;
          border-left: 3px solid rgba(190, 154, 255, .72);
          border-radius: 8px;
          background: rgba(141, 102, 229, .08);
          color: rgba(235, 229, 255, .78);
          font-size: .78rem;
          line-height: 1.55;
        }
        #football-review-analysis-sibling-field {
          display: grid;
          gap: .4rem;
          margin-top: .72rem;
        }
        #football-review-analysis-sibling-field.football-hidden,
        #football-source-review-note.football-hidden {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    return true;
  }

  /**
   * 依目前打開的紀錄顯示單一回顧或雙牌源回顧。
   * 時間複雜度：O(r)
   * 空間複雜度：O(1)
   *
   * 更快替代方案比較：
   * - 每次重建整個賽後表單會丟失尚未送出的輸入值。
   * - 本版只查找同 comparisonGroupId 的 sibling，並原地切換固定兩個 textarea。
   */
  function configureReviewFields() {
    if (!ensurePairedReviewField()) return;

    const primary = byId("football-review-analysis");
    const primaryLabel = byId("football-review-analysis-primary-field");
    const sibling = byId("football-review-analysis-sibling");
    const siblingLabel = byId("football-review-analysis-sibling-field");
    const note = byId("football-source-review-note");
    const recordId = String(byId("football-evaluation-id")?.value || "").trim();
    const record = recordId ? core.getRecord(recordId) : null;

    if (!isComparisonRecord(record)) {
      setLabelText(primaryLabel, "回顧與分析（選填）");
      siblingLabel?.classList.add("football-hidden");
      note?.classList.add("football-hidden");
      if (sibling) {
        sibling.value = "";
        delete sibling.dataset.recordId;
        delete sibling.dataset.comparisonGroupId;
      }
      return;
    }

    const siblingRecord = core.getRecords().find((item) => (
      item.id !== record.id
      && isComparisonRecord(item)
      && item.match.comparisonGroupId === record.match.comparisonGroupId
    ));

    if (!siblingRecord) {
      setLabelText(primaryLabel, `${sourceLabel(record)}｜回顧與分析（選填）`);
      siblingLabel?.classList.add("football-hidden");
      note?.classList.add("football-hidden");
      return;
    }

    setLabelText(primaryLabel, `${sourceLabel(record)}｜回顧與分析（選填）`);
    setLabelText(siblingLabel, `${sourceLabel(siblingRecord)}｜回顧與分析（選填）`);

    primary.value = String(record.actual?.reviewAnalysis || "");
    sibling.value = String(siblingRecord.actual?.reviewAnalysis || "");
    sibling.dataset.recordId = siblingRecord.id;
    sibling.dataset.comparisonGroupId = record.match.comparisonGroupId;

    siblingLabel.classList.remove("football-hidden");
    note.classList.remove("football-hidden");
  }

  /**
   * 捕獲階段委派核對按鈕，避免既有 click handler 阻止冒泡後漏掉欄位切換。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   *
   * 更快替代方案比較：
   * - 逐列綁定事件需隨每次 renderRecords 重綁 O(r)。
   * - document capture 只綁一次，固定 O(1)，並以 records 容器限制作用範圍。
   */
  function handleEvaluationClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button[data-action="evaluate"]');
    const body = byId("football-records-body");
    if (!button || !body?.contains(button)) return;

    window.setTimeout(configureReviewFields, 0);
  }

  /** 固定事件委派：時間／空間 O(1)。 */
  function bind() {
    const form = byId("football-evaluation-form");

    document.addEventListener("click", handleEvaluationClick, true);

    form?.addEventListener("submit", () => {
      window.setTimeout(configureReviewFields, 0);
    });

    configureReviewFields();
  }

  bind();
})();
