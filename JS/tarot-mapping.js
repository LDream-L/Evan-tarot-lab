// ==============================
// tarot-mapping.js
// 失物占卜：從 Google Sheet 讀取 Mapping（GViz JSON 版）
// ==============================
//
// 為什麼用 GViz：
// - 原本用 CSV 直連，在 GitHub Pages 會被 CORS 擋住。
// - GViz JSON 可以配合 Proxy，在前端直接 fetch。
// - 不需要後端，純前端即可在 GitHub Pages 運作。
//
// 時間複雜度：
// - 載入 Mapping：O(n)（n = Sheet 列數，只在第一次載入時做一次）
// - 抽牌：O(1)（固定抽 3 張）
//
// 空間複雜度：O(n) 儲存全部牌的 Mapping。
//
// 暴力法：
//   每次占卜都重新呼叫 Google API + parse 全表 → 網路 & 延遲成本高。
// 本實作：
//   首次載入時呼叫 GViz API → 解析後快取在 window.mappingEngine，
//   之後所有占卜都只在本機抽牌，體驗 O(1)。
// ==============================

// ===== 1. 設定你的試算表 ID & 分頁名稱 =====
//
// 試算表網址：
//   https://docs.google.com/spreadsheets/d/1-keWBaDsLqYiLL2_lVCYVr8uvCSZA-SxFjJAEjDT0lU/edit?gid=0#gid=0
//   ↑ 這段中間的就是 SHEET_ID
const SHEET_ID = "1-keWBaDsLqYiLL2_lVCYVr8uvCSZA-SxFjJAEjDT0lU";

// 底下的工作表分頁名稱（你現在叫「Mapping」）
const SHEET_TAB_NAME = "Mapping";

