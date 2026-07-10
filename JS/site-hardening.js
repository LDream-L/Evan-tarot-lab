// ==============================
// site-hardening.js
// 全站可靠性、安全性與資料還原補強
// ==============================
//
// 主要函式複雜度：
// - loadScriptReliable：時間 O(1)，空間 O(1)（不含網路等待）
// - sanitizeLinks：時間 O(a)，空間 O(1)，a = 本次掃描連結數
// - installTimeflowJsonImport：初始化 O(1)，匯入 O(n)，n = 備份資料量
// - initAccessibleDialog：單次開啟 O(m)，空間 O(m)，m = 顯示文字長度
//
// 替代方案比較：
// - 各頁各自修補：容易產生版本分歧，新增頁面時也會漏載。
// - 共用防護模組：所有載入 utils.js 的頁面套用同一套安全與可靠性規則。
// ==============================

(function initSiteHardening() {
  "use strict";

  if (window.EvanSiteHardening) return;

  const SCRIPT_PROMISES = new Map();
  const SCRIPT_TIMEOUT_MS = 12000;
  const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

  /**
   * 可靠載入單一模組；既有 script 已完成、失敗或逾時時均會結束 Promise。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function loadScriptReliable({ src, marker, isReady }) {
    if (typeof isReady === "function" && isReady()) return Promise.resolve(true);
    if (SCRIPT_PROMISES.has(marker)) return SCRIPT_PROMISES.get(marker);

    const promise = new Promise((resolve) => {
      const selector = `script[data-hardening-asset="${CSS.escape(marker)}"]`;
      let script = document.querySelector(selector);
      let settled = false;
      let timeoutId = 0;

      const finish = (success) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        if (!success) SCRIPT_PROMISES.delete(marker);
        resolve(Boolean(success));
      };

      const verifyReady = () => {
        const ready = typeof isReady !== "function" || Boolean(isReady());
        finish(ready);
      };

      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.hardeningAsset = marker;
        script.dataset.loadState = "loading";
        script.addEventListener("load", () => {
          script.dataset.loadState = "loaded";
          verifyReady();
        }, { once: true });
        script.addEventListener("error", () => {
          script.dataset.loadState = "error";
          finish(false);
        }, { once: true });
        document.head.appendChild(script);
      } else if (script.dataset.loadState === "loaded") {
        queueMicrotask(verifyReady);
      } else if (script.dataset.loadState === "error") {
        script.remove();
        SCRIPT_PROMISES.delete(marker);
        finish(false);
        return;
      } else {
        script.addEventListener("load", verifyReady, { once: true });
        script.addEventListener("error", () => finish(false), { once: true });
        queueMicrotask(() => {
          if (typeof isReady === "function" && isReady()) finish(true);
        });
      }

      timeoutId = window.setTimeout(() => {
        console.error(`[site-hardening] 模組載入逾時：${src}`);
        finish(typeof isReady === "function" && isReady());
      }, SCRIPT_TIMEOUT_MS);
    });

    SCRIPT_PROMISES.set(marker, promise);
    return promise;
  }

  /**
   * 以可完成 Promise 的無障礙彈窗取代舊版彈窗。
   * 時間複雜度：O(m)
   * 空間複雜度：O(m)
   */
  function initAccessibleDialog() {
    let active = null;

    function closeActive(result) {
      if (!active) return;
      const current = active;
      active = null;
      current.backdrop.classList.add("is-leaving");
      window.setTimeout(() => {
        current.backdrop.remove();
        current.resolve(result);
        current.returnFocus?.focus?.();
      }, 120);
    }

    function createDialog({ type = "alert", title = "提示", message = "", defaultValue = "", placeholder = "" }) {
      if (active) {
        const replacementResult = active.type === "alert" ? true : active.type === "prompt" ? null : false;
        closeActive(replacementResult);
      }

      return new Promise((resolve) => {
        const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const backdrop = document.createElement("div");
        backdrop.className = "evan-dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = "evan-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "evan-dialog-title");

        const orb = document.createElement("div");
        orb.className = "evan-dialog-orb";
        orb.setAttribute("aria-hidden", "true");

        const header = document.createElement("div");
        header.className = "evan-dialog-header";
        const kicker = document.createElement("p");
        kicker.className = "map-form-kicker";
        kicker.textContent = "Evan Tarot";
        const heading = document.createElement("h3");
        heading.id = "evan-dialog-title";
        heading.textContent = String(title || "提示");
        header.append(kicker, heading);

        if (message) {
          const body = document.createElement("p");
          body.style.whiteSpace = "pre-line";
          body.textContent = String(message).replace(/<br\s*\/?>/gi, "\n");
          header.appendChild(body);
        }

        dialog.append(orb, header);

        let input = null;
        if (type === "prompt") {
          const field = document.createElement("label");
          field.className = "evan-dialog-field";
          const label = document.createElement("span");
          label.textContent = "輸入內容";
          input = document.createElement("input");
          input.type = "text";
          input.value = String(defaultValue ?? "");
          input.placeholder = String(placeholder ?? "");
          input.autocomplete = "off";
          field.append(label, input);
          dialog.appendChild(field);
        }

        const actions = document.createElement("div");
        actions.className = "evan-dialog-actions";
        let cancelButton = null;
        if (type !== "alert") {
          cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.className = "btn ghost";
          cancelButton.textContent = "取消";
          actions.appendChild(cancelButton);
        }
        const okButton = document.createElement("button");
        okButton.type = "button";
        okButton.className = "btn primary";
        okButton.textContent = type === "confirm" ? "確認" : "確定";
        actions.appendChild(okButton);
        dialog.appendChild(actions);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        active = { backdrop, resolve, returnFocus, type };

        const cancelResult = type === "prompt" ? null : type === "alert" ? true : false;
        okButton.addEventListener("click", () => closeActive(type === "prompt" ? input.value : true));
        cancelButton?.addEventListener("click", () => closeActive(cancelResult));
        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) closeActive(cancelResult);
        });
        backdrop.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeActive(cancelResult);
          } else if (event.key === "Enter" && type === "prompt") {
            event.preventDefault();
            closeActive(input.value);
          } else if (event.key === "Tab") {
            const focusable = Array.from(dialog.querySelectorAll("button, input")).filter((element) => !element.disabled);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        });

        window.requestAnimationFrame(() => {
          if (input) {
            input.focus();
            input.select();
          } else {
            okButton.focus();
          }
        });
      });
    }

    window.EvanDialog = Object.freeze({
      alert(message, title = "提示") {
        return createDialog({ type: "alert", title, message });
      },
      confirm(message, title = "確認操作") {
        return createDialog({ type: "confirm", title, message });
      },
      prompt(message, defaultValue = "", title = "輸入內容", placeholder = "") {
        return createDialog({ type: "prompt", title, message, defaultValue, placeholder });
      },
    });
  }

  /**
   * 移除 javascript:、data: 等不應由動態資料產生的連結。
   * 時間複雜度：O(a)
   * 空間複雜度：O(1)
   */
  function sanitizeLinks(root = document) {
    const anchors = root instanceof HTMLAnchorElement
      ? [root]
      : root.querySelectorAll?.("a[href]") || [];

    anchors.forEach((anchor) => {
      const rawHref = String(anchor.getAttribute("href") || "").trim();
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("/") || rawHref.startsWith("./") || rawHref.startsWith("../")) return;

      let parsed;
      try {
        parsed = new URL(rawHref, window.location.href);
      } catch (error) {
        anchor.removeAttribute("href");
        anchor.setAttribute("aria-disabled", "true");
        return;
      }

      if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
        console.warn("[site-hardening] 已移除不安全連結：", rawHref);
        anchor.removeAttribute("href");
        anchor.setAttribute("aria-disabled", "true");
      }
    });
  }

  function observeDynamicLinks() {
    sanitizeLinks(document);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) sanitizeLinks(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /** 匯入時間流 JSON：時間／空間 O(n)，n = 備份資料量。 */
  function installTimeflowJsonImport() {
    const exportButton = document.getElementById("map-export-json");
    if (!exportButton || document.getElementById("map-import-json")) return;

    const importButton = document.createElement("button");
    importButton.id = "map-import-json";
    importButton.type = "button";
    importButton.className = "map-icon-btn map-text-btn";
    importButton.textContent = "匯入 JSON";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    exportButton.insertAdjacentElement("afterend", importButton);
    importButton.insertAdjacentElement("afterend", fileInput);

    const syncAuthState = () => {
      const signedIn = Boolean(window.EvanTimeflowV5?.app?.signedIn);
      importButton.disabled = !signedIn;
      importButton.title = signedIn ? "從 JSON 備份還原全部時間流" : "請先從右上角登入 Google 帳號";
    };

    importButton.addEventListener("click", () => {
      if (!window.EvanTimeflowV5?.app?.signedIn) {
        window.EvanSiteAccount?.open?.();
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        await window.EvanDialog?.alert("JSON 備份超過 5 MB，請確認檔案是否正確。", "無法匯入");
        return;
      }

      try {
        const raw = JSON.parse(await file.text());
        const TF = window.EvanTimeflowV5;
        if (!TF?.normalizeState || !TF?.ctx || !TF?.ui?.render) throw new Error("時間流模組尚未完成載入。");

        const confirmed = await window.EvanDialog?.confirm(
          "匯入會以備份內容取代目前時間流。建議先下載現有 JSON 備份。",
          "還原時間流備份"
        );
        if (!confirmed) return;

        TF.ctx.state = TF.normalizeState(raw);
        TF.rebuildIndexes();
        TF.ensureSelection();
        TF.rebuildIndexes();
        TF.save();
        TF.ui.render(true);
        await window.EvanDialog?.alert("時間流 JSON 已完成還原。", "匯入完成");
      } catch (error) {
        console.error("[site-hardening] 時間流匯入失敗：", error);
        await window.EvanDialog?.alert(error.message || "JSON 格式不正確，無法匯入。", "匯入失敗");
      }
    });

    window.addEventListener("evan-google-auth-change", syncAuthState);
    window.setTimeout(syncAuthState, 0);
  }

  function updateOutdatedCopy() {
    const footballStorage = document.querySelector(".football-storage-note");
    if (footballStorage) {
      footballStorage.textContent = "資料會先保存在本機 localStorage；登入資料庫擁有者帳號後，可同步至專用 Google Sheets。CSV 可直接用 Excel 開啟，JSON 用於完整備份與還原。";
    }

    const practiceRemember = document.getElementById("practice-remember-device")?.closest("label");
    if (practiceRemember) {
      const textNode = Array.from(practiceRemember.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = " 記住接收網址（私人金鑰只保留在目前瀏覽器工作階段）";
    }
  }

  async function ensureOptionalModules() {
    const accountLoaded = await loadScriptReliable({
      src: "JS/site-account.js?v=20260710-hardening-v1",
      marker: "site-account",
      isReady: () => Boolean(window.EvanSiteAccount),
    });

    if (accountLoaded) {
      try {
        await window.EvanSiteAccount?.init?.();
      } catch (error) {
        console.error("[site-hardening] 帳戶模組初始化失敗：", error);
      }
    }

    const adminLoaded = await loadScriptReliable({
      src: "JS/admin-navigation.js?v=20260710-hardening-v1",
      marker: "admin-navigation",
      isReady: () => Boolean(window.EvanAdminNavigation),
    });

    if (adminLoaded) {
      try {
        await window.EvanAdminNavigation?.init?.();
      } catch (error) {
        console.error("[site-hardening] 管理入口初始化失敗：", error);
      }
    }
  }

  function boot() {
    initAccessibleDialog();
    observeDynamicLinks();
    installTimeflowJsonImport();
    updateOutdatedCopy();
    ensureOptionalModules();
  }

  window.EvanSiteHardening = Object.freeze({
    loadScriptReliable,
    sanitizeLinks,
    installTimeflowJsonImport,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
