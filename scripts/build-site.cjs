const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".github",
  "dist",
  "node_modules",
  "playwright-report",
  "scripts",
  "src",
  "test-results",
  "tests",
]);

const EXCLUDED_ROOT_FILES = new Set([
  ".gitignore",
  "package.json",
  "package-lock.json",
  "playwright.config.cjs",
  "README.md",
]);

const NAVIGATION_PAGES = new Map([
  ["index.html", "intro"],
  ["services.html", "services"],
  ["articles.html", "articles"],
  ["article.html", "articles"],
  ["lab.html", "lab"],
  ["lost-item.html", "lab"],
  ["football-lab.html", "lab"],
  ["timeflow.html", "lab"],
  ["practice.html", "lab"],
]);

const TIMEFLOW_RUNTIME = new Map([
  ["ui.js", "timeflow-v5-ui.js"],
  ["actions.js", "timeflow-v5-actions.js"],
  ["bootstrap.js", "divination-map.js"],
]);

const PODCAST_URL = "https://podcasts.apple.com/tw/podcast/%E6%9C%89%E9%BB%9E%E5%81%8F/id1896598359";
const NAV_PATTERN = /(^[ \t]*)<nav\b(?=[^>]*\bclass=["'][^"']*\bnav\b[^"']*["'])(?=[^>]*\baria-label=["']主選單["'])[^>]*>[\s\S]*?<\/nav>/m;

/**
 * 產生單一頁面的靜態主導覽。
 * 時間／空間複雜度 O(1)：固定六個入口。
 *
 * 替代方案比較：每頁手動維護容易漏改；瀏覽器執行後再重排會產生閃動。
 * 本方案在建置期由同一模板產生，正式頁面不依賴 JavaScript 才一致。
 */
function renderNavigation(currentKey, indent) {
  const childIndent = `${indent}  `;
  const current = (key) => (currentKey === key ? ' aria-current="page"' : "");

  return [
    `${indent}<nav class="nav" aria-label="主選單">`,
    `${childIndent}<a href="index.html#intro"${current("intro")}>介紹</a>`,
    `${childIndent}<a href="services.html"${current("services")}>占卜項目</a>`,
    `${childIndent}<a href="articles.html"${current("articles")}>文章</a>`,
    `${childIndent}<a href="lab.html"${current("lab")}>實驗室</a>`,
    `${childIndent}<a data-podcast-link="true" href="${PODCAST_URL}" target="_blank" rel="noopener noreferrer" aria-label="前往 Apple Podcast 收聽《有點偏》（另開新分頁）">Podcast</a>`,
    `${childIndent}<a href="services.html#booking">預約</a>`,
    `${indent}</nav>`,
  ].join("\n");
}

/**
 * 將指定 HTML 的主導覽替換為共用模板。
 * 時間／空間複雜度 O(H)，H 為 HTML 長度。
 */
function transformHtml(source, fileName) {
  if (!NAVIGATION_PAGES.has(fileName)) return source;

  const match = source.match(NAV_PATTERN);
  if (!match) throw new Error(`[build] ${fileName} 找不到主導覽`);

  return source.replace(NAV_PATTERN, renderNavigation(NAVIGATION_PAGES.get(fileName), match[1]));
}

/**
 * 正式輸出不再於 DOMContentLoaded 後重排導覽。
 * 時間／空間複雜度 O(J)，J 為 main.js 長度。
 */
function transformMainScript(source) {
  const invocation = "  normalizeSiteNavigation();";
  if (!source.includes(invocation)) {
    throw new Error("[build] JS/main.js 找不到 normalizeSiteNavigation() 初始化呼叫");
  }

  return source.replace(
    invocation,
    "  // 主導覽已由 scripts/build-site.cjs 在建置期靜態產生。"
  );
}

/**
 * 遞迴複製正式資源。
 * 時間 O(F+B)，空間 O(D)，F 為檔案數、B 為總位元組、D 為目錄深度。
 *
 * 替代方案比較：把 repository 根目錄直接發布會連測試與開發設定一起公開；
 * 本方案只排除明確的開發目錄與設定，其餘圖片、CSS、JS、JSON 依原結構複製。
 */
function copyProductionTree(sourceDirectory, targetDirectory, relativeDirectory = "") {
  fs.mkdirSync(targetDirectory, { recursive: true });

  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
  entries.forEach((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      if (!relativeDirectory && EXCLUDED_DIRECTORIES.has(entry.name)) return;
      copyProductionTree(sourcePath, targetPath, relativePath);
      return;
    }

    if (!entry.isFile()) return;
    if (!relativeDirectory && EXCLUDED_ROOT_FILES.has(entry.name)) return;

    if (entry.name.endsWith(".html") && !relativeDirectory) {
      const html = fs.readFileSync(sourcePath, "utf8");
      fs.writeFileSync(targetPath, transformHtml(html, entry.name), "utf8");
      return;
    }

    if (relativePath.split(path.sep).join("/") === "JS/main.js") {
      const script = fs.readFileSync(sourcePath, "utf8");
      fs.writeFileSync(targetPath, transformMainScript(script), "utf8");
      return;
    }

    fs.copyFileSync(sourcePath, targetPath);
  });
}

/**
 * 由可閱讀 source 產生時間流正式執行檔與 linked sourcemap。
 * 時間／空間複雜度 O(B)，B 為三個 source 的總位元組數。
 *
 * 替代方案比較：
 * - 直接維護單行壓縮檔：檔案小，但難以 code review、追蹤差異與除錯。
 * - 只發布可閱讀 source：維護容易，但傳輸量較大且暴露完整註解。
 * - 本方案：main 維護可閱讀 source，dist 發布壓縮檔與 sourcemap，兼顧維護與載入。
 */
function buildTimeflowRuntime() {
  const sourceDirectory = path.join(ROOT, "src", "timeflow");
  const outputDirectory = path.join(DIST, "JS");
  fs.mkdirSync(outputDirectory, { recursive: true });

  TIMEFLOW_RUNTIME.forEach((outputName, sourceName) => {
    const sourcePath = path.join(sourceDirectory, sourceName);
    const outputPath = path.join(outputDirectory, outputName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`[build] 缺少時間流 source：src/timeflow/${sourceName}`);
    }

    esbuild.buildSync({
      entryPoints: [sourcePath],
      outfile: outputPath,
      bundle: false,
      minify: true,
      sourcemap: "linked",
      sourcesContent: true,
      legalComments: "inline",
      charset: "utf8",
      target: ["es2020"],
      logLevel: "silent",
    });
  });
}

/**
 * 完整建置入口。
 * 時間 O(F+B)，空間 O(D+B)。
 */
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  copyProductionTree(ROOT, DIST);
  buildTimeflowRuntime();
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "", "utf8");

  const builtPages = [...NAVIGATION_PAGES.keys()].filter((fileName) =>
    fs.existsSync(path.join(DIST, fileName))
  );
  if (builtPages.length !== NAVIGATION_PAGES.size) {
    throw new Error(`[build] 預期 ${NAVIGATION_PAGES.size} 個導覽頁，實際 ${builtPages.length} 個`);
  }

  console.log(
    `[build] 已產生 dist/：統一 ${builtPages.length} 個頁面導覽，並建置 ${TIMEFLOW_RUNTIME.size} 個時間流執行檔`
  );
}

build();
