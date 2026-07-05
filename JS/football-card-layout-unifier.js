// ==============================
// football-card-layout-unifier.js
// 世足賽事驗證：延長賽／PK 與紀錄牌面統一使用主牌組卡片版型
// ==============================
// 主要函式複雜度：
// - unifyKnockoutBoards：O(k)，k 為目前畫面的延長賽／PK 牌數，固定上限 10。
// - renderRecordBoards：O(r * c)，r 為紀錄數，c 為每場主牌數，固定上限 5。
// - createRecordBoard：O(c log c) 時間／O(c) DOM 空間；c <= 5，排序成本為固定小量。
//
// 更快替代方案比較：
// - 只替換首次出現的精簡牌面：DOM 操作較少，但後續 UX 重繪會把卡片蓋回文字版。
// - 本版：監聽列內重繪並以資料簽章補回統一卡片；只有內容變更才重建，兼顧穩定與效能。
// ==============================

(function initFootballCardLayoutUnifier() {
  "use strict";

  const core = window.FootballLabCore;
  if (!core) return;

  const POSITION_META = Object.freeze({
    directResult: Object.freeze({
      order: 0,
      group: "direct",
      title: "單張｜90 分鐘整體能量",
      note: "觀察比賽活躍度、總進球區間，以及是否可能和局進入決勝階段；不指定勝方",
    }),
    homeAttack: Object.freeze({
      order: 1,
      group: "structure",
      title: "攻防組｜主隊進攻",
      note: "主隊創造機會與把握進球的狀態",
    }),
    awayDefense: Object.freeze({
      order: 2,
      group: "structure",
      title: "攻防組｜客隊防守",
      note: "客隊限制主隊與承受壓力的狀態",
    }),
    awayAttack: Object.freeze({
      order: 3,
      group: "structure",
      title: "攻防組｜客隊進攻",
      note: "客隊創造機會與把握進球的狀態",
    }),
    homeDefense: Object.freeze({
      order: 4,
      group: "structure",
      title: "攻防組｜主隊防守",
      note: "主隊限制客隊與承受壓力的狀態",
    }),
  });

  const GROUP_META = Object.freeze({
    direct: Object.freeze({
      title: "A｜單張整體能量模型",
      note: "這一組只看 90 分鐘整體節奏、總進球量與是否和局，不判定哪一隊獲勝。",
    }),
    structure: Object.freeze({
      title: "B｜四張攻防模型",
      note: "主隊進攻＋客隊防守推估主隊進球；客隊進攻＋主隊防守推估客隊進球。",
    }),
    legacy: Object.freeze({
      title: "舊版｜五牌位模型",
      note: "舊版紀錄保留原始牌位，以相同卡片版型呈現。",
    }),
  });

  let recordObserver = null;
  let knockoutObserver = null;
  let renderToken = 0;
  let applyingRecords = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function injectStyles() {
    if (byId("football-card-layout-unifier-style")) return;

    const style = document.createElement("style");
    style.id = "football-card-layout-unifier-style";
    style.textContent = `
      .football-knockout-card-sections,
      .football-record-card-board {
        display: grid;
        gap: 0.85rem;
      }
      .football-knockout-card-grid,
      .football-record-card-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.85rem;
        margin: 0;
      }
      .football-knockout-card-grid.is-single,
      .football-record-card-grid.is-single {
        grid-template-columns: minmax(180px, 1fr);
        max-width: 25%;
      }
      .football-knockout-card-grid .football-card,
      .football-record-card-grid .football-card {
        min-height: 190px;
      }
      .football-record-match {
        min-width: 760px !important;
      }
      #football-records .football-table {
        min-width: 1840px;
      }
      #football-records .football-table th:nth-child(2),
      #football-records .football-table td:nth-child(2) {
        min-width: 780px;
        width: 780px;
      }
      .football-record-card-board .football-card-group-heading,
      .football-knockout-card-sections .football-card-group-heading {
        padding: 0.72rem 0.85rem;
        border-radius: 14px;
      }
      .football-record-card-grid .football-random-card-name {
        overflow-wrap: anywhere;
      }
      @media (max-width: 1200px) {
        .football-knockout-card-grid,
        .football-record-card-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .football-knockout-card-grid.is-single,
        .football-record-card-grid.is-single {
          max-width: 50%;
        }
      }
      @media (max-width: 760px) {
        .football-knockout-card-grid,
        .football-record-card-grid,
        .football-knockout-card-grid.is-single,
        .football-record-card-grid.is-single {
          grid-template-columns: 1fr;
          max-width: none;
        }
        .football-knockout-card-grid .football-card,
        .football-record-card-grid .football-card {
          min-height: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createGroupHeading(meta) {
    const heading = createElement("div", "football-card-group-heading");
    heading.append(
      createElement("h4", "", meta.title),
      createElement("p", "", meta.note)
    );
    return heading;
  }

  function createOrientationBadge(orientation) {
    return createElement(
      "span",
      `football-orientation${orientation === "逆位" ? " is-reversed" : ""}`,
      orientation || "—"
    );
  }

  /** 將既有延長賽／PK 表單卡改成主牌組卡片：O(1) 單卡時間／O(1) 額外空間。 */
  function unifyKnockoutCard(article, order) {
    if (!article || article.dataset.unifiedCard === "1") return;

    const title = article.querySelector("h5, h4");
    const note = article.querySelector("p");
    const selects = Array.from(article.querySelectorAll(":scope > select"));
    const randomCard = article.querySelector(":scope > strong[data-card-name]");

    article.classList.remove("football-knockout-card");
    article.classList.add("football-card");

    const orderBadge = createElement("span", "football-card-order", `本組第 ${order} 張`);
    if (title) {
      const replacement = createElement("h4", "football-card-name", title.textContent);
      title.replaceWith(replacement);
    }
    if (note) note.className = "football-card-role";
    article.prepend(orderBadge);

    if (selects.length >= 2) {
      const cardLabel = createElement("label", "", "抽到的牌");
      const orientationLabel = createElement("label", "", "正逆位");
      cardLabel.appendChild(selects[0]);
      orientationLabel.appendChild(selects[1]);
      article.append(cardLabel, orientationLabel);
    } else if (randomCard) {
      const name = randomCard.dataset.cardName || randomCard.textContent || "—";
      const orientation = randomCard.dataset.cardOrientation || "";
      randomCard.className = "football-random-card-name";
      randomCard.textContent = name;
      article.appendChild(createOrientationBadge(orientation));
    }

    article.dataset.unifiedCard = "1";
  }

  function getKnockoutPosition(card) {
    const control = card?.querySelector("select[id*='-card-'], strong[data-position]");
    if (control?.dataset?.position) return control.dataset.position;
    const match = String(control?.id || "").match(/-card-(.+)$/);
    return match ? match[1] : "";
  }

  function knockoutGroupMeta(grid) {
    const stage = grid.id.includes("penalty") ? "penalty" : "extra";
    if (stage === "penalty") {
      return [{
        title: "D｜PK 牌面模型",
        note: "以射手、門將與最終結果牌分開觀察 PK 大戰。",
        cards: Array.from(grid.children),
      }];
    }

    const cards = Array.from(grid.children);
    const structureOrder = Object.freeze({
      extraHomeAttack: 1,
      extraAwayDefense: 2,
      extraAwayAttack: 3,
      extraHomeDefense: 4,
    });
    return [
      {
        title: "C-1｜延長賽單張模型",
        note: "只判斷延長賽 30 分鐘的整體賽果，不與攻防牌混合。",
        cards: cards.filter((card) => getKnockoutPosition(card) === "extraResult"),
      },
      {
        title: "C-2｜延長賽四張攻防模型",
        note: "主隊延長賽進攻＋客隊延長賽防守推估主隊新增進球；另一組反向推估客隊新增進球。",
        cards: cards
          .filter((card) => getKnockoutPosition(card) !== "extraResult")
          .sort((a, b) => (structureOrder[getKnockoutPosition(a)] || 99) - (structureOrder[getKnockoutPosition(b)] || 99)),
      },
    ].filter((group) => group.cards.length);
  }

  /** 延長賽與 PK 牌組固定最多十張：O(k) 時間／O(k) DOM 搬移空間。 */
  function unifyKnockoutBoards() {
    document.querySelectorAll(".football-knockout-cards:not([data-unified-board='1'])").forEach((grid) => {
      const sections = createElement("div", "football-knockout-card-sections");
      knockoutGroupMeta(grid).forEach((group) => {
        const cardGrid = createElement(
          "div",
          `football-knockout-card-grid${group.cards.length === 1 ? " is-single" : ""}`
        );
        group.cards.forEach((card, index) => {
          unifyKnockoutCard(card, index + 1);
          cardGrid.appendChild(card);
        });
        sections.append(createGroupHeading(group), cardGrid);
      });

      grid.dataset.unifiedBoard = "1";
      grid.replaceWith(sections);
    });
  }

  function getCardMeta(card) {
    const known = POSITION_META[card?.position];
    if (known) return known;

    const title = String(card?.positionTitle || card?.title || "牌位");
    const direct = card?.group === "direct" || title.includes("單張") || title.includes("結果牌");
    return {
      order: 99,
      group: direct ? "direct" : "legacy",
      title,
      note: String(card?.positionNote || "保留原始牌位說明。"),
    };
  }

  function createRecordCard(card, orderInGroup) {
    const meta = getCardMeta(card);
    const article = createElement("article", "football-card football-record-card");
    article.append(
      createElement("span", "football-card-order", `本組第 ${orderInGroup} 張`),
      createElement("h4", "football-card-name", card?.positionTitle || meta.title),
      createElement("p", "football-card-role", card?.positionNote || meta.note),
      createElement("strong", "football-random-card-name", card?.name || "—"),
      createOrientationBadge(card?.orientation || "")
    );
    return article;
  }

  function cardSignature(record) {
    return JSON.stringify((record?.cards || []).map((card) => [
      card.position,
      card.positionTitle,
      card.positionNote,
      card.name,
      card.orientation,
    ]));
  }

  /** 主牌固定最多五張：O(c log c) 時間／O(c) DOM 空間。 */
  function createRecordBoard(record) {
    const board = createElement("div", "football-record-card-board");
    board.dataset.cardSignature = cardSignature(record);

    const cards = Array.isArray(record?.cards)
      ? record.cards.slice().sort((a, b) => getCardMeta(a).order - getCardMeta(b).order)
      : [];

    const groups = new Map();
    cards.forEach((card) => {
      const group = getCardMeta(card).group;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(card);
    });

    ["direct", "structure", "legacy"].forEach((groupName) => {
      const groupCards = groups.get(groupName);
      if (!groupCards?.length) return;

      const meta = GROUP_META[groupName];
      const grid = createElement(
        "div",
        `football-record-card-grid${groupCards.length === 1 ? " is-single" : ""}`
      );
      groupCards.forEach((card, index) => grid.appendChild(createRecordCard(card, index + 1)));
      board.append(createGroupHeading(meta), grid);
    });

    return board;
  }

  /** 依紀錄排序一對一更新列：O(r * c) 時間／O(r * c) DOM 空間。 */
  function renderRecordBoards() {
    if (applyingRecords) return;
    const body = byId("football-records-body");
    if (!body) return;

    applyingRecords = true;
    recordObserver?.disconnect();
    try {
      const records = core
        .getRecords()
        .sort((a, b) => String(b.match?.kickoff || "").localeCompare(String(a.match?.kickoff || "")));

      Array.from(body.children).forEach((row, index) => {
        const record = records[index];
        const match = row.children[1]?.querySelector(".football-record-match");
        if (!record || !match) return;

        const signature = cardSignature(record);
        const existingBoard = match.querySelector(":scope > .football-record-card-board");
        const compact = match.querySelector(":scope > .football-compact-cards");
        const staleBoard = existingBoard?.dataset.cardSignature !== signature;
        if (existingBoard && !compact && !staleBoard) return;

        compact?.remove();
        existingBoard?.remove();
        match.appendChild(createRecordBoard(record));
      });
    } finally {
      applyingRecords = false;
      recordObserver?.observe(body, { childList: true, subtree: true });
    }
  }

  function scheduleRender() {
    renderToken += 1;
    const token = renderToken;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (token !== renderToken) return;
        unifyKnockoutBoards();
        renderRecordBoards();
      });
    });
  }

  function init() {
    injectStyles();

    const readingForm = byId("football-reading-form");
    if (readingForm) {
      knockoutObserver = new MutationObserver(scheduleRender);
      knockoutObserver.observe(readingForm, { childList: true, subtree: true });
    }

    const body = byId("football-records-body");
    if (body) {
      recordObserver = new MutationObserver(scheduleRender);
      recordObserver.observe(body, { childList: true, subtree: true });
    }

    window.addEventListener("football-energy-render", scheduleRender);
    byId("football-evaluation-form")?.addEventListener("submit", scheduleRender);
    byId("football-edit-form")?.addEventListener("submit", scheduleRender);
    scheduleRender();
  }

  init();
})();