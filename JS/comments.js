// ==============================
// comments.js
// 文章留言區（localStorage）
// ==============================
//
// 資料只存在使用者自己瀏覽器，不會寫入 Google Sheet
//
// 時間複雜度：
// - 讀寫留言：O(n)（n = 留言數）
// 空間複雜度：O(n)
// ==============================

const COMMENT_STORAGE_KEY = "evanTarotComments";

function loadComments() {
  try {
    const raw = localStorage.getItem(COMMENT_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveComments(comments) {
  localStorage.setItem(COMMENT_STORAGE_KEY, JSON.stringify(comments));
}

// 簡單 XSS 防護
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// O(n) 渲染全部留言
window.renderComments = function renderComments() {
  const listEl = document.getElementById("comment-list");
  if (!listEl) return;

  const comments = loadComments();
  if (comments.length === 0) {
    listEl.innerHTML =
      '<p class="comments-empty">目前還沒有留言，可以當第一個留下紀錄的人。</p>';
    return;
  }

  const html = comments
    .slice()
    .reverse()
    .map((c) => {
      const date = new Date(c.createdAt);
      const dateText = isNaN(date.getTime())
        ? ""
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
            2,
            "0"
          )}-${String(date.getDate()).padStart(2, "0")} ` +
          `${String(date.getHours()).padStart(2, "0")}:${String(
            date.getMinutes()
          ).padStart(2, "0")}`;

      return `
        <div class="comment-item">
          <div class="comment-header">
            <div>
              <span class="comment-name">${escapeHtml(c.name || "匿名")}</span>
              ${
                c.title
                  ? `<span class="comment-title">｜${escapeHtml(c.title)}</span>`
                  : ""
              }
            </div>
            <span class="comment-date">${dateText}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
      `;
    })
    .join("");

  listEl.innerHTML = html;
};

// O(n) 讀 + 寫 + 重渲染
window.handleCommentForm = function handleCommentForm(event) {
  event.preventDefault();

  const nameInput = document.getElementById("comment-name");
  const titleInput = document.getElementById("comment-title");
  const textInput = document.getElementById("comment-text");

  const name = nameInput.value.trim() || "匿名";
  const title = titleInput.value.trim();
  const text = textInput.value.trim();

  if (!text) return;

  const comments = loadComments();
  comments.push({
    name,
    title,
    text,
    createdAt: new Date().toISOString()
  });

  saveComments(comments);
  window.renderComments();
  event.target.reset();
};
