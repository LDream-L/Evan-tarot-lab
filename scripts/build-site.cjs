const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const { buildFootballRuntime, transformFootballHtml } = require("./build-football.cjs");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".github", "cloud", "dist", "node_modules", "playwright-report", "scripts", "src", "test-results", "tests",
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
const ADMIN_PAGES = new Set(["article-admin.html", "service-admin.html"]);
const NOINDEX_PAGES = new Set([...ADMIN_PAGES, "practice.html"]);
const TIMEFLOW_RUNTIME = new Map([
  ["ui.js", "timeflow-v5-ui.js"],
  ["actions.js", "timeflow-v5-actions.js"],
  ["bootstrap.js", "divination-map.js"],
]);
const SITE_ORIGIN = "https://ldream-l.github.io/Evan-tarot-lab";
const PODCAST_URL = "https://podcasts.apple.com/tw/podcast/%E6%9C%89%E9%BB%9E%E5%81%8F/id1896598359";
const BRAND_LOGO_URL = "images/branding/evan-tarot-logo.svg?v=20260625-brand-v4";

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

/** 時間／空間 O(1)。建置期直接輸出品牌，避免執行期閃動。 */
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

/** HTML attribute 安全輸出。時間／空間 O(m)，m = 文字長度。 */
function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 開啟標籤是否包含指定 class。時間 O(a)，空間 O(1)。 */
function openingTagHasClass(openingTag, className) {
  const match = String(openingTag || "").match(/\bclass\s*=\s*(["'])(.*?)\1/i);
  return Boolean(match && match[2].split(/\s+/).includes(className));
}

/** 開啟標籤的 attribute 是否等於指定值。時間 O(a)，空間 O(1)。 */
function openingTagHasAttribute(openingTag, attributeName, expectedValue) {
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return String(openingTag || "").match(pattern)?.[2] === expectedValue;
}

/**
 * 找出指定 HTML 元素的完整範圍；使用標籤深度，不以跨區塊 regex 猜結尾。
 * 時間 O(H)，空間 O(1)，H = HTML 長度。
 *
 * 更快替代方案比較：跨區塊 lazy regex 實作短，但遇到巢狀同名標籤或屬性換行容易誤判；
 * 本實作先定位開啟標籤，再依同名標籤深度找到真正 closing tag。
 */
function findElementRange(source, tagName, predicate) {
  const openingPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let openingMatch;
  while ((openingMatch = openingPattern.exec(source))) {
    if (typeof predicate === "function" && !predicate(openingMatch[0])) continue;

    const start = openingMatch.index;
    const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
    tokenPattern.lastIndex = start;
    let depth = 0;
    let token;
    while ((token = tokenPattern.exec(source))) {
      const isClosing = /^<\//.test(token[0]);
      const isSelfClosing = /\/>$/.test(token[0]);
      if (isClosing) depth -= 1;
      else if (!isSelfClosing) depth += 1;
      if (depth === 0) {
        return {
          start,
          end: tokenPattern.lastIndex,
          openingTag: openingMatch[0],
          openingEnd: openingMatch.index + openingMatch[0].length,
        };
      }
    }
    throw new Error(`[build] <${tagName}> 缺少 closing tag`);
  }
  return null;
}

/** 找出單一 opening tag。時間 O(H)，空間 O(1)。 */
function findOpeningTag(source, tagName, predicate) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let match;
  while ((match = pattern.exec(source))) {
    if (typeof predicate === "function" && !predicate(match[0])) continue;
    return { start: match.index, end: pattern.lastIndex, text: match[0] };
  }
  return null;
}

/** 取得元素所在行縮排。時間 O(H)，空間 O(1)。 */
function getLineIndent(source, index) {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  return source.slice(lineStart, index).match(/^[ \t]*/)?.[0] || "";
}

/** 以已驗證範圍替換元素。時間／空間 O(H)。 */
function replaceRange(source, range, replacement) {
  return `${source.slice(0, range.start)}${replacement}${source.slice(range.end)}`;
}

/** 讀取既有 title／description。時間 O(H)，空間 O(m)。 */
function extractPageMetadata(source) {
  const title = source.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "Evan Tarot";
  const descriptionPatterns = [
    /<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/i,
    /<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']description["'][^>]*>/i,
  ];
  const description = descriptionPatterns
    .map((pattern) => source.match(pattern)?.[1]?.trim() || "")
    .find(Boolean) || "Evan Tarot 的塔羅占卜、文章與實驗工具。";
  return { title, description };
}

/** 建置靜態 canonical、社群預覽與 Schema.org。時間／空間 O(m)。 */
function renderPageMetadata(source, fileName) {
  if (source.includes('data-site-meta="true"')) return "";
  const { title, description } = extractPageMetadata(source);
  const noIndex = NOINDEX_PAGES.has(fileName);
  const canonicalUrl = fileName === "index.html" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}/${fileName}`;
  const lines = [
    `  <meta data-site-meta="true" name="robots" content="${noIndex ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large"}" />`,
  ];

  if (!noIndex) {
    lines.push(
      `  <link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}" />`,
      '  <meta property="og:locale" content="zh_TW" />',
      '  <meta property="og:type" content="website" />',
      '  <meta property="og:site_name" content="Evan Tarot" />',
      `  <meta property="og:title" content="${escapeHtmlAttribute(title)}" />`,
      `  <meta property="og:description" content="${escapeHtmlAttribute(description)}" />`,
      `  <meta property="og:url" content="${escapeHtmlAttribute(canonicalUrl)}" />`,
      '  <meta name="twitter:card" content="summary" />'
    );

    const schema = {
      "@context": "https://schema.org",
      "@type": fileName === "index.html" ? "WebSite" : "WebPage",
      name: title,
      description,
      url: canonicalUrl,
      inLanguage: "zh-Hant",
      ...(fileName === "index.html" ? {} : {
        isPartOf: {
          "@type": "WebSite",
          name: "Evan Tarot",
          url: `${SITE_ORIGIN}/`,
        },
      }),
    };
    lines.push(`  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`);
  }

  return lines.join("\n");
}

