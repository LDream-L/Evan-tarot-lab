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

// Apps Script Web App URL 本來就是公開前端設定；直接保留可讀字串，避免字元碼混淆造成維護困難。
const EVAN_CLOUD_API_URL = "https://script.google.com/macros/s/AKfycbzswz6AgA2DnXKNVwfSgCHBUwgiqZCT6w8McUVw8EOCBxvnPb2--SxAZJelKsakdbrv/exec";

window.EVAN_CLOUD_CONFIG = Object.freeze({
  commentsApiUrl: EVAN_CLOUD_API_URL,
  lostItemApiUrl: EVAN_CLOUD_API_URL,
  articlesApiUrl: EVAN_CLOUD_API_URL,
  servicesApiUrl: EVAN_CLOUD_API_URL,
  bookingApiUrl: "https://script.google.com/macros/s/AKfycbykVXhAk-hZhga2vcDjUj6vD0fq6y12DG0dzPmjlTi4crqP1qiLGFOaIzo1lCswbA0I/exec",
  footballApiUrl: "https://script.google.com/macros/s/AKfycbxDiCjFB7IufBQRIOI121idnoy1raHe4FdkNgMWZa6VGQ4KdQJWdsAyl7sSsq7hzdx5/exec",
  googleClientId: "932432791893-tuj2pi0gv8v1v5oiscahueludlrpmsnv.apps.googleusercontent.com",
});
