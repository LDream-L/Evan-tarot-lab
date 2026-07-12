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

const requiredFunctions = [
  "getOAuthClientId_",
  "verifyGoogleCredential_",
  "enforceRateLimit_",
  "isAdmin_",
  "getProfilesSheet_",
  "getCommentsSheet_",
  "getProfileBySubject_",
  "getPublicProfileByUserKey_",
  "setNickname_",
  "sanitizeUserKey_",
  "normalizeIncomingComment_",
  "listComments_",
];

for (const functionName of requiredFunctions) {
  assert.match(
    authSource,
    new RegExp(`function\\s+${functionName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\(`),
    `AuthProfiles.gs 缺少 ${functionName}`
  );
}

assert.match(codeSource, /verifyGoogleCredential_\(payload\.credential\)/, "Code.gs 必須驗證 Google ID Token");
assert.match(codeSource, /action === "adminstatus"/, "Code.gs 必須保留管理員狀態驗證路由");
assert.doesNotMatch(authSource, /client_secret|PRIVATE KEY/i, "AuthProfiles.gs 不可包含 OAuth Client Secret 或私鑰");

console.log("Apps Script Google 驗證、暱稱與留言依賴檢查通過。");
