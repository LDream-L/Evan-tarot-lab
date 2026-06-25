// ==============================
// lost-item-form-ux.js
// 塔羅尋物：降低補充欄位的填寫負擔
// ==============================
// 主要函式複雜度：
// - init：O(f + o)，f = 固定欄位數、o = 選項總數
// - convertSelectToFlexibleInput：O(o)
// 空間複雜度：O(o)
//
// 更快替代方案比較：
// - 原做法：所有補充欄位直接展開，且只能選固定下拉選項。
// - 本實作：主流程只保留必要欄位；補充資料收進選填區，文字類欄位可選建議或直接輸入。
// ==============================

(function initLostItemFormUxModule() {
  "use strict";

  const STYLE_ID = "lost-item-form-ux-style";
  let initialized = false;

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .lost-record-details {
        grid-column: 1 / -1;
        border: 1px solid rgba(175, 166, 255, 0.22);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.025);
        overflow: hidden;
      }
      .lost-record-details > summary {
        cursor: pointer;
        padding: 0.95rem 1rem;
        font-weight: 800;
        list-style-position: inside;
        background: rgba(87, 72, 160, 0.1);
      }
      .lost-record-details[open] > summary {
        border-bottom: 1px solid rgba(175, 166, 255, 0.16);
      }
      .lost-record-body {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }
      .lost-record-grid {
        margin: 0;
      }
      .lost-record-grid label {
        margin: 0;
      }
      .lost-record-grid input,
      .lost-record-grid select,
      .lost-record-grid textarea {
        width: 100%;
      }
      .lost-record-field-help {
        display: block;
        margin-top: 0.35rem;
        font-size: 0.82rem;
        font-weight: 400;
        line-height: 1.45;
        opacity: 0.66;
      }
      @media (max-width: 680px) {
        .lost-record-details {
          grid-column: auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renameLabel(label, text, help = "") {
    if (!label) return;
    const control = label.querySelector("input, select, textarea");
    if (!control) return;

    const nodes = Array.from(label.childNodes);
    const textNode = nodes.find((node) => node.nodeType === Node.TEXT_NODE && clean(node.textContent));
    if (textNode) textNode.textContent = `\n                ${text}\n                `;

    label.querySelector(".lost-record-field-help")?.remove();
    if (help) {
      const small = document.createElement("small");
      small.className = "lost-record-field-help";
      small.textContent = help;
      label.appendChild(small);
    }
  }

  /** 時間複雜度 O(o)，空間複雜度 O(o)。 */
  function convertSelectToFlexibleInput(selectId, placeholder) {
    const select = document.getElementById(selectId);
    if (!(select instanceof HTMLSelectElement)) return;

    const listId = `${selectId}-suggestions`;
    const datalist = document.createElement("datalist");
    datalist.id = listId;

    const seen = new Set();
    Array.from(select.options).forEach((option) => {
      const value = clean(option.value || option.textContent);
      if (!value || seen.has(value)) return;
      seen.add(value);
      const suggestion = document.createElement("option");
      suggestion.value = value;
      datalist.appendChild(suggestion);
    });

    const input = document.createElement("input");
    input.id = selectId;
    input.type = "text";
    input.setAttribute("list", listId);
    input.setAttribute("autocomplete", "off");
    input.maxLength = 80;
    input.placeholder = placeholder;
    input.value = "";

    select.replaceWith(input);
    input.insertAdjacentElement("afterend", datalist);
  }

  function resetBooleanSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!(select instanceof HTMLSelectElement)) return;

    Array.from(select.options).forEach((option) => option.removeAttribute("selected"));
    if (!Array.from(select.options).some((option) => option.value === "")) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "不提供";
      select.insertBefore(empty, select.firstChild);
    }
    select.value = "";
  }

  function simplifyPageCopy() {
    const lead = document.querySelector("#lost-item-tool .section-lead");
    if (lead) lead.textContent = "輸入物品名稱、選擇抽牌張數後即可開始。";

    document.querySelector("#lost-item-form .tool-disclaimer")?.remove();

    const heroItems = document.querySelectorAll(".hero-card-inner li");
    if (heroItems[2]) heroItems[2].textContent = "依序查看搜尋區域與具體動作";

    const feedbackNote = document.querySelector("#lost-item-feedback-form")?.previousElementSibling;
    if (feedbackNote?.classList.contains("lost-v50-feedback-note")) {
      feedbackNote.textContent = "找到後請回報實際位置，協助核對結果。";
    }

    const feedbackForm = document.getElementById("lost-item-feedback-form");
    const feedbackMessage = document.getElementById("lost-item-feedback-message");
    feedbackForm?.addEventListener("submit", () => {
      window.setTimeout(() => {
        if (feedbackMessage && feedbackMessage.textContent.includes("不會改變牌面權重")) {
          feedbackMessage.textContent = "感謝你的回饋。";
        }
      }, 0);
    });
  }

  /** 時間複雜度 O(f + o)，空間複雜度 O(o)。 */
  function init() {
    if (initialized || !document.getElementById("lost-item-form")) return;
    initialized = true;
    injectStyles();
    simplifyPageCopy();

    const grid = document.querySelector("#lost-item-form .lost-v47-grid");
    const cardCountLabel = document.getElementById("card-count")?.closest("label");
    if (!grid || !cardCountLabel) return;

    const optionalControls = [
      "item-notes",
      "item-type",
      "last-action",
      "scene",
      "rough-searched",
      "lost-duration",
      "touched-by-other",
    ];
    const optionalLabels = optionalControls
      .map((id) => document.getElementById(id)?.closest("label"))
      .filter(Boolean);

    convertSelectToFlexibleInput("item-type", "可選建議或直接輸入，例如：積木");
    convertSelectToFlexibleInput("last-action", "可選建議或直接描述，例如：打掃房間");
    convertSelectToFlexibleInput("scene", "可選建議或直接輸入，例如：兒童遊戲室");
    convertSelectToFlexibleInput("lost-duration", "可選建議或直接輸入，例如：約兩小時");
    resetBooleanSelect("rough-searched");
    resetBooleanSelect("touched-by-other");

    renameLabel(document.getElementById("item-notes")?.closest("label"), "目前狀況", "自由描述，也可以留白。");
    renameLabel(document.getElementById("item-type")?.closest("label"), "失物類型", "可選建議或直接輸入。");
    renameLabel(document.getElementById("last-action")?.closest("label"), "最後一次明確行為", "可選建議或直接描述。");
    renameLabel(document.getElementById("scene")?.closest("label"), "當時場景", "可選建議或直接輸入。");
    renameLabel(document.getElementById("rough-searched")?.closest("label"), "是否已粗找過一次");
    renameLabel(document.getElementById("lost-duration")?.closest("label"), "大約遺失多久", "可選建議或直接輸入。");
    renameLabel(document.getElementById("touched-by-other")?.closest("label"), "是否可能被別人碰過");

    const details = document.createElement("details");
    details.className = "lost-record-details";

    const summary = document.createElement("summary");
    summary.textContent = "補充資料（選填）";

    const body = document.createElement("div");
    body.className = "lost-record-body";

    const optionalGrid = document.createElement("div");
    optionalGrid.className = "lost-v47-grid lost-record-grid";
    optionalLabels.forEach((label) => optionalGrid.appendChild(label));

    body.appendChild(optionalGrid);
    details.append(summary, body);
    cardCountLabel.insertAdjacentElement("afterend", details);
  }

  window.EvanLostItemFormUx = Object.freeze({ init });
})();