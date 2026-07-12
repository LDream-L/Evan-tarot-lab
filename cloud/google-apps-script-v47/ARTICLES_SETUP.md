# 文章管理設定

## 必要檔案

同一個 Apps Script 專案需包含：

```text
Code.gs
AuthProfiles.gs
Articles.gs
ArticleAdmin.gs
AdminHistory.gs
Backups.gs
```

## 第一次啟用或更新

1. 從正式資料試算表開啟 Apps Script。
2. 使用 GitHub `main` 最新版 `Code.gs`、`AuthProfiles.gs`、`Articles.gs`、`ArticleAdmin.gs`。
3. 新增 `AdminHistory.gs` 與 `Backups.gs`。
4. 執行 `setupCommentsSheet`。
5. 執行 `setupArticlesSheet`。
6. 執行 `setupAdminHistorySheet`。
7. 確認指令碼屬性有 `GOOGLE_OAUTH_CLIENT_ID` 與 `ADMIN_EMAILS`。
8. 更新同一個 Web App 的新版本。
9. 回網站登入管理員帳號後開啟「文章管理」。

## 健康檢查

```text
?action=auth-health
?action=articles-health
?action=health
```

登入健康檢查必須顯示 `ready: true`，不能只看文章工作表正常。

## 發布方式

- `draft`：草稿，不公開。
- `published`：公開。
- `scheduled`：到 `publishAt` 後公開。
- `archived`：封存，不公開。

`content` 以空白行分隔段落。`internalNote` 只留在私人試算表，不會傳到網站。

## 修改歷史與備份

文章建立、修改、刪除會寫入 `AdminHistory`。首次執行 `setupDailyBackups` 後，綁定試算表會每日完整備份至私人 Google Drive，預設保留 60 天。

## 權限原則

- 公開文章讀取不需要登入。
- `adminArticles`、`saveArticle`、`deleteArticle` 都會再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- 前端顯示管理按鈕不是權限本身。
