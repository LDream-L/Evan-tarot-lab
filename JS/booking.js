// ==============================
// booking.js
// 預約表單 -> Google Form（Apps Script 正式接管前保留既有寫入）
// ==============================
//
// 主要函式複雜度：
// - syncBookingAvailabilityField：O(1)
// - buildBookingFormData：O(1)（欄位數固定）
// - handleBookingForm：O(1)（不含網路延遲）
// 空間複雜度：O(1)
//
// 暴力法：不分形式，一律顯示時間欄位，增加文字占卜使用者的填寫負擔。
// 優化法（本實作）：只有選擇非文字形式時才顯示並要求填寫可配合時間。
// ==============================

const BOOKING_TEXT_MODE = "text";

// Apps Script 正式接管前，仍使用現有 Google Form，避免網站預約中斷。
const BOOKING_GOOGLE_FORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLScdne-yHwre5blIV7jk4UeejqUjPzuqaqCj9tpio_CuD-HSDA/formResponse",
  fields: {
    name: "entry.86660633",     // 暱稱
    contact: "entry.923361511", // 聯絡方式
    topic: "entry.274274082",   // 想占卜的主題
    mode: "entry.923638205",    // 希望的形式
    message: "entry.1276210815" // 想說的話
  },
};

/**
 * 非文字形式才需要提供可配合時間。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {string} mode
 * @return {boolean}
 */
function requiresBookingAvailability(mode) {
  return Boolean(mode) && mode !== BOOKING_TEXT_MODE;
}

/**
 * 依希望形式切換時間欄位與 required 狀態。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {HTMLFormElement} form
 */
function syncBookingAvailabilityField(form) {
  const modeField = form.elements["mode"];
  const availabilityField = form.elements["availability"];
  const availabilityWrapper = document.getElementById("booking-availability-field");
  if (!modeField || !availabilityField || !availabilityWrapper) return;

  const isRequired = requiresBookingAvailability(modeField.value);
  availabilityWrapper.hidden = !isRequired;
  availabilityField.required = isRequired;

  if (!isRequired) {
    availabilityField.value = "";
  }
}

/**
 * 將時間資訊併入既有「想說的話」欄位，避免修改 Google Form 題目。
 * Apps Script 接管後可改成獨立欄位寫入。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {HTMLFormElement} form
 * @return {string}
 */
function buildBookingMessage(form) {
  const message = form.elements["message"].value.trim();
  const mode = form.elements["mode"].value;
  if (!requiresBookingAvailability(mode)) return message;

  const availability = form.elements["availability"].value.trim();
  return message
    ? `[可配合時間]\n${availability}\n\n[想說的話]\n${message}`
    : `[可配合時間]\n${availability}`;
}

/**
 * 將預約表單欄位打包成 FormData。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {HTMLFormElement} form
 * @return {FormData}
 */
function buildBookingFormData(form) {
  const formData = new FormData();
  const fields = BOOKING_GOOGLE_FORM.fields;

  formData.append(fields.name, form.elements["name"].value.trim());
  formData.append(fields.contact, form.elements["contact"].value.trim());
  formData.append(fields.topic, form.elements["topic"].value);
  formData.append(fields.mode, form.elements["mode"].value);
  formData.append(fields.message, buildBookingMessage(form));
  formData.append("submit", "Submit");

  return formData;
}

/**
 * 對 Google Form 發送 POST。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 暴力法：不用 JS，直接讓整頁跳轉到 Google Form。
 * 本實作：fetch + no-cors，送出後仍留在 Evan Tarot 網站。
 *
 * @param {string} url
 * @param {FormData} formData
 * @return {Promise<Response>}
 */
function postToGoogleForm(url, formData) {
  return fetch(url, {
    method: "POST",
    mode: "no-cors",
    body: formData,
  });
}

/**
 * 初始化條件式時間欄位。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function initBookingAvailability() {
  const form = document.getElementById("booking-form");
  if (!form) return;

  const modeField = form.elements["mode"];
  if (!modeField) return;

  modeField.addEventListener("change", () => syncBookingAvailabilityField(form));
  syncBookingAvailabilityField(form);
}

document.addEventListener("DOMContentLoaded", initBookingAvailability);

/**
 * 預約送出事件。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {SubmitEvent} event
 */
window.handleBookingForm = function handleBookingForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  syncBookingAvailabilityField(form);

  if (!form.reportValidity()) return;

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  const formData = buildBookingFormData(form);

  postToGoogleForm(BOOKING_GOOGLE_FORM.url, formData)
    .then(() => {
      window.EvanDialog?.alert(
        "已送出預約意願，感謝你。<br>我會依照你留下的聯絡方式回覆時間與細節。",
        "預約已送出"
      );
      form.reset();
      syncBookingAvailabilityField(form);
    })
    .catch(() => {
      window.EvanDialog?.alert(
        "預約送出時遇到網路問題。<br>建議你暫時改用 IG / Email 聯絡一次，避免漏接。",
        "送出失敗"
      );
    })
    .finally(() => {
      if (submitButton) submitButton.disabled = false;
    });
};
