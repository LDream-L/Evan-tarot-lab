# Evan Tarot｜Google 登入＋Apps Script 留言系統

## 架構

```text
GitHub Pages
├─ Google Identity Services 登入
├─ 文章留言／回覆
└─ Google ID Token
        ↓
Google Apps Script Web App
├─ 驗證 Google 帳號
├─ 產生公開匿名代號
└─ 寫入 Google Sheets
```

Google Email 只保存在試算表後台，不會由公開留言 API 回傳。網站公開顯示格式為：

```text
Google 訪客 A1B2
```

## 一、建立 Google OAuth Web Client ID

1. 開啟 Google Cloud Console。
2. 建立或選擇專案。
3. 設定 Google Auth Platform 的 Branding。
4. 建立 OAuth Client，應用程式類型選「Web application」。
5. Authorized JavaScript origins 加入：

```text
https://ldream-l.github.io
```

本機測試時可另外加入實際使用的 localhost origin，例如：

```text
http://localhost:5500
```

6. 複製以 `.apps.googleusercontent.com` 結尾的 Client ID。

## 二、設定網站前端

在 `JS/cloud-config.js` 填入同一組 Client ID：

```js
window.EVAN_CLOUD_CONFIG = Object.freeze({
  commentsApiUrl: "你的 Apps Script /exec 網址",
  googleClientId: "你的 OAuth Web Client ID",
});
```

Client ID 可公開；Client Secret 絕對不可放進 GitHub。

## 三、更新 Apps Script

1. 從 Google 試算表開啟「擴充功能 → Apps Script」。
2. 將本資料夾的 `Code.gs` 完整覆蓋到 Apps Script。
3. 開啟 Apps Script 左側「專案設定」。
4. 在「指令碼屬性」新增：

```text
GOOGLE_OAUTH_CLIENT_ID = 你的 OAuth Web Client ID
ADMIN_EMAILS = 你的管理員 Gmail
```

多個管理員 Email 可用逗號分隔。

5. 儲存並執行一次 `setupCommentsSheet`。
6. 選擇「部署 → 管理部署作業 → 編輯」。
7. 版本選「新版本」後重新部署。
8. 執行身分選「我」，存取權維持「任何人」。

## 四、健康檢查

開啟：

```text
你的 /exec 網址?action=health
```

應看到：

```json
{
  "success": true,
  "service": "Evan Tarot Google Comments",
  "authConfigured": true
}
```

## 權限結果

- 未登入：可閱讀文章與公開留言，不能留言或回覆。
- Google 已登入：可留言與回覆。
- Email 不公開，試算表後台仍可辨認留言者。
- 回覆固定只有一層，同一主留言下可持續增加多則回覆。
- 每位帳號每分鐘最多寫入 10 次，降低灌留言風險。

## 現階段限制

目前 Google 登入先套用在文章留言與回覆。文章新增／修改／刪除後台，以及其他資料全面雲端化，可沿用同一組 Google 管理員身分繼續擴充。
