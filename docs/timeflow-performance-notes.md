# 主題時間流核心最佳化

## 本次調整

- 在 `rebuildIndexes()` 預先建立：
  - `childrenByTimelineId`
  - `childTimelinesByParentNodeId`
- `descendants()` 改為 BFS，只走實際後代。
- `deleteNode()` 直接從父節點查找子時間線，不再先掃描全部時間線。
- `sortNodes()` 改為 decorate-sort-undecorate，日期範圍只解析一次。
- localStorage 被封鎖或容量不足時，改為可預期的失敗結果，不讓整個頁面中斷。

## 複雜度比較

| 運算 | 舊版 | 新版 |
|---|---:|---:|
| 建立索引 | O(T+L+N+E) | O(T+L+N+E) |
| 查找一條時間線全部後代 | 最壞 O(L²) | O(D) |
| 日期排序的日期解析次數 | O(N log N) | O(N) |
| 排序本身 | O(N log N) | O(N log N) |

`D` 代表實際走訪的後代時間線數。

## 為何不在這一批改排版引擎

卡片層級配置屬於獨立演算法，會影響畫面位置與 SVG 連線。本批先固定資料索引與刪除行為，並加入回歸測試；排版 min-heap 另以獨立 PR 處理，避免兩類風險混在同一次發布。
