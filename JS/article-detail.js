// ==============================
// article-detail.js
// 獨立文章頁：安全結構化標記、共用圖片與自動目錄
// ==============================
//
// 主要函式複雜度：
// - renderArticle：O(n + L)，n = 文章數，L = 文章總字元／區塊數
// - renderContent：O(L)
// 空間複雜度：O(L)
//
// 更快替代方案比較：
// - 全功能 Markdown 套件：功能較多，但增加外部依賴與內容清理成本。
// - 本實作：只解析本站需要的標記，單次線性掃描並先跳脫所有文章文字。
// ==============================

(function initArticleDetailPage() {
  "use strict";

  const IMAGE_RE = /^\[\[image:([a-z0-9_-]+)(?:\|([a-z0-9_-]+))?\]\]$/i;
  const FLOW_RE = /^\[\[flow:(.+)\]\]$/i;
  const NOTE_RE = /^\[\[note:([^|\]]+)\|(.+)\]\]$/i;
  const DETAILS_RE = /^\[\[details:([^|\]]+)(?:\|(open))?\]\]$/i;
  const DETAILS_END = "[[/details]]";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inline(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function normalizeNavigation() {
    const nav = document.querySelector(".nav");
    if (!nav) return;
    let articleLink = nav.querySelector('a[href="articles.html"]');
    let labLink = nav.querySelector('a[href="lab.html"]');
    const timeflowLink = nav.querySelector('a[href="timeflow.html"]');

    if (!articleLink) {
      articleLink = document.createElement("a");
      articleLink.href = "articles.html";
      nav.insertBefore(articleLink, timeflowLink || null);
    }
    if (!labLink) {
      labLink = document.createElement("a");
      labLink.href = "lab.html";
      articleLink.insertAdjacentElement("afterend", labLink);
    }

    articleLink.textContent = "文章";
    articleLink.setAttribute("aria-current", "page");
    labLink.textContent = "實驗室";
    labLink.removeAttribute("aria-current");
    nav.querySelector('a[href="lost-item.html"]')?.remove();
    const backLink = document.querySelector(".article-back-link");
    if (backLink) backLink.textContent = "← 回文章總覽";
  }

  function flattenContent(article) {
    const source = Array.isArray(article.content) && article.content.length
      ? article.content
      : [article.excerpt];
    const lines = [];

    source.forEach((entry, index) => {
      const current = String(entry || "").replace(/\r\n?/g, "\n").split("\n");
      lines.push(...current);
      if (index >= source.length - 1) return;

      const last = ([...current].reverse().find((line) => line.trim()) || "").trim();
      const next = (String(source[index + 1] || "")
        .replace(/\r\n?/g, "\n").split("\n")
        .find((line) => line.trim()) || "").trim();
      const join =
        (last.startsWith("|") && next.startsWith("|")) ||
        (/^[-*]\s+/.test(last) && /^[-*]\s+/.test(next)) ||
        (/^\d+\.\s+/.test(last) && /^\d+\.\s+/.test(next)) ||
        (/^>\s?/.test(last) && /^>\s?/.test(next));
      if (!join) lines.push("");
    });
    return lines;
  }

  function tableCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "")
      .split("|").map((cell) => cell.trim());
  }

  function isTableDivider(line) {
    const cells = tableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function mediaHtml(id, variant) {
    const media = window.EvanArticleMedia?.get?.(id);
    if (!media) {
      console.warn(`[article-detail] 找不到圖片代碼：${id}`);
      return "";
    }
    const safeVariant = ["cover", "wide", "portrait", "inline"].includes(variant)
      ? variant : "wide";
    const eager = safeVariant === "cover" ? "eager" : "lazy";
    const credit = media.creditLabel && /^https?:\/\//i.test(media.creditUrl || "")
      ? `<a href="${escapeHtml(media.creditUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(media.creditLabel)}</a>`
      : "";
    const caption = media.caption || credit
      ? `<figcaption><span>${escapeHtml(media.caption || "")}</span>${credit}</figcaption>`
      : "";
    return `<figure class="article-media article-media-${safeVariant}"><img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.alt || "")}" loading="${eager}" decoding="async">${caption}</figure>`;
  }

  function findDetailsEnd(lines, start) {
    let depth = 1;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (DETAILS_RE.test(lines[index].trim())) depth += 1;
      if (lines[index].trim() === DETAILS_END) depth -= 1;
      if (depth === 0) return index;
    }
    return -1;
  }

  function isBlockStart(lines, index) {
    const line = String(lines[index] || "").trim();
    const next = String(lines[index + 1] || "").trim();
    return !line || /^#{2,3}\s+/.test(line) || /^[-*]\s+/.test(line) ||
      /^\d+\.\s+/.test(line) || /^>\s?/.test(line) || line === "---" ||
      IMAGE_RE.test(line) || FLOW_RE.test(line) || NOTE_RE.test(line) ||
      DETAILS_RE.test(line) || line === DETAILS_END ||
      (line.startsWith("|") && next.startsWith("|") && isTableDivider(next));
  }

  function renderContent(lines, state) {
    const html = [];
    for (let index = 0; index < lines.length;) {
      const line = String(lines[index] || "").trim();
      if (!line || line === DETAILS_END) { index += 1; continue; }

      const details = line.match(DETAILS_RE);
      if (details) {
        const end = findDetailsEnd(lines, index);
        const innerLines = end === -1 ? lines.slice(index + 1) : lines.slice(index + 1, end);
        html.push(`<details class="article-content-details"${details[2] ? " open" : ""}><summary>${inline(details[1])}</summary><div class="article-detail-body article-structured-body article-details-body">${renderContent(innerLines, state)}</div></details>`);
        index = end === -1 ? lines.length : end + 1;
        continue;
      }

      const image = line.match(IMAGE_RE);
      if (image) { html.push(mediaHtml(image[1], image[2] || "wide")); index += 1; continue; }

      const flow = line.match(FLOW_RE);
      if (flow) {
        const steps = flow[1].split(/\s*>\s*/).map((item) => item.trim()).filter(Boolean);
        html.push(`<ol class="article-story-flow">${steps.map((step, i) => `<li><span class="article-story-flow-number">${String(i + 1).padStart(2, "0")}</span><span class="article-story-flow-text">${inline(step)}</span></li>`).join("")}</ol>`);
        index += 1; continue;
      }

      const note = line.match(NOTE_RE);
      if (note) { html.push(`<aside class="article-content-note"><strong>${inline(note[1])}</strong><p>${inline(note[2])}</p></aside>`); index += 1; continue; }

      if (line.startsWith("## ") || line.startsWith("### ")) {
        const level = line.startsWith("### ") ? 3 : 2;
        const text = line.slice(level + 1).trim();
        state.heading += 1;
        html.push(`<h${level} id="article-section-${state.heading}">${inline(text)}</h${level}>`);
        index += 1; continue;
      }

      if (line === "---") { html.push('<hr class="article-content-divider">'); index += 1; continue; }

      if (line.startsWith("|") && isTableDivider(String(lines[index + 1] || "").trim())) {
        const rows = [line];
        index += 2;
        while (index < lines.length && String(lines[index] || "").trim().startsWith("|")) {
          rows.push(String(lines[index] || "").trim()); index += 1;
        }
        const head = tableCells(rows[0]).map((cell) => `<th>${inline(cell)}</th>`).join("");
        const body = rows.slice(1).map((row) => `<tr>${tableCells(row).map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("");
        html.push(`<div class="article-table-wrap"><table class="article-content-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
        continue;
      }

      if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        const ordered = /^\d+\.\s+/.test(line);
        const items = [];
        const itemRe = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
        while (index < lines.length && itemRe.test(String(lines[index] || "").trim())) {
          items.push(String(lines[index] || "").trim().replace(itemRe, "")); index += 1;
        }
        const tag = ordered ? "ol" : "ul";
        html.push(`<${tag} class="article-content-list">${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(String(lines[index] || "").trim())) {
          quote.push(String(lines[index] || "").trim().replace(/^>\s?/, "")); index += 1;
        }
        html.push(`<blockquote class="article-content-quote">${quote.map(inline).join("<br>")}</blockquote>`);
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (index < lines.length && !isBlockStart(lines, index)) {
        paragraph.push(String(lines[index] || "").trim()); index += 1;
      }
      html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    }
    return html.join("");
  }

  function buildToc(body) {
    const headings = Array.from(body.querySelectorAll(":scope > h2"));
    if (headings.length < 3) return null;
    const nav = document.createElement("nav");
    nav.className = "article-table-of-contents";
    nav.setAttribute("aria-label", "本文導覽");
    nav.innerHTML = `<p class="article-toc-title">本文導覽</p><ol>${headings.map((heading) => `<li><a href="#${heading.id}">${escapeHtml(heading.textContent)}</a></li>`).join("")}</ol>`;
    return nav;
  }

  function renderNotFound(container) {
    container.className = "article-detail-card article-not-found";
    container.innerHTML = '<h1>找不到這篇文章</h1><p>文章可能尚未發布、已封存，或網址中的文章 ID 不正確。</p><a class="btn primary" href="articles.html">回文章總覽</a>';
    document.getElementById("article-discussion")?.classList.add("hidden");
  }

  function renderArticle(container, article) {
    const header = document.createElement("header");
    header.className = "article-detail-header";
    header.innerHTML = `<span class="article-tag">${escapeHtml(article.tag || "文章")}</span><h1>${escapeHtml(article.title)}</h1><p class="article-meta">${escapeHtml(article.date)} · ${escapeHtml(article.author)}</p>`;

    const body = document.createElement("div");
    body.className = "article-detail-body article-structured-body";
    body.innerHTML = renderContent(flattenContent(article), { heading: 0 });

    const footer = document.createElement("footer");
    footer.className = "article-detail-actions";
    if (article.relatedLink) {
      const related = document.createElement("a");
      related.className = "btn ghost";
      related.href = article.relatedLink;
      related.textContent = article.relatedLabel || "閱讀相關頁面";
      footer.appendChild(related);
    }
    const discussion = document.createElement("a");
    discussion.className = "btn primary";
    discussion.href = "#article-discussion";
    discussion.textContent = "前往留言討論";
    footer.appendChild(discussion);

    const toc = buildToc(body);
    container.replaceChildren(...(toc ? [header, toc, body, footer] : [header, body, footer]));
  }

  document.addEventListener("DOMContentLoaded", async () => {
    normalizeNavigation();
    const container = document.getElementById("article-detail");
    if (!container) return;

    try { await window.EvanArticles?.ready; }
    catch (error) { console.warn("[article-detail] 等待文章資料時發生錯誤：", error); }

    const id = new URLSearchParams(window.location.search).get("id") || "";
    const article = window.EvanArticles?.getById?.(id) || null;
    if (!article) { renderNotFound(container); return; }

    document.title = `${article.title}｜Evan Tarot`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = article.excerpt;
    document.body.dataset.articleId = article.id;
    renderArticle(container, article);

    await window.EvanGoogleAuth?.init?.();
    await window.EvanArticleComments?.init?.(article);
  });
})();
