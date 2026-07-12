const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const authPath = path.join(ROOT, "cloud", "google-apps-script-v47", "AuthProfiles.gs");
const codePath = path.join(ROOT, "cloud", "google-apps-script-v47", "Code.gs");

assert.ok(fs.existsSync(authPath), "缺少 AuthProfiles.gs，Google 登入與暱稱後端會在執行期失敗");

const authSource = fs.readFileSync(authPath, "utf8");
const codeSource = fs.readFileSync(codePath, "utf8");
new vm.Script(authSource, { filename: "AuthProfiles.gs" });
new vm.Script(codeSource, { filename: "Code.gs" });

const requiredFunctions = [
  "getOAuthClientId_", "verifyGoogleCredential_", "enforceRateLimit_", "isAdmin_",
  "getProfilesSheet_", "getCommentsSheet_", "getProfileBySubject_",
  "getPublicProfileByUserKey_", "setNickname_", "sanitizeUserKey_",
  "normalizeIncomingComment_", "listComments_", "getAuthProfilesHealth_",
];

for (const functionName of requiredFunctions) {
  assert.match(authSource, new RegExp(`function\\s+${functionName}\\s*\\(`), `AuthProfiles.gs 缺少 ${functionName}`);
}

assert.match(codeSource, /verifyGoogleCredential_\(payload\.credential\)/, "Code.gs 必須驗證 Google ID Token");
assert.match(codeSource, /action === "authstatus"/, "Code.gs 必須提供一般登入後端確認路由");
assert.match(codeSource, /action === "auth-health"/, "Code.gs 必須提供登入健康檢查");
assert.match(codeSource, /cleanupDeprecatedScriptProperties/, "Code.gs 應提供舊屬性安全清理函式");
assert.match(codeSource, /authReady:/, "總體健康檢查必須回報真正的登入資料層狀態");
assert.doesNotMatch(authSource, /client_secret|PRIVATE KEY/i, "AuthProfiles.gs 不可包含 OAuth Client Secret 或私鑰");

console.log("Apps Script Google 驗證、健康檢查與暱稱依賴通過。");
