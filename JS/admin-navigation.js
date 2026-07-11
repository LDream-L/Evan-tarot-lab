// ==============================
// admin-navigation.js
// 後端驗證管理員後，才顯示內容管理入口與私人實驗物件
// ==============================
//
// 主要函式複雜度：
// - verifyAdmin：O(1)（不含網路等待）
// - ensureAdminEntries：O(n + r)，n = 導覽連結數、r = 管理員限定節點數
// - waitForAuthModules：O(a)，a = 固定載入檢查次數上限
// 空間複雜度：O(1)
//
// 更快替代方案比較：
// - 只在前端判斷帳號：速度快，但可被偽造，不能作為權限依據。
// - 本實作：向 Apps Script 驗證 Google Token；通過後才建立管理入口並解除私人項目的 hidden 狀態。
// ==============================

(function defineAdminNavigation() {
  "use strict";

  if (window.EvanAdminNavigation) return;

  const REQUEST_TIMEOUT_MS = 12000;
  const AUTH_WAIT_ATTEMPTS = 120;
  const AUTH_WAIT_INTERVAL_MS = 100;
  const ADMIN_LINKS = Object.freeze([
    Object.freeze({ key: "service-admin", href: "service-admin.html", label: "服務管理", anchor: 'a[href="services.html"]' }),
    Object.freeze({ key: "article-admin", href: "article-admin.html", label: "文章管理", anchor: 'a[href="articles.html"]' }),
  ]);

  let initialized = false;
  let verificationSequence = 0;
  let isAdmin = false;

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.servicesApiUrl
      || window.EVAN_CLOUD_CONFIG?.articlesApiUrl
      || window.EVAN_CLOUD_CONFIG?.commentsApiUrl
      || ""
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

  function syncAdminOnlyContent() {
    document.querySelectorAll("[data-admin-only-lab-item]").forEach((element) => {
      element.hidden = !isAdmin;
    });

    const count = document.getElementById("lab-project-count");
    const countLabel = document.getElementById("lab-project-count-label");
    if (count) count.textContent = isAdmin ? "4" : "3";
    if (countLabel) countLabel.textContent = isAdmin ? "個實驗物件" : "個公開／研究項目";

    window.dispatchEvent(new CustomEvent("evan-admin-status-change", {
      detail: Object.freeze({ isAdmin }),
    }));
  }

  function removeAdminEntries() {
    document.querySelectorAll("[data-admin-navigation]").forEach((element) => element.remove());
    syncAdminOnlyContent();
  }

  function createAdminLink(definition, className = "") {
    const link = document.createElement("a");
    link.href = definition.href;
    link.textContent = definition.label;
    link.dataset.adminNavigation = definition.key;
    if (className) link.className = className;
    return link;
  }

  function ensureAdminEntries() {
    document.querySelectorAll("[data-admin-navigation]").forEach((element) => element.remove());
    syncAdminOnlyContent();
    if (!isAdmin) return;

    const nav = document.querySelector(".nav");
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    if (nav) {
      ADMIN_LINKS.forEach((definition) => {
        const link = createAdminLink(definition);
        const anchor = nav.querySelector(definition.anchor);
        if (anchor) anchor.insertAdjacentElement("afterend", link);
        else nav.appendChild(link);

        if (currentPage === definition.href) {
          nav.querySelectorAll('[aria-current="page"]').forEach((element) => {
            element.removeAttribute("aria-current");
          });
          link.setAttribute("aria-current", "page");
        }
      });
    }

    const accountActions = document.querySelector("#site-account-menu .site-account-actions");
    if (accountActions) {
      const fragment = document.createDocumentFragment();
      ADMIN_LINKS.forEach((definition) => {
        fragment.appendChild(createAdminLink(definition, "btn primary"));
      });
      accountActions.prepend(fragment);
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
    syncAdminOnlyContent();

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
    syncAdminOnlyContent,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
