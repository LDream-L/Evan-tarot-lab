# 文章管理設定

## 第一次啟用

1. 從原本「塔羅牌」試算表開啟 Apps Script。
2. 使用本資料夾最新版 `Code.gs`。
3. **新增或覆蓋 `AuthProfiles.gs`**。這個檔案負責 Google ID Token 驗證、管理員權限、公開暱稱與留言資料層，不能省略。
4. 新增或覆蓋指令碼檔案 `Articles.gs`。
5. 新增或覆蓋指令碼檔案 `ArticleAdmin.gs`。
6. 儲存後先執行 `setupCommentsSheet`，確認 `Comments` 與 `Profiles` 分頁存在。
7. 執行 `setupArticlesSheet`。
8. 回試算表確認新增 `Articles` 分頁，且原本四篇文章已匯入。
9. 在「專案設定 → 指令碼屬性」確認：
   - `GOOGLE_OAUTH_CLIENT_ID`：與網站 `JS/cloud-config.js` 相同的 Google OAuth Web Client ID。
   - `ADMIN_EMAILS`：可管理文章與服務的 Email；多個帳號以逗號分隔。
10. 將同一個網頁應用程式更新成新版本。
11. 回到網站，以 `ADMIN_EMAILS` 內的 Google 帳號登入；驗證成功後會顯示「文章管理」。

## 健康檢查

在網頁應用程式網址後加：

```text
?action=articles-health
```

正常時會顯示：

```json
{"success":true,"ready":true,"missingHeaders":[]}
```

整體健康檢查 `?action=health` 中的 `authConfigured` 也必須為 `true`。

`articles-health` 只代表 Articles 工作表結構正常；若登入時出現 `verifyGoogleCredential_ is not defined`，代表 Apps Script 專案漏裝 `AuthProfiles.gs`，必須加入後重新部署。

## 發布方式

- `draft`：草稿，不公開。
- `published`：公開。
- `scheduled`：到 `publishAt` 後公開。
- `archived`：封存，不公開。

`content` 欄位以空白行分隔段落。`internalNote` 只留在私人試算表，不會傳到網站。

## 權限原則

- 公開文章讀取不需要登入。
- `adminArticles`、`saveArticle`、`deleteArticle` 都會在 Apps Script 再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- 前端顯示管理按鈕不是權限本身；即使直接開啟管理頁，後端未驗證也不能讀寫資料。
