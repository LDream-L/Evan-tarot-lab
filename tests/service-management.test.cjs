const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/** 讀取正式建置文字。時間／空間 O(n)，n = 檔案長度。 */
function readDist(relativePath) {
  return fs.readFileSync(path.join(DIST, relativePath), "utf8");
}

/** 讀取正式 source。時間／空間 O(n)。 */
function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

/**
 * 驗證服務多方案、登入後端確認、歷史、備份、私人入口與橋接安全契約。
 * 時間 O(H + J)，空間 O(H + J)。
 * 替代方案：人工點擊易漏權限與部署輸出；靜態契約搭配 E2E 可提早阻止缺檔。
 */
function run() {
  const services = readDist("services.html");
  const serviceAdmin = readDist("service-admin.html");
  const lab = readDist("lab.html");
  const bookingBridge = readDist(path.join("JS", "booking-verified.js"));
  const adminNavigation = readDist(path.join("JS", "admin-navigation.js"));
  const servicePlans = readDist(path.join("JS", "service-plans.js"));
  const serviceAdminV2 = readDist(path.join("JS", "service-admin-v2.js"));
  const googleAuth = readDist(path.join("JS", "google-auth.js"));
  const servicesBackend = readSource(path.join("cloud", "google-apps-script-v47", "Services.gs"));
  const codeBackend = readSource(path.join("cloud", "google-apps-script-v47", "Code.gs"));

  assert.ok(services.includes('id="service-list"'));
  assert.ok(services.includes('id="service-topic-options"'));
  assert.ok(services.includes('src="JS/service-plans.js'));
  assert.ok(serviceAdmin.includes('id="service-admin-form"'));
  assert.ok(serviceAdmin.includes('id="service-admin-add-plan"'));
  assert.ok(serviceAdmin.includes('id="service-admin-preview-plans"'));
  assert.ok(serviceAdmin.includes('src="JS/service-admin-v2.js'));
  assert.ok(serviceAdmin.includes('class="skip-link" href="#main-content"'));

  assert.ok(servicePlans.includes("servicePlanBooking"));
  assert.ok(servicePlans.includes("deliveryMode"));
  assert.ok(servicePlans.includes("bookingValue"));
  assert.ok(serviceAdminV2.includes("service-plan-editor"));
  assert.ok(serviceAdminV2.includes("公開方案"));
  assert.ok(serviceAdminV2.includes("service-plan-calculation"));

  assert.ok(servicesBackend.includes('"plansJson"'));
  assert.ok(servicesBackend.includes("normalizeServicePlans_"));
  assert.ok(servicesBackend.includes("buildServicePlanBookingValue_"));
  assert.ok(codeBackend.includes('action === "authstatus"'));
  assert.ok(codeBackend.includes('action === "auth-health"'));
  assert.ok(codeBackend.includes("cleanupDeprecatedScriptProperties"));
  assert.ok(googleAuth.includes("verifyCredentialWithBackend"));
  assert.ok(googleAuth.includes('action: "authStatus"'));
  assert.ok(googleAuth.indexOf("verifyCredentialWithBackend(nextCredential)") < googleAuth.indexOf("credential = nextCredential"));

  assert.ok(lab.includes('data-admin-only-lab-item="private-access" hidden'));
  assert.ok(lab.includes('data-admin-only-lab-item="private-practice" hidden'));
  assert.ok(lab.includes('<strong id="lab-project-count">3</strong>'));

  assert.ok(bookingBridge.includes("state.bridgeOrigin = event.origin"));
  assert.ok(bookingBridge.includes("state.bridgeOrigin\n      );"));
  assert.equal(bookingBridge.includes('type: "create", payload },\n        "*"'), false);

  assert.ok(adminNavigation.includes('href: "service-admin.html"'));
  assert.ok(adminNavigation.includes("data-admin-only-lab-item"));
  assert.ok(fs.existsSync(path.join(ROOT, "cloud", "google-apps-script-v47", "Services.gs")));
  assert.ok(fs.existsSync(path.join(ROOT, "cloud", "google-apps-script-v47", "AdminHistory.gs")));
  assert.ok(fs.existsSync(path.join(ROOT, "cloud", "google-apps-script-v47", "Backups.gs")));
  assert.equal(fs.existsSync(path.join(DIST, "cloud")), false);

  console.log("service-management tests passed");
}

run();
