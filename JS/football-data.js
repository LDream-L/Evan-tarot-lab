// 世足賽事驗證 v1.2.0｜固定資料
// 讀取時間 O(1)，牌組空間 O(78)。
(function defineFootballLabData() {
  "use strict";

  const positions = [
    { key: "directResult", title: "單張｜90 分鐘結果", note: "只判斷正規時間加傷停的主勝、和局或客勝" },
    { key: "homeAttack", title: "攻防組｜主隊進攻", note: "主隊創造機會與把握進球的狀態" },
    { key: "awayDefense", title: "攻防組｜客隊防守", note: "客隊限制主隊與承受壓力的狀態" },
    { key: "awayAttack", title: "攻防組｜客隊進攻", note: "客隊創造機會與把握進球的狀態" },
    { key: "homeDefense", title: "攻防組｜主隊防守", note: "主隊限制客隊與承受壓力的狀態" },
  ];

  window.FOOTBALL_LAB_DATA = Object.freeze({
    modelVersion: "1.2.0",
    storageKey: "evanFootballTarotRecordsV1",
    resultLabels: Object.freeze({ H: "主隊勝", D: "和局", A: "客隊勝" }),
    modeLabels: Object.freeze({ direct: "單張結果模式", structure: "四張攻防模式", dual: "雙模型比較模式", legacy5: "舊版五牌位" }),
    cardSourceLabels: Object.freeze({ manual: "手動記錄實體抽牌", random: "網站隨機抽牌" }),
    positionSets: Object.freeze({
      direct: Object.freeze(["directResult"]),
      structure: Object.freeze(["homeAttack", "awayDefense", "awayAttack", "homeDefense"]),
    }),
    positions: Object.freeze(positions),
    positionMap: Object.freeze(Object.fromEntries(positions.map((position) => [position.key, Object.freeze(position)]))),
    deck: Object.freeze([
      "愚者", "魔術師", "女祭司", "皇后", "皇帝", "教皇", "戀人", "戰車", "力量", "隱者", "命運之輪",
      "正義", "吊人", "死神", "節制", "惡魔", "高塔", "星星", "月亮", "太陽", "審判", "世界",
      "權杖王牌", "權杖二", "權杖三", "權杖四", "權杖五", "權杖六", "權杖七", "權杖八", "權杖九", "權杖十", "權杖侍者", "權杖騎士", "權杖皇后", "權杖國王",
      "聖杯王牌", "聖杯二", "聖杯三", "聖杯四", "聖杯五", "聖杯六", "聖杯七", "聖杯八", "聖杯九", "聖杯十", "聖杯侍者", "聖杯騎士", "聖杯皇后", "聖杯國王",
      "寶劍王牌", "寶劍二", "寶劍三", "寶劍四", "寶劍五", "寶劍六", "寶劍七", "寶劍八", "寶劍九", "寶劍十", "寶劍侍者", "寶劍騎士", "寶劍皇后", "寶劍國王",
      "金幣王牌", "金幣二", "金幣三", "金幣四", "金幣五", "金幣六", "金幣七", "金幣八", "金幣九", "金幣十", "金幣侍者", "金幣騎士", "金幣皇后", "金幣國王",
    ]),
  });
})();
