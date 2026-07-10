const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const { buildFootballRuntime, transformFootballHtml } = require("./build-football.cjs");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".github", "dist", "node_modules", "playwright-report", "scripts", "src", "test-results", "tests",
]);
const EXCLUDED_ROOT_FILES = new Set([
  ".gitignore", "package.json", "package-lock.json", "playwright.config.cjs", "README.md",
]);
const NAVIGATION_PAGES = new Map([
  ["index.html", "intro"], ["services.html", "services"], ["privacy.html", "services"],
  ["articles.html", "articles"], ["article.html", "articles"], ["lab.html", "lab"],
  ["methodology.html", "lab"], ["lost-item.html", "lab"], ["football-lab.html", "lab"],
  ["timeflow.html", "lab"], ["practice.html", "lab"],
]);
const TIMEFLOW_RUNTIME = new Map([
  ["ui.js", "timeflow-v5-ui.js"],
  ["actions.js", "timeflow-v5-actions.js"],
  ["bootstrap.js", "divination-map.js"],
]);
const PODCAST_URL = "https://podcasts.apple.com/tw/podcast/%E6%9C%89%E9%BB%9E%E5%81%8F/id1896598359";
const BRAND_LOGO_URL = "images/branding/evan-tarot-logo.svg?v=20260625-brand-v4";
const NAV_PATTERN = /(^[ \t]*)<nav\b(?=[^>]*\bclass=["'][^"']*\bnav\b[^"']*["'])(?=[^>]*\baria-label=["']主選單["'])[^>]*>[\s\S]*?<\/nav>/m;
const LOGO_PATTERN = /(^[ \t]*)<div\s+class=["']logo["']\s*>[\s\S]*?<\/div>/m;

/** 時間／空間 O(1)。 */
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
 * 產生不依賴 JavaScript 的品牌首頁連結。
 * 時間／空間複雜度 O(1)。
 *
 * 替代方案比較：DOMContentLoaded 後才將文字 Logo 換成圖片會造成首屏閃動；
 * 建置期直接輸出完整品牌節點，瀏覽器第一次繪製即為最終內容。
 */
function renderBrand(indent) {
  return [
    `${indent}<a class="logo site-brand-link" href="index.html" aria-label="Evan Tarot 首頁">`,
    `${indent}  <img class="site-brand-image" src="${BRAND_LOGO_URL}" alt="" width="54" height="54" decoding="async" />`,
    `${indent}  <span class="site-brand-copy">`,
    `${indent}    <span class="logo-main">Evan Tarot</span>`,
    `${indent}    <span class="logo-sub">Tarot Lab ／ Systematic Divination</span>`,
    `${indent}  </span>`,
    `${indent}</a>`,
  ].join("\n");
}

/**
 * 將品牌、favicon、跳轉連結與主要內容目標寫入正式 HTML。
 * 時間／空間複雜度 O(H)，H 為 HTML 長度。
 *
 * 替代方案比較：逐頁手動維護容易分歧；執行期注入會造成閃動。
 * 本方案集中在建置器，所有正式頁面得到相同靜態結構。
 */
function applyStaticSiteShell(source, fileName) {
  let output = source;
  const logoMatch = output.match(LOGO_PATTERN);
  if (!logoMatch) throw new Error(`[build] ${fileName} 找不到品牌 Logo 容器`);
  output = output.replace(LOGO_PATTERN, renderBrand(logoMatch[1]));

  if (!output.includes('href="site-shell.css')) {
    output = output.replace(
      "</head>",
      `  <link rel="stylesheet" href="site-shell.css?v=20260710-static-brand-a11y-v1" />\n  <link rel="icon" type="image/svg+xml" href="${BRAND_LOGO_URL}" />\n</head>`
    );
  }

  if (!output.includes('class="skip-link"')) {
    output = output.replace(/(<body\b[^>]*>)/, '$1\n  <a class="skip-link" href="#main-content">跳到主要內容</a>');
  }

  output = output.replace(/<main(\s[^>]*)?>/, (match, attributes = "") => {
    if (/\bid=/.test(attributes)) {
      throw new Error(`[build] ${fileName} 的 main 已有 id，需明確整合 main-content`);
    }
    return `<main id="main-content" tabindex="-1"${attributes}>`;
  });

  return output;
}

/** 時間／空間 O(H)，H 為 HTML 長度。 */
function transformHtml(source, fileName) {
  if (!NAVIGATION_PAGES.has(fileName)) return source;
  const match = source.match(NAV_PATTERN);
  if (!match) throw new Error(`[build] ${fileName} 找不到主導覽`);
  let output = source.replace(NAV_PATTERN, renderNavigation(NAVIGATION_PAGES.get(fileName), match[1]));
  output = applyStaticSiteShell(output, fileName);
  if (fileName === "football-lab.html") output = transformFootballHtml(output);
  return output;
}

/** 時間／空間 O(J)，J 為 main.js 長度。 */
function transformMainScript(source) {
  const invocation = "  normalizeSiteNavigation();";
  if (!source.includes(invocation)) throw new Error("[build] JS/main.js 找不到 normalizeSiteNavigation() 初始化呼叫");
  return source.replace(invocation, "  // 主導覽已由 scripts/build-site.cjs 在建置期靜態產生。");
}

/**
 * 遞迴複製正式資源：時間 O(F+B)，空間 O(D)。
 * 快速方案：排除開發目錄後一次複製，避免發布 tests、src 與建置設定。
 */
function copyProductionTree(sourceDirectory, targetDirectory, relativeDirectory = "") {
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.readdirSync(sourceDirectory, { withFileTypes: true }).forEach((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!relativeDirectory && EXCLUDED_DIRECTORIES.has(entry.name)) return;
      copyProductionTree(sourcePath, targetPath, relativePath);
      return;
    }
    if (!entry.isFile() || (!relativeDirectory && EXCLUDED_ROOT_FILES.has(entry.name))) return;
    if (entry.name.endsWith(".html") && !relativeDirectory) {
      fs.writeFileSync(targetPath, transformHtml(fs.readFileSync(sourcePath, "utf8"), entry.name), "utf8");
      return;
    }
    if (relativePath.split(path.sep).join("/") === "JS/main.js") {
      fs.writeFileSync(targetPath, transformMainScript(fs.readFileSync(sourcePath, "utf8")), "utf8");
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
  });
}

