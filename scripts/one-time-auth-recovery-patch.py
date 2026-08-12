from pathlib import Path
import re

VERSION = "20260812-auth-recovery-v2"


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


# 1) Google auth: let users re-login while a stored session is being verified,
#    and ignore stale async verification results.
path = Path("JS/google-auth.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  const REQUEST_TIMEOUT_MS = 12000;\n  const CREDENTIAL_STORAGE_KEY = "evanGoogleIdToken";\n',
    '  const REQUEST_TIMEOUT_MS = 12000;\n  const RESTORE_TIMEOUT_MS = 5000;\n  const CREDENTIAL_STORAGE_KEY = "evanGoogleIdToken";\n',
    "restore timeout constant",
)
text = replace_once(
    text,
    '  let reloadScheduled = false;\n  let lifecycleBound = false;\n',
    '  let reloadScheduled = false;\n  let lifecycleBound = false;\n  let restoringSession = false;\n  let verificationAttempt = 0;\n',
    "auth state fields",
)
text = replace_once(
    text,
    '  async function fetchWithTimeout(url, options = {}) {\n    const controller = new AbortController();\n    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);\n',
    '''  /**\n   * 單次網路請求逾時控制：時間／空間 O(1)（不含網路等待）。\n   * 更快替代方案比較：所有驗證共用 12 秒會讓舊工作階段恢復卡住介面過久；\n   * 本版允許恢復流程使用較短逾時，但新登入仍保留完整驗證時間。\n   */\n  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {\n    const controller = new AbortController();\n    const timer = window.setTimeout(\n      () => controller.abort(),\n      Math.max(1, Number(timeoutMs) || REQUEST_TIMEOUT_MS)\n    );\n''',
    "fetch timeout function",
)
text = replace_once(
    text,
    '    if (signInContainer && authVerifying && !isSignedIn) {\n      signInContainer.textContent = "正在向後端確認 Google 登入…";\n      signInContainer.classList.add("site-account-loading");\n    }\n',
    '''    if (signInContainer && authVerifying && !isSignedIn && !restoringSession) {\n      signInContainer.textContent = "正在向後端確認 Google 登入…";\n      signInContainer.classList.add("site-account-loading");\n    }\n''',
    "verification loading UI",
)
text = replace_once(
    text,
    '      if (authVerifying) {\n        status.textContent = "正在向 Apps Script 驗證 Google 工作階段…";\n',
    '      if (authVerifying) {\n        status.textContent = restoringSession\n          ? "正在恢復上次 Google 工作階段；若等待過久，可直接重新登入。"\n          : "正在向 Apps Script 驗證 Google 工作階段…";\n',
    "verification status copy",
)
text = replace_once(
    text,
    '  async function verifyCredentialWithBackend(nextCredential) {\n    const response = await fetchWithTimeout(getApiUrl(), {\n',
    '  async function verifyCredentialWithBackend(nextCredential, timeoutMs = REQUEST_TIMEOUT_MS) {\n    const response = await fetchWithTimeout(getApiUrl(), {\n',
    "backend verification signature",
)
text = replace_once(
    text,
    '      }),\n    });\n    return readJsonResponse(response, "Google 登入後端驗證失敗。");\n  }\n\n  async function loadProfile() {\n',
    '      }),\n    }, timeoutMs);\n    return readJsonResponse(response, "Google 登入後端驗證失敗。");\n  }\n\n  async function loadProfile() {\n',
    "backend verification timeout call",
)
old_set = '''  async function setCredential(nextCredential, persist) {\n    const payload = decodeJwtPayload(nextCredential);\n    if (!nextCredential || !isCredentialFresh(payload)) {\n      authError = "Google 登入資料無效或已過期，請重新登入。";\n      return false;\n    }\n\n    authVerifying = true;\n    authError = "";\n    credential = "";\n    user = null;\n    nickname = "";\n    updateUI();\n    notify();\n\n    try {\n      await verifyCredentialWithBackend(nextCredential);\n      const nextUser = await createUser(payload);\n      credential = nextCredential;\n      user = nextUser;\n      scheduleCredentialExpiry(payload);\n      if (persist) sessionStorage.setItem(CREDENTIAL_STORAGE_KEY, nextCredential);\n      authVerifying = false;\n      updateUI();\n      notify();\n      await loadProfile();\n      return true;\n    } catch (error) {\n      console.error("[google-auth] 後端驗證失敗：", error);\n      clearCredentialExpiryTimer();\n      credentialExpiresAt = 0;\n      sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);\n      credential = "";\n      user = null;\n      nickname = "";\n      authVerifying = false;\n      authError = error?.name === "AbortError"\n        ? "Google 登入驗證逾時，請稍後重新登入。"\n        : error?.message || "Google 登入驗證失敗，請重新操作。";\n      updateUI();\n      notify();\n      renderButton();\n      return false;\n    }\n  }\n'''
new_set = '''  /**\n   * 後端驗證並套用單次 Google 憑證。\n   * 時間複雜度：O(m)＋一次後端請求，m = JWT payload 長度。\n   * 空間複雜度：O(m)。\n   * 更快替代方案比較：直接信任瀏覽器 JWT 可省一次請求，但會失去 audience／issuer 的後端安全驗證；\n   * 本版保留後端驗證，並用 attempt 編號 O(1) 丟棄較舊的非同步結果，讓重新登入不必等待舊恢復請求。\n   */\n  async function setCredential(nextCredential, persist, options = {}) {\n    const payload = decodeJwtPayload(nextCredential);\n    if (!nextCredential || !isCredentialFresh(payload)) {\n      authError = "Google 登入資料無效或已過期，請重新登入。";\n      return false;\n    }\n\n    const attempt = ++verificationAttempt;\n    const isRestore = Boolean(options.restore);\n    restoringSession = isRestore;\n    authVerifying = true;\n    authError = "";\n    credential = "";\n    user = null;\n    nickname = "";\n    updateUI();\n    notify();\n    if (isRestore) renderButton();\n\n    try {\n      await verifyCredentialWithBackend(\n        nextCredential,\n        isRestore ? RESTORE_TIMEOUT_MS : REQUEST_TIMEOUT_MS\n      );\n      if (attempt !== verificationAttempt) return false;\n      const nextUser = await createUser(payload);\n      if (attempt !== verificationAttempt) return false;\n      credential = nextCredential;\n      user = nextUser;\n      restoringSession = false;\n      scheduleCredentialExpiry(payload);\n      if (persist) sessionStorage.setItem(CREDENTIAL_STORAGE_KEY, nextCredential);\n      authVerifying = false;\n      updateUI();\n      notify();\n      await loadProfile();\n      return true;\n    } catch (error) {\n      if (attempt !== verificationAttempt) return false;\n      console.error("[google-auth] 後端驗證失敗：", error);\n      clearCredentialExpiryTimer();\n      credentialExpiresAt = 0;\n      if (sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) === nextCredential) {\n        sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);\n      }\n      credential = "";\n      user = null;\n      nickname = "";\n      restoringSession = false;\n      authVerifying = false;\n      authError = error?.name === "AbortError"\n        ? (isRestore\n          ? "上次登入恢復逾時，請直接重新登入。"\n          : "Google 登入驗證逾時，請稍後重新登入。")\n        : error?.message || "Google 登入驗證失敗，請重新操作。";\n      updateUI();\n      notify();\n      renderButton();\n      return false;\n    }\n  }\n'''
text = replace_once(text, old_set, new_set, "setCredential")
text = replace_once(
    text,
    '''  async function restoreCredential() {\n    const storedCredential = String(sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) || "");\n    if (!storedCredential) return false;\n    const accepted = await setCredential(storedCredential, false);\n    if (!accepted) sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);\n    return accepted;\n  }\n''',
    '''  /**\n   * 背景恢復舊工作階段：時間 O(m)＋一次後端請求，空間 O(m)。\n   * 重新登入若已寫入新 Token，不得由較舊恢復流程刪除。\n   */\n  async function restoreCredential() {\n    const storedCredential = String(sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) || "");\n    if (!storedCredential) return false;\n    const accepted = await setCredential(storedCredential, false, { restore: true });\n    if (!accepted && sessionStorage.getItem(CREDENTIAL_STORAGE_KEY) === storedCredential) {\n      sessionStorage.removeItem(CREDENTIAL_STORAGE_KEY);\n    }\n    return accepted;\n  }\n''',
    "restoreCredential",
)
text = replace_once(
    text,
    '    if (!container || !window.google?.accounts?.id || !isConfigured() || authVerifying) return false;\n',
    '    if (\n      !container\n      || !window.google?.accounts?.id\n      || !isConfigured()\n      || Boolean(credential && user)\n      || (authVerifying && !restoringSession)\n    ) return false;\n',
    "render button guard",
)
path.write_text(text, encoding="utf-8")

