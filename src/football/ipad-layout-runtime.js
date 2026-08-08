// 塔羅X賽事驗證｜iPad / tablet 樣式載入層
//
// 主要函式 ensureIpadLayoutStylesheet：時間／空間 O(1)。
// 更快替代方案比較：把 tablet 規則塞回大型既有 CSS 會增加舊規則耦合；
// 本層只掛載一張獨立 override stylesheet，瀏覽器快取與後續回退都更單純。

const STYLE_ID = "football-ipad-layout-style";
const STYLE_MARKER = "football-ipad-layout.css";
const STYLE_VERSION = "20260808-ipad-layout-v2";

/** 只掛載一次 tablet override。時間／空間 O(1)。 */
function ensureIpadLayoutStylesheet() {
  if (
    document.getElementById(STYLE_ID)
    || document.querySelector(`link[href*="${STYLE_MARKER}"]`)
  ) {
    return;
  }

  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  const url = new URL(STYLE_MARKER, document.baseURI);
  url.searchParams.set("v", STYLE_VERSION);
  link.href = url.href;
  document.head.appendChild(link);
}

ensureIpadLayoutStylesheet();

export const footballIpadLayoutRuntime = Object.freeze({
  version: STYLE_VERSION,
  ensure: ensureIpadLayoutStylesheet,
});

window.FootballIpadLayoutRuntime = footballIpadLayoutRuntime;
