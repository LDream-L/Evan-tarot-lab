// ==============================
// cloud-config.js
// Evan Tarot 雲端服務設定
// ==============================
//
// 部署 Google Apps Script Web App 後，將 /exec 網址填入 commentsApiUrl。
// 此檔案只放公開端點，不可放密碼、Token 或私人金鑰。
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)
// ==============================

window.EVAN_CLOUD_CONFIG = Object.freeze({
  commentsApiUrl: "",
});
