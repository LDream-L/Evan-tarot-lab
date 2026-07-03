# Evan Tarot｜新預約與新留言 Gmail 通知

本試行版只通知：

- `Comments`：文章新留言
- `占卜預約`：網站新預約

不包含：

- 世足驗證
- 每日待辦摘要
- 修煉逾期提醒

## 通知方式

Apps Script 每分鐘檢查一次上次游標後新增的列，只讀取新資料，不重掃全部歷史紀錄。

因此這是「近即時通知」，一般會在下一個觸發週期寄出，不保證精確在 60 秒內。

## 設定步驟

### 1. 加入程式檔

在存放 `Comments` 或 `占卜預約` 的 Google Sheet：

1. 按 `擴充功能` → `Apps Script`。
2. 左側 `+` → `指令碼`。
3. 檔名輸入：`ImmediateNotifications`。
4. 將 GitHub 的 `ImmediateNotifications.gs` 全部內容貼入。
5. 儲存。

如果留言與預約分屬兩份 Google Sheet／兩個 Apps Script 專案，兩邊都要加入同一份檔案並各自設定。

### 2. 設定收件信箱

Apps Script 左側按 `專案設定`，在 `指令碼屬性` 新增：

```text
NOTIFY_EMAILS = 你的 Gmail
```

多個收件者可用半形逗號分隔：

```text
first@gmail.com,second@gmail.com
```

### 3. 建立觸發器並授權

1. 回到 Apps Script 編輯器。
2. 上方函式選單選 `setupImmediateNotifications`。
3. 按 `執行`。
4. 完成 Google 授權。
5. 執行成功後會收到一封：

```text
【Evan Tarot】網站通知測試成功
```

這一步會：

- 以目前最後一列作為基準線
- 不補寄既有舊資料
- 建立每分鐘檢查一次的時間觸發器

### 4. 實際測試

1. 從網站送一筆測試預約。
2. 從文章頁送一則測試留言。
3. 等待下一個觸發週期。
4. 確認 Gmail 收到：

```text
【Evan Tarot 新預約】...
【Evan Tarot 新留言】...
```

## 其他函式

### 手動測試 Gmail

執行：

```text
testImmediateNotificationEmail
```

只寄測試信，不移動工作表游標。

### 停止通知

執行：

```text
stopImmediateNotifications
```

只刪除此模組建立的觸發器，不刪除工作表資料。

## 注意

- 本模組依「新增列」判斷，因此留言與預約應維持 appendRow 寫入模式。
- 通知失敗時，該列游標不會提前越過，可在下次觸發時重試。
- Apps Script Gmail 有每日寄送額度；低頻網站通知通常足夠，實際額度依帳號類型而異。
