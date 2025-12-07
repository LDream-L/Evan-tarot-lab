// ==============================
// lost-item.js
// 失物占卜表單邏輯 + 回饋紀錄（本機）
// ==============================
//
// 占卜主流程（handleLostItemForm + renderLostItemResult）：
//   時間複雜度：O(1)（抽 3 張＋渲染固定結構，牌數固定）
//   空間複雜度：O(1)
//
// 回饋儲存（localStorage）：
//   單次寫入：O(n)（n = 目前紀錄數，用於序列化 JSON）
//   單次讀取：O(n)
//   目前資料量極小，可視為常數成本。
//
// 暴力法 vs 優化法：
//   暴力法：每次占卜都把所有牌洗牌（O(N)）或打 API 取遠端資料。
//   優化法：mapping 已在 tarot-mapping.js 載入到記憶體，只抽固定 3 張，
//           並把渲染邏輯限制在固定結構 → 每次請求成本近似常數。
//
// ==============================
// 基本設定
// ==============================

// localStorage 存放 key
const LOST_FEEDBACK_STORAGE_KEY = "evanLostItemFeedback";

// 最近一次占卜的上下文（給回饋使用）
window.lastLostItemContext = null;

// ==============================
// 小工具：HTML 轉義
// ==============================
//
// 時間複雜度：O(m)（m = 字串長度）
// 空間複雜度：O(1)
function escapeHtmlInline(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ==============================
// 儲存回饋到 localStorage
// ==============================
//
// 時間複雜度：O(n)（n = 目前紀錄數）
// 空間複雜度：O(n)
function saveLostItemFeedback(record) {
  try {
    const raw = localStorage.getItem(LOST_FEEDBACK_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(record);
    localStorage.setItem(LOST_FEEDBACK_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("儲存失物回饋失敗", e);
  }
}

// ==============================
// 匯出單筆回饋為文字檔並下載
// ==============================
//
// 時間複雜度：O(m)（m = 這次紀錄字串長度）
// 空間複雜度：O(m)
//
// 暴力法：自己開 DevTools 把 JSON 複製貼到記事本再存檔。
// 優化法：程式自動把本次紀錄排版成文字，建立 Blob 觸發下載。
function downloadLostItemFeedbackRecord(record) {
  if (!record) return;

  const itemName = record.itemName || "";
  const createdAt = record.createdAt || "";
  const resultStatus =
    record.resultStatus === "found" ? "最後有找到" : "暫時還沒找到";

  const cards = Array.isArray(record.cards) ? record.cards : [];
  const cardLine = cards
    .map((c) => (c && c.name ? c.name : ""))
    .filter(Boolean)
    .join(" / ");

  const lines = [
    `物品：${itemName}`,
    `占卜時間：${createdAt}`,
    `牌組：${cardLine}`,
    `回饋結果：${resultStatus}`,
    record.feedbackNote ? `補充說明：${record.feedbackNote}` : "",
    record.feedbackAt ? `回饋時間：${record.feedbackAt}` : ""
  ].filter(Boolean);

  const content = lines.join("\n");

  const blob = new Blob([content], {
    type: "text/plain;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  // 檔名：lost-item-耳機-2025-12-07-19-30-15.txt
  const safeName = (itemName || "lost-item")
    .replace(/[^\w\u4e00-\u9fa5\-]+/g, "_")
    .slice(0, 20);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  a.download = `lost-item-${safeName}-${ts}.txt`;
  a.href = url;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==============================
// 渲染占卜結果（卡片＋文字解釋整合進卡片）
// ==============================
//
// 時間複雜度：O(1)（固定 3 張牌）
// 空間複雜度：O(1)
function renderLostItemResult(ctx) {
  const { itemName, notes, cards } = ctx;

  const resultSection = document.getElementById("lost-item-result");
  const cardsContainer = document.getElementById("lost-item-cards");
  const detailsEl = document.getElementById("lost-item-details");

  if (!resultSection || !cardsContainer) {
    console.warn("[lost-item] 缺少結果容器元素");
    return;
  }

  // 清空舊結果
  cardsContainer.innerHTML = "";

  // 將說明 details 隱藏（第二張圖整塊不顯示）
  if (detailsEl) {
    detailsEl.classList.add("hidden");
  }

  if (!cards || cards.length === 0) {
    console.warn("[lost-item] 沒有牌可以渲染");
    return;
  }

  const safeItemName = escapeHtmlInline(itemName);
  const safeNotes = escapeHtmlInline(notes);

  // 標題改成「占卜結果｜關於『XXX』」
  const titleEl = resultSection.querySelector("h4");
  if (titleEl) {
    const label = safeItemName || "這個物品";
    titleEl.innerHTML = `占卜結果｜關於「${label}」`;
  }

  const statusCard = cards[0];
  const locationCard = cards[1] || cards[0];
  const actionCard = cards[2] || cards[0];

  const cardConfigs = [
    {
      index: 1,
      card: statusCard,
      bodyHtml: `<p>目前狀態：${statusCard.statusHint}</p>`
    },
    {
      index: 2,
      card: locationCard,
      bodyHtml:
        `<p><strong>${locationCard.areaHint}</strong></p>` +
        `<p>比較可能出現的場域：${locationCard.locationHint}。</p>`
    },
    {
      index: 3,
      card: actionCard,
      bodyHtml: `<p>搜尋建議：${actionCard.actionHint}</p>`
    }
  ];

  // 固定 3 張 → 迴圈次數為常數，時間複雜度 O(1)
  for (let i = 0; i < cardConfigs.length; i++) {
    const cfg = cardConfigs[i];
    if (!cfg.card) continue;

    const div = document.createElement("div");
    div.className = "card small-card";
    div.innerHTML =
      `<strong>第 ${cfg.index} 張｜${cfg.card.name}</strong>` +
      cfg.bodyHtml;

    cardsContainer.appendChild(div);
  }

  // 表單補充說明，放在卡片下面
  if (safeNotes) {
    const noteP = document.createElement("p");
    noteP.className = "tool-interpretation";
    noteP.innerHTML = `<em>你補充的狀況：「${safeNotes}」，可以當作第一輪搜尋的起點；如果這一輪沒找到，建議換一個場域再跑一次。</em>`;
    cardsContainer.appendChild(noteP);
  }

  // 保存上下文給回饋表單使用
  window.lastLostItemContext = {
    itemName,
    notes,
    cards,
    createdAt: new Date().toISOString()
  };

  resultSection.classList.remove("hidden");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ==============================
// 占卜表單送出
// ==============================
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)
window.handleLostItemForm = async function handleLostItemForm(event) {
  event.preventDefault();

  const itemNameInput = document.getElementById("item-name");
  const notesInput = document.getElementById("item-notes");
  const itemName = itemNameInput ? itemNameInput.value.trim() : "";
  const notes = notesInput ? notesInput.value.trim() : "";

  if (!itemName) {
    return;
  }

  try {
    // 確保 mapping 已載入
    if (typeof window.loadMappingFromSheet === "function") {
      await window.loadMappingFromSheet();
    }

    let cards = null;

    // 優先使用 drawThreeFromEngine（O(1)）
    if (typeof window.drawThreeFromEngine === "function") {
      cards = window.drawThreeFromEngine();
    } else if (Array.isArray(window.mappingEngine)) {
      const engine = window.mappingEngine;
      const n = engine.length;
      const count = Math.min(3, n);
      const indices = new Set();
      while (indices.size < count) {
        indices.add(Math.floor(Math.random() * n));
      }
      cards = Array.from(indices).map((idx) => engine[idx]);
    }

    if (!cards || !cards.length) {
      alert("目前沒有可用的牌組資料，請稍後再試一次。");
      return;
    }

    renderLostItemResult({ itemName, notes, cards });
  } catch (e) {
    console.error("[lost-item] 占卜流程錯誤", e);
    alert("占卜過程發生錯誤，請稍後再試一次。");
  }
};

// ==============================
// 回饋表單送出
// ==============================
//
// 時間複雜度：O(n)（含一次寫入 localStorage）
// 空間複雜度：O(n)
window.handleLostItemFeedbackForm = function handleLostItemFeedbackForm(
  event
) {
  event.preventDefault();

  const ctx = window.lastLostItemContext;
  if (!ctx || !ctx.itemName) {
    alert("請先進行一次失物占卜，再填寫回饋。");
    return;
  }

  const form = event.target;
  const statusInput = form.querySelector('input[name="found-status"]:checked');
  const status = statusInput ? statusInput.value : null;
  const notesEl = document.getElementById("found-notes");
  const notes = notesEl ? notesEl.value.trim() : "";

  if (!status) {
    alert("請選擇「最後有找到」或「暫時還沒找到」。");
    return;
  }

  const record = {
    ...ctx,
    resultStatus: status, // "found" 或 "not_found"
    feedbackNote: notes,
    feedbackAt: new Date().toISOString()
  };

  // 1. 存到瀏覽器本機
  saveLostItemFeedback(record);

  // 2. 下載一份文字紀錄檔（你如果不想強制下載，可以註解掉這行）
  downloadLostItemFeedbackRecord(record);

  form.reset();

  alert("已將這次結果記錄在本機（僅存在這台裝置），並下載一份文字紀錄檔。");
};
