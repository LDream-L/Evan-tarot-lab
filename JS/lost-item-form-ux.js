// ==============================
// lost-item-form-ux.js
// 塔羅尋物：降低非計分欄位的填寫負擔
// ==============================
// 主要函式複雜度：
// - init：O(f + o)，f = 固定欄位數、o = 選項總數
// - convertSelectToFlexibleInput：O(o)
// 空間複雜度：O(o)
//
// 更快替代方案比較：
// - 原做法：所有紀錄欄位直接展開，且只能選固定下拉選項。
// - 本實作：本次占卜只保留必要欄位；研究資料收進選填區，文字類欄位可選建議或直接輸入。
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
      .lost-record-note {
        margin: 0;
        line-height: 1.65;
        opacity: 0.78;
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

  /** 時間複雜度 O(f + o)，空間複雜度 O(o)。 */
  function init() {
    if (initialized || !document.getElementById("lost-item-form")) return;
    initialized = true;
    injectStyles();

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

    renameLabel(document.getElementById("item-notes")?.closest("label"), "目前狀況", "自由描述即可，也可以留白。");
    renameLabel(document.getElementById("item-type")?.closest("label"), "失物類型", "可從建議中選擇，也能直接輸入其他類型。");
    renameLabel(document.getElementById("last-action")?.closest("label"), "最後一次明確行為", "可從建議中選擇，也能直接描述當時在做什麼。");
    renameLabel(document.getElementById("scene")?.closest("label"), "當時場景", "可從建議中選擇，也能直接輸入實際場所。");
    renameLabel(document.getElementById("rough-searched")?.closest("label"), "是否已粗找過一次");
    renameLabel(document.getElementById("lost-duration")?.closest("label"), "大約遺失多久", "可從建議中選擇，也能直接輸入時間。");
    renameLabel(document.getElementById("touched-by-other")?.closest("label"), "是否可能被別人碰過");

    const details = document.createElement("details");
    details.className = "lost-record-details";

    const summary = document.createElement("summary");
    summary.textContent = "補充實驗紀錄（選填，不影響本次結果）";

    const body = document.createElement("div");
    body.className = "lost-record-body";

    const note = document.createElement("p");
    note.className = "lost-record-note";
    note.textContent = "這些資料只用來核對不同情境下的結果偏差，不參與抽牌或區域計分；不想填可以全部留白。";

    const optionalGrid = document.createElement("div");
    optionalGrid.className = "lost-v47-grid lost-record-grid";
    optionalLabels.forEach((label) => optionalGrid.appendChild(label));

    body.append(note, optionalGrid);
    details.append(summary, body);
    cardCountLabel.insertAdjacentElement("afterend", details);

    const disclaimer = document.querySelector("#lost-item-form .tool-disclaimer");
    if (disclaimer) {
      disclaimer.textContent = "本次結果只由牌面資料產生；補充紀錄不參與計分。";
    }
  }

  window.EvanLostItemFormUx = Object.freeze({ init });
})();