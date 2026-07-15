// ==============================
// article-media-upload.js
// 文章後台：從本機選圖、壓縮、查重、上傳並直接插入正文
// ==============================
//
// 主要函式複雜度：
// - renderMediaLibrary：時間／空間 O(m)，m = 圖片數量
// - optimizeImage：時間／空間 O(p)，p = 影像像素數
// - blobToBase64：時間／空間 O(b)，b = 圖片位元組數
// - insertAtCursor / uploadMedia：時間 O(L + b)，空間 O(b)，L = 正文字元數
//
// 更快替代方案比較：
// - 原圖直接 Base64 上傳：程式較短，但手機照片常超過後端限制且載入慢。
// - 本實作：小檔保留原圖，大檔只縮放一次並轉 WebP；後端再以圖片代碼與 Drive 檔名雙重查重。
// ==============================

(function initArticleMediaUpload() {
  "use strict";

  const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
  const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 2200;
  const REQUEST_TIMEOUT_MS = 60000;
  let uploadBusy = false;
  let remoteCheckSequence = 0;

  const $ = (id) => document.getElementById(id);

  function getApiUrl() {
    return String(
      window.EVAN_CLOUD_CONFIG?.articlesApiUrl ||
      window.EVAN_CLOUD_CONFIG?.commentsApiUrl ||
      ""
    ).trim();
  }

  function escapeHtml(input) {
    return String(input ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function requestJson(action, extra = {}) {
    const apiUrl = getApiUrl();
    const credential = window.EvanGoogleAuth?.getCredential?.() || "";
    if (!apiUrl) throw new Error("文章 API 尚未設定。");
    if (!credential) throw new Error("請先登入 Google 管理員帳戶。");

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        cache: "no-store",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          credential,
          requestId: window.crypto?.randomUUID?.() || `${action}_${Date.now().toString(36)}`,
          website: "",
          ...extra,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.success) throw new Error(payload?.error || "圖片管理操作失敗。");
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function mountUploadPanel() {
    const panel = $("article-admin-media-panel");
    if (!panel || $("article-admin-media-upload-form")) return;

    const form = document.createElement("form");
    form.className = "article-admin-media-upload";
    form.id = "article-admin-media-upload-form";
    form.noValidate = true;
    form.innerHTML = `
      <div class="article-admin-media-upload-heading">
        <div>
          <p class="article-admin-kicker">UPLOAD</p>
          <h3>上傳圖片並插入正文</h3>
        </div>
        <span class="article-admin-media-upload-limit">JPEG／PNG／WebP，處理後須小於 6 MB</span>
      </div>
      <label>
        選擇本機圖片
        <input id="article-admin-media-file" type="file" accept="image/jpeg,image/png,image/webp" required />
      </label>
      <div class="article-admin-media-upload-grid">
        <label>
          圖片名稱（不可重複）
          <input id="article-admin-media-id" type="text" maxlength="80" pattern="[a-z0-9][a-z0-9_-]{1,79}" required placeholder="article-image-20260715" autocomplete="off" />
          <span class="article-admin-media-id-status" id="article-admin-media-id-status" data-state="idle">請使用小寫英文、數字、連字號或底線。</span>
        </label>
        <label>
          插入版型
          <select id="article-admin-media-variant">
            <option value="cover">文章首圖</option>
            <option value="wide" selected>橫幅圖</option>
            <option value="portrait">直式圖</option>
            <option value="inline">窄版圖</option>
          </select>
        </label>
      </div>
      <label>
        圖片替代文字
        <input id="article-admin-media-alt" type="text" maxlength="500" required placeholder="描述圖片實際內容，不要只寫『圖片』" />
      </label>
      <label>
        圖說
        <textarea id="article-admin-media-caption" rows="2" maxlength="1000" placeholder="可留白；顯示在圖片下方。"></textarea>
      </label>
      <div class="article-admin-media-upload-grid">
        <label>
          來源標示
          <input id="article-admin-media-credit-label" type="text" maxlength="160" placeholder="例如 Evan Tarot" />
        </label>
        <label>
          來源網址
          <input id="article-admin-media-credit-url" type="url" maxlength="1000" placeholder="https://…" />
        </label>
      </div>
      <button class="btn primary full" id="article-admin-media-upload-submit" type="submit">上傳並插入正文</button>
      <p class="tool-feedback-message hidden" id="article-admin-media-upload-message" aria-live="polite"></p>
    `;

    const help = panel.querySelector(".article-admin-media-help");
    if (help) help.insertAdjacentElement("afterend", form);
    else panel.prepend(form);

    const tools = document.querySelector(".article-admin-markup-tools");
    if (tools && !$("article-admin-open-media")) {
      const button = document.createElement("button");
      button.id = "article-admin-open-media";
      button.type = "button";
      button.textContent = "圖片";
      button.addEventListener("click", () => {
        activateTab("media");
        $("article-admin-media-file")?.click();
      });
      tools.appendChild(button);
    }
  }

  function setUploadMessage(message, type = "info") {
    const element = $("article-admin-media-upload-message");
    if (!element) return;
    element.textContent = message || "";
    element.dataset.type = type;
    element.classList.toggle("hidden", !message);
  }

  function setUploadBusy(nextBusy) {
    uploadBusy = Boolean(nextBusy);
    const button = $("article-admin-media-upload-submit");
    if (button) {
      button.disabled = uploadBusy;
      button.textContent = uploadBusy ? "圖片處理與上傳中…" : "上傳並插入正文";
    }
  }

  function normalizeMediaId(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function fallbackMediaId() {
    const date = new Date();
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0"),
    ].join("");
    return `article-image-${stamp}`;
  }

  /** 依目前 Map 產生不重複建議名稱。時間 O(k)，空間 O(1)，k = 衝突次數。 */
  function suggestUniqueMediaId(rawBase) {
    const base = normalizeMediaId(rawBase) || fallbackMediaId();
    if (!window.EvanArticleMedia?.has?.(base)) return base;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${base.slice(0, 76 - String(suffix).length)}-${suffix}`;
      if (!window.EvanArticleMedia?.has?.(candidate)) return candidate;
    }
    return fallbackMediaId();
  }

  function setMediaIdStatus(message, state) {
    const element = $("article-admin-media-id-status");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  function checkLocalMediaId() {
    const input = $("article-admin-media-id");
    const id = normalizeMediaId(input?.value);
    if (input && input.value !== id) input.value = id;
    if (!VALID_ID_PATTERN.test(id)) {
      setMediaIdStatus("名稱須為 2～80 字，只能使用小寫英文、數字、連字號與底線。", "error");
      return false;
    }
    if (window.EvanArticleMedia?.has?.(id)) {
      setMediaIdStatus(`「${id}」已存在，請更換名稱。`, "error");
      return false;
    }
    setMediaIdStatus(`「${id}」目前可使用，送出時後端會再查重。`, "success");
    return true;
  }

  async function checkRemoteMediaId() {
    if (!checkLocalMediaId()) return false;
    const id = $("article-admin-media-id")?.value || "";
    if (!window.EvanGoogleAuth?.getCredential?.()) return true;
    const sequence = ++remoteCheckSequence;
    setMediaIdStatus("正在向後端確認名稱…", "checking");
    try {
      const payload = await requestJson("checkArticleMediaId", { mediaId: id });
      if (sequence !== remoteCheckSequence) return false;
      if (!payload.available) {
        setMediaIdStatus(payload.error || `「${id}」已存在。`, "error");
        return false;
      }
      setMediaIdStatus(`「${id}」可使用。`, "success");
      return true;
    } catch (error) {
      if (sequence === remoteCheckSequence) setMediaIdStatus(error.message, "error");
      return false;
    }
  }

  function activateTab(tabName) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      const active = button.dataset.adminTab === tabName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.adminPanel !== tabName);
    });
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.setRangeText(text, start, end, "end");
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderMediaLibrary() {
    const list = $("article-admin-media-list");
    if (!list) return;
    const mediaItems = window.EvanArticleMedia?.list?.() || [];
    if (!mediaItems.length) {
      list.innerHTML = '<p class="article-admin-empty">共用圖片庫目前沒有圖片。</p>';
      return;
    }

    list.innerHTML = mediaItems.map((media) => {
      const preferredVariant = ["cover", "wide", "portrait", "inline"].includes(media.adminVariant || media.defaultVariant)
        ? (media.adminVariant || media.defaultVariant)
        : "wide";
      const option = (value, label) => `<option value="${value}"${preferredVariant === value ? " selected" : ""}>${label}</option>`;
      return `
        <article class="article-admin-media-card">
          <img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.alt || "")}" loading="lazy" decoding="async" />
          <div class="article-admin-media-card-body">
            <code>${escapeHtml(media.id)}</code>
            <span>${escapeHtml(media.caption || media.alt || "")}</span>
            <div class="article-admin-media-actions">
              <select aria-label="圖片版型" data-media-variant="${escapeHtml(media.id)}">
                ${option("cover", "文章首圖")}
                ${option("wide", "橫幅圖")}
                ${option("portrait", "直式圖")}
                ${option("inline", "窄版圖")}
              </select>
              <button type="button" data-insert-media="${escapeHtml(media.id)}">插入</button>
            </div>
          </div>
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-insert-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.insertMedia || "";
        const variant = list.querySelector(`[data-media-variant="${CSS.escape(id)}"]`)?.value || "wide";
        insertAtCursor($("article-admin-content"), `[[image:${id}|${variant}]]\n\n`);
        activateTab("preview");
      });
    });
  }

  async function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = objectUrl;
      await image.decode();
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
        close: () => URL.revokeObjectURL(objectUrl),
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("瀏覽器無法輸出處理後的圖片。"));
      }, type, quality);
    });
  }

  /** 小圖保留原檔，大圖縮至最長邊 2200px。時間／空間 O(p)。 */
  async function optimizeImage(file) {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error("只接受 JPEG、PNG 或 WebP 圖片。");
    if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error("原始圖片需小於 20 MB。");

    const decoded = await decodeImage(file);
    try {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(decoded.width, decoded.height));
      const targetWidth = Math.max(1, Math.round(decoded.width * scale));
      const targetHeight = Math.max(1, Math.round(decoded.height * scale));
      const canKeepOriginal = scale === 1 && file.size <= MAX_UPLOAD_BYTES;
      if (canKeepOriginal) return file;

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("瀏覽器無法建立圖片處理畫布。");
      decoded.draw(context, targetWidth, targetHeight);
      const optimized = await canvasToBlob(canvas, "image/webp", 0.9);
      if (optimized.size > MAX_UPLOAD_BYTES) throw new Error("圖片處理後仍超過 6 MB，請先在電腦縮小尺寸。");
      return optimized;
    } finally {
      decoded.close();
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("無法讀取圖片檔案。"));
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        if (commaIndex < 0) reject(new Error("圖片轉換失敗。"));
        else resolve(result.slice(commaIndex + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  async function uploadMedia(event) {
    event.preventDefault();
    if (uploadBusy) return;

    const file = $("article-admin-media-file")?.files?.[0] || null;
    const id = normalizeMediaId($("article-admin-media-id")?.value);
    const alt = $("article-admin-media-alt")?.value.trim() || "";
    const creditUrl = $("article-admin-media-credit-url")?.value.trim() || "";
    if (!file) return setUploadMessage("請先選擇圖片。", "error");
    if (!VALID_ID_PATTERN.test(id)) return setUploadMessage("圖片名稱格式不正確。", "error");
    if (!alt) return setUploadMessage("請填寫圖片替代文字。", "error");
    if (creditUrl && !/^https?:\/\/[^\s]+$/i.test(creditUrl)) return setUploadMessage("來源網址須為 http(s) 網址。", "error");

    setUploadBusy(true);
    setUploadMessage("正在確認圖片名稱…");
    try {
      if (!await checkRemoteMediaId()) throw new Error("圖片名稱無法使用，請更換後再上傳。");
      setUploadMessage("正在縮放與壓縮圖片…");
      const optimized = await optimizeImage(file);
      const base64 = await blobToBase64(optimized);
      setUploadMessage("圖片正在上傳至共用圖庫…");
      const payload = await requestJson("uploadArticleMedia", {
        media: {
          id,
          alt,
          caption: $("article-admin-media-caption")?.value.trim() || "",
          creditLabel: $("article-admin-media-credit-label")?.value.trim() || "",
          creditUrl,
        },
        file: {
          name: file.name,
          mimeType: optimized.type || file.type,
          base64,
        },
      });

      const media = window.EvanArticleMedia?.add?.(payload.media);
      if (!media) throw new Error("後端已上傳，但前端沒有收到可用圖片資料。");
      renderMediaLibrary();
      const variant = $("article-admin-media-variant")?.value || "wide";
      insertAtCursor($("article-admin-content"), `[[image:${media.id}|${variant}]]\n\n`);
      setUploadMessage(`圖片「${media.id}」已上傳並插入正文。`, "success");
      $("article-admin-media-upload-form")?.reset();
      setMediaIdStatus("請使用小寫英文、數字、連字號或底線。", "idle");
      activateTab("preview");
    } catch (error) {
      console.error("[article-media-upload] 上傳失敗：", error);
      setUploadMessage(error?.name === "AbortError" ? "圖片上傳逾時，請重新整理圖片庫確認是否已寫入。" : error.message, "error");
    } finally {
      setUploadBusy(false);
    }
  }

  function bindEvents() {
    $("article-admin-media-upload-form")?.addEventListener("submit", uploadMedia);
    $("article-admin-media-id")?.addEventListener("input", checkLocalMediaId);
    $("article-admin-media-id")?.addEventListener("blur", checkRemoteMediaId);
    $("article-admin-media-file")?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const idInput = $("article-admin-media-id");
      if (idInput && !idInput.value.trim()) idInput.value = suggestUniqueMediaId(baseName);
      checkLocalMediaId();
      const altInput = $("article-admin-media-alt");
      if (altInput && !altInput.value.trim()) altInput.value = baseName.replace(/[-_]+/g, " ").trim();
    });
    document.addEventListener("evan:article-media-updated", renderMediaLibrary);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    mountUploadPanel();
    bindEvents();
    try { await window.EvanArticleMedia?.ready; }
    catch (error) { console.warn("[article-media-upload] 等待圖片庫時發生錯誤：", error); }
    renderMediaLibrary();
  });
})();
