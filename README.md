# Evan Tarot Lab

Evan Tarot 的正式靜態網站、公開實驗工具與私人 Google Sheets 資料後端。

## 正式版本原則

- GitHub `main`：網站程式唯一正式版本。
- GitHub Pages：由 `main` 通過建置與回歸測試後發布。
- Google Sheets：使用者資料、文章、服務、方案與研究紀錄的雲端資料來源。
- Apps Script：Google Sheets 的正式後端。
- 聊天附件：只補充 GitHub 沒有的檔案，不作為正式程式版本。

## 專案結構

```text
.
├─ index.html / services.html / articles.html / lab.html
├─ article-admin.html / service-admin.html
├─ JS/
│  ├─ core/                     # 共用載入器與無障礙對話框
│  ├─ security/                 # 動態連結安全
│  ├─ articles/                 # 文章備援
│  ├─ timeflow/                 # 時間流匯入／匯出介面
│  └─ bootstrap/                # 非阻塞帳戶與管理入口啟動
├─ src/
│  ├─ timeflow/                 # 可閱讀的時間流 JavaScript source
│  └─ styles/timeflow.css       # 可閱讀的時間流 CSS source
├─ scripts/                     # 結構化 HTML、CSS 與 JavaScript 建置器
├─ tests/                       # 靜態契約與 Playwright 回歸測試
├─ cloud/google-apps-script-v47/
│  ├─ Code.gs                  # Cloud API action router、健康檢查
│  ├─ AuthProfiles.gs          # Google Token、管理員、暱稱與留言資料層
│  ├─ Articles.gs              # 公開文章讀取
│  ├─ ArticleAdmin.gs          # 管理員文章寫入
│  ├─ Services.gs              # 服務大方向與多方案價格管理
│  ├─ AdminHistory.gs          # 文章／服務修改歷史
│  ├─ Backups.gs               # 每日 Google Drive JSON 備份
│  └─ *.md                     # Apps Script 部署說明
└─ dist/                       # 正式建置產物，不手動修改
```

## 本機指令

```bash
npm ci
npm run build
npm run test:build
npm run test:e2e
```

- `npm run build`：建立正式 `dist/`。
- `npm run test:build`：檢查導覽、品牌、登入依賴、服務方案、模組邊界、資料界線與正式輸出。
- `npm run test:e2e`：以桌機與行動裝置執行瀏覽器回歸測試。
- `npm run format:timeflow`：僅在需要由舊壓縮檔重新產生可讀 CSS source 時使用；平時應直接維護 `src/styles/timeflow.css`。

## 前端建置原則

- `JS/site-hardening.js` 只負責模組啟動順序，不再包含所有功能實作。
- 導覽與品牌由建置器依 HTML 標籤深度定位，不使用跨區塊 lazy regex 猜測結尾。
- `src/styles/timeflow.css` 是正式可維護來源；`dist/timeflow.css` 由 esbuild 壓縮產生。
- 已知文案修正應放在來源或建置期，不在頁面完成載入後改寫 DOM。
- `dist/` 不手動修改，也不提交後端、測試與 source 目錄。

## 發布流程

1. 在功能分支完成修改。
2. 執行建置與測試。
3. 建立 Pull Request。
4. CI 通過後合併至 `main`。
5. GitHub Pages workflow 完成正式發布與公開 smoke test。

## Apps Script 更新

GitHub Pages 與 Apps Script 是不同部署面：

- 網站前端改動：合併 `main` 後由 GitHub Pages 發布。
- 後端程式改動：將 `cloud/google-apps-script-v47/` 對應檔案更新至綁定試算表的 Apps Script，建立新版本並重新部署原 Web App。

文章後台請閱讀：

```text
cloud/google-apps-script-v47/ARTICLES_SETUP.md
```

服務與價格方案後台請閱讀：

```text
cloud/google-apps-script-v47/SERVICES_SETUP.md
```

## 後端健康檢查

```text
?action=auth-health
?action=articles-health
?action=services-health
?action=health
```

總體 `health` 必須同時確認 `authReady`、文章與服務資料，而不是只確認 OAuth Client ID 有值。

## 安全與資料界線

- Client Secret、管理員密碼、Spreadsheet ID 與 service account 金鑰不得提交至 GitHub。
- 管理員按鈕是否顯示不是權限依據；Apps Script 必須再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- `ARTICLE_ADMIN_EMAILS` 已淘汰，文章與服務統一使用 `ADMIN_EMAILS`。
- `cloud/`、`tests/`、`src/` 與建置設定不會複製到公開 `dist/`。
- 預約、文章、服務與私人紀錄使用不同資料流程；公開頁只取得必要的公開欄位。
- 文章與服務寫入會保存管理歷史；每日備份需由管理員首次執行 `setupDailyBackups` 啟用。
