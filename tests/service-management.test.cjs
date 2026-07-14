const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
 * 建立只涵蓋服務刪除所需介面的工作表替身。
 * 時間 O(r)，空間 O(r)，r = 測試資料列數。
 *
 * 更快替代方案比較：連線正式 Google Sheets 會受到網路與私人資料狀態影響；
 * 記憶體替身能在固定資料下直接驗證首次刪除與重送刪除。
 */
function createServiceSheet(rows) {
  return {
    rows: rows.map((row) => row.slice()),
    getLastRow() {
      return this.rows.length + 1;
    },
    getRange(row, column, rowCount, columnCount) {
      const values = this.rows
        .slice(row - 2, row - 2 + rowCount)
        .map((sourceRow) => sourceRow.slice(column - 1, column - 1 + columnCount));
      return {
        getDisplayValues: () => values.map((sourceRow) => sourceRow.map((value) => String(value ?? ""))),
        getValues: () => values.map((sourceRow) => sourceRow.slice()),
      };
    },
    deleteRow(rowNumber) {
      this.rows.splice(rowNumber - 2, 1);
    },
  };
}

/**
 * 在隔離環境執行 Apps Script 服務刪除函式。
 * 時間／空間 O(S)，S = Services.gs 程式碼長度。
 *
 * 更快替代方案比較：只比對原始碼字串無法驗證回傳值與資料列是否真的移除；
 * VM 測試直接執行正式函式，並以固定工作表替身隔離外部服務。
 */
function createDeleteServiceRunner(source, sheet) {
  const context = vm.createContext({
    __sheet: sheet,
    console: { error() {} },
    SpreadsheetApp: { flush() {} },
    formatTaipeiDate_: (value) => String(value || ""),
    sanitizeText_: (value, maxLength) => String(value == null ? "" : value).trim().slice(0, maxLength),
  });
  vm.runInContext(
    `${source}\ngetServicesSheet_ = () => __sheet;\nthis.__deleteService = deleteService_;`,
    context,
    { filename: "Services.gs" }
  );
  return context.__deleteService;
}

/** 時間／空間 O(S + r)，驗證刪除為冪等操作。 */
function verifyIdempotentServiceDeletion(source) {
  const sheet = createServiceSheet([[
    "relationship", "published", "2026-07-14T00:26:00+08:00", "人際 / 感情動態占卜", "測試簡介",
    "", "", "", "", "", "", "", "relationship", 30, "", "[]",
  ]]);
  const deleteService = createDeleteServiceRunner(source, sheet);

  const first = JSON.parse(JSON.stringify(deleteService("relationship", "", "request-1")));
  assert.deepEqual(first, { id: "relationship", deleted: true });
  assert.equal(sheet.rows.length, 0, "首次刪除應移除指定服務列");

  const repeated = JSON.parse(JSON.stringify(deleteService("relationship", "", "request-2")));
  assert.deepEqual(repeated, { id: "relationship", deleted: false, alreadyAbsent: true });
  assert.throws(() => deleteService("不合法 ID", "", "request-3"), /服務 ID 不正確/);
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
  const publicServices = readDist(path.join("JS", "services.js"));
  const servicePlans = readDist(path.join("JS", "service-plans.js"));
  const servicePlanDetails = readDist(path.join("JS", "service-plan-details.js"));
  const serviceAdminV2 = readDist(path.join("JS", "service-admin-v2.js"));
  const googleAuth = readDist(path.join("JS", "google-auth.js"));
  const servicesBackend = readSource(path.join("cloud", "google-apps-script-v47", "Services.gs"));
  const codeBackend = readSource(path.join("cloud", "google-apps-script-v47", "Code.gs"));

  assert.ok(services.includes('id="service-list"'));
  assert.ok(services.includes('id="service-topic-options"'));
  assert.ok(services.includes('src="JS/service-plans.js'));
  assert.ok(services.includes('id="service-plan-dialog"'));
  assert.ok(services.includes('src="JS/service-plan-details.js'));
  assert.ok(services.includes("正在載入目前公開的方案"));
  assert.equal(services.includes("人際 / 感情動態占卜"), false);
  assert.equal(services.includes("工作 / 職涯路線占卜"), false);
  assert.equal(services.includes("主題深度占卜"), false);
  assert.ok(serviceAdmin.includes('id="service-admin-form"'));
  assert.ok(serviceAdmin.includes('id="service-admin-add-plan"'));
  assert.ok(serviceAdmin.includes('id="service-admin-preview-plans"'));
  assert.ok(serviceAdmin.includes('src="JS/service-admin-v2.js'));
  assert.ok(serviceAdmin.includes('class="skip-link" href="#main-content"'));

  assert.ok(servicePlans.includes("servicePlanBooking"));
  assert.ok(servicePlans.includes("servicePlanDetails"));
  assert.ok(servicePlans.includes("deliveryMode"));
  assert.ok(servicePlans.includes("bookingValue"));
  assert.ok(servicePlans.includes("createPlanCard"));
  assert.equal(servicePlans.includes("fetch("), false, "方案呈現層不應重複請求服務 API");
  assert.ok(publicServices.includes('setServices([], "unavailable")'));
  assert.equal(publicServices.includes("人際 / 感情動態占卜"), false);
  assert.equal(publicServices.includes("工作 / 職涯路線占卜"), false);
  assert.equal(publicServices.includes("主題深度占卜"), false);
  assert.ok(servicePlanDetails.includes("servicePlanDetails"));
  assert.ok(servicePlanDetails.includes("getPlanByBookingValue"));
  assert.ok(servicePlanDetails.includes("HTMLDialogElement"));
  assert.ok(serviceAdminV2.includes("service-plan-editor"));
  assert.ok(serviceAdminV2.includes("公開方案"));
  assert.ok(serviceAdminV2.includes("service-plan-calculation"));

  assert.ok(servicesBackend.includes('"plansJson"'));
  assert.ok(servicesBackend.includes("normalizeServicePlans_"));
  assert.ok(servicesBackend.includes("buildServicePlanBookingValue_"));
  verifyIdempotentServiceDeletion(servicesBackend);
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
