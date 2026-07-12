# 服務項目管理設定

## 功能

服務資料改由私人 Google Sheets 管理。網站公開頁只讀取 `published` 項目；草稿、封存與內部備註不會公開。

可在線上管理：

- 服務名稱與簡介
- 適合情境與整理重點
- 費用
- 預計時間
- 交付方式
- 追問範圍
- 改期、取消、退款或承接界線
- 公開狀態與排序

## 第一次啟用

1. 從正式資料試算表開啟 Apps Script。
2. 使用本資料夾最新版 `Code.gs`。
3. **新增或覆蓋 `AuthProfiles.gs`**。這個檔案負責 Google ID Token 驗證、管理員權限、公開暱稱與留言資料層，不能省略。
4. 保留或覆蓋現有的 `Articles.gs`。
5. 新增或覆蓋 `ArticleAdmin.gs`。
6. 新增或覆蓋 `Services.gs`。
7. 儲存後先執行 `setupCommentsSheet`，確認 `Comments` 與 `Profiles` 分頁存在。
8. 執行 `setupServicesSheet`。
9. 回試算表確認新增 `Services` 分頁，且既有三項服務已匯入。
10. 在「專案設定 → 指令碼屬性」確認：
    - `GOOGLE_OAUTH_CLIENT_ID`：與網站 `JS/cloud-config.js` 相同的 Google OAuth Web Client ID。
    - `ADMIN_EMAILS`：可管理文章與服務的 Email；多個帳號以逗號分隔。
11. 選擇「部署 → 管理部署作業 → 編輯」，建立新版本並重新部署同一個 Web App。
12. 回到網站，以 `ADMIN_EMAILS` 內的 Google 帳號登入；驗證成功後會顯示「服務管理」。

## 健康檢查

在 Web App 網址後加：

```text
?action=services-health
```

正常時會顯示：

```json
{"success":true,"ready":true,"missingHeaders":[]}
```

整體健康檢查：

```text
?action=health
```

應至少包含：

```json
{
  "authConfigured": true,
  "servicesConfigured": true,
  "servicesError": ""
}
```

`services-health` 只代表 Services 工作表結構正常；若登入時出現 `verifyGoogleCredential_ is not defined`，代表 Apps Script 專案漏裝 `AuthProfiles.gs`，必須加入後重新部署。

也可在 Apps Script 編輯器手動執行：

```text
showAuthProfilesHealth_
```

用來檢查 OAuth Client ID、管理員 Email、Comments 與 Profiles 工作表。

## 狀態

- `draft`：草稿，不公開。
- `published`：顯示於占卜項目頁與預約選單。
- `archived`：封存，不公開，但保留於後台。

## 權限與資料界線

- 公開服務列表不需要登入。
- `adminServices`、`saveService`、`deleteService` 會在 Apps Script 再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- `internalNote` 只回傳給已通過管理員驗證的後台。
- 前端隱藏按鈕不是安全邊界；真正的讀寫權限由 Apps Script 控制。

## 更新服務

1. 網站右上角登入管理員 Google 帳號。
2. 開啟「服務管理」。
3. 新增或選取服務。
4. 填寫公開資料。
5. 可先儲存草稿，確認預覽後再發布。
6. 公開頁下次讀取時會取得最新資料，不需要重新部署 GitHub Pages。
