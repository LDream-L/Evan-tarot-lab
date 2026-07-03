// Evan 修煉紀錄：瀏覽器本機保存、趨勢整理與匯出。
(function initPracticeTracker() {
  const STORAGE_KEY = "evanPracticeRecords.v1";
  const form = document.getElementById("practice-form");
  if (!form) return;

  const recordList = document.getElementById("practice-record-list");
  const summary = document.getElementById("practice-summary");
  const message = document.getElementById("practice-message");
  const modeLabel = document.getElementById("practice-form-mode");
  const recordIdInput = document.getElementById("practice-record-id");
  const weekInput = document.getElementById("practice-week");

  const fieldIds = [
    "practice-date", "practice-time", "practice-week", "practice-session-number",
    "practice-duration", "practice-audio-duration", "practice-willingness", "practice-mental",
    "practice-fatigue", "practice-anxiety", "practice-distraction", "practice-pace",
    "practice-thought-label", "practice-grounding", "practice-helpful-line", "practice-awkward-line",
    "practice-repeated", "practice-speed-notes", "practice-brow", "practice-body-sensation",
    "practice-dizziness", "practice-head-pressure", "practice-chest-tightness", "practice-nausea",
    "practice-floating", "practice-anxiety-rise", "practice-discomfort", "practice-grounding-help",
    "practice-first-word", "practice-first-image", "practice-first-emotion", "practice-first-body",
    "practice-interpretation", "practice-clear-after", "practice-recovery-seconds",
    "practice-best-reorientation", "practice-sudden-step", "practice-card",
    "practice-card-orientation", "practice-awake-for-tarot", "practice-tarot-match",
    "practice-tarot-mismatch", "practice-followup-event", "practice-after-30",
    "practice-sleep", "practice-next-day", "practice-willing-next", "practice-next-change"
  ];

  const labelMap = {
    "practice-date": "日期",
    "practice-time": "時間",
    "practice-week": "訓練週期",
    "practice-session-number": "本週第幾次",
    "practice-duration": "實際完成時間（分鐘）",
    "practice-audio-duration": "實際音檔長度（分鐘）",
    "practice-willingness": "願意開始",
    "practice-mental": "精神狀態",
    "practice-fatigue": "身體疲累",
    "practice-anxiety": "焦慮或躁動",
    "practice-distraction": "注意力最常跑去哪裡",
    "practice-pace": "整體速度",
    "practice-thought-label": "想法標記是否有效",
    "practice-grounding": "腳底是否能成為穩定錨點",
    "practice-helpful-line": "最有幫助的一句",
    "practice-awkward-line": "最出戲的一句",
    "practice-repeated": "覺得重複的地方",
    "practice-speed-notes": "太快／太慢的地方",
    "practice-brow": "眉心感覺",
    "practice-body-sensation": "其他身體感",
    "practice-dizziness": "頭暈",
    "practice-head-pressure": "頭脹",
    "practice-chest-tightness": "胸悶",
    "practice-nausea": "噁心",
    "practice-floating": "飄忽或不真實感",
    "practice-anxiety-rise": "焦慮升高",
    "practice-discomfort": "其他不舒服",
    "practice-grounding-help": "腳底注意力是否有幫助",
    "practice-first-word": "第一個字詞",
    "practice-first-image": "第一個畫面",
    "practice-first-emotion": "第一個情緒",
    "practice-first-body": "第一個身體感",
    "practice-interpretation": "後來自己補上的解釋",
    "practice-clear-after": "睜眼後是否清楚",
    "practice-recovery-seconds": "回到正常狀態（秒）",
    "practice-best-reorientation": "最有效的回神步驟",
    "practice-sudden-step": "仍然太突然的步驟",
    "practice-card": "抽到的牌",
    "practice-card-orientation": "正逆位",
    "practice-awake-for-tarot": "抽牌時是否完全清醒",
    "practice-tarot-match": "冥想與牌面一致處",
    "practice-tarot-mismatch": "冥想與牌面不一致處",
    "practice-followup-event": "後續實際事件",
    "practice-after-30": "30 分鐘後狀態",
    "practice-sleep": "當晚睡眠",
    "practice-next-day": "隔天狀態",
    "practice-willing-next": "下次是否願意再做",
    "practice-next-change": "最希望下一版修改的地方",
    "practice-no-content": "本次沒有明顯內容"
  };

  function getRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("Unable to parse practice records", error);
      return [];
    }
  }

  function saveRecords(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `practice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getTaipeiParts() {
    const iso = window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString().slice(0, 19);
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }

  function fillSeverityOptions() {
    document.querySelectorAll("select[data-severity]").forEach((select) => {
      select.innerHTML = `
        <option value="無">無</option>
        <option value="輕微">輕微</option>
        <option value="明顯">明顯</option>
      `;
    });
  }

  function bindRangeOutputs() {
    ["willingness", "mental", "fatigue", "anxiety"].forEach((name) => {
      const input = document.getElementById(`practice-${name}`);
      const output = document.getElementById(`practice-${name}-output`);
      const update = () => { output.textContent = input.value; };
      input.addEventListener("input", update);
      update();
    });
  }

  function resetForm({ keepWeek = true } = {}) {
    const selectedWeek = weekInput.value;
    form.reset();
    recordIdInput.value = "";
    modeLabel.textContent = "新增模式";
    fillSeverityOptions();
    if (keepWeek && selectedWeek) weekInput.value = selectedWeek;
    const now = getTaipeiParts();
    document.getElementById("practice-date").value = now.date;
    document.getElementById("practice-time").value = now.time;
    document.getElementById("practice-willingness").value = "10";
    document.getElementById("practice-mental").value = "5";
    document.getElementById("practice-fatigue").value = "5";
    document.getElementById("practice-anxiety").value = "5";
    ["willingness", "mental", "fatigue", "anxiety"].forEach((name) => {
      document.getElementById(`practice-${name}-output`).textContent = document.getElementById(`practice-${name}`).value;
    });
    message.textContent = "";
    message.classList.remove("is-error");
  }

  function readForm() {
    const data = {};
    fieldIds.forEach((id) => {
      const element = document.getElementById(id);
      data[id] = element.value.trim ? element.value.trim() : element.value;
    });
    data["practice-no-content"] = document.getElementById("practice-no-content").checked;
    return data;
  }

  function writeForm(record) {
    fieldIds.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.value = record.data?.[id] ?? "";
      if (element.type === "range") {
        const output = document.getElementById(`${id}-output`);
        if (output) output.textContent = element.value;
      }
    });
    document.getElementById("practice-no-content").checked = Boolean(record.data?.["practice-no-content"]);
    recordIdInput.value = record.id;
    modeLabel.textContent = "編輯模式";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }

  function numberValue(record, key) {
    const value = Number(record.data?.[key]);
    return Number.isFinite(value) ? value : null;
  }

  function average(values) {
    const valid = values.filter((value) => value !== null && Number.isFinite(value));
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function severityCount(records, key, level) {
    return records.filter((record) => record.data?.[key] === level).length;
  }

  function renderSummary() {
    const records = getRecords();
    if (!records.length) {
      summary.innerHTML = `<div class="practice-empty">尚未建立紀錄。</div>`;
      return;
    }

    const selectedWeek = weekInput.value;
    const filtered = records.filter((record) => record.data?.["practice-week"] === selectedWeek);
    const source = filtered.length ? filtered : records;
    const avgDuration = average(source.map((record) => numberValue(record, "practice-duration")));
    const avgRecovery = average(source.map((record) => numberValue(record, "practice-recovery-seconds")));
    const mildFloating = severityCount(source, "practice-floating", "輕微");
    const obviousFloating = severityCount(source, "practice-floating", "明顯");
    const contentCount = source.filter((record) => {
      const data = record.data || {};
      return data["practice-first-word"] || data["practice-first-image"] || data["practice-first-emotion"] || data["practice-first-body"];
    }).length;

    summary.innerHTML = `
      <div class="practice-summary-card"><small>${filtered.length ? selectedWeek : "全部週期"}紀錄數</small><strong>${source.length}</strong></div>
      <div class="practice-summary-card"><small>平均完成時間</small><strong>${avgDuration === null ? "—" : `${avgDuration.toFixed(1)} 分`}</strong></div>
      <div class="practice-summary-card"><small>平均回神時間</small><strong>${avgRecovery === null ? "—" : `${Math.round(avgRecovery)} 秒`}</strong></div>
      <div class="practice-summary-card"><small>有具體內容的次數</small><strong>${contentCount}／${source.length}</strong></div>
      <div class="practice-summary-card"><small>飄忽感</small><strong>輕微 ${mildFloating}／明顯 ${obviousFloating}</strong></div>
    `;
  }

  function safeText(value, fallback = "—") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function renderRecords() {
    const records = getRecords().sort((a, b) => `${b.data?.["practice-date"] || ""}${b.data?.["practice-time"] || ""}`.localeCompare(`${a.data?.["practice-date"] || ""}${a.data?.["practice-time"] || ""}`));
    recordList.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "practice-empty";
      empty.textContent = "尚未建立練習紀錄。";
      recordList.appendChild(empty);
      renderSummary();
      return;
    }

    records.forEach((record) => {
      const data = record.data || {};
      const card = document.createElement("article");
      card.className = "practice-record-card";

      const topline = document.createElement("div");
      topline.className = "practice-record-topline";
      const heading = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `${safeText(data["practice-date"], "未填日期")} ${safeText(data["practice-time"], "")}`.trim();
      const week = document.createElement("p");
      week.className = "practice-eyebrow";
      week.textContent = safeText(data["practice-week"], "未分類");
      heading.append(week, title);
      topline.appendChild(heading);

      const meta = document.createElement("div");
      meta.className = "practice-record-meta";
      [
        data["practice-duration"] ? `${data["practice-duration"]} 分鐘` : "未填時長",
        data["practice-pace"] || "未評節奏",
        data["practice-floating"] ? `飄忽：${data["practice-floating"]}` : "未填飄忽感"
      ].forEach((item) => {
        const span = document.createElement("span");
        span.textContent = item;
        meta.appendChild(span);
      });

      const body = document.createElement("div");
      body.className = "practice-record-body";
      [
        ["注意力", data["practice-distraction"]],
        ["眉心", data["practice-brow"]],
        ["第一內容", data["practice-first-word"] || data["practice-first-image"] || data["practice-first-emotion"] || data["practice-first-body"] || (data["practice-no-content"] ? "無明顯內容" : "未填")],
        ["回神", data["practice-recovery-seconds"] ? `${data["practice-recovery-seconds"]} 秒` : "未填"],
        ["有效步驟", data["practice-best-reorientation"]],
        ["希望修改", data["practice-next-change"]]
      ].forEach(([label, value]) => {
        const item = document.createElement("div");
        const small = document.createElement("small");
        const strong = document.createElement("strong");
        small.textContent = label;
        strong.textContent = safeText(value);
        item.append(small, strong);
        body.appendChild(item);
      });

      const actions = document.createElement("div");
      actions.className = "practice-record-actions";
      [
        ["edit", "編輯"],
        ["download", "下載單筆"],
        ["delete", "刪除"]
      ].forEach(([action, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action;
        button.dataset.id = record.id;
        button.textContent = label;
        actions.appendChild(button);
      });

      card.append(topline, meta, body, actions);
      recordList.appendChild(card);
    });
    renderSummary();
  }

  function fileSafe(value) {
    return String(value || "practice").replace(/[\\/:*?"<>|\s]+/g, "-");
  }

  function downloadText(filename, content, type = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function recordToText(record) {
    const data = record.data || {};
    const lines = [`【${safeText(data["practice-week"], "修煉紀錄")}｜${safeText(data["practice-date"], "未填日期")}】`];
    Object.entries(labelMap).forEach(([key, label]) => {
      const value = data[key];
      if (key === "practice-no-content") {
        if (value) lines.push(`${label}：是`);
        return;
      }
      if (value !== undefined && value !== null && String(value).trim() !== "") lines.push(`${label}：${value}`);
    });
    return lines.join("\n");
  }

  function weekFeedbackText(records, week) {
    const filtered = records.filter((record) => record.data?.["practice-week"] === week);
    const source = filtered.length ? filtered : records;
    const avgDuration = average(source.map((record) => numberValue(record, "practice-duration")));
    const avgRecovery = average(source.map((record) => numberValue(record, "practice-recovery-seconds")));
    const lines = [
      `EVAN 修煉回饋｜${filtered.length ? week : "全部週期"}`,
      `總計：${source.length} 次`,
      `平均完成時間：${avgDuration === null ? "未填" : `${avgDuration.toFixed(1)} 分鐘`}`,
      `平均回神時間：${avgRecovery === null ? "未填" : `${Math.round(avgRecovery)} 秒`}`,
      "",
      ...source.sort((a, b) => String(a.data?.["practice-date"] || "").localeCompare(String(b.data?.["practice-date"] || ""))).flatMap((record, index) => [
        `===== 第 ${index + 1} 次 =====`,
        recordToText(record),
        ""
      ])
    ];
    return lines.join("\n");
  }

  function toCsv(records) {
    const keys = [...fieldIds, "practice-no-content"];
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const header = keys.map((key) => escape(labelMap[key] || key)).join(",");
    const rows = records.map((record) => keys.map((key) => escape(record.data?.[key] ?? "")).join(","));
    return `\uFEFF${[header, ...rows].join("\r\n")}`;
  }

  async function confirmAction(text, title = "確認操作") {
    if (window.EvanDialog?.confirm) return window.EvanDialog.confirm(text, title);
    return window.confirm(text);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!document.getElementById("practice-date").value || !weekInput.value) {
      showMessage("請先填寫日期與訓練週期。", true);
      return;
    }

    const records = getRecords();
    const id = recordIdInput.value || createId();
    const existingIndex = records.findIndex((record) => record.id === id);
    const record = {
      id,
      createdAt: existingIndex >= 0 ? records[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: readForm()
    };
    if (existingIndex >= 0) records[existingIndex] = record;
    else records.push(record);
    saveRecords(records);
    showMessage(existingIndex >= 0 ? "紀錄已更新。" : "本次練習已保存。 ");
    renderRecords();
    resetForm({ keepWeek: true });
  });

  document.getElementById("practice-reset").addEventListener("click", () => resetForm({ keepWeek: true }));
  weekInput.addEventListener("change", renderSummary);

  recordList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const records = getRecords();
    const record = records.find((item) => item.id === button.dataset.id);
    if (!record) return;

    if (button.dataset.action === "edit") writeForm(record);
    if (button.dataset.action === "download") {
      const date = record.data?.["practice-date"] || "undated";
      downloadText(`EVAN-修煉紀錄-${fileSafe(date)}.txt`, recordToText(record));
    }
    if (button.dataset.action === "delete") {
      const confirmed = await confirmAction("刪除這筆練習紀錄？", "刪除紀錄");
      if (!confirmed) return;
      saveRecords(records.filter((item) => item.id !== record.id));
      renderRecords();
    }
  });

  document.getElementById("practice-export-feedback").addEventListener("click", () => {
    const records = getRecords();
    if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
    const week = weekInput.value;
    downloadText(`EVAN-${fileSafe(week)}-回饋給ChatGPT.txt`, weekFeedbackText(records, week));
  });

  document.getElementById("practice-export-csv").addEventListener("click", () => {
    const records = getRecords();
    if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
    downloadText("EVAN-修煉紀錄.csv", toCsv(records), "text/csv;charset=utf-8");
  });

  document.getElementById("practice-export-json").addEventListener("click", () => {
    const records = getRecords();
    if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
    downloadText("EVAN-修煉紀錄完整備份.json", JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2), "application/json;charset=utf-8");
  });

  document.getElementById("practice-import-json").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(incoming)) throw new Error("Invalid records");
      const confirmed = await confirmAction(`匯入 ${incoming.length} 筆紀錄並取代目前資料？`, "匯入備份");
      if (!confirmed) return;
      saveRecords(incoming);
      renderRecords();
      showMessage(`已匯入 ${incoming.length} 筆紀錄。`);
    } catch (error) {
      console.error(error);
      showMessage("無法讀取這份 JSON 備份。", true);
    } finally {
      event.target.value = "";
    }
  });

  document.getElementById("practice-delete-all").addEventListener("click", async () => {
    const records = getRecords();
    if (!records.length) return;
    const confirmed = await confirmAction("這會刪除目前瀏覽器內的全部修煉紀錄。建議先下載 JSON 備份。", "刪除全部紀錄");
    if (!confirmed) return;
    localStorage.removeItem(STORAGE_KEY);
    resetForm({ keepWeek: true });
    renderRecords();
  });

  fillSeverityOptions();
  bindRangeOutputs();
  resetForm({ keepWeek: false });
  renderRecords();
})();
