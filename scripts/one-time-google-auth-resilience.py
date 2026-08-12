from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
auth_path = ROOT / "JS" / "google-auth.js"
main_path = ROOT / "JS" / "main.js"
account_path = ROOT / "JS" / "site-account.js"
test_path = ROOT / "tests" / "e2e" / "site.spec.js"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


auth = auth_path.read_text(encoding="utf-8")

auth = replace_once(
    auth,
    '  const RESTORE_TIMEOUT_MS = 5000;\n  const CREDENTIAL_STORAGE_KEY = "evanGoogleIdToken";',
    '  const RESTORE_TIMEOUT_MS = 5000;\n  const GOOGLE_FALLBACK_TIMEOUT_MS = 6000;\n  const GOOGLE_TOKEN_INFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";\n  const GOOGLE_ACCEPTED_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);\n  const CREDENTIAL_STORAGE_KEY = "evanGoogleIdToken";',
    "auth constants",
)

auth = replace_once(
    auth,
    '  let restoringSession = false;\n  let verificationAttempt = 0;',
    '  let restoringSession = false;\n  let verificationAttempt = 0;\n  let googleIdentityInitialized = false;\n  let googleButtonRendered = false;',
    "auth state",
)

old_ui = '''    if (signInContainer && authVerifying && !isSignedIn && !restoringSession) {
      signInContainer.textContent = "正在向後端確認 Google 登入…";
      signInContainer.classList.add("site-account-loading");
    }
'''
new_ui = '''    if (signInContainer && !isSignedIn && googleButtonRendered) {
      signInContainer.classList.remove("site-account-loading");
      signInContainer.setAttribute("aria-busy", authVerifying ? "true" : "false");
    }
'''
auth = replace_once(auth, old_ui, new_ui, "preserve sign-in button while verifying")

auth = replace_once(
    auth,
    '          : "正在向 Apps Script 驗證 Google 工作階段…";',
    '          : "正在驗證 Google 工作階段；若等待過久，可直接重新選擇帳號。";',
    "fresh verification status",
)

old_backend = '''  async function verifyCredentialWithBackend(nextCredential, timeoutMs = REQUEST_TIMEOUT_MS) {
    const response = await fetchWithTimeout(getApiUrl(), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        action: "authStatus",
        credential: nextCredential,
        requestId: window.crypto?.randomUUID?.() || `auth_${Date.now().toString(36)}`,
        website: "",
      }),
    }, timeoutMs);
    return readJsonResponse(response, "Google 登入後端驗證失敗。");
  }
'''
new_backend = '''  /**
   * 標記驗證失敗類型：時間／空間 O(1)。
   * 更快替代方案比較：只靠錯誤文字判斷會重複解析字串；直接附加固定 failure kind 可常數時間分流。
   */
  function createAuthVerificationError(message, kind, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.authFailureKind = kind;
    return error;
  }

  /**
   * Apps Script 驗證：時間 O(m)＋一次網路請求，空間 O(m)，m = Token 長度。
   * 更快替代方案比較：直接信任前端 JWT 可省一次請求但不能驗證簽章／audience；正式流程仍優先由後端驗證。
   */
  async function verifyCredentialWithBackend(nextCredential, timeoutMs = REQUEST_TIMEOUT_MS) {
    let response;
    try {
      response = await fetchWithTimeout(getApiUrl(), {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          action: "authStatus",
          credential: nextCredential,
          requestId: window.crypto?.randomUUID?.() || `auth_${Date.now().toString(36)}`,
          website: "",
        }),
      }, timeoutMs);
    } catch (error) {
      throw createAuthVerificationError(
        error?.name === "AbortError" ? "Apps Script 驗證逾時。" : "Apps Script 驗證連線失敗。",
        "transport",
        error
      );
    }

    if (!response.ok) {
      throw createAuthVerificationError(`Apps Script 驗證 HTTP ${response.status}。`, "transport");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw createAuthVerificationError("Apps Script 沒有回傳可讀的 JSON。", "transport", error);
    }
    if (!payload?.success) {
      throw createAuthVerificationError(
        payload?.error || "Google 登入後端驗證失敗。",
        "rejected"
      );
    }
    return payload;
  }

  /**
   * Apps Script 僅在傳輸層失敗時使用 Google 官方 tokeninfo 備援。
   * 時間 O(m)＋一次網路請求，空間 O(m)，m = Token 長度。
   * 更快替代方案比較：本機只解析 JWT 雖最快但無法驗證簽章；官方 tokeninfo 仍驗證 aud／iss／exp／email_verified。
   */
  async function verifyCredentialWithGoogleTokenInfo(nextCredential, timeoutMs = GOOGLE_FALLBACK_TIMEOUT_MS) {
    const url = new URL(GOOGLE_TOKEN_INFO_ENDPOINT);
    url.searchParams.set("id_token", nextCredential);
    let response;
    try {
      response = await fetchWithTimeout(
        url.toString(),
        { method: "GET", cache: "no-store", mode: "cors" },
        timeoutMs
      );
    } catch (error) {
      throw createAuthVerificationError("Google 官方驗證服務連線失敗。", "transport", error);
    }
    if (!response.ok) {
      throw createAuthVerificationError("Google 登入已失效，請重新登入。", "rejected");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw createAuthVerificationError("Google 驗證服務回傳格式異常。", "transport", error);
    }

    const audience = String(payload?.aud || "").trim();
    const issuer = String(payload?.iss || "").trim();
    const expiresAt = Number(payload?.exp || 0) * 1000;
    const emailVerified = payload?.email_verified === true || String(payload?.email_verified) === "true";
    const subject = String(payload?.sub || "").trim();
    const email = String(payload?.email || "").trim();

    if (audience !== getClientId()) throw createAuthVerificationError("Google 登入來源與本站 OAuth 設定不一致。", "rejected");
    if (!GOOGLE_ACCEPTED_ISSUERS.has(issuer)) throw createAuthVerificationError("Google 登入簽發來源不正確。", "rejected");
    if (!expiresAt || expiresAt <= Date.now()) throw createAuthVerificationError("Google 登入已過期，請重新登入。", "rejected");
    if (!emailVerified) throw createAuthVerificationError("此 Google 帳號的 Email 尚未完成驗證。", "rejected");
    if (!subject || !email) throw createAuthVerificationError("Google 登入資料缺少必要欄位。", "rejected");
    return payload;
  }
'''
auth = replace_once(auth, old_backend, new_backend, "backend verification and Google fallback")

