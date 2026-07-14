// ==============================
// timeflow/import-export.js
// 時間樹 JSON 備份還原入口
// ==============================
//
// 主要函式複雜度：
// - install：初始化時間／空間 O(1)
// - 匯入：時間／空間 O(n)，n = 備份節點與關聯數
//
// 更快替代方案比較：
// - 在全站 bootstrap 內直接操作時間樹：責任耦合且其他頁也會載入細節。
// - 本實作：只有找到時間樹匯出按鈕才安裝匯入流程。
// ==============================

(function defineTimeflowImportExport() {
  "use strict";

  if (window.EvanTimeflowImportExport) return;

  function install() {
    const exportButton = document.getElementById("map-export-json");
    if (!exportButton || document.getElementById("map-import-json")) return false;

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
      importButton.title = signedIn ? "從 JSON 備份還原整棵時間樹" : "請先從右上角登入 Google 帳號";
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
        if (!TF?.normalizeState || !TF?.ctx || !TF?.ui?.render) {
          throw new Error("時間樹模組尚未完成載入。");
        }

        const confirmed = await window.EvanDialog?.confirm(
          "匯入會以備份內容取代目前時間樹。建議先下載現有 JSON 備份。",
          "還原時間樹備份"
        );
        if (!confirmed) return;

        TF.ctx.state = TF.normalizeState(raw);
        TF.rebuildIndexes();
        TF.ensureSelection();
        TF.rebuildIndexes();
        TF.save();
        TF.ui.render(true);
        await window.EvanDialog?.alert("時間樹 JSON 已完成還原。", "匯入完成");
      } catch (error) {
        console.error("[timeflow-import] 匯入失敗：", error);
        await window.EvanDialog?.alert(error.message || "JSON 格式不正確，無法匯入。", "匯入失敗");
      }
    });

    window.addEventListener("evan-google-auth-change", syncAuthState);
    window.setTimeout(syncAuthState, 0);
    return true;
  }

  window.EvanTimeflowImportExport = Object.freeze({ install });
})();
