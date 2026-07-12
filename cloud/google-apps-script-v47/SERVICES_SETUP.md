# 服務與多方案價格管理設定

## 資料模型

`Services` 一列代表一個服務大方向，例如感情、職涯或綜合主題。每個大方向可再建立多個方案，依下列因素分開定價：

- 單一問題或多層次問題
- 文字、語音／通話或彈性交付
- 是否包含時間軸、數字、比較路線等額外計算
- 預計工期與追問範圍

方案集中儲存在 `plansJson` 欄位，由網站管理後台維護。公開頁只輸出服務狀態為 `published`、方案狀態為 `published` 的資料。

若某個服務尚未建立方案，網站會暫時使用舊的費用、時間、交付與追問欄位作為備援。

## 必要 Apps Script 檔案

請確認同一個綁定試算表的 Apps Script 專案至少包含：

```text
Code.gs
AuthProfiles.gs
Articles.gs
ArticleAdmin.gs
Services.gs
AdminHistory.gs
Backups.gs
```

原有尋物或通知模組可保留。

## 更新步驟

1. 以 GitHub `main` 的最新版覆蓋上述檔案。
2. 執行 `setupCommentsSheet`，確認 `Comments`、`Profiles` 存在。
3. 執行 `setupServicesSheet`。
   - 舊版 15 欄 `Services` 會安全新增第 16 欄 `plansJson`。
   - 不會覆蓋既有服務資料。
4. 執行 `setupAdminHistorySheet`，建立 `AdminHistory`。
5. 在「專案設定 → 指令碼屬性」確認：
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `ADMIN_EMAILS`
6. 重新部署原本同一個 Web App，版本選「新版本」。
7. 回網站登入管理員帳號，進入「服務管理」。

## 健康檢查

登入與資料層：

```text
?action=auth-health
```

正常結果：

```json
{
  "success": true,
  "ready": true,
  "missing": []
}
```

服務資料：

```text
?action=services-health
```

正常結果應包含：

```json
{
  "success": true,
  "ready": true,
  "schemaVersion": 2,
  "missingHeaders": []
}
```

整體狀態：

```text
?action=health
```

應至少包含：

```json
{
  "authReady": true,
  "servicesConfigured": true,
  "servicesSchemaVersion": 2,
  "deprecatedProperties": []
}
```

## 舊指令碼屬性清理

新版文章與服務管理統一使用 `ADMIN_EMAILS`。確認 `ADMIN_EMAILS` 正確後，可在 Apps Script 手動執行：

```text
cleanupDeprecatedScriptProperties
```

它只會移除不再使用的 `ARTICLE_ADMIN_EMAILS`；通知相關的 `NOTIFY_EMAILS` 與 `IMMEDIATE_NOTIFY_CURSOR_*` 不會被刪除。

## 方案欄位

每個方案包含：

- 方案 ID：建立後保持穩定
- 狀態：`published` 或 `hidden`
- 方案名稱
- 問題規模與範圍
- 價格
- 預計時間
- 預約形式：文字、語音、皆可或自訂
- 公開交付內容
- 額外計算／工作量
- 追問範圍
- 排序值

公開方案必須有價格與交付內容。預約選單值會自動組成：

```text
服務ID--方案ID
```

## 修改歷史

建立、修改與刪除服務時，系統會在 `AdminHistory` 寫入：

- 操作時間
- 操作者 Email
- request ID
- 修改前 JSON
- 修改後 JSON

即使永久刪除，刪除前快照仍會保留於歷史表。

## 每日備份

首次執行：

```text
setupDailyBackups
```

系統會：

- 在私人 Google Drive 建立 `Evan Tarot Backups` 資料夾
- 立即建立一份完整 JSON 備份
- 每日凌晨約 3 點備份綁定試算表全部工作表
- 自動保留最近 60 天

可執行 `showBackupHealth_` 查看觸發器與資料夾設定。

## 權限與資料界線

- 公開頁不需要登入，只取得已發布服務與已公開方案。
- `internalNote`、隱藏方案與歷史快照只對後端管理流程可見。
- 管理操作會再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- 前端顯示管理按鈕不是權限依據。
