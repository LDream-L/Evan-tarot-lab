# 文章管理設定

## 必要檔案

同一個 Apps Script 專案需包含：

```text
Code.gs
AuthProfiles.gs
Articles.gs
ArticleAdmin.gs
ArticleMedia.gs
AdminHistory.gs
Backups.gs
```

## 第一次啟用或更新

1. 從正式資料試算表開啟 Apps Script。
2. 使用 GitHub `main` 最新版 `Code.gs`、`AuthProfiles.gs`、`Articles.gs`、`ArticleAdmin.gs`、`ArticleMedia.gs`。
3. 新增或更新 `AdminHistory.gs` 與 `Backups.gs`。
4. 執行 `setupCommentsSheet`。
5. 執行 `setupArticlesSheet`。
6. 執行 `setupArticleMediaLibrary`，建立 `ArticleMedia` 工作表與專用 Google Drive 圖片資料夾。
7. 執行 `setupAdminHistorySheet`。
8. 確認指令碼屬性有 `GOOGLE_OAUTH_CLIENT_ID` 與 `ADMIN_EMAILS`。
9. 更新同一個 Web App 的新版本，網址不可更換。
10. 回網站登入管理員帳號後開啟「文章管理」。

## 健康檢查

```text
?action=auth-health
?action=articles-health
?action=article-media-health
?action=health
```

登入、文章與圖片健康檢查都必須顯示 `ready: true`。總體健康檢查中的 `authReady`、`articlesConfigured`、`articleMediaConfigured` 也應為 `true`。

## 圖片上傳與名稱規則

- 後台接受 JPEG、PNG、WebP；瀏覽器會先縮放大圖，送到後端的圖片不得超過 6 MB。
- 圖片實體存放在私人帳號的專用 Google Drive 資料夾；公開文章只讀取可公開檢視的圖片網址。
- 圖片名稱會成為文章中的固定代碼，只能使用小寫英文、數字、連字號與底線。
- 前端會先提示是否重複；真正寫入前，Apps Script 會在鎖內再次檢查 `ArticleMedia` 代碼與 Drive 檔名，避免同時上傳造成重名。
- 文章正文只保存 `[[image:圖片代碼|版型]]`，不保存 Base64，也不把圖片內容寫進 Google Sheets。

## 發布方式

- `draft`：草稿，不公開。
- `published`：公開。
- `scheduled`：到 `publishAt` 後公開。
- `archived`：封存，不公開。

`content` 以空白行分隔段落。`internalNote` 只留在私人試算表，不會傳到網站。

## 修改歷史與備份

文章建立、修改、刪除會寫入 `AdminHistory`。首次執行 `setupDailyBackups` 後，綁定試算表會每日完整備份至私人 Google Drive，預設保留 60 天。

圖片檔案本身存放於 Google Drive；`ArticleMedia` 索引會隨試算表備份保存，但仍應保留 Drive 原始檔，不要手動刪除專用資料夾中的檔案。

## 權限原則

- 公開文章與公開圖片索引讀取不需要登入。
- `adminArticles`、`saveArticle`、`deleteArticle`、`adminArticleMedia`、`checkArticleMediaId`、`uploadArticleMedia` 都會再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- 前端顯示管理按鈕不是權限本身。
- GitHub 只保存前端與 Apps Script 原始碼；Google Drive 圖片、Google Sheets 資料與 Script Properties 不提交至 GitHub。