old_verify_call = '''    try {
      await verifyCredentialWithBackend(
        nextCredential,
        isRestore ? RESTORE_TIMEOUT_MS : REQUEST_TIMEOUT_MS
      );
      if (attempt !== verificationAttempt) return false;
      const nextUser = await createUser(payload);
'''
new_verify_call = '''    try {
      let backendPayload = null;
      try {
        backendPayload = await verifyCredentialWithBackend(
          nextCredential,
          isRestore ? RESTORE_TIMEOUT_MS : REQUEST_TIMEOUT_MS
        );
      } catch (error) {
        if (error?.authFailureKind !== "transport") throw error;
        console.warn("[google-auth] Apps Script 驗證傳輸失敗，改由 Google 官方服務確認憑證：", error);
        await verifyCredentialWithGoogleTokenInfo(
          nextCredential,
          isRestore ? RESTORE_TIMEOUT_MS : GOOGLE_FALLBACK_TIMEOUT_MS
        );
      }
      if (attempt !== verificationAttempt) return false;
      const nextUser = await createUser(payload);
'''
auth = replace_once(auth, old_verify_call, new_verify_call, "verification fallback")

old_profile_tail = '''      authVerifying = false;
      updateUI();
      notify();
      await loadProfile();
      return true;
'''
new_profile_tail = '''      authVerifying = false;
      if (backendPayload !== null) {
        nickname = String(backendPayload?.profile?.nickname || "").trim();
        profileLoading = false;
        updateUI();
        notify();
        return true;
      }
      updateUI();
      notify();
      await loadProfile();
      return true;
'''
auth = replace_once(auth, old_profile_tail, new_profile_tail, "reuse authStatus profile")

