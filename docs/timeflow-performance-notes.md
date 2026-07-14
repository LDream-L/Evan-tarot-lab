# 時間樹核心與排版最佳化

## 本次調整

- 在 `rebuildIndexes()` 預先建立：
  - `childrenByTimelineId`
  - `childTimelinesByParentNodeId`
- `descendants()` 改為 BFS，只走實際後代。
- `deleteNode()` 直接從父節點查找子時間線，不再先掃描全部時間線。
- `sortNodes()` 改為 decorate-sort-undecorate，日期範圍只解析一次。
- localStorage 被封鎖或容量不足時，改為可預期的失敗結果，不讓整個頁面中斷。
- 全域只保留一條日期主幹；案例與研究改為由來源點延伸的有限分支線段。
- 聚焦分支只轉換觀看視角，不改寫 `parentNodeId` 或真實親緣。
- 文字與卡片使用反向縮放，避免縮小畫布後字級跟著變小而模糊。

## 複雜度比較

| 運算 | 舊版 | 新版 |
|---|---:|---:|
| 建立索引 | O(T+L+N+E) | O(T+L+N+E) |
| 查找一條時間線全部後代 | 最壞 O(L²) | O(D) |
| 日期排序的日期解析次數 | O(N log N) | O(N) |
| 排序本身 | O(N log N) | O(N log N) |

`D` 代表實際走訪的後代時間線數。

## 排版引擎取捨

舊版替每個案例重畫全寬日期軸，容易理解程式碼，卻造成視覺上的多條主幹。新版保留一條全域日期尺，分支只從來源節點延伸到必要範圍；卡片碰撞仍使用 min-heap 配置，在保持 O(N log N) 的同時降低畫布高度。
