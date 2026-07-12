// ==============================
// core/dialog.js
// 全站 Promise 型無障礙 alert / confirm / prompt
// ==============================
//
// 主要函式複雜度：
// - createDialog：時間／空間 O(m + f)，m = 顯示文字長度、f = 可聚焦元件數
// - settleActive：時間／空間 O(1)
//
// 更快替代方案比較：
// - 原生 window.alert：阻塞主執行緒且無法統一品牌與焦點還原。
// - 本實作：非阻塞 Promise、焦點循環、Escape 關閉與返回原焦點。
// ==============================

(function defineEvanDialog() {
  "use strict";

  let active = null;

  function settleActive(result, animate = true) {
    if (!active) return;
    const current = active;
    active = null;

    const finish = () => {
      current.backdrop.remove();
      current.resolve(result);
      current.returnFocus?.focus?.();
    };

    if (!animate) {
      finish();
      return;
    }

    current.backdrop.classList.add("is-leaving");
    window.setTimeout(finish, 120);
  }

  function createDialog({ type = "alert", title = "提示", message = "", defaultValue = "", placeholder = "" }) {
    if (active) {
      const previousResult = active.type === "prompt" ? null : active.type === "alert" ? true : false;
      settleActive(previousResult, false);
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
      dialog.tabIndex = -1;

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

      okButton.addEventListener("click", () => settleActive(type === "prompt" ? input.value : true));
      cancelButton?.addEventListener("click", () => settleActive(cancelResult));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) settleActive(cancelResult);
      });
      backdrop.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          settleActive(cancelResult);
          return;
        }
        if (event.key === "Enter" && type === "prompt") {
          event.preventDefault();
          settleActive(input.value);
          return;
        }
        if (event.key !== "Tab") return;

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
    alert: (message, title = "提示") => createDialog({ type: "alert", title, message }),
    confirm: (message, title = "確認操作") => createDialog({ type: "confirm", title, message }),
    prompt: (message, defaultValue = "", title = "輸入內容", placeholder = "") =>
      createDialog({ type: "prompt", title, message, defaultValue, placeholder }),
  });
})();
