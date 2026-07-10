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
  ["articles.html", "文章"],
  ["article.html", "文章"],
  ["lab.html", "實驗室"],
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
 *
 * 替代方案比較：只檢查檔案存在無法證明 map 指回正式 source；本測試會解析 map，
 * 確認 sources、sourcesContent 與壓縮執行檔的 linked 註記都完整。
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
    assert.ok(
      runtime.includes(`sourceMappingURL=${runtimeName}.map`),
      `${runtimeName} 未連結 sourcemap`
    );
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
 * 建置驗證：時間 O(P×H+B)，空間 O(H+B)，P 為固定頁數。
 */
function run() {
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, stdio: "inherit" });

  PAGE_CURRENT.forEach((expectedCurrent, fileName) => {
    const html = fs.readFileSync(path.join(DIST, fileName), "utf8");
    const links = extractNavigation(html);

    assert.deepEqual(
      links.map((link) => link.text),
      EXPECTED_NAVIGATION,
      `${fileName} 導覽順序不一致`
    );

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
  assert.equal(
    builtMain.includes("  normalizeSiteNavigation();"),
    false,
    "正式 main.js 不應在 DOMContentLoaded 後重排導覽"
  );
  assert.ok(
    builtMain.includes("主導覽已由 scripts/build-site.cjs 在建置期靜態產生"),
    "正式 main.js 應保留建置期導覽註記"
  );

  verifyTimeflowRuntime();

  assert.ok(fs.existsSync(path.join(DIST, ".nojekyll")), "dist 必須包含 .nojekyll");
  assert.equal(fs.existsSync(path.join(DIST, "package.json")), false, "不得發布 package.json");
  assert.equal(fs.existsSync(path.join(DIST, "tests")), false, "不得發布 tests 目錄");
  assert.equal(fs.existsSync(path.join(DIST, "scripts")), false, "不得發布 scripts 目錄");
  assert.equal(fs.existsSync(path.join(DIST, "src")), false, "不得直接發布可閱讀 src 目錄");

  console.log("build-site tests passed");
}

run();