// 組出 GViz JSON 讀取網址
const SHEET_JSON_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}` +
  `/gviz/tq?sheet=${encodeURIComponent(SHEET_TAB_NAME)}` +
  `&headers=1&tqx=out:json`;

// 使用 AllOrigins 當免費 CORS Proxy
const PROXY_BASE_URL = "https://api.allorigins.win/raw?url=";

// 全域快取（掛在 window 上，給其他檔案用）
window.mappingEngine = [];
window.mappingLoaded = false;
let mappingLoadingPromise = null;

// ==============================
// 解析 GViz JSON 回傳格式
// ==============================
//
// GViz 回傳格式會長得像：
//   /**/google.visualization.Query.setResponse({...});
//
// 我們需要把前後包裝字串去掉，只留下 {...} 再做 JSON.parse。
//
// 時間複雜度：O(L)（L = 字串長度）
// 空間複雜度：O(L)
function parseGvizJson(text) {
  const prefix = "google.visualization.Query.setResponse(";
  const startIndex = text.indexOf(prefix);

  if (startIndex === -1) {
    throw new Error("GViz 回傳格式異常：找不到 setResponse(..) 包裝。");
  }

  const jsonStart = startIndex + prefix.length;
  const jsonEnd = text.lastIndexOf(");");

  if (jsonEnd === -1) {
    throw new Error("GViz 回傳格式異常：找不到結尾 ');'。");
  }

  const jsonString = text.slice(jsonStart, jsonEnd);
  return JSON.parse(jsonString);
}

// ==============================
// GViz table 結構 → 我們的 mapping 陣列
// ==============================
//
// table 格式大致為：
// {
//   table: {
//     cols: [ { label: "CardCode" }, { label: "CardName" }, ... ],
//     rows: [ { c: [ { v: "XX" }, { v: "聖杯二" }, ... ] }, ... ]
//   }
// }
//
// 時間複雜度：O(n * m)
//   n = 列數，m = 欄數
// 空間複雜度：O(n)
//
// 暴力法：每一列都重複去找欄位名稱。
// 本實作：一開始就先把欄位 index 算好，之後每列 O(1) 取值。
function tableToMapping(table) {
  if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) {
    throw new Error("GViz table 結構不正確。");
  }

  // 預先把欄位名稱拉成一個陣列，避免在迴圈裡重複判斷
  const cols = table.cols.map((col) =>
    col && col.label ? String(col.label).trim() : ""
  );

  const idxCode = cols.indexOf("CardCode");
  const idxName = cols.indexOf("CardName");
  const idxStatus = cols.indexOf("StatusHint");
  const idxLocation = cols.indexOf("LocationHint");
  const idxArea = cols.indexOf("AreaHint");
  const idxAction = cols.indexOf("ActionHint");

  const maxIdx = Math.max(
    idxCode,
    idxName,
    idxStatus,
    idxLocation,
    idxArea,
    idxAction
  );
  if (maxIdx < 0) {
    throw new Error("在 GViz cols 中找不到對應欄位（CardCode / CardName ...）。");
  }

  const result = [];
  const rows = table.rows;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row.c)) continue;

    const cells = row.c;

    // 小工具函式：安全取得某欄位的字串值
    // 時間：O(1)，空間：O(1)
    function getCell(idx) {
      if (idx < 0 || idx >= cells.length) return "";
      const cell = cells[idx];
      if (!cell || cell.v === undefined || cell.v === null) return "";
      return String(cell.v).trim();
    }

    result.push({
      code: getCell(idxCode),
      name: getCell(idxName),
      statusHint: getCell(idxStatus),
      locationHint: getCell(idxLocation),
      areaHint: getCell(idxArea),
      actionHint: getCell(idxAction)
    });
  }

  return result;
}

// ==============================
// 從 Google Sheet 載入 Mapping（只讀，一次）
// ==============================
//
// 時間複雜度：O(n)，空間複雜度：O(n)
//   n = 試算表資料列數，只會在第一次載入時跑一次。
//
// 暴力法（較慢 & 會被擋）：
//   直接在瀏覽器 fetch(SHEET_JSON_URL)
//   → 會被 Google 的 CORS 政策擋住（Failed to fetch）。
//
// 本實作（優化）：
//   透過 AllOrigins 這個免費 CORS Proxy：
//   你的網頁 → AllOrigins → Google Sheet → AllOrigins → 你的網頁。
window.loadMappingFromSheet = function loadMappingFromSheet() {
  // 簡單的 Promise 快取：同時間多次呼叫只會真的打一次 API
  if (mappingLoadingPromise) return mappingLoadingPromise;

  const proxiedUrl = PROXY_BASE_URL + encodeURIComponent(SHEET_JSON_URL);

  mappingLoadingPromise = fetch(proxiedUrl)
    .then((res) => {
      if (!res.ok) {
        throw new Error("載入 Google Sheet 失敗，HTTP 狀態：" + res.status);
      }
      return res.text();
    })
    .then((text) => {
      const data = parseGvizJson(text);
      if (!data.table) {
        throw new Error("GViz 回傳資料裡找不到 table。");
      }

      window.mappingEngine = tableToMapping(data.table);
      window.mappingLoaded = true;

      console.log(
        "Mapping loaded (GViz via AllOrigins), count =",
        window.mappingEngine.length
      );
    })
    .catch((err) => {
      console.error("[loadMappingFromSheet] 發生錯誤:", err);
      alert(
        "無法載入失物占卜資料（Google Sheet / GViz）。\n\n" +
          "錯誤訊息：" +
          err.message +
          "\n\n" +
          "請確認：\n" +
          "1. SHEET_ID 是否填對（tarot-mapping.js 最上面）。\n" +
          "2. 試算表是否設為「知道連結的人都可以檢視」。\n" +
          "3. 工作表分頁名稱是否叫 Mapping（或同步修改 SHEET_TAB_NAME）。\n" +
          "4. 若上述皆正確，可能是 AllOrigins 暫時掛掉，稍後再重整一次即可。"
      );
    });

  return mappingLoadingPromise;
};

// ==============================
// 抽出 3 張不同的牌
// ==============================
//
// 時間複雜度：O(1)（固定最多抽 3 張）
// 空間複雜度：O(1)
//
// 暴力法：每次都打亂整副牌（shuffle O(n)），再拿前三張。
// 本實作：用 Set 直接隨機抽 3 個 index，成本固定。
window.drawThreeFromEngine = function drawThreeFromEngine() {
  const n = window.mappingEngine.length;
  if (n === 0) {
    throw new Error("MappingEngine 尚未載入或沒有資料。");
  }

  const indices = new Set();
  // 最多抽到 3 張，或是牌數不足時抽到 n 張
  while (indices.size < 3 && indices.size < n) {
    const idx = Math.floor(Math.random() * n);
    indices.add(idx);
  }

  return Array.from(indices).map((i) => window.mappingEngine[i]);
};
