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
 * 驗證服務管理、私人入口與橋接安全契約。
 * 時間 O(H + J)，空間 O(H + J)。
 *
 * 替代方案比較：只依人工點擊容易漏掉權限與建置輸出；
 * 本測試直接鎖定正式 dist 的靜態契約，E2E 再驗證瀏覽器互動。
 */
function run() {
  const services = readDist("services.html");
  const serviceAdmin = readDist("service-admin.html");
  const lab = readDist("lab.html");
  const bookingBridge = readDist(path.join("JS", "booking-verified.js"));
  const adminNavigation = readDist(path.join("JS", "admin-navigation.js"));

  assert.ok(services.includes('id="service-list"'));
  assert.ok(services.includes('id="service-topic-options"'));
  assert.ok(services.includes('src="JS/services.js'));
  assert.ok(serviceAdmin.includes('id="service-admin-form"'));
  assert.ok(serviceAdmin.includes('id="service-admin-price"'));
  assert.ok(serviceAdmin.includes('src="JS/service-admin.js'));
  assert.ok(serviceAdmin.includes('class="skip-link" href="#main-content"'));

  assert.ok(lab.includes('data-admin-only-lab-item="private-access" hidden'));
  assert.ok(lab.includes('data-admin-only-lab-item="private-practice" hidden'));
  assert.ok(lab.includes('<strong id="lab-project-count">3</strong>'));

  assert.ok(bookingBridge.includes("state.bridgeOrigin = event.origin"));
  assert.ok(bookingBridge.includes("state.bridgeOrigin\n      );"));
  assert.equal(bookingBridge.includes('type: "create", payload },\n        "*"'), false);

  assert.ok(adminNavigation.includes('href: "service-admin.html"'));
  assert.ok(adminNavigation.includes("data-admin-only-lab-item"));

  assert.ok(fs.existsSync(path.join(ROOT, "cloud", "google-apps-script-v47", "Services.gs")));
  assert.ok(fs.existsSync(path.join(ROOT, "cloud", "google-apps-script-v47", "ArticleAdmin.gs")));
  assert.equal(fs.existsSync(path.join(DIST, "cloud")), false);

  console.log("service-management tests passed");
}

run();
