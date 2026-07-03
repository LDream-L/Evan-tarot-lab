# Evan 修煉紀錄｜Google Sheet 與 Apps Script 設定

## 1. 建立私人 Google Sheet

1. 到 Google Drive 建立一份新的 Google 試算表。
2. 檔名可設為：`EVAN 修煉紀錄`。
3. 不要開啟「知道連結的任何人」；保持只有你的 Google 帳號可以存取。
4. 不需要手動建立欄位，Apps Script 第一次收到資料時會自動建立 `修煉紀錄` 工作表與標題列。

## 2. 開啟 Apps Script

1. 在試算表上方選單按：`擴充功能` → `Apps Script`。
2. 刪除編輯器內原本的範例程式。
3. 貼上 `practice-apps-script.gs` 的全部內容。
4. 儲存專案，名稱可設為：`Evan Practice Receiver`。

## 3. 設定私人接收金鑰

1. Apps Script 左側按 `專案設定`。
2. 找到 `指令碼屬性`，新增：
   - 屬性：`PRACTICE_ACCESS_KEY`
   - 值：自行設定至少 20 個字元的隨機字串
3. 想在每次提交後收到 Gmail 通知，再新增：
   - 屬性：`PRACTICE_NOTIFY_EMAIL`
   - 值：你的 Gmail 地址
4. 金鑰不要放進 GitHub、網頁程式碼、公開文件或截圖。

## 4. 部署成網頁應用程式

1. 右上角按：`部署` → `新增部署作業`。
2. 類型選：`網頁應用程式`。
3. 執行身分選：`我`。
4. 誰可以存取選：`任何人`。
5. 按 `部署`，完成 Google 授權。
6. 複製部署網址。正式網址會以 `/exec` 結尾；不要使用 `/dev` 測試網址。

之所以要選「任何人」，是讓 GitHub Pages 可以把資料送到 Apps Script。實際寫入仍必須通過 `PRACTICE_ACCESS_KEY`；腳本沒有提供公開讀取 Google Sheet 的功能。

## 5. 回到網站解鎖

1. 開啟：`https://ldream-l.github.io/Evan-tarot-lab/practice.html`
2. 貼上 `/exec` 接收網址。
3. 輸入和 `PRACTICE_ACCESS_KEY` 完全相同的私人金鑰。
4. 私人裝置可勾選「記住這台裝置」。共用電腦不要勾。
5. 按「驗證並開啟」。

## 6. 測試

1. 先填一筆簡短測試資料並按「保存並同步」。
2. 回到 Google Sheet，確認出現 `修煉紀錄` 工作表與新的一列。
3. 有設定 `PRACTICE_NOTIFY_EMAIL` 時，再確認 Gmail 是否收到通知。
4. 測試成功後，可以刪除該筆測試紀錄。

## 7. 之後修改 Apps Script

每次更改 Apps Script 程式碼後：

1. 按 `部署` → `管理部署作業`。
2. 編輯原本的部署。
3. 版本選 `新版本`。
4. 重新部署。

網址通常維持不變，不需要重新貼到網站。