# 2) Bust site-account/google-auth caches everywhere main.js is used.
path = Path("JS/site-account.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  const SCRIPT_VERSION = "20260810-auth-expiry-reload-v1";',
    f'  const SCRIPT_VERSION = "{VERSION}";',
    "site account version",
)
path.write_text(text, encoding="utf-8")

path = Path("JS/main.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '    src: "JS/site-account.js?v=20260810-auth-expiry-reload-v1",',
    f'    src: "JS/site-account.js?v={VERSION}",',
    "main site account version",
)
path.write_text(text, encoding="utf-8")

for html_path in Path(".").glob("*.html"):
    html = html_path.read_text(encoding="utf-8")
    updated = re.sub(
        r'JS/main\.js\?v=20260810-auth-expiry-reload-v1',
        f'JS/main.js?v={VERSION}',
        html,
    )
    if updated != html:
        html_path.write_text(updated, encoding="utf-8")

# 3) Browser regression: a slow stored-session restore must not block a fresh login.
path = Path("tests/e2e/site.spec.js")
text = path.read_text(encoding="utf-8")
marker = 'test("Google 舊工作階段驗證慢時仍可直接重新登入"'
if marker not in text:
    text += r'''

/**
 * 固定兩次 auth 驗證：時間／額外空間 O(1)。
 * 更快替代方案比較：只測最終成功會漏掉「恢復期間按鈕被遮住」的回歸；
 * 本案例刻意延遲舊 Token，直接驗證使用者可用新 Token 超車完成登入。
 */
test("Google 舊工作階段驗證慢時仍可直接重新登入", async ({ page }) => {
  const makeToken = (subject) => {
    const payload = Buffer.from(JSON.stringify({
      sub: subject,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    return `header.${payload}.signature`;
  };
  const storedToken = makeToken("stored-user");
  const freshToken = makeToken("fresh-user");

  await page.addInitScript(({ storedToken: stored, freshToken: fresh }) => {
    sessionStorage.setItem("evanGoogleIdToken", stored);
    window.__fakeFreshGoogleToken = fresh;
    window.__fakeGoogleCallback = null;
    window.google = {
      accounts: {
        id: {
          initialize(options) {
            window.__fakeGoogleCallback = options.callback;
          },
          renderButton(container) {
            const button = document.createElement("button");
            button.type = "button";
            button.id = "fake-google-relogin";
            button.textContent = "使用 Google 重新登入";
            button.addEventListener("click", () => {
              window.__fakeGoogleCallback?.({ credential: window.__fakeFreshGoogleToken });
            });
            container.replaceChildren(button);
          },
          disableAutoSelect() {},
        },
      },
    };
  }, { storedToken, freshToken });

  await page.route("https://script.google.com/macros/s/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      if (body.action === "authStatus") {
        if (body.credential === storedToken) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, isAdmin: false, profile: null }),
        });
      }
    }
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, profile: null }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.EvanGoogleAuth))).toBe(true);
  await page.locator("#site-account-trigger").click();

  await expect(page.locator("#google-auth-status")).toContainText("正在恢復上次 Google 工作階段");
  await expect(page.locator("#fake-google-relogin")).toBeVisible();
  await page.locator("#fake-google-relogin").click();

  await expect.poll(() => page.evaluate(() => window.EvanGoogleAuth?.isSignedIn?.())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.EvanGoogleAuth?.getCredential?.())).toBe(freshToken);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("evanGoogleIdToken"))).toBe(freshToken);
});
'''
    path.write_text(text, encoding="utf-8")

print("auth recovery patch prepared")
