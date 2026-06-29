// ==============================
// article-detail.js
// 獨立文章頁渲染：支援安全的結構化文章標記、共用圖片與自動目錄
// ==============================
//
// 主要函式複雜度：
// - renderArticle：O(n + L)，n = 文章數，L = 文章總字元／區塊數
// - renderStructuredContent：O(L)
// - buildTableOfContents：O(h)，h = 二級標題數
// 空間複雜度：O(L + h)
//
// 更快替代方案比較：
// - 全功能 Markdown 函式庫：功能較多，但需額外載入套件並增加內容清理成本。
// - 本實作：只解析本站實際需要的安全標記，單次線性掃描並以 DOM 節點輸出。
// ==============================

(function initArticleDetailPage() {
  "use strict";

  const IMAGE_PATTERN = /^\[\[image:([a-z0-9_-]+)(?:\|([a-z0-9_-]+))?\]\]$/i;
  const FLOW_PATTERN = /^\[\[flow:(.+)\]\]$/i;
  const NOTE_PATTERN = /^\[\[note:([^|\]]+)\|(.+)\]\]$/i;
  const DETAILS_PATTERN = /^\[\[details:([^|\]]+)(?:\|(open))?\]\]$/i;
  const DETAILS_END = "[[/details]]";

  function normalizeArticleNavigation() {
    const nav = document.querySelector(".nav");
    if (!nav) return;

    let articleLink = nav.querySelector('a[href="articles.html"]');
    let labLink = nav.querySelector('a[href="lab.html"]');
    const lostItemLink = nav.querySelector('a[href="lost-item.html"]');
    const timeflowLink = nav.querySelector('a[href="timeflow.html"]');

    if (!articleLink) {
      articleLink = document.createElement("a");
      articleLink.href = "articles.html";
      articleLink.textContent = "文章";
      nav.insertBefore(articleLink, timeflowLink || null);
    }

    if (!labLink) {
      labLink = document.createElement("a");
      labLink.href = "lab.html";
      labLink.textContent = "實驗室";
      articleLink.insertAdjacentElement("afterend", labLink);
    }

    articleLink.textContent = "文章";
    articleLink.setAttribute("aria-current", "page");
    labLink.textContent = "實驗室";
    labLink.removeAttribute("aria-current");
    lostItemLink?.remove();

    const backLink = document.querySelector(".article-back-link");
    if (backLink) backLink.textContent = "← 回文章總覽";
  }

  function appendInlineText(parent, input) {
    const text = String(input || "");
    const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let cursor = 0;
    let match;

    while ((match = tokenPattern.exec(text)) !== null) {
      if (match.index > cursor) {
        parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }

      const token = match[0];
      if (token.startsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      }

      cursor = tokenPattern.lastIndex;
    }

    if (cursor < text.length) {
      parent.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function appendMultilineText(parent, lines) {
    lines.forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement("br"));
      appendInlineText(parent, line);
    });
  }

  function flattenArticleContent(article) {
    const source = Array.isArray(article.content) && article.content.length
      ? article.content
      : [article.excerpt];
    const lines = [];

    source.forEach((entry, index) => {
      const normalizedLines = String(entry || "")
        .replace(/\r\n?/g, "\n")
        .split("\n");
      lines.push(...normalizedLines);

      if (index < source.length - 1) {
        const currentLast = [...normalizedLines].reverse().find((line) => line.trim()) || "";
        const nextLines = String(source[index + 1] || "")
          .replace(/\r\n?/g, "\n")
          .split("\n");
        const nextFirst = nextLines.find((line) => line.trim()) || "";
        const currentTrimmed = currentLast.trim();
        const nextTrimmed = nextFirst.trim();
        const isSameTable = currentTrimmed.startsWith("|") && nextTrimmed.startsWith("|");
        const isSameBulletList = /^[-*]\s+/.test(currentTrimmed) && /^[-*]\s+/.test(nextTrimmed);
        const isSameNumberedList = /^\d+\.\s+/.test(currentTrimmed) && /^\d+\.\s+/.test(nextTrimmed);
        const isSameQuote = /^>\s?/.test(currentTrimmed) && /^>\s?/.test(nextTrimmed);

        if (!isSameTable && !isSameBulletList && !isSameNumberedList && !isSameQuote) {
          lines.push("");
        }
      }
    });

    return lines;
  }

  function createHeading(level, text, state) {
    const heading = document.createElement(level);
    state.headingCounter += 1;
    heading.id = `article-section-${state.headingCounter}`;
    appendInlineText(heading, text);
    return heading;
  }

  function createParagraph(lines) {
    const paragraph = document.createElement("p");
    appendMultilineText(paragraph, lines);
    return paragraph;
  }

  function createList(lines, ordered) {
    const list = document.createElement(ordered ? "ol" : "ul");
    list.className = "article-content-list";

    lines.forEach((line) => {
      const item = document.createElement("li");
      const content = ordered
        ? line.replace(/^\d+\.\s+/, "")
        : line.replace(/^[-*]\s+/, "");
      appendInlineText(item, content);
      list.appendChild(item);
    });

    return list;
  }

  function createBlockquote(lines) {
    const quote = document.createElement("blockquote");
    quote.className = "article-content-quote";
    appendMultilineText(
      quote,
      lines.map((line) => line.replace(/^>\s?/, ""))
    );
    return quote;
  }

  function parseTableRow(line) {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((cell) => cell.trim());
  }

  function isTableDivider(line) {
    const cells = parseTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function createTable(lines) {
    const wrapper = document.createElement("div");
    wrapper.className = "article-table-wrap";

    const table = document.createElement("table");
    table.className = "article-content-table";
    const headerCells = parseTableRow(lines[0]);
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");

    headerCells.forEach((cellText) => {
      const cell = document.createElement("th");
      appendInlineText(cell, cellText);
      headRow.appendChild(cell);
    });

    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    lines.slice(2).forEach((line) => {
      const row = document.createElement("tr");
      parseTableRow(line).forEach((cellText) => {
        const cell = document.createElement("td");
        appendInlineText(cell, cellText);
        row.appendChild(cell);
      });
      body.appendChild(row);
    });

    table.appendChild(body);
    wrapper.appendChild(table);
    return wrapper;
  }

  function isSafeHttpUrl(input) {
    try {
      const url = new URL(String(input || ""), window.location.href);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (error) {
      return false;
    }
  }

  function createMediaFigure(mediaId, variant) {
    const media = window.EvanArticleMedia?.get?.(mediaId) || null;
    if (!media) {
      console.warn(`[article-detail] 找不到圖片代碼：${mediaId}`);
      return null;
    }

    const figure = document.createElement("figure");
    const safeVariant = ["cover", "wide", "portrait", "inline"].includes(variant)
      ? variant
      : "wide";
    figure.className = `article-media article-media-${safeVariant}`;

    const image = document.createElement("img");
    image.src = media.src;
    image.alt = media.alt || "";
    image.loading = safeVariant === "cover" ? "eager" : "lazy";
    image.decoding = "async";
    figure.appendChild(image);

    if (media.caption || media.creditLabel) {
      const caption = document.createElement("figcaption");
      if (media.caption) {
        const captionText = document.createElement("span");
        captionText.textContent = media.caption;
        caption.appendChild(captionText);
      }

      if (media.creditLabel && isSafeHttpUrl(media.creditUrl)) {
        const credit = document.createElement("a");
        credit.href = media.creditUrl;
        credit.target = "_blank";
        credit.rel = "noopener noreferrer";
        credit.textContent = media.creditLabel;
        caption.appendChild(credit);
      }
      figure.appendChild(caption);
    }

    return figure;
  }

  function createFlow(text) {
    const steps = String(text || "")
      .split(/\s*>\s*/)
      .map((step) => step.trim())
      .filter(Boolean);
    if (!steps.length) return null;

    const flow = document.createElement("ol");
    flow.className = "article-story-flow";
    steps.forEach((step, index) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.className = "article-story-flow-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const textNode = document.createElement("span");
      textNode.className = "article-story-flow-text";
      appendInlineText(textNode, step);
      item.append(number, textNode);
      flow.appendChild(item);
    });
    return flow;
  }

  function createNote(label, text) {
    const note = document.createElement("aside");
    note.className = "article-content-note";
    const title = document.createElement("strong");
    title.textContent = label.trim();
    const body = document.createElement("p");
    appendInlineText(body, text.trim());
    note.append(title, body);
    return note;
  }

  function findDetailsEnd(lines, startIndex) {
    let depth = 1;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (DETAILS_PATTERN.test(lines[index].trim())) depth += 1;
      if (lines[index].trim() === DETAILS_END) depth -= 1;
      if (depth === 0) return index;
    }
    return -1;
  }

  function isBlockStart(lines, index) {
    const line = String(lines[index] || "").trim();
    const nextLine = String(lines[index + 1] || "").trim();
    if (!line) return true;
    if (/^#{2,3}\s+/.test(line)) return true;
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) return true;
    if (/^>\s?/.test(line) || line === "---") return true;
    if (IMAGE_PATTERN.test(line) || FLOW_PATTERN.test(line) || NOTE_PATTERN.test(line)) return true;
    if (DETAILS_PATTERN.test(line) || line === DETAILS_END) return true;
    return line.startsWith("|") && nextLine.startsWith("|") && isTableDivider(nextLine);
  }

  function renderStructuredContent(article, state = { headingCounter: 0 }) {
    const body = document.createElement("div");
    body.className = "article-detail-body article-structured-body";
    const lines = flattenArticleContent(article);
    for (let index = 0; index < lines.length;) {
      const rawLine = String(lines[index] || "");
      const line = rawLine.trim();

      if (!line || line === DETAILS_END) {
        index += 1;
        continue;
      }

      const detailsMatch = line.match(DETAILS_PATTERN);
      if (detailsMatch) {
        const endIndex = findDetailsEnd(lines, index);
        const details = document.createElement("details");
        details.className = "article-content-details";
        details.open = detailsMatch[2] === "open";
        const summary = document.createElement("summary");
        appendInlineText(summary, detailsMatch[1]);
        const nestedArticle = {
          ...article,
          content: [
            (endIndex === -1
              ? lines.slice(index + 1)
              : lines.slice(index + 1, endIndex)
            ).join("\n"),
          ],
        };
        const nestedBody = renderStructuredContent(nestedArticle, state);
        nestedBody.classList.add("article-details-body");
        details.append(summary, nestedBody);
        body.appendChild(details);
        index = endIndex === -1 ? lines.length : endIndex + 1;
        continue;
      }

      const imageMatch = line.match(IMAGE_PATTERN);
      if (imageMatch) {
        const figure = createMediaFigure(imageMatch[1], imageMatch[2] || "wide");
        if (figure) body.appendChild(figure);
        index += 1;
        continue;
      }

      const flowMatch = line.match(FLOW_PATTERN);
      if (flowMatch) {
        const flow = createFlow(flowMatch[1]);
        if (flow) body.appendChild(flow);
        index += 1;
        continue;
      }

      const noteMatch = line.match(NOTE_PATTERN);
      if (noteMatch) {
        body.appendChild(createNote(noteMatch[1], noteMatch[2]));
        index += 1;
        continue;
      }

      if (line.startsWith("## ")) {
        body.appendChild(createHeading("h2", line.slice(3).trim(), state));
        index += 1;
        continue;
      }

      if (line.startsWith("### ")) {
        body.appendChild(createHeading("h3", line.slice(4).trim(), state));
        index += 1;
        continue;
      }

      if (line === "---") {
        const divider = document.createElement("hr");
        divider.className = "article-content-divider";
        body.appendChild(divider);
        index += 1;
        continue;
      }

      if (line.startsWith("|") && isTableDivider(String(lines[index + 1] || "").trim())) {
        const tableLines = [line, String(lines[index + 1] || "").trim()];
        index += 2;
        while (index < lines.length && String(lines[index] || "").trim().startsWith("|")) {
          tableLines.push(String(lines[index] || "").trim());
          index += 1;
        }
        body.appendChild(createTable(tableLines));
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const listLines = [];
        while (index < lines.length && /^[-*]\s+/.test(String(lines[index] || "").trim())) {
          listLines.push(String(lines[index] || "").trim());
          index += 1;
        }
        body.appendChild(createList(listLines, false));
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const listLines = [];
        while (index < lines.length && /^\d+\.\s+/.test(String(lines[index] || "").trim())) {
          listLines.push(String(lines[index] || "").trim());
          index += 1;
        }
        body.appendChild(createList(listLines, true));
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(String(lines[index] || "").trim())) {
          quoteLines.push(String(lines[index] || "").trim());
          index += 1;
        }
        body.appendChild(createBlockquote(quoteLines));
        continue;
      }

      const paragraphLines = [rawLine.trim()];
      index += 1;
      while (index < lines.length && !isBlockStart(lines, index)) {
        paragraphLines.push(String(lines[index] || "").trim());
        index += 1;
      }
      body.appendChild(createParagraph(paragraphLines));
    }

    return body;
  }

  function buildTableOfContents(body) {
    const headings = Array.from(body.querySelectorAll(":scope > h2"));
    if (headings.length < 3) return null;

    const nav = document.createElement("nav");
    nav.className = "article-table-of-contents";
    nav.setAttribute("aria-label", "本文導覽");

    const title = document.createElement("p");
    title.className = "article-toc-title";
    title.textContent = "本文導覽";

    const list = document.createElement("ol");
    headings.forEach((heading) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      item.appendChild(link);
      list.appendChild(item);
    });

    nav.append(title, list);
    return nav;
  }

  function renderNotFound(container) {
    container.className = "article-detail-card article-not-found";

    const title = document.createElement("h1");
    title.textContent = "找不到這篇文章";

    const text = document.createElement("p");
    text.textContent = "文章可能尚未發布、已封存，或網址中的文章 ID 不正確。";

    const link = document.createElement("a");
    link.className = "btn primary";
    link.href = "articles.html";
    link.textContent = "回文章總覽";

    container.replaceChildren(title, text, link);
    document.getElementById("article-discussion")?.classList.add("hidden");
  }

  function renderArticle(container, article) {
    const header = document.createElement("header");
    header.className = "article-detail-header";

    const tag = document.createElement("span");
    tag.className = "article-tag";
    tag.textContent = article.tag || "文章";

    const title = document.createElement("h1");
    title.textContent = article.title;

    const meta = document.createElement("p");
    meta.className = "article-meta";
    meta.textContent = `${article.date} · ${article.author}`;

    header.append(tag, title, meta);

    const body = renderStructuredContent(article);
    const toc = buildTableOfContents(body);

    const footer = document.createElement("footer");
    footer.className = "article-detail-actions";

    if (article.relatedLink) {
      const relatedLink = document.createElement("a");
      relatedLink.className = "btn ghost";
      relatedLink.href = article.relatedLink;
      relatedLink.textContent = article.relatedLabel || "閱讀相關頁面";
      footer.appendChild(relatedLink);
    }

    const discussionLink = document.createElement("a");
    discussionLink.className = "btn primary";
    discussionLink.href = "#article-discussion";
    discussionLink.textContent = "前往留言討論";
    footer.appendChild(discussionLink);

    const nodes = toc ? [header, toc, body, footer] : [header, body, footer];
    container.replaceChildren(...nodes);
  }

  /**
   * 將結構化文章內容渲染到指定容器。
   * 時間複雜度 O(L + h)，空間複雜度 O(L + h)。
   */
  function renderPreview(container, article, options = {}) {
    if (!container) return null;
    const body = renderStructuredContent(article || { content: [] });
    const toc = options.includeToc === false ? null : buildTableOfContents(body);
    container.replaceChildren(...(toc ? [toc, body] : [body]));
    return Object.freeze({ body, toc });
  }

  window.EvanArticleRenderer = Object.freeze({
    renderInto: renderPreview,
    createBody: renderStructuredContent,
    createToc: buildTableOfContents,
  });

  document.addEventListener("DOMContentLoaded", async () => {
    normalizeArticleNavigation();

    const container = document.getElementById("article-detail");
    if (!container) return;

    try {
      await window.EvanArticles?.ready;
    } catch (error) {
      console.warn("[article-detail] 等待文章資料時發生錯誤：", error);
    }

    const articleId = new URLSearchParams(window.location.search).get("id") || "";
    const article = window.EvanArticles?.getById?.(articleId) || null;

    if (!article) {
      renderNotFound(container);
      return;
    }

    document.title = `${article.title}｜Evan Tarot`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = article.excerpt;

    document.body.dataset.articleId = article.id;
    renderArticle(container, article);

    await window.EvanGoogleAuth?.init?.();
    await window.EvanArticleComments?.init?.(article);
  });
})();
