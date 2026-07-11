const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/** 讀取正式建置文字。時間／空間 O(n)，n = 檔案長度。 */
function readDist(relativePath) {
  return fs.readFileSync(path.join(DIST, relativePath), "utf8");
}

/**
 * 驗證 SEO、行動導覽、404 與公開設定可維護性。
 * 時間 O(H + C)，空間 O(H + C)。
 *
 * 替代方案比較：人工檢查容易漏掉管理頁 noindex 或 canonical 分歧；
 * 本測試直接鎖定正式 dist 與 source 契約。
 */
function run() {
  const index = readDist("index.html");
  const article = readDist("article.html");
  const practice = readDist("practice.html");
  const serviceAdmin = readDist("service-admin.html");
  const shellCss = readDist("site-shell.css");
  const shellJs = readDist(path.join("JS", "site-shell.js"));
  const cloudConfig = readDist(path.join("JS", "cloud-config.js"));
  const notFound = readDist("404.html");
  const robots = readDist("robots.txt");
  const sitemap = readDist("sitemap.xml");

  assert.ok(index.includes('data-site-meta="true" name="robots" content="index,follow,max-image-preview:large"'));
  assert.ok(index.includes('rel="canonical" href="https://ldream-l.github.io/Evan-tarot-lab/"'));
  assert.ok(index.includes('property="og:title"'));
  assert.ok(index.includes('type="application/ld+json"'));

  assert.ok(article.includes('rel="canonical" href="https://ldream-l.github.io/Evan-tarot-lab/article.html"'));
  assert.ok(shellJs.includes("normalizeDynamicCanonical"));
  assert.ok(shellJs.includes('url.searchParams.set("id", articleId.toLowerCase())'));

  assert.ok(practice.includes('content="noindex,nofollow,noarchive"'));
  assert.equal(practice.includes('rel="canonical"'), false);
  assert.ok(serviceAdmin.includes('content="noindex,nofollow,noarchive"'));
  assert.equal(serviceAdmin.includes('rel="canonical"'), false);

  assert.ok(shellCss.includes("flex-wrap: nowrap"));
  assert.ok(shellCss.includes("overflow-x: auto"));
  assert.ok(shellCss.includes("scroll-snap-type: x proximity"));

  assert.ok(notFound.includes("404 / PAGE NOT FOUND"));
  assert.ok(notFound.includes('name="robots" content="noindex,nofollow,noarchive"'));
  assert.ok(robots.includes("Disallow: /service-admin.html"));
  assert.ok(robots.includes("Sitemap: https://ldream-l.github.io/Evan-tarot-lab/sitemap.xml"));
  assert.ok(sitemap.includes("https://ldream-l.github.io/Evan-tarot-lab/services.html"));
  assert.equal(sitemap.includes("service-admin.html"), false);
  assert.equal(sitemap.includes("practice.html"), false);

  assert.ok(cloudConfig.includes('const EVAN_CLOUD_API_URL = "https://script.google.com/macros/s/'));
  assert.equal(cloudConfig.includes("String.fromCharCode"), false);

  console.log("site-quality tests passed");
}

run();
