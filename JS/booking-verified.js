// ==============================
// booking-verified.js
// Apps Script HTML Service 橋接：後端確認寫入後才回傳 bookingId
// ==============================
// 主要函式複雜度：
// - buildFingerprint / buildVerifiedPayload：時間、空間 O(m)，m 為輸入文字長度
// - initBridge：時間、空間 O(1)（不含網路等待）
// - postViaBridge / handleVerifiedBooking：時間、空間 O(m)（不含網路等待）
//
// 替代方案：no-cors 只能確認請求已送出；本模組用隱藏 HTML Service iframe
// 配合 google.script.run 取得真實 bookingId。橋接尚未部署時保留 no-cors 備援，
// 但不會把備援誤報為已完成入庫。
// ==============================

(function initVerifiedBookingModule() {
  "use strict";

  const CHANNEL = "evan-tarot-booking";
  const PENDING_KEY = "evanTarotPendingBooking.v1";
  const READY_TIMEOUT_MS = 12000;
  const RESPONSE_TIMEOUT_MS = 20000;
  const MAX_PENDING_AGE_MS = 6 * 60 * 60 * 1000;

  const state = {
    iframe: null,
    bridgeWindow: null,
    bridgeOrigin: "",
    nonce: "",
    ready: false,
    readyPromise: null,
    resolveReady: null,
    readyTimer: 0,
    pending: new Map(),
    listening: false,
  };

  function makeError(message, code) {
    const error = new Error(String(message || "預約系統發生錯誤。"));
    error.code = code || "BOOKING_ERROR";
    return error;
  }

  function makeRequestId() {
    return window.crypto?.randomUUID?.()
      || `booking-request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  // 時間、空間 O(m)。
  function buildFingerprint(form) {
    const mode = form.elements.mode.value;
    return JSON.stringify({
      name: form.elements.name.value.trim(),
      contact: form.elements.contact.value.trim(),
      topic: form.elements.topic.value,
      mode,
      availability: mode && mode !== "text" ? form.elements.availability.value.trim() : "",
      message: form.elements.message.value.trim(),
    });
  }

  // 時間、空間 O(m)。相同內容重試沿用 requestId。
  function getPendingRequestId(form) {
    const fingerprint = buildFingerprint(form);
    try {
      const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
      const age = Date.now() - Number(saved?.createdAt || 0);
      if (saved?.requestId && saved.fingerprint === fingerprint && age >= 0 && age <= MAX_PENDING_AGE_MS) {
        return saved.requestId;
      }
    } catch (error) {
      console.warn("[booking] 無法讀取待送出 requestId：", error);
    }

    const requestId = makeRequestId();
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ requestId, fingerprint, createdAt: Date.now() }));
    } catch (error) {
      console.warn("[booking] 無法保存待送出 requestId：", error);
    }
    return requestId;
  }

  function clearPendingRequest(requestId) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
      if (!saved || saved.requestId === requestId) sessionStorage.removeItem(PENDING_KEY);
    } catch (error) {
      sessionStorage.removeItem(PENDING_KEY);
    }
  }

  // 時間、空間 O(m)。沿用原 booking.js 欄位清理，再覆蓋持久 requestId。
  function buildVerifiedPayload(form) {
    const payload = window.buildBookingPayload(form);
    payload.requestId = getPendingRequestId(form);
    return payload;
  }

  function bridgeUrl(nonce) {
    const apiUrl = window.getBookingApiUrl();
    if (!apiUrl) return "";
    const url = new URL(apiUrl);
    url.searchParams.set("view", "booking-bridge");
    url.searchParams.set("bridgeNonce", nonce);
    url.searchParams.set("v", "20260711-target-origin-v1");
    return url.toString();
  }

  function isGoogleOrigin(origin) {
    try {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (
        host === "script.google.com"
        || host === "script.googleusercontent.com"
        || host.endsWith(".googleusercontent.com")
      );
    } catch (error) {
      return false;
    }
  }

  function onBridgeMessage(event) {
    const data = event.data || {};
    if (!state.iframe || !isGoogleOrigin(event.origin)) return;
    if (data.channel !== CHANNEL || data.nonce !== state.nonce) return;
    if (state.bridgeWindow && event.source !== state.bridgeWindow) return;
    if (!state.bridgeWindow && data.type !== "ready") return;

    if (data.type === "ready") {
      state.bridgeWindow = event.source;
      state.bridgeOrigin = event.origin;
      state.ready = true;
      clearTimeout(state.readyTimer);
      state.resolveReady?.(true);
      return;
    }

    const requestId = String(data.requestId || "");
    const pending = state.pending.get(requestId);
    if (!pending) return;
    state.pending.delete(requestId);
    clearTimeout(pending.timer);

    if (data.type === "result") pending.resolve(data.result || {});
    else if (data.type === "error") pending.reject(makeError(data.error, "BACKEND_ERROR"));
  }

  function resetBridge() {
    clearTimeout(state.readyTimer);
    state.iframe?.remove();
    state.iframe = null;
    state.bridgeWindow = null;
    state.bridgeOrigin = "";
    state.nonce = "";
    state.ready = false;
    state.readyPromise = null;
    state.resolveReady = null;
  }

  // 時間、空間 O(1)。
  function initBridge() {
    if (state.ready) return Promise.resolve(true);
    if (state.readyPromise) return state.readyPromise;

    const nonce = makeRequestId();
    const src = bridgeUrl(nonce);
    if (!src) return Promise.reject(makeError("預約橋接網址尚未設定。", "BRIDGE_UNAVAILABLE"));

    if (!state.listening) {
      window.addEventListener("message", onBridgeMessage);
      state.listening = true;
    }

    state.nonce = nonce;
    state.readyPromise = new Promise((resolve, reject) => {
      state.resolveReady = resolve;
      const iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.title = "Evan Tarot 預約安全橋接";
      iframe.hidden = true;
      iframe.tabIndex = -1;
      iframe.setAttribute("aria-hidden", "true");
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.addEventListener("error", () => {
        reject(makeError("預約橋接頁載入失敗。", "BRIDGE_UNAVAILABLE"));
        resetBridge();
      }, { once: true });
      state.iframe = iframe;
      document.body.appendChild(iframe);

      state.readyTimer = setTimeout(() => {
        reject(makeError("預約橋接服務逾時。", "BRIDGE_UNAVAILABLE"));
        resetBridge();
      }, READY_TIMEOUT_MS);
    });
    return state.readyPromise;
  }

  // 時間、空間 O(m)。ready 訊息確認來源後，後續只向同一個精確 origin 傳送資料。
  async function postViaBridge(payload) {
    await initBridge();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(payload.requestId);
        reject(makeError("等待後端確認逾時。", "BRIDGE_TIMEOUT"));
      }, RESPONSE_TIMEOUT_MS);
      state.pending.set(payload.requestId, { resolve, reject, timer });

      if (!state.bridgeWindow || !state.bridgeOrigin) {
        clearTimeout(timer);
        state.pending.delete(payload.requestId);
        reject(makeError("預約橋接頁尚未就緒。", "BRIDGE_UNAVAILABLE"));
        return;
      }

      state.bridgeWindow.postMessage(
        { channel: CHANNEL, nonce: state.nonce, type: "create", payload },
        state.bridgeOrigin
      );
    });
  }

  async function sendUnverifiedFallback(apiUrl, payload) {
    await window.postBooking(apiUrl, payload);
    return { requestSent: true, storageConfirmed: false };
  }

  // 時間、空間 O(m)。
  async function handleVerifiedBooking(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.currentTarget;
    window.syncBookingAvailabilityField(form);
    window.clearBookingMessage();
    if (!form.reportValidity()) return;

    const apiUrl = window.getBookingApiUrl();
    if (!apiUrl) {
      window.showBookingMessage("預約系統尚未完成設定，請暫時改用 IG 或 Email 聯絡。", "is-error");
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    window.showBookingMessage("正在送出並等待後端確認……");
    const payload = buildVerifiedPayload(form);

    try {
      let result;
      try {
        result = await postViaBridge(payload);
      } catch (bridgeError) {
        if (bridgeError.code === "BACKEND_ERROR") throw bridgeError;
        console.warn("[booking] 橋接無法確認，使用相容備援：", bridgeError);
        await sendUnverifiedFallback(apiUrl, payload);
        window.showBookingMessage(
          "預約請求已送出，但目前無法讀取後端確認結果。表單與 requestId 已保留；若 24 小時內未收到回覆，請由 IG 或 Email 聯絡。"
        );
        await window.EvanDialog?.alert(
          "預約請求已送出，但目前無法確認是否完成入庫。\n表單內容已保留；若 24 小時內未收到回覆，請由 IG 或 Email 聯絡。",
          "已送出，等待確認"
        );
        return;
      }

      if (!result?.ok && !result?.success) throw makeError(result?.error || "後端拒絕這筆預約。", "BACKEND_ERROR");
      if (!result.bookingId) throw makeError("後端未回傳預約編號。", "INVALID_RESPONSE");

      clearPendingRequest(payload.requestId);
      form.reset();
      window.syncBookingAvailabilityField(form);
      const prefix = result.duplicate ? "這筆需求先前已收到" : "預約需求已成功收到";
      window.showBookingMessage(
        `${prefix}，預約編號：${result.bookingId}。送出需求不代表預約已正式成立，我會再依聯絡方式確認。`,
        "is-success"
      );
      await window.EvanDialog?.alert(
        `${prefix}。\n預約編號：${result.bookingId}\n我會再依你留下的聯絡方式確認是否承接、時間與費用。`,
        result.duplicate ? "已找到原預約" : "預約需求已收到"
      );
    } catch (error) {
      console.error("[booking] 預約送出失敗：", error);
      window.showBookingMessage(
        `${error.message || "預約送出失敗。"} 表單與 requestId 已保留，請修正後重試或改用 IG／Email 聯絡。`,
        "is-error"
      );
      await window.EvanDialog?.alert(
        `${error.message || "預約送出失敗。"}\n表單內容仍保留，請稍後重試，或改用 IG／Email 聯絡。`,
        "送出失敗"
      );
    } finally {
      if (button) button.disabled = false;
    }
  }

  function initForm() {
    const form = document.getElementById("booking-form");
    if (!form || form.dataset.verifiedBookingReady === "1") return;
    form.dataset.verifiedBookingReady = "1";
    window.handleBookingForm = handleVerifiedBooking;
    form.addEventListener("submit", handleVerifiedBooking);
    initBridge().catch((error) => console.warn("[booking] 橋接預載尚未完成：", error.message));
  }

  document.addEventListener("DOMContentLoaded", initForm);
})();
