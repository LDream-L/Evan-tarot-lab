// 世足賽事驗證 v1.2.2｜開賽時間相容性修正
// 將 datetime-local 拆成 date + time，避開部分 Chrome/Windows 地區格式判定錯誤。
// 初始化與同步皆為 O(1) 時間／O(1) 空間。
(function fixFootballKickoffInput() {
  "use strict";

  const original = document.getElementById("football-kickoff");
  if (!original || original.dataset.splitDatetime === "1") return;

  const wrapper = document.createElement("div");
  wrapper.className = "football-datetime-split";

  const dateInput = document.createElement("input");
  dateInput.id = "football-kickoff-date";
  dateInput.type = "date";
  dateInput.required = true;
  dateInput.setAttribute("aria-label", "開賽日期");

  const timeInput = document.createElement("input");
  timeInput.id = "football-kickoff-time";
  timeInput.type = "time";
  timeInput.required = true;
  timeInput.step = "60";
  timeInput.setAttribute("aria-label", "開賽時間");

  const hiddenInput = document.createElement("input");
  hiddenInput.id = "football-kickoff";
  hiddenInput.type = "hidden";
  hiddenInput.dataset.splitDatetime = "1";

  const oldValue = String(original.value || "");
  const matched = oldValue.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (matched) {
    dateInput.value = matched[1];
    timeInput.value = matched[2];
    hiddenInput.value = `${matched[1]}T${matched[2]}`;
  }

  /** 合併兩個欄位：O(1) 時間／O(1) 空間。 */
  function syncValue() {
    hiddenInput.value = dateInput.value && timeInput.value
      ? `${dateInput.value}T${timeInput.value}`
      : "";
  }

  dateInput.addEventListener("input", syncValue);
  dateInput.addEventListener("change", syncValue);
  timeInput.addEventListener("input", syncValue);
  timeInput.addEventListener("change", syncValue);

  wrapper.append(dateInput, timeInput);
  original.replaceWith(wrapper, hiddenInput);

  const form = document.getElementById("football-match-form");
  form?.addEventListener("reset", () => {
    window.setTimeout(syncValue, 0);
  });

  const style = document.createElement("style");
  style.textContent = `
    .football-datetime-split {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(120px, 0.65fr);
      gap: 0.65rem;
    }
    .football-datetime-split input {
      min-width: 0;
      width: 100%;
    }
    @media (max-width: 620px) {
      .football-datetime-split { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
})();
