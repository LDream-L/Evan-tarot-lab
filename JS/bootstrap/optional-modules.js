// ==============================
// bootstrap/optional-modules.js
// 帳戶與管理入口的非阻塞初始化
// ==============================
//
// 主要函式複雜度：
// - init：時間／空間 O(k)，k = 固定可選模組數（目前 2）
//
// 更快替代方案比較：
// - 每頁阻塞等待登入完成：會拖慢尋物、預約等核心功能。
// - 本實作：共用可靠載入器並獨立初始化，失敗不阻斷頁面主要內容。
// ==============================

(function defineOptionalModulesBootstrap() {
  "use strict";

  if (window.EvanOptionalModules) return;

  async function initializeModule(spec, globalName, initName, label) {
    const loaded = await window.EvanScriptLoader?.load?.(spec);
    if (!loaded) return false;
    try {
      await window[globalName]?.[initName]?.();
      return true;
    } catch (error) {
      console.error(`[optional-modules] ${label}初始化失敗：`, error);
      return false;
    }
  }

  async function init() {
    if (!window.EvanScriptLoader) {
      console.error("[optional-modules] 缺少 EvanScriptLoader。");
      return [false, false];
    }

    return Promise.all([
      initializeModule(
        {
          src: "JS/site-account.js?v=20260714-account-layout-v1",
          marker: "site-account",
          isReady: () => Boolean(window.EvanSiteAccount),
        },
        "EvanSiteAccount",
        "init",
        "帳戶模組"
      ),
      initializeModule(
        {
          src: "JS/admin-navigation.js?v=20260710-hardening-v2",
          marker: "admin-navigation",
          isReady: () => Boolean(window.EvanAdminNavigation),
        },
        "EvanAdminNavigation",
        "init",
        "管理入口"
      ),
    ]);
  }

  window.EvanOptionalModules = Object.freeze({ init });
})();