old_render = '''  function renderButton() {
    const container = document.getElementById("google-signin-button");
    if (
      !container
      || !window.google?.accounts?.id
      || !isConfigured()
      || Boolean(credential && user)
      || (authVerifying && !restoringSession)
    ) return false;
    container.replaceChildren();
    container.classList.remove("site-account-loading", "hidden");
    window.google.accounts.id.initialize({
      client_id: getClientId(),
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      logo_alignment: "left",
      locale: "zh_TW",
      width: 300,
    });
    return true;
  }
'''
new_render = '''  /**
   * Google Identity 只初始化一次：時間／空間 O(1)。
   * 更快替代方案比較：每次重畫按鈕都 initialize 會中止前一個 iframe；單次初始化後只重用 callback 狀態更穩定。
   */
  function ensureGoogleIdentityInitialized() {
    if (googleIdentityInitialized) return true;
    if (!window.google?.accounts?.id || !isConfigured()) return false;
    window.google.accounts.id.initialize({
      client_id: getClientId(),
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    googleIdentityInitialized = true;
    return true;
  }

  /**
   * 登入按鈕採冪等渲染：時間／空間 O(1)。
   * 更快替代方案比較：replaceChildren 後重建 iframe 會造成額外網路與競態；已建立時直接保留原 DOM。
   */
  function renderButton() {
    const container = document.getElementById("google-signin-button");
    if (!container || !ensureGoogleIdentityInitialized() || Boolean(credential && user)) return false;

    container.classList.remove("site-account-loading", "hidden");
    if (googleButtonRendered) return true;

    container.replaceChildren();
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      logo_alignment: "left",
      locale: "zh_TW",
      width: 300,
    });
    googleButtonRendered = true;
    return true;
  }
'''
auth = replace_once(auth, old_render, new_render, "idempotent Google button")

auth_path.write_text(auth, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = main.replace("20260812-auth-recovery-v2", "20260812-auth-resilience-v3")
main_path.write_text(main, encoding="utf-8")

account = account_path.read_text(encoding="utf-8")
account = account.replace("20260812-auth-recovery-v2", "20260812-auth-resilience-v3")
account_path.write_text(account, encoding="utf-8")

for html_path in ROOT.glob("*.html"):
    html = html_path.read_text(encoding="utf-8")
    updated = re.sub(
        r'JS/main\.js\?v=[^"\']+',
        'JS/main.js?v=20260812-auth-resilience-v3',
        html,
    )
    if updated != html:
        html_path.write_text(updated, encoding="utf-8")

site_test = test_path.read_text(encoding="utf-8")
if 'Google 新登入驗證期間保留按鈕且只初始化 Identity 一次' not in site_test:
    site_test += r'''

/**
 * 固定單次 fresh login：時間／額外空間 O(1)。
 * 更快替代方案比較：只驗證最終登入成功會漏掉驗證途中 iframe 被 replaceChildren 摧毀；
 * 本案例同時檢查按鈕持續存在與 Google Identity initialize 僅呼叫一次。
 */
test("Google 新登入驗證期間保留按鈕且只初始化 Identity 一次", async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({
    sub: "fresh-only-user",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const freshToken = `header.${payload}.signature`;

  await page.addInitScript((token) => {
    sessionStorage.removeItem("evanGoogleIdToken");
    window.__fakeFreshGoogleToken = token;
    window.__fakeGoogleCallback = null;
    window.__fakeGoogleInitializeCount = 0;
    window.google = {
      accounts: {
        id: {
          initialize(options) {
            window.__fakeGoogleInitializeCount += 1;
            window.__fakeGoogleCallback = options.callback;
          },
          renderButton(container) {
            const button = document.createElement("button");
            button.type = "button";
            button.id = "fake-google-fresh-login";
            button.textContent = "使用 Google 登入";
            button.addEventListener("click", () => {
              window.__fakeGoogleCallback?.({ credential: window.__fakeFreshGoogleToken });
            });
            container.replaceChildren(button);
          },
          disableAutoSelect() {},
        },
      },
    };
  }, freshToken);

  await page.route("https://script.google.com/macros/s/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      if (body.action === "authStatus") {
        await new Promise((resolve) => setTimeout(resolve, 900));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, isAdmin: false, profile: null }),
        });
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, profile: null }),
    });
  });

  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.EvanGoogleAuth))).toBe(true);
  await page.locator("#site-account-trigger").click();
  await expect(page.locator("#fake-google-fresh-login")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fakeGoogleInitializeCount)).toBe(1);

  await page.locator("#fake-google-fresh-login").click();
  await expect(page.locator("#google-auth-status")).toContainText("正在驗證 Google 工作階段");
  await expect(page.locator("#fake-google-fresh-login")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fakeGoogleInitializeCount)).toBe(1);

  await expect.poll(() => page.evaluate(() => window.EvanGoogleAuth?.isSignedIn?.())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.EvanGoogleAuth?.getCredential?.())).toBe(freshToken);
});
'''
    test_path.write_text(site_test, encoding="utf-8")

print("Google auth resilience patch prepared.")