/** 建置期取代已確認的舊文案，不在瀏覽器載入後修改 DOM。時間／空間 O(H)。 */
function applyStaticCopyUpdates(source) {
  return source.replace(
    /(<input\s+id=["']practice-remember-device["'][^>]*>\s*)記住這台裝置/g,
    "$1記住接收網址（私人金鑰只保留在目前瀏覽器工作階段）"
  );
}

/**
 * 將品牌、SEO、favicon、跳轉連結與主要內容目標寫入正式 HTML。
 * 時間／空間 O(H)，H = HTML 長度。
 */
function applyStaticSiteShell(source, fileName) {
  let output = applyStaticCopyUpdates(source);
  const logoRange = findElementRange(output, "div", (tag) => openingTagHasClass(tag, "logo"));
  if (!logoRange) throw new Error(`[build] ${fileName} 找不到品牌 Logo 容器`);
  output = replaceRange(output, logoRange, renderBrand(getLineIndent(output, logoRange.start)));

  const pageMetadata = renderPageMetadata(output, fileName);
  if (pageMetadata) output = output.replace("</head>", `${pageMetadata}\n</head>`);

  if (!output.includes('href="site-shell.css')) {
    output = output.replace(
      "</head>",
      `  <link rel="stylesheet" href="site-shell.css?v=20260712-structured-shell-v1" />\n  <link rel="icon" type="image/svg+xml" href="${BRAND_LOGO_URL}" />\n</head>`
    );
  }

  if (!output.includes('class="skip-link"')) {
    const bodyTag = findOpeningTag(output, "body");
    if (!bodyTag) throw new Error(`[build] ${fileName} 找不到 body`);
    output = `${output.slice(0, bodyTag.end)}\n  <a class="skip-link" href="#main-content">跳到主要內容</a>${output.slice(bodyTag.end)}`;
  }

  const mainTag = findOpeningTag(output, "main");
  if (!mainTag) throw new Error(`[build] ${fileName} 找不到 main`);
  if (/\bid\s*=/.test(mainTag.text)) {
    throw new Error(`[build] ${fileName} 的 main 已有 id，需明確整合 main-content`);
  }
  const mainReplacement = mainTag.text.replace(/^<main\b/i, '<main id="main-content" tabindex="-1"');
  output = replaceRange(output, mainTag, mainReplacement);

  if (!output.includes('src="JS/site-shell.js')) {
    output = output.replace(
      "</body>",
      '  <script src="JS/site-shell.js?v=20260712-structured-shell-v1"></script>\n</body>'
    );
  }

  return output;
}

/** 時間／空間 O(H)，H = HTML 長度。 */
function transformHtml(source, fileName) {
  if (ADMIN_PAGES.has(fileName)) return applyStaticSiteShell(source, fileName);
  if (!NAVIGATION_PAGES.has(fileName)) return source;

  const navRange = findElementRange(source, "nav", (tag) =>
    openingTagHasClass(tag, "nav") && openingTagHasAttribute(tag, "aria-label", "主選單")
  );
  if (!navRange) throw new Error(`[build] ${fileName} 找不到主導覽`);
  let output = replaceRange(
    source,
    navRange,
    renderNavigation(NAVIGATION_PAGES.get(fileName), getLineIndent(source, navRange.start))
  );
  output = applyStaticSiteShell(output, fileName);
  if (fileName === "football-lab.html") output = transformFootballHtml(output);
  return output;
}

/** 時間／空間 O(J)，J = main.js 長度。 */
function transformMainScript(source) {
  const invocation = "  normalizeSiteNavigation();";
  if (!source.includes(invocation)) throw new Error("[build] JS/main.js 找不到 normalizeSiteNavigation() 初始化呼叫");
  return source.replace(invocation, "  // 主導覽已由 scripts/build-site.cjs 在建置期靜態產生。");
}

/** 遞迴複製正式資源：時間 O(F+B)，空間 O(D)。 */
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

/** 時間／空間 O(B)，B = 三個 source 總大小。 */
function buildTimeflowRuntime() {
  const sourceDirectory = path.join(ROOT, "src", "timeflow");
  const outputDirectory = path.join(DIST, "JS");
  fs.mkdirSync(outputDirectory, { recursive: true });
  TIMEFLOW_RUNTIME.forEach((outputName, sourceName) => {
    const sourcePath = path.join(sourceDirectory, sourceName);
    if (!fs.existsSync(sourcePath)) throw new Error(`[build] 缺少時間流 source：src/timeflow/${sourceName}`);
    esbuild.buildSync({
      entryPoints: [sourcePath],
      outfile: path.join(outputDirectory, outputName),
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
 * 從可閱讀來源產生正式壓縮 CSS。時間／空間 O(C)，C = CSS 長度。
 * 更快替代方案：直接維護單行壓縮檔雖不需建置，但無法有效 diff 與 code review。
 */
function buildTimeflowStyles() {
  const sourcePath = path.join(ROOT, "src", "styles", "timeflow.css");
  if (!fs.existsSync(sourcePath)) throw new Error("[build] 缺少 src/styles/timeflow.css");
  const source = fs.readFileSync(sourcePath, "utf8");
  const result = esbuild.transformSync(source, {
    loader: "css",
    minify: true,
    legalComments: "inline",
    charset: "utf8",
    logLevel: "silent",
  });
  fs.writeFileSync(path.join(DIST, "timeflow.css"), result.code, "utf8");
}

/** 完整建置：時間 O(F+B+C)，空間 O(D+B+C)。 */
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  copyProductionTree(ROOT, DIST);
  buildTimeflowRuntime();
  buildTimeflowStyles();
  buildFootballRuntime({ root: ROOT, dist: DIST });
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "", "utf8");
  const builtPages = [...NAVIGATION_PAGES.keys()].filter((fileName) => fs.existsSync(path.join(DIST, fileName)));
  const builtAdminPages = [...ADMIN_PAGES].filter((fileName) => fs.existsSync(path.join(DIST, fileName)));
  if (builtPages.length !== NAVIGATION_PAGES.size) throw new Error(`[build] 預期 ${NAVIGATION_PAGES.size} 個導覽頁，實際 ${builtPages.length} 個`);
  if (builtAdminPages.length !== ADMIN_PAGES.size) throw new Error(`[build] 預期 ${ADMIN_PAGES.size} 個管理頁，實際 ${builtAdminPages.length} 個`);
  console.log(`[build] 已產生 dist/：${builtPages.length} 頁導覽、${builtAdminPages.length} 頁管理後台、${TIMEFLOW_RUNTIME.size} 個時間流 runtime、1 個時間流 CSS、1 個世足 bundle`);
}

build();
