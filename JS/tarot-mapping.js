// ==============================
// tarot-mapping.js
// 失物占卜：從 Google Sheet 讀取 Mapping
// ==============================
//
// 時間複雜度：
// - 載入 Mapping：O(n)（n = Sheet 列數，只在第一次載入時做一次）
// - 抽牌：O(1)（固定抽 3 張）
// 空間複雜度：O(n) 儲存全部牌的 Mapping
//
// 暴力法：每次占卜都重新抓 CSV + 解析
// 本實作：啟動時抓一次 → 放在記憶體 → 之後直接抽，速度更快
// ==============================

// 你的 Google Sheet（已發佈為 CSV）的網址（只讀）
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSICh3Kf0kiGIhFuR2cd324elPosc1FpSLUyr8Z7mSit6rhzOMgh3xoI7wKpsi-l9BtRwsb_GyXoyMA/pub?gid=0&single=true&output=csv";

// 全域快取（掛在 window 上，給其他檔案用）
window.mappingEngine = [];
window.mappingLoaded = false;
let mappingLoadingPromise = null;

// 解析一行 CSV → 陣列
// 時間：O(m)，m = 該行字元數；空間：O(m)
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// 解析整個 CSV → mapping 陣列
// 時間：O(n*m)，空間：O(n)
function parseCsvToMapping(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const idxCode = header.indexOf("CardCode");
  const idxName = header.indexOf("CardName");
  const idxStatus = header.indexOf("StatusHint");
  const idxLocation = header.indexOf("LocationHint");
  const idxArea = header.indexOf("AreaHint");
  const idxAction = header.indexOf("ActionHint");

  const maxIdx = Math.max(
    idxCode,
    idxName,
    idxStatus,
    idxLocation,
    idxArea,
    idxAction
  );

  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (maxIdx >= row.length) continue;

    result.push({
      code: (row[idxCode] || "").trim(),
      name: (row[idxName] || "").trim(),
      statusHint: (row[idxStatus] || "").trim(),
      locationHint: (row[idxLocation] || "").trim(),
      areaHint: (row[idxArea] || "").trim(),
      actionHint: (row[idxAction] || "").trim()
    });
  }

  return result;
}

// 從 Google Sheet 載入 Mapping（只讀）
// 時間：O(n)，空間：O(n)
window.loadMappingFromSheet = function loadMappingFromSheet() {
  if (mappingLoadingPromise) return mappingLoadingPromise;

  mappingLoadingPromise = fetch(SHEET_CSV_URL)
    .then((res) => {
      if (!res.ok) {
        throw new Error("載入 Google Sheet 失敗");
      }
      return res.text();
    })
    .then((text) => {
      window.mappingEngine = parseCsvToMapping(text);
      window.mappingLoaded = true;
      console.log("Mapping loaded, count =", window.mappingEngine.length);
    })
    .catch((err) => {
      console.error(err);
      alert("無法載入失物占卜資料（Google Sheet）。請稍後再試。");
    });

  return mappingLoadingPromise;
};

// 抽出 3 張不同的牌
// 時間：O(1)，空間：O(1)
// 暴力：洗整副牌 O(n)；本實作：只用 Set 抽 3 張
window.drawThreeFromEngine = function drawThreeFromEngine() {
  const n = window.mappingEngine.length;
  if (n === 0) {
    throw new Error("MappingEngine 尚未載入或沒有資料");
  }
  const indices = new Set();
  while (indices.size < 3 && indices.size < n) {
    const idx = Math.floor(Math.random() * n);
    indices.add(idx);
  }
  return Array.from(indices).map((i) => window.mappingEngine[i]);
};
