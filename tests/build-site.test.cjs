const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const BUILD_SCRIPT = path.join(ROOT, "scripts", "build-site.cjs");

const EXPECTED_NAVIGATION = ["介紹", "占卜項目", "文章", "實驗室", "Podcast", "預約"];
const PAGE_CURRENT = new Map([
  ["index.html", "介紹"],
  ["services.html", "占卜項目"],
  ["privacy.html", "占卜項目"],
  ["articles.html", "文章"],
  ["article.html", "文章"],
  ["lab.html", "實驗室"],
  ["methodology.html", "實驗室"],
  ["lost-item.html", "實驗室"],
  ["football-lab.html", "實驗室"],
  ["timeflow.html", "實驗室"],
  ["practice.html", "實驗室"],
]);

const TIMEFLOW_RUNTIME = new Map([
  ["timeflow-v5-ui.js", "ui.js"],
  ["timeflow-v5-actions.js", "actions.js"],
  ["divination-map.js", "bootstrap.js"],
]);

/**
 * 擷取主導覽連結。
 * 時間／空間複雜度 O(H)，H 為 HTML 長度。
 *
 * 替代方案比較：完整 HTML parser 更通用但增加依賴；建置輸出格式由本專案控制，
 * 使用受限正規表示式能以零依賴快速驗證固定模板。
 */
function extractNavigation(html) {
  const navMatch = html.match(/<nav class="nav" aria-label="主選單">([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, "找不到靜態主導覽");

  return [...navMatch[1].matchAll(/<a\b([^>]*)>([^<]+)<\/a>/g)].map((match) => ({
    attributes: match[1],
    text: match[2].trim(),
  }));
}

/**
 * 驗證時間流 source → runtime → sourcemap 關係。
 * 時間／空間複雜度 O(B)，B 為三組 source 與 map 的總大小。
 */
function verifyTimeflowRuntime() {
  TIMEFLOW_RUNTIME.forEach((sourceName, runtimeName) => {
    const sourcePath = path.join(ROOT, "src", "timeflow", sourceName);
    const runtimePath = path.join(DIST, "JS", runtimeName);
    const mapPath = `${runtimePath}.map`;

    assert.ok(fs.existsSync(sourcePath), `缺少可閱讀 source：${sourceName}`);
    assert.ok(fs.existsSync(runtimePath), `缺少正式執行檔：${runtimeName}`);
    assert.ok(fs.existsSync(mapPath), `缺少 sourcemap：${runtimeName}.map`);

    const source = fs.readFileSync(sourcePath, "utf8");
    const runtime = fs.readFileSync(runtimePath, "utf8");
    const sourceMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));

    assert.ok(source.split("\n").length > 20, `${sourceName} 不應是單行原始碼`);
    assert.ok(runtime.includes(`sourceMappingURL=${runtimeName}.map`), `${runtimeName} 未連結 sourcemap`);
    assert.ok(
      sourceMap.sources.some((value) => String(value).endsWith(`src/timeflow/${sourceName}`)),
      `${runtimeName}.map 未指向 ${sourceName}`
    );
    assert.ok(
      Array.isArray(sourceMap.sourcesContent) && sourceMap.sourcesContent.some(Boolean),
      `${runtimeName}.map 缺少 sourcesContent`
    );
  });
}

/**
 * 驗證信任內容與實驗室存取分區。
 * 時間／空間複雜度 O(H)，H 為三個頁面的總 HTML 長度。
 *
 * 替代方案比較：只檢查檔案存在無法防止頁面失去核心說明或交叉連結；
 * 本測試鎖定最小必要文案與連結，不限制日後擴寫內容。
 */
function verifyTrustArchitecture() {
  const lab = fs.readFileSync(path.join(DIST, "lab.html"), "utf8");
  const methodology = fs.readFileSync(path.join(DIST, "methodology.html"), "utf8");
  const privacy = fs.readFileSync(path.join(DIST, "privacy.html"), "utf8");
  const services = fs.readFileSync(path.join(DIST, "services.html"), "utf8");

  assert.ok(lab.includes('id="lab-public-tools"'));
  assert.ok(lab.includes('id="lab-research-workspace"'));
  assert.ok(lab.includes('id="lab-private-tools"'));
  assert.ok(lab.includes("模型 v1.6.0｜介面 v1.7.6"));
  assert.ok(lab.includes('href="methodology.html"'));
  assert.ok(lab.includes('href="privacy.html"'));

  assert.ok(methodology.includes("保留第一次完整判讀"));
  assert.ok(methodology.includes("未應驗"));
  assert.ok(methodology.includes('href="privacy.html"'));

  assert.ok(privacy.includes("localStorage"));
  assert.ok(privacy.includes("Google Sheets"));
  assert.ok(privacy.includes("查詢、更正或刪除"));
  assert.ok(privacy.includes('href="methodology.html"'));

  assert.ok(services.includes('href="privacy.html"'));
  assert.ok(services.includes('href="methodology.html"'));
}

/** 建置驗證：時間 O(P×H+B)，空間 O(H+B)。 */
function run() {
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, stdio: "inherit" });

  PAGE_CURRENT.forEach((expectedCurrent, fileName) => {
    const html = fs.readFileSync(path.join(DIST, fileName), "utf8");
    const links = extractNavigation(html);

    assert.deepEqual(links.map((link) => link.text), EXPECTED_NAVIGATION, `${fileName} 導覽順序不一致`);

    const currentLinks = links.filter((link) => link.attributes.includes('aria-current="page"'));
    assert.equal(currentLinks.length, 1, `${fileName} 應只有一個 aria-current`);
    assert.equal(currentLinks[0].text, expectedCurrent, `${fileName} aria-current 錯誤`);

    const podcast = links.find((link) => link.text === "Podcast");
    assert.ok(podcast.attributes.includes('target="_blank"'));
    assert.ok(podcast.attributes.includes('rel="noopener noreferrer"'));

    const navHtml = html.match(/<nav class="nav" aria-label="主選單">([\s\S]*?)<\/nav>/)[1];
    assert.equal(navHtml.includes('href="timeflow.html"'), false, `${fileName} 不應把時間流列為主選單`);
  });

  const builtMain = fs.readFileSync(path.join(DIST, "JS", "main.js"), "utf8");
  assert.equal(builtMain.includes("  normalizeSiteNavigation();"), false, "正式 main.js 不應在 DOMContentLoaded 後重排導覽");
  assert.ok(
    builtMain.includes("主導覽已由 scripts/build-site.cjs 在建置期靜態產生"),
    "正式 main.js 應保留建置期導覽註記"
  );

  verifyTimeflowRuntime();
  verifyTrustArchitecture();

  assert.ok(fs.existsSync(path.join(DIST, ".nojekyll")), "dist 必須包含 .nojekyll");
  assert.equal(fs.existsSync(path.join(DIST, "package.json")), false, "不得發布 package.json");
  assert.equal(fs.existsSync(path.join(DIST, "tests")), false, "不得發布 tests 目錄");
  assert.equal(fs.existsSync(path.join(DIST, "scripts")), false, "不得發布 scripts 目錄");
  assert.equal(fs.existsSync(path.join(DIST, "src")), false, "不得直接發布可閱讀 src 目錄");

  console.log("build-site tests passed");
}

run();
