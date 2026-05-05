// ==============================
// utils.js
// 共用時間小工具
// ==============================
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)

(function initSharedUtils() {
  /**
   * 取得台北時間 ISO 字串（不含時區尾碼）。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function nowTaipeiISO() {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  }

  window.nowTaipeiISO = nowTaipeiISO;
})();


// ==============================
// Evan Tarot Custom Dialog
// 統一網站彈窗樣式，取代原生 alert / confirm / prompt
// 時間複雜度：O(1)
// 空間複雜度：O(1)
// 更快替代方案：原生 alert/prompt/confirm 雖然成本最低，但無法配合網站 UI；本實作使用單一 Promise modal，維持低成本並符合視覺系統。
// ==============================
(function initEvanDialog() {
  if (window.EvanDialog) return;

  function closeDialog(backdrop, result, resolve) {
    backdrop.classList.add("is-leaving");
    window.setTimeout(() => {
      backdrop.remove();
      resolve(result);
    }, 120);
  }

  function createDialog({ type = "alert", title = "提示", message = "", defaultValue = "", placeholder = "" }) {
    return new Promise((resolve) => {
      document.querySelector(".evan-dialog-backdrop")?.remove();

      const backdrop = document.createElement("div");
      backdrop.className = "evan-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="evan-dialog" role="dialog" aria-modal="true" aria-label="${title}">
          <div class="evan-dialog-orb" aria-hidden="true"></div>
          <div class="evan-dialog-header">
            <p class="map-form-kicker">Evan Tarot</p>
            <h3>${title}</h3>
            ${message ? `<p>${message}</p>` : ""}
          </div>
          ${type === "prompt" ? `
            <label class="evan-dialog-field">
              <span>輸入內容</span>
              <input id="evan-dialog-input" type="text" value="${defaultValue}" placeholder="${placeholder}" autocomplete="off" />
            </label>
          ` : ""}
          <div class="evan-dialog-actions">
            ${type !== "alert" ? `<button type="button" class="btn ghost" data-dialog-action="cancel">取消</button>` : ""}
            <button type="button" class="btn primary" data-dialog-action="ok">${type === "confirm" ? "確認" : "確定"}</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const input = backdrop.querySelector("#evan-dialog-input");
      const okButton = backdrop.querySelector('[data-dialog-action="ok"]');
      const cancelButton = backdrop.querySelector('[data-dialog-action="cancel"]');

      if (input) {
        input.focus();
        input.select();
      } else {
        okButton.focus();
      }

      okButton.addEventListener("click", () => {
        if (type === "prompt") {
          closeDialog(backdrop, input.value, resolve);
          return;
        }
        closeDialog(backdrop, true, resolve);
      });

      cancelButton?.addEventListener("click", () => {
        closeDialog(backdrop, type === "prompt" ? null : false, resolve);
      });

      backdrop.addEventListener("click", (event) => {
        if (event.target !== backdrop) return;
        closeDialog(backdrop, type === "alert" ? true : type === "prompt" ? null : false, resolve);
      });

      backdrop.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog(backdrop, type === "alert" ? true : type === "prompt" ? null : false, resolve);
        }
        if (event.key === "Enter" && type === "prompt") {
          event.preventDefault();
          closeDialog(backdrop, input.value, resolve);
        }
      });
    });
  }

  window.EvanDialog = {
    alert(message, title = "提示") {
      return createDialog({ type: "alert", title, message });
    },
    confirm(message, title = "確認操作") {
      return createDialog({ type: "confirm", title, message });
    },
    prompt(message, defaultValue = "", title = "輸入內容", placeholder = "") {
      return createDialog({ type: "prompt", title, message, defaultValue, placeholder });
    },
  };
})();
