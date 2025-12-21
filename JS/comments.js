// ==============================
// comments.js
// 文章留言區：本機暫存 + Google Form 回饋
// ==============================
//
// 時間複雜度：
// - loadComments：O(n)（n = 本機留言數）
// - renderComments：O(n)
// 空間複雜度：O(n)
// ==============================

const COMMENT_STORAGE_KEY = "evanTarotComments";

// ★「Evan Tarot 網站回饋」Google 表單
// 留言 & 失物回饋共用同一份，靠 type 區分。
const FEEDBACK_GOOGLE_FORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLScdDR6CrMrs_G7HVMAbQYo95s4AaH5b3KDupUZ9TlD5e5yKLQ/formResponse",
  fields: {
    type: "entry.1980954123",
    name: "entry.1821676998",
    title: "entry.2042241666",
    text: "entry.243999010",
    createdAt: "entry.1203451900",  // ✅ 建立時間
  },
};




/**
 * 從 localStorage 讀留言
 * 時間複雜度：O(n)
 * 空間複雜度：O(n)
 */
function loadComments() {
  try {
    const raw = localStorage.getItem(COMMENT_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("讀取留言失敗，已清空本機紀錄：", e);
    localStorage.removeItem(COMMENT_STORAGE_KEY);
    return [];
  }
}

/**
 * 寫入 localStorage
 * 時間複雜度：O(n)
 * 空間複雜度：O(n)
 */
function saveComments(comments) {
  localStorage.setItem(COMMENT_STORAGE_KEY, JSON.stringify(comments));
}

/**
 * 渲染留言列表
 * 時間複雜度：O(n)
 * 空間複雜度：O(1)（DOM 操作視為外部）
 */
function renderComments() {
  const container = document.getElementById("comment-list");
  if (!container) return;

  const comments = loadComments();
  if (!comments.length) {
    container.innerHTML =
      '<p class="comment-empty">目前還沒有留言，可以當第一個留下紀錄的人。</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  comments
    .slice()
    .reverse() // 最新的顯示在最上面
    .forEach((c) => {
      const item = document.createElement("article");
      item.className = "comment-item";

      const title = document.createElement("h4");
      title.textContent = c.title || "（無標題）";

      const meta = document.createElement("div");
      meta.className = "comment-meta";
      const created = new Date(c.createdAt);
      meta.textContent = `${c.name || "匿名"} ／ ${created.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}`;

      const body = document.createElement("p");
      body.className = "comment-text";
      body.textContent = c.text;

      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(body);
      frag.appendChild(item);
    });

  container.innerHTML = "";
  container.appendChild(frag);
}

/**
 * 共用的 Google Form POST
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 *
 * 暴力法：<form> action 直接丟到 Google。
 * 優化法（本實作）：fetch + no-cors，不打斷使用者流程。
 */
function postToGoogleForm(url, formData) {
  return fetch(url, {
    method: "POST",
    mode: "no-cors",
    body: formData,
  });
}

/**
 * 組留言的 FormData
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function buildCommentFormData(comment) {
  const fd = new FormData();
  const f = FEEDBACK_GOOGLE_FORM.fields;

  fd.append(f.type, "comment");
  fd.append(f.name, comment.name || "");
  fd.append(f.title, comment.title || "");
  fd.append(f.text, comment.text || "");
  fd.append(f.createdAt, comment.createdAt || nowTaipeiISO());
  fd.append("submit", "Submit");

  return fd;
}

// 對外暴露給 main.js 使用
window.renderComments = renderComments;

/**
 * 留言表單 submit 處理
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
window.handleCommentForm = function handleCommentForm(event) {
  event.preventDefault();
  const form = event.target;

  const name = document.getElementById("comment-name")?.value.trim() || "";
  const title = document.getElementById("comment-title")?.value.trim() || "";
  const text = document.getElementById("comment-text")?.value.trim() || "";
  if (!text) return;

  const comment = {
    name,
    title,
    text,
    createdAt: nowTaipeiISO(),
  };

  // 1. 存到本機，維持你原本「留給未來的自己」的概念
  const comments = loadComments();
  comments.push(comment);
  saveComments(comments);
  renderComments();

  // 2. 送到 Google Form（非同步，不影響體驗）
  const fd = buildCommentFormData(comment);
  postToGoogleForm(FEEDBACK_GOOGLE_FORM.url, fd).catch((e) => {
    console.warn("留言送到 Google 失敗，但本機已經存起來：", e);
  });

  form.reset();
};
