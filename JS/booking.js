// ==============================
// booking.js
// 預約表單 -> 獨立 Apps Script Web App
// ==============================
//
// 主要函式複雜度：
// - syncBookingAvailabilityField：時間 O(1)，空間 O(1)
// - buildBookingPayload：時間 O(m)，空間 O(m)，m = 本次輸入文字總長度
// - postBooking：時間 O(1)，空間 O(1)（不含網路延遲）
// - handleBookingForm：時間 O(m)，空間 O(m)（不含網路延遲）
//
// 替代方案比較：
// - Google Form 跳轉：可確認表單頁，但流程中斷且欄位難以動態控制。
// - no-cors 直送 Apps Script：流程不中斷，但瀏覽器無法讀取後端結果。
// - 本實作：保留直送流程，並誠實標示「請求已送出但無法確認入庫」，避免假成功。
// ==============================

const BOOKING_TEXT_MODE = "text";
const BOOKING_CLIENT_ID_KEY = "evanTarotBookingClientId";

/** 取得獨立預約 API 網址。時間／空間複雜度 O(1)。 */
function getBookingApiUrl() {
  return String(window.EVAN_CLOUD_CONFIG?.bookingApiUrl || "").trim();
}

/** 非文字形式才需要提供可配合時間。時間／空間複雜度 O(1)。 */
function requiresBookingAvailability(mode) {
  return Boolean(mode) && mode !== BOOKING_TEXT_MODE;
}

/** 依希望形式切換時間欄位與 required 狀態。時間／空間複雜度 O(1)。 */
function syncBookingAvailabilityField(form) {
  const modeField = form.elements["mode"];
  const availabilityField = form.elements["availability"];
  const availabilityWrapper = document.getElementById("booking-availability-field");
  if (!modeField || !availabilityField || !availabilityWrapper) return;

  const isRequired = requiresBookingAvailability(modeField.value);
  availabilityWrapper.hidden = !isRequired;
  availabilityWrapper.style.display = isRequired ? "block" : "none";
  availabilityField.required = isRequired;

  if (!isRequired) availabilityField.value = "";
}

/** 建立並保存匿名瀏覽器識別碼，只用於基本限流。時間／空間複雜度 O(1)。 */
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

/** 建立單次請求識別碼，供後端進行冪等檢查。時間／空間複雜度 O(1)。 */
function createBookingRequestId() {
  return window.crypto?.randomUUID?.()
    || `booking-request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 將網站欄位整理成 Apps Script 接收格式。時間／空間複雜度 O(m)。 */
function buildBookingPayload(form) {
  const mode = form.elements["mode"].value;

  return {
    action: "createbooking",
    requestId: createBookingRequestId(),
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
 * 時間／空間複雜度 O(1)（不含網路延遲）。
 *
 * no-cors 只能確認瀏覽器完成送出，無法讀取 Apps Script 的入庫結果；
 * 因此呼叫端不得把 opaque response 當成已成功寫入。
 */
async function postBooking(url, payload) {
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    cache: "no-store",
    keepalive: true,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });

  return Object.freeze({ requestSent: true, storageConfirmed: false });
}

/** 顯示表單內狀態文字。時間／空間複雜度 O(1)。 */
function showBookingMessage(message, type = "") {
  const element = document.getElementById("booking-message");
  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden", "is-error", "is-success");
  if (type) element.classList.add(type);
}

/** 清除表單內狀態文字。時間／空間複雜度 O(1)。 */
function clearBookingMessage() {
  const element = document.getElementById("booking-message");
  if (!element) return;

  element.textContent = "";
  element.classList.add("hidden");
  element.classList.remove("is-error", "is-success");
}

/** 初始化條件式時間欄位。時間／空間複雜度 O(1)。 */
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

/** 預約送出事件。時間／空間複雜度 O(m)。 */
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
  showBookingMessage("預約請求送出中……");

  try {
    const payload = buildBookingPayload(form);
    const delivery = await postBooking(apiUrl, payload);

    if (!delivery.requestSent) throw new Error("瀏覽器未完成預約請求。");

    form.reset();
    syncBookingAvailabilityField(form);
    showBookingMessage(
      "預約請求已送出。因 Apps Script 跨網域限制，前端無法確認是否已完成入庫；若 24 小時內未收到回覆，請改由 IG 或 Email 聯絡。"
    );

    await window.EvanDialog?.alert(
      "預約請求已送出，但前端無法確認是否完成入庫。\n若 24 小時內未收到回覆，請改由 IG 或 Email 聯絡，避免漏接。",
      "預約請求已送出"
    );
  } catch (error) {
    console.error("[booking] 預約送出失敗：", error);
    showBookingMessage("預約送出時遇到網路問題，表單內容已保留；請稍後重試或改用 IG／Email 聯絡。", "is-error");

    await window.EvanDialog?.alert(
      "預約送出時遇到網路問題。\n表單內容仍保留，請稍後重試，或改用 IG／Email 聯絡。",
      "送出失敗"
    );
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};
