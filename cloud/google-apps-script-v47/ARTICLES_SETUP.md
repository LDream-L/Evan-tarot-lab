# 文章管理設定

## 第一次啟用

1. 從原本「塔羅牌」試算表開啟 Apps Script。
2. 使用本資料夾最新版 `Code.gs`。
3. 新增指令碼檔案 `Articles.gs`，貼入本資料夾同名檔案內容。
4. 儲存後執行 `setupArticlesSheet`。
5. 回試算表確認新增 `Articles` 分頁，且原本四篇文章已匯入。
6. 將同一個網頁應用程式更新成新版本。

## 健康檢查

在網頁應用程式網址後加：

```text
?action=articles-health
```

正常時會顯示：

```json
{"success":true,"ready":true,"missingHeaders":[]}
```

## 發布方式

- `draft`：草稿，不公開。
- `published`：公開。
- `scheduled`：到 `publishAt` 後公開。
- `archived`：封存，不公開。

`content` 欄位以空白行分隔段落。`internalNote` 只留在私人試算表，不會傳到網站。