/** 時間／空間 O(B)，B 為三個 source 總大小。 */
function buildTimeflowRuntime() {
  const sourceDirectory = path.join(ROOT, "src", "timeflow");
  const outputDirectory = path.join(DIST, "JS");
  fs.mkdirSync(outputDirectory, { recursive: true });
  TIMEFLOW_RUNTIME.forEach((outputName, sourceName) => {
    const sourcePath = path.join(sourceDirectory, sourceName);
    if (!fs.existsSync(sourcePath)) throw new Error(`[build] 缺少時間流 source：src/timeflow/${sourceName}`);
    esbuild.buildSync({
      entryPoints: [sourcePath], outfile: path.join(outputDirectory, outputName), bundle: false,
      minify: true, sourcemap: "linked", sourcesContent: true, legalComments: "inline",
      charset: "utf8", target: ["es2020"], logLevel: "silent",
    });
  });
}

/** 完整建置：時間 O(F+B)，空間 O(D+B)。 */
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  copyProductionTree(ROOT, DIST);
  buildTimeflowRuntime();
  buildFootballRuntime({ root: ROOT, dist: DIST });
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "", "utf8");
  const builtPages = [...NAVIGATION_PAGES.keys()].filter((fileName) => fs.existsSync(path.join(DIST, fileName)));
  if (builtPages.length !== NAVIGATION_PAGES.size) throw new Error(`[build] 預期 ${NAVIGATION_PAGES.size} 個導覽頁，實際 ${builtPages.length} 個`);
  console.log(`[build] 已產生 dist/：${builtPages.length} 頁導覽與靜態品牌、${TIMEFLOW_RUNTIME.size} 個時間流 runtime、1 個世足 bundle`);
}

build();
