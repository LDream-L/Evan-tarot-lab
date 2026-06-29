// ==============================
// admin-navigation.js
// 後端驗證管理員後，才顯示文章管理入口
// ==============================
//
// 主要函式複雜度：
// - verifyAdmin：O(1)
// - ensureAdminEntries：O(n)，n = 導覽連結數
// - waitForAuthModules：O(a)，a = 固定載入檢查次數上限
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 只在前端判斷帳號：速度快，但可被偽造，不能作為權限依據。
// - 本實作：等待登入模組完成後，向 Apps Script 驗證，通過才顯示入口。
// ==============================

(function defineAdminNavigation() {
  "use strict";

  if (window.EvanAdminNavigation) return;

  const REQUEST_TIMEOUT_MS = 12000;
  const AUTH_WAIT_ATTEMPTS = 120;
  const AUTH_WAIT_INTERVAL_MS = 100;
  let initialized = false;
  let verificationSequence = 0;
  let isAdmin = false;

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.articlesApiUrl ||
      window.EVAN_CLOUD_CONFIG?.commentsApiUrl ||
      ""
    ).trim();
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function waitForAuthModules() {
    for (let attempt = 0; attempt < AUTH_WAIT_ATTEMPTS; attempt += 1) {
      if (window.EvanSiteAccount && window.EvanGoogleAuth) return true;
      await new Promise((resolve) => window.setTimeout(resolve, AUTH_WAIT_INTERVAL_MS));
    }
    return false;
  }

  function removeAdminEntries() {
    document.querySelectorAll('[data-admin-navigation="article-admin"]').forEach((element) => {
      element.remove();
    });
  }

  function ensureAdminEntries() {
    removeAdminEntries();
    if (!isAdmin) return;

    const nav = document.querySelector(".nav");
    if (nav) {
      const link = document.createElement("a");
      link.href = "article-admin.html";
      link.textContent = "文章管理";
      link.dataset.adminNavigation = "article-admin";

      const articleLink = nav.querySelector('a[href="articles.html"]');
      const labLink = nav.querySelector('a[href="lab.html"]');
      if (articleLink) articleLink.insertAdjacentElement("afterend", link);
      else nav.insertBefore(link, labLink || null);

      const currentPage = window.location.pathname.split("/").pop() || "index.html";
      if (currentPage === "article-admin.html") {
        nav.querySelectorAll('[aria-current="page"]').forEach((element) => {
          element.removeAttribute("aria-current");
        });
        link.setAttribute("aria-current", "page");
      }
    }

    const accountActions = document.querySelector("#site-account-menu .site-account-actions");
    if (accountActions) {
      const link = document.createElement("a");
      link.href = "article-admin.html";
      link.className = "btn primary";
      link.textContent = "文章管理";
      link.dataset.adminNavigation = "article-admin";
      accountActions.prepend(link);
    }
  }

  async function verifyAdmin(state) {
    const sequence = ++verificationSequence;
    const signedIn = Boolean(state?.isSignedIn);
    const credential = window.EvanGoogleAuth?.getCredential?.() || "";

    if (!signedIn || !credential || !getApiUrl()) {
      isAdmin = false;
      removeAdminEntries();
      return false;
    }

    try {
      const response = await fetchWithTimeout(getApiUrl(), {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          action: "adminStatus",
          credential,
          requestId: window.crypto?.randomUUID?.() || `admin_nav_${Date.now().toString(36)}`,
          website: "",
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (sequence !== verificationSequence) return false;

      isAdmin = Boolean(payload?.success && payload?.isAdmin);
      ensureAdminEntries();
      return isAdmin;
    } catch (error) {
      if (sequence !== verificationSequence) return false;
      isAdmin = false;
      removeAdminEntries();
      console.warn("[admin-navigation] 管理員入口驗證失敗：", error);
      return false;
    }
  }

  async function init() {
    if (initialized) return isAdmin;
    initialized = true;

    const modulesReady = await waitForAuthModules();
    if (!modulesReady) {
      console.warn("[admin-navigation] 登入模組載入逾時，未顯示管理入口。");
      return false;
    }

    await window.EvanSiteAccount.ready;
    await window.EvanGoogleAuth.init();
    window.EvanGoogleAuth.onChange(verifyAdmin);
    return verifyAdmin(window.EvanGoogleAuth.getState());
  }

  window.EvanAdminNavigation = Object.freeze({
    init,
    refresh: () => verifyAdmin(window.EvanGoogleAuth?.getState?.() || {}),
    isAdmin: () => isAdmin,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
