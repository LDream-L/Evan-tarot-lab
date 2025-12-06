// ==============================
// booking.js
// 預約表單（目前示意用）
// ==============================
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)
//
// 暴力法：現在就串接 Google Sheet / 後端，牽扯權限 & 安全性
// 本實作：先用 alert + reset，未來你要接後端再改這裡即可
// ==============================

window.handleBookingForm = function handleBookingForm(event) {
  event.preventDefault();

  alert(
    "目前為示意表單。\n正式版可以串接到：Email、Google 表單、Notion 或其他你習慣的接案系統。"
  );

  event.target.reset();
};
