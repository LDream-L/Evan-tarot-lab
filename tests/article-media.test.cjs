const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");

/** 讀取來源檔。時間／空間 O(n)，n = 檔案長度。 */
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

/**
 * 驗證文章圖片前後端路由、查重、格式檢查與正式頁面載入契約。
 * 時間／空間 O(S)，S = 受檢來源總長度。
 *
 * 更快替代方案比較：只以瀏覽器人工上傳無法覆蓋 Apps Script 未部署或路由漏接；
 * 本測試先以靜態契約攔截結構性缺漏，再由 E2E 驗證瀏覽器互動。
 */
function run() {
  const code = read("cloud/google-apps-script-v47/Code.gs");
  const backend = read("cloud/google-apps-script-v47/ArticleMedia.gs");
  const library = read("JS/article-media-library.js");
  const upload = read("JS/article-media-upload.js");
  const publicRefresh = read("JS/article-media-refresh.js");
  const adminRefresh = read("JS/article-admin-media-refresh.js");
  const adminHtml = read("article-admin.html");
  const articleHtml = read("article.html");
  const uploadCss = read("article-media-upload.css");

  new vm.Script(code, { filename: "Code.gs" });
  new vm.Script(backend, { filename: "ArticleMedia.gs" });
  new vm.Script(library, { filename: "article-media-library.js" });
  new vm.Script(upload, { filename: "article-media-upload.js" });
  new vm.Script(publicRefresh, { filename: "article-media-refresh.js" });
  new vm.Script(adminRefresh, { filename: "article-admin-media-refresh.js" });

  [
    "setupArticleMediaLibrary",
    "getArticleMediaHealth_",
    "listPublicArticleMedia_",
    "listAdminArticleMedia_",
    "isArticleMediaIdAvailable_",
    "uploadArticleMedia_",
    "detectArticleImageType_",
  ].forEach((functionName) => {
    assert.match(backend, new RegExp(`function\\s+${functionName}\\s*\\(`), `ArticleMedia.gs 缺少 ${functionName}`);
  });

  assert.match(backend, /ARTICLE_MEDIA_FOLDER_ID/, "圖片資料夾 ID 應保存於 Script Properties");
  assert.match(backend, /getFilesByName\(fileName\)/, "後端必須檢查 Drive 檔名重複");
  assert.match(backend, /圖片名稱「\$\{article\.id\}」已存在|圖片名稱「\$\{id\}」已存在/, "後端必須拒絕重複圖片代碼");
  assert.match(backend, /image\/jpeg/);
  assert.match(backend, /image\/png/);
  assert.match(backend, /image\/webp/);
  assert.match(backend, /setSharing\(DriveApp\.Access\.ANYONE_WITH_LINK, DriveApp\.Permission\.VIEW\)/);

  assert.match(code, /"article-media-health"/);
  assert.match(code, /"article-media"/);
  assert.match(code, /"checkarticlemediaid"/);
  assert.match(code, /"uploadarticlemedia"/);
  assert.match(code, /articleMediaConfigured:/);

  assert.match(library, /const mediaById = new Map/);
  assert.match(library, /function has\(mediaId\)/);
  assert.match(library, /function add\(rawMedia\)/);
  assert.match(library, /function refresh\(options = \{\}\)/);
  assert.match(library, /action", "article-media"/);
  assert.match(library, /const ready = refresh/);

  assert.match(upload, /checkArticleMediaId/);
  assert.match(upload, /uploadArticleMedia/);
  assert.match(upload, /createImageBitmap|document\.createElement\("canvas"\)/);
  assert.match(upload, /image\/webp/);
  assert.match(upload, /MAX_UPLOAD_BYTES = 6 \* 1024 \* 1024/);
  assert.match(upload, /\[\[image:\$\{media\.id\}\|\$\{variant\}\]\]/);

  assert.match(adminHtml, /article-media-upload\.css/);
  assert.match(adminHtml, /JS\/article-media-upload\.js/);
  assert.match(adminHtml, /JS\/article-admin-media-refresh\.js/);
  assert.match(articleHtml, /JS\/article-media-refresh\.js/);
  assert.match(uploadCss, /article-admin-media-id-status\[data-state="error"\]/);

  console.log("article media upload contracts passed");
}

run();
