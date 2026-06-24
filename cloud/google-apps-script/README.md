# Evan Tarot 留言雲端 API

網站端已支援雲端留言，且在 API 尚未啟用時會保留原本的 localStorage 與 Google Form 備援，不會讓現有留言功能中斷。

## Google 端只需完成一次

1. 建立一份 Google 試算表。
2. 在試算表開啟「擴充功能 → Apps Script」。
3. 將本資料夾的 `Code.gs` 全部貼入。
4. 手動執行一次 `setupCommentsSheet`，並允許權限。
5. 選擇「部署 → 新增部署 → 網頁應用程式」。
6. 執行身分選擇「我」，存取權選擇「任何人」。
7. 複製以 `/exec` 結尾的網址。
8. 將網址填入網站的 `JS/cloud-config.js`：

```js
window.EVAN_CLOUD_CONFIG = Object.freeze({
  commentsApiUrl: "https://script.google.com/macros/s/你的部署ID/exec",
});
```

## 測試

將 `/exec` 網址後方加上：

```text
?action=health
```

瀏覽器應看到 `success: true`。

## 舊留言匯入

API 啟用後，在曾經保存舊留言的瀏覽器開啟文章頁，按 F12，在 Console 執行一次：

```js
await EvanCloudComments.migrateLegacyLocalComments()
```

每個瀏覽器只需執行一次。
