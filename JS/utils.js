// ==============================
// utils.js
// 共用時間小工具
// ==============================
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)

(function initSharedUtils() {
  /**
   * 取得台北時間 ISO 字串（不含時區尾碼）。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function nowTaipeiISO() {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  }

  window.nowTaipeiISO = nowTaipeiISO;
})();
