// ==============================
// booking.js
// 預約表單 -> 獨立 Apps Script Web App
// ==============================
//
// 主要函式複雜度：
// - syncBookingAvailabilityField：O(1)
// - buildBookingPayload：O(m)，m = 本次輸入文字總長度
// - postBooking：O(1)（不含網路延遲）
// - handleBookingForm：O(m)（不含網路延遲）
// 空間複雜度：O(m)
//
// 更快替代方案比較：
// - 暴力法：網站直接跳轉 Google Form，流程中斷且欄位難以動態控制。
// - 本實作：直接送到獨立 Apps Script，固定欄位寫入私人試算表。
// ==============================

const BOOKING_TEXT_MODE = "text";
const BOOKING_CLIENT_ID_KEY = "evanTarotBookingClientId";

/**
 * 取得獨立預約 API 網址。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @return {string}
 */
function getBookingApiUrl() {
  return String(window.EVAN_CLOUD_CONFIG?.bookingApiUrl || "").trim();
}

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
  availabilityWrapper.style.display = isRequired ? "block" : "none";
  availabilityField.required = isRequired;

  if (!isRequired) {
    availabilityField.value = "";
  }
}

/**
 * 建立並保存匿名瀏覽器識別碼，只用於基本限流。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @return {string}
 */
function getOrCreateBookingClientId() {
  try {
    const savedId = window.localStorage.getItem(BOOKING_CLIENT_ID_KEY);
    if (savedId) return savedId;

    const randomPart = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    const clientId = `booking-${randomPart}`.slice(0, 128);
    window.localStorage.setItem(BOOKING_CLIENT_ID_KEY, clientId);
    return clientId;
  } catch (error) {
    return `booking-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * 將網站欄位整理成 Apps Script 接收格式。
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 *
 * @param {HTMLFormElement} form
 * @return {Object}
 */
function buildBookingPayload(form) {
  const mode = form.elements["mode"].value;

  return {
    action: "createbooking",
    createdAt: window.nowTaipeiISO?.() || new Date().toISOString(),
    name: form.elements["name"].value.trim(),
    contact: form.elements["contact"].value.trim(),
    topic: form.elements["topic"].value,
    mode,
    availability: requiresBookingAvailability(mode)
      ? form.elements["availability"].value.trim()
      : "",
    message: form.elements["message"].value.trim(),
    clientId: getOrCreateBookingClientId(),
    website: "",
  };
}

/**
 * 對 Apps Script 發送預約。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * Apps Script Web App 跨網域寫入使用 no-cors；
 * 前端負責相同的必填驗證，後端再做第二次驗證與限流。
 *
 * @param {string} url
 * @param {Object} payload
 * @return {Promise<Response>}
 */
function postBooking(url, payload) {
  return fetch(url, {
    method: "POST",
    mode: "no-cors",
    cache: "no-store",
    keepalive: true,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
}

/**
 * 顯示表單內狀態文字。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * @param {string} message
 * @param {string} type
 */
function showBookingMessage(message, type = "") {
  const element = document.getElementById("booking-message");
  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden", "is-error", "is-success");
  if (type) element.classList.add(type);
}

/**
 * 清除表單內狀態文字。
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function clearBookingMessage() {
  const element = document.getElementById("booking-message");
  if (!element) return;

  element.textContent = "";
  element.classList.add("hidden");
  element.classList.remove("is-error", "is-success");
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

  modeField.addEventListener("change", () => {
    syncBookingAvailabilityField(form);
    clearBookingMessage();
  });

  syncBookingAvailabilityField(form);
}

document.addEventListener("DOMContentLoaded", initBookingAvailability);

/**
 * 預約送出事件。
 * 時間複雜度：O(m)
 * 空間複雜度：O(m)
 *
 * @param {SubmitEvent} event
 */
window.handleBookingForm = async function handleBookingForm(event) {
  event.preventDefault();

  const form = event.currentTarget;
  syncBookingAvailabilityField(form);
  clearBookingMessage();

  if (!form.reportValidity()) return;

  const apiUrl = getBookingApiUrl();
  if (!apiUrl) {
    showBookingMessage("預約系統尚未完成設定，請暫時改用 IG 或 Email 聯絡。", "is-error");
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showBookingMessage("預約送出中……");

  try {
    const payload = buildBookingPayload(form);
    await postBooking(apiUrl, payload);

    form.reset();
    syncBookingAvailabilityField(form);
    showBookingMessage("預約已送出，我會依照你留下的聯絡方式回覆。", "is-success");

    window.EvanDialog?.alert(
      "已送出預約意願，感謝你。<br>我會依照你留下的聯絡方式回覆時間與細節。",
      "預約已送出"
    );
  } catch (error) {
    console.error(error);
    showBookingMessage("預約送出時遇到網路問題，請稍後重試或改用 IG／Email 聯絡。", "is-error");

    window.EvanDialog?.alert(
      "預約送出時遇到網路問題。<br>請稍後重試，或暫時改用 IG／Email 聯絡，避免漏接。",
      "送出失敗"
    );
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};
