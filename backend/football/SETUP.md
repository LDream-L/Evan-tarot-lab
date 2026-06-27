# 世足賽事驗證｜獨立 Google 試算表部署

正式資料庫名稱：`Evan Tarot｜世足賽事驗證資料庫`

## 建立方式

1. 新增一份空白 Google 試算表，命名為 `Evan Tarot｜世足賽事驗證資料庫`。
2. 從該試算表開啟「擴充功能 → Apps Script」。
3. 將 `backend/football/Code.gs` 完整貼入 Apps Script 的 `Code.gs`。
4. 在 Apps Script 的「專案設定 → 指令碼屬性」新增：
   - `GOOGLE_CLIENT_ID`：網站現有 Google OAuth Client ID
   - `OWNER_EMAIL`：唯一允許讀寫世足資料庫的 Google 帳號
5. 手動執行一次 `setupFootballWorkbook()` 並授權。
6. 確認試算表自動出現：
   - `FootballMatches`
   - `FootballCards`
   - `FootballEvents`
7. 選擇「部署 → 新增部署作業 → 網頁應用程式」：
   - 執行身分：我
   - 誰可以存取：所有人
   - 寫入仍會由後端驗證 Google ID Token 與 OWNER_EMAIL，不代表所有人都有資料權限。
8. 複製部署後的 `/exec` 網址，填入前端 `JS/cloud-config.js` 的 `footballApiUrl`。

## 資料拆分

### FootballMatches

一場比賽一列。保存賽事、實驗模式、兩個模型的預測、實際比分與自動驗證結果。

### FootballCards

一張牌一列。雙模型模式每場會有五列：

- 單張結果模型：1 列
- 四張攻防模型：4 列

### FootballEvents

一個特殊事件一列，例如紅牌、傷退、點球、烏龍球、天候與輪換。

## 防止重複與覆寫

- `recordId` 為唯一鍵。
- `createRecord` 重送相同 `recordId` 時不會新增第二筆。
- 賽前鎖定資料不提供修改接口。
- 賽後只更新實際比分與驗證欄位。
- Apps Script 使用 Script Lock，避免同時寫入造成重複列。

## 嚴格比分制更新

比分模型只承認完整比分命中：

- 預測 `1：0`、實際 `2：0`：比分未中。
- 預測 `2：1`、實際 `2：0`：比分未中。
- 預測 `2：1`、實際 `2：1`：確切比分命中。
- 單邊進球數相同只保留作誤差分析，不獨立計為 Bingo。

更新既有 Apps Script 時：

1. 用 GitHub `backend/football/Code.gs` 完整覆蓋 Apps Script 的 `Code.gs`。
2. 執行一次 `recalculateAllFootballEvaluations()`，重算既有資料。
3. 到「部署 → 管理部署作業 → 編輯」，建立新版本並重新部署。
4. `/exec` 網址通常維持不變，不必重新修改前端設定。

## 前端同步

網站會先保存 localStorage，再同步到 Google Sheets：

- 建立鎖定紀錄
- 更新賽果
- 補傳全部本機紀錄

雲端失敗時，本機資料不會被刪除。
