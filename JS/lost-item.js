// ==============================
// lost-item.js
// 失物占卜表單邏輯 + 回饋紀錄（本機）
// ==============================
//
// 占卜：
//   時間複雜度：O(1)（抽 3 張 + 渲染固定結構）
//   空間複雜度：O(1)
//
// 回饋儲存（localStorage）：
//   單次寫入：O(n)（n = 目前紀錄數，用於序列化 JSON）
//   單次讀取：O(n)
//   目前資料量極小，成本可忽略
//
// 暴力法：每次回饋都送到後端 / Google Sheet
// 本實作：只存到本機 localStorage，避免亂填，也方便你先實驗
// ==============================

const LOST_FEEDBACK_STORAGE_KEY = "evanLostItemFeedback";

// 最近一次占卜的上下文，給回饋用
window.lastLostItemContext = null;

// 儲存回饋到 localStorage
// 時間：O(n)，空間：O(n)
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
// 占卜表單送出
// ==============================
window.handleLostItemForm = async function handleLostItemForm(event) {
  event.preventDefault();

  const itemNameInput = document.getElementById("item-name");
  const notesInput = document.getElementById("item-notes");
  const itemName = itemNameInput.value.trim();
  const notes = notesInput.value.trim();

  if (!itemName) return;

  // 確保已載入 Mapping
  if (!window.mappingLoaded) {
    await window.loadMappingFromSheet();
    if (!window.mappingLoaded) return; // 載入失敗就中止
  }

  const cards = window.drawThreeFromEngine();
  const resultSection = document.getElementById("lost-item-result");
  const cardsContainer = document.getElementById("lost-item-cards");
  const interpretationContainer = document.getElementById(
    "lost-item-interpretation"
  );

  cardsContainer.innerHTML = "";

  const roles = ["物品現在的狀態", "比較可能出現的場域", "你接下來的搜尋方式"];

  cards.forEach((card, index) => {
    const div = document.createElement("div");
    div.className = "card small-card";
    div.innerHTML = `
      <strong>第 ${index + 1} 張｜${card.code}｜${card.name}</strong>
      <p>${roles[index]}</p>
    `;
    cardsContainer.appendChild(div);
  });

  const [statusCard, locationCard, actionCard] = cards;
  const textParts = [];

  textParts.push(
    `關於「<strong>${itemName}</strong>」，目前的狀態比較接近：<br>` +
      `<strong>${statusCard.code}｜${statusCard.name}</strong> —— ${statusCard.statusHint}`
  );

  textParts.push(
    `可以優先鎖定的環境與場域：<br>` +
      `<strong>${locationCard.code}｜${locationCard.name}</strong> 指向的空間，例如：${locationCard.locationHint}。<br>` +
      `這類位置的共同特徵是：<strong>${locationCard.areaHint}</strong>。`
  );

  textParts.push(
    `在實際行動上，<strong>${actionCard.code}｜${actionCard.name}</strong> 給你的建議是：<br>` +
      actionCard.actionHint
  );

  if (notes) {
    textParts.push(
      `<em>你補充的狀況：「${notes}」，可以當作第一輪搜尋的起點；如果這一輪沒找到，建議換一個場域再跑一次。</em>`
    );
  }

  interpretationContainer.innerHTML = textParts
    .map((t) => `<p>${t}</p>`)
    .join("");

  // 把這次抽牌的上下文存起來，讓回饋可以對應
  window.lastLostItemContext = {
    itemName,
    notes,
    cards,
    createdAt: new Date().toISOString()
  };

  resultSection.classList.remove("hidden");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
};

// ==============================
// 回饋表單送出
// ==============================
window.handleLostItemFeedbackForm = function handleLostItemFeedbackForm(event) {
  event.preventDefault();

  const ctx = window.lastLostItemContext;
  if (!ctx || !ctx.itemName) {
    alert("請先進行一次失物占卜，再填寫回饋。");
    return;
  }

  const form = event.target;
  const statusInput = form.querySelector('input[name="found-status"]:checked');
  const status = statusInput ? statusInput.value : null;
  const notes = document.getElementById("found-notes").value.trim();

  if (!status) {
    alert("請選擇「最後有找到」或「暫時還沒找到」。");
    return;
  }

  const record = {
    ...ctx,
    resultStatus: status, // found / not_found
    feedbackNote: notes,
    feedbackAt: new Date().toISOString()
  };

  saveLostItemFeedback(record);
  form.reset();

  alert("已將這次結果記錄在本機（僅存在這台裝置）。");
};
