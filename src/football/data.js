// 世足賽事驗證｜模型固定資料 ES Module
//
// 主要函式複雜度：
// - 模組初始化：時間／空間 O(D)，D = 78 張牌與固定選項數量。
// - 牌位查詢：透過 frozen positionMap 直接查表。
//
// 更快替代方案比較：
// - 舊版只寫入 window.FOOTBALL_LAB_DATA，所有模組依賴隱性全域。
// - 本版正式匯出 footballData 與各固定集合，同時暫時回填 window API 供舊模組相容。

const positions = [
  { key: "directResult", title: "單張｜90 分鐘整體能量", note: "觀察總進球區間與是否和局，不判定主隊或客隊勝" },
  { key: "homeAttack", title: "攻防組｜主隊進攻", note: "主隊創造機會與把握進球的狀態" },
  { key: "awayDefense", title: "攻防組｜客隊防守", note: "客隊限制主隊與承受壓力的狀態" },
  { key: "awayAttack", title: "攻防組｜客隊進攻", note: "客隊創造機會與把握進球的狀態" },
  { key: "homeDefense", title: "攻防組｜主隊防守", note: "主隊限制客隊與承受壓力的狀態" },
];

export const modelVersion = "1.6.0";
export const storageKey = "evanFootballTarotRecordsV1";
export const resultLabels = Object.freeze({ H: "主隊勝", D: "和局", A: "客隊勝" });
export const modeLabels = Object.freeze({
  direct: "單張整體能量模式",
  structure: "四張攻防模式",
  dual: "雙模型比較模式",
  legacy5: "舊版五牌位",
});
export const cardSourceLabels = Object.freeze({
  manual: "手動記錄實體抽牌",
  random: "網站隨機抽牌",
});
export const positionSets = Object.freeze({
  direct: Object.freeze(["directResult"]),
  structure: Object.freeze(["homeAttack", "awayDefense", "awayAttack", "homeDefense"]),
});
export const positionList = Object.freeze(positions.map((position) => Object.freeze({ ...position })));
export const positionMap = Object.freeze(
  Object.fromEntries(positionList.map((position) => [position.key, position]))
);
export const deck = Object.freeze([
  "愚者", "魔術師", "女祭司", "皇后", "皇帝", "教皇", "戀人", "戰車", "力量", "隱者", "命運之輪",
  "正義", "吊人", "死神", "節制", "惡魔", "高塔", "星星", "月亮", "太陽", "審判", "世界",
  "權杖王牌", "權杖二", "權杖三", "權杖四", "權杖五", "權杖六", "權杖七", "權杖八", "權杖九", "權杖十", "權杖侍者", "權杖騎士", "權杖皇后", "權杖國王",
  "聖杯王牌", "聖杯二", "聖杯三", "聖杯四", "聖杯五", "聖杯六", "聖杯七", "聖杯八", "聖杯九", "聖杯十", "聖杯侍者", "聖杯騎士", "聖杯皇后", "聖杯國王",
  "寶劍王牌", "寶劍二", "寶劍三", "寶劍四", "寶劍五", "寶劍六", "寶劍七", "寶劍八", "寶劍九", "寶劍十", "寶劍侍者", "寶劍騎士", "寶劍皇后", "寶劍國王",
  "金幣王牌", "金幣二", "金幣三", "金幣四", "金幣五", "金幣六", "金幣七", "金幣八", "金幣九", "金幣十", "金幣侍者", "金幣騎士", "金幣皇后", "金幣國王",
]);

export const footballData = Object.freeze({
  modelVersion,
  storageKey,
  resultLabels,
  modeLabels,
  cardSourceLabels,
  positionSets,
  positions: positionList,
  positionMap,
  deck,
});

// 相容層：其餘尚未轉成具名 import 的模組仍可照原 API 執行。
window.FOOTBALL_LAB_DATA = footballData;
