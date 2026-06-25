# 塔羅尋物 v5.0.0 後端部署

網站前端已改為 v5.0.0，並會檢查 Apps Script 回傳的 `version`。後端尚未部署新版時，網站會顯示版本不一致，不會把 v4.7 結果誤當成 v5.0.0。

## 1. 更新 Google Sheets

在目前綁定 Apps Script 的正式 Google 試算表中，更新或加入下列工作表：

- `CardDB`
- `Area Matrix`
- `Event Guide`

建議同步保留最新版的：

- `Zone Guide`
- `Spatial Guide`
- `Area Guide`
- `Tarot Audit`

請勿刪除留言、暱稱或文章系統使用的既有工作表，例如 `Comments`、`Profiles`、`Articles`。

## 2. 更新 Apps Script 程式

將正式 Apps Script 專案中的對應檔案替換為 GitHub `main` 分支版本：

- `cloud/google-apps-script-v47/Code.gs`
- `cloud/google-apps-script/LostItemModel.gs`
- `cloud/google-apps-script/LostItemScoring.gs`

其他留言、文章與帳號檔案維持原樣。

## 3. 重新部署 Web App

1. Apps Script 右上角選擇「部署」→「管理部署作業」。
2. 編輯目前網站使用的 Web App 部署。
3. 建立新版本並部署。
4. 維持原本的執行身分與存取權限。

若是編輯既有部署，通常可沿用原 Web App URL；如 URL 改變，需同步更新 `JS/cloud-config.js` 的 `lostItemApiUrl`。

## 4. 健康檢查

在 Web App URL 後加上：

```text
?action=lostitem-health
```

預期回傳：

```json
{
  "success": true,
  "service": "Evan Tarot Lost Item v5.0.0",
  "version": "5.0.0",
  "missingSheets": []
}
```

## 5. v5.0.0 固定規則

- 排名只讀牌面區域分數。
- 每張牌在同一大型區域只取最強子區域分數。
- 正逆位不修改區域與空間分數。
- 物品類型、情境、時間、是否被他人碰過及找到結果均不加權。
- 空間特徵只細化已入選的大型區域。
- 事件只由 `CardDB.EventTags` 觸發，不得新增區域。
