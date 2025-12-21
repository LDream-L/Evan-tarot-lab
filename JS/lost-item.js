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

// 台灣固定 UTC+8（無夏令時間）
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

// 台灣年月日+時間：2025-12-21 22:26
function nowTaipeiStamp() {
  const d = new Date(Date.now() + TAIPEI_OFFSET_MS);
  return d.toISOString().slice(0, 16).replace("T", " ");
}



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

// ★ 跟留言共用「Evan Tarot 網站回饋」表單
const LOST_ITEM_FEEDBACK_FORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLScdDR6CrMrs_G7HVMAbQYo95s4AaH5b3KDupUZ9TlD5e5yKLQ/formResponse",
  fields: {
    type: "entry.1980954123",        // 回饋類型
    title: "entry.2042241666",       // ✅ 標題/物品名稱（拿來放 itemName）
    note: "entry.243999010",         // ✅ 留言內容/補充（放 item-notes + 回饋補充）
    lastLocation: "entry.1220725361",// ✅ 最後位置
    status: "entry.2036025518",      // ✅ 失物狀態（找到/尚未找到）
    feedbackAt: "entry.1203451900",  // ✅ 建立時間
  },
};





/**
 * 共用的 Google Form POST（跟 comments.js 類似）
 * 時間複雜度：O(1)
 * 空間複雜度：O(1)
 */
function postToGoogleForm(url, formData) {
  return fetch(url, {
    method: "POST",
    mode: "no-cors",
    body: formData,
  });
}

/**
 * 把失物回饋紀錄組成 FormData
 */
function buildLostItemFeedbackFormData(record) {
  const fd = new FormData();
  const f = LOST_ITEM_FEEDBACK_FORM.fields;

  // type
  fd.append(f.type, "lost_item");

  // ✅ 物品名稱 → 放到「標題/物品名稱」
  fd.append(f.title, record.itemName || "");

  // ✅ 最後位置（你指定：要連結到「簡單描述一下狀況」）
  // 也順便把真正的「最後位置」一起附上，避免資訊消失
  const lastLocParts = [];
  if (record.itemNotes) lastLocParts.push(`狀況描述：${record.itemNotes}`);
  if (record.lastLocation) lastLocParts.push(`最後位置：${record.lastLocation}`);

  // ✅ 最後位置：只放「簡單描述」
  fd.append(f.lastLocation, record.lastLocation || record.itemNotes || "");

  // ✅ 留言內容/補充說明：只放「回饋補充」
  fd.append(f.note, record.feedbackNote || "");

  // ✅ 失物狀態
  fd.append(f.status, record.foundStatus || "");

  // ✅ 建立時間
  fd.append(f.feedbackAt, record.feedbackAt || nowTaipeiStamp());

  fd.append("submit", "Submit");
  return fd;
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
  const { itemName, notes, lastLocation, cards } = ctx;

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
    lastLocation,
    cards,
    createdAt: nowTaipeiStamp()
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
  // 你指定：把「簡單描述一下狀況」當作表單的「最後位置」
  const lastLocation = notes;


  if (!itemName) {
    itemNameInput?.focus();
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

    renderLostItemResult({ itemName, notes, lastLocation, cards });
  } catch (e) {
    console.error("[lost-item] 占卜流程錯誤", e);
    alert("占卜過程發生錯誤，請稍後再試一次。");
  }
};

// 主要：失物回饋表單 submit
// 時間複雜度：O(1)
// 空間複雜度：O(1)
//
// 暴力法：同時存 localStorage + 下載 txt + alert。
// 優化法（本實作）：只送 Google Form，頁面內顯示簡短提示，
//                  不在使用者裝置留下額外檔案或本機紀錄。
window.handleLostItemFeedbackForm = function handleLostItemFeedbackForm(event) {
  event.preventDefault();
  const form = event.target;

  const statusInput = form.querySelector('input[name="found-status"]:checked');
  const status = statusInput ? statusInput.value : "";
  const notes =
    document.getElementById("found-notes")?.value.trim() || "";

  const ctx = window.lastLostItemContext;

  if (!ctx || !ctx.itemName) {
    const msgEl = document.getElementById("lost-item-feedback-message");
    if (msgEl) {
      msgEl.textContent = "請先抽牌產生結果後再回饋。";
      msgEl.classList.remove("hidden");
    }
    return;
  }


  const record = {
    foundStatus: status,                          // "找到" / "尚未找到"
    feedbackNote: notes,                          // 回饋補充
    feedbackAt: nowTaipeiStamp(),                 // ✅ 建立時間（真的時間）
    itemName: ctx.itemName || "",                 // ✅ 物品名稱
    itemNotes: ctx.notes || "",                   // ✅ 簡述狀況（你原本的 item-notes）
    lastLocation: ctx.lastLocation || ""          // ✅ 最後位置
  };



  // ✅ 只送到 Google Form，不再存 localStorage / 下載文字檔
  const fd = buildLostItemFeedbackFormData(record);
  postToGoogleForm(LOST_ITEM_FEEDBACK_FORM.url, fd).catch((e) => {
    console.warn("失物回饋送到 Google 失敗：", e);
  });

  form.reset();

  // ✅ 不用 alert，改在頁面上顯示「感謝你的回饋」
  const msgEl = document.getElementById("lost-item-feedback-message");
  if (msgEl) {
    msgEl.textContent = "感謝你的回饋。";
    msgEl.classList.remove("hidden");
  }
};
