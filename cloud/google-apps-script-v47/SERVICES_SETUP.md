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
3. 保留或覆蓋現有的 `Articles.gs`。
4. 新增或覆蓋 `ArticleAdmin.gs`。
5. 新增 `Services.gs`，貼入本資料夾同名檔案內容。
6. 儲存後執行 `setupServicesSheet`。
7. 回試算表確認新增 `Services` 分頁，且既有三項服務已匯入。
8. 選擇「部署 → 管理部署作業 → 編輯」，建立新版本並重新部署同一個 Web App。
9. 回到網站，以 `ADMIN_EMAILS` 內的 Google 帳號登入；驗證成功後會顯示「服務管理」。

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

應包含：

```json
{
  "servicesConfigured": true,
  "servicesError": ""
}
```

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
