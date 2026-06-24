// ==============================
// cloud-config.js
// Evan Tarot 雲端服務設定
// ==============================
//
// 此檔案只放可公開的前端設定：
// - Apps Script Web App URL
// - Google OAuth Web Client ID
// 不可放 Client Secret、管理員密碼、Spreadsheet ID 或 service account 金鑰。
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)
// ==============================

const EVAN_CLOUD_API_URL = String.fromCharCode(
  104,116,116,112,115,58,47,47,115,99,114,105,112,116,46,103,111,111,103,108,101,46,99,111,109,47,109,97,99,114,111,115,47,115,47,65,75,102,121,99,98,122,115,119,122,54,65,103,65,50,68,110,88,75,78,86,119,102,83,103,67,72,66,85,119,103,105,113,90,67,84,54,119,56,77,99,85,86,119,56,69,79,67,66,120,118,110,80,98,50,45,45,83,120,65,90,74,101,108,75,115,97,107,100,98,114,118,47,101,120,101,99
);

window.EVAN_CLOUD_CONFIG = Object.freeze({
  commentsApiUrl: EVAN_CLOUD_API_URL,
  lostItemApiUrl: EVAN_CLOUD_API_URL,
  articlesApiUrl: EVAN_CLOUD_API_URL,
  googleClientId: "932432791893-tuj2pi0gv8v1v5oiscahueludlrpmsnv.apps.googleusercontent.com",
});
