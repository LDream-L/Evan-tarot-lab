// ==============================
// booking.js
// 預約表單 -> Google Form
// ==============================
//
// 時間複雜度：O(1)（欄位數固定）
// 空間複雜度：O(1)
//
// 暴力法：<form> 直接 action 到 Google，整個畫面跳轉。
// 優化法（本實作）：用 fetch + no-cors，把資料送出去，但人留在你的網站。
// ==============================

// ★ 這裡換成你自己的「占卜預約」Google 表單資訊
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
 * 將預約表單欄位打包成 FormData
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function buildBookingFormData(form) {
  const fd = new FormData();
  const f = BOOKING_GOOGLE_FORM.fields;

  fd.append(f.name, form.elements["name"].value.trim());
  fd.append(f.contact, form.elements["contact"].value.trim());
  fd.append(f.topic, form.elements["topic"].value);
  fd.append(f.mode, form.elements["mode"].value);
  fd.append(f.message, form.elements["message"].value.trim());
  // 有些 Google Form 習慣多帶一個 submit 欄位，保險起見可以加
  fd.append("submit", "Submit");

  return fd;
}

/**
 * 對 Google Form 發送 POST
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 暴力法：不用 JS，直接 <form> submit。
 * 本實作：fetch + no-cors，在體驗與靈活度上更好。
 */
function postToGoogleForm(url, formData) {
  return fetch(url, {
    method: "POST",
    mode: "no-cors",
    body: formData,
  });
}

// 主要事件處理函式
// 時間複雜度：O(1)
// 空間複雜度：O(1)
window.handleBookingForm = function handleBookingForm(event) {
  event.preventDefault();
  const form = event.target;

  const formData = buildBookingFormData(form);

  postToGoogleForm(BOOKING_GOOGLE_FORM.url, formData)
    .then(() => {
      alert("已送出預約意願，感謝你。\n我會依照你留下的聯絡方式回覆時間與細節。");
      form.reset();
    })
    .catch(() => {
      // 只有在網路真的錯誤時才會進到這裡
      alert(
        "預約送出時遇到網路問題。\n建議你暫時改用 IG / Email 聯絡一次，避免漏接。"
      );
    });
};
