# Evan Tarot Lab

Evan Tarot 的正式靜態網站、公開實驗工具與私人 Google Sheets 資料後端。

## 正式版本原則

- GitHub `main`：網站程式唯一正式版本。
- GitHub Pages：由 `main` 通過建置與回歸測試後發布。
- Google Sheets：使用者資料、文章、服務與研究紀錄的雲端資料來源。
- Apps Script：Google Sheets 的正式後端。
- 聊天附件：只補充 GitHub 沒有的檔案，不作為正式程式版本。

## 專案結構

```text
.
├─ index.html / services.html / articles.html / lab.html
├─ article-admin.html / service-admin.html
├─ JS/                         # 瀏覽器端模組
├─ src/                        # 可閱讀的正式 source
├─ scripts/                    # 建置器
├─ tests/                      # 靜態契約與 Playwright 回歸測試
├─ cloud/google-apps-script-v47/
│  ├─ Code.gs                  # Cloud API action router
│  ├─ Articles.gs              # 公開文章讀取
│  ├─ ArticleAdmin.gs          # 管理員文章寫入
│  ├─ Services.gs              # 服務項目讀取與管理
│  └─ *.md                     # Apps Script 部署說明
└─ dist/                       # 建置產物，不手動修改
```

## 本機指令

```bash
npm ci
npm run build
npm run test:build
npm run test:e2e
```

- `npm run build`：建立正式 `dist/`。
- `npm run test:build`：檢查導覽、品牌、資料界線、服務後台、私人入口與正式輸出。
- `npm run test:e2e`：以桌機與行動裝置執行瀏覽器回歸測試。

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

服務後台請閱讀：

```text
cloud/google-apps-script-v47/SERVICES_SETUP.md
```

## 安全與資料界線

- Client Secret、管理員密碼、Spreadsheet ID 與 service account 金鑰不得提交至 GitHub。
- 管理員按鈕是否顯示不是權限依據；Apps Script 必須再次驗證 Google ID Token 與 `ADMIN_EMAILS`。
- `cloud/`、`tests/`、`src/` 與建置設定不會複製到公開 `dist/`。
- 預約、文章、服務與私人紀錄使用不同資料流程；公開頁只取得必要的公開欄位。
