// Evan 修煉紀錄：本機保存、草稿自動保存、趨勢整理與匯出。
(function initPracticeTracker() {
  const STORAGE_KEY = "evanPracticeRecords.v1";
  const DRAFT_KEY = "evanPracticeDraft.v1";
  const SEEDED_KEY = "evanPracticeSeeded.v1";
  const form = document.getElementById("practice-form");
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const recordList = $("practice-record-list");
  const summary = $("practice-summary");
  const message = $("practice-message");
  const modeLabel = $("practice-form-mode");
  const recordIdInput = $("practice-record-id");
  const weekInput = $("practice-week");

  const fields = [
    ["practice-date", "日期"], ["practice-time", "時間"], ["practice-week", "訓練週期"],
    ["practice-session-number", "本週第幾次"], ["practice-duration", "實際完成時間（分鐘）"],
    ["practice-audio-duration", "實際音檔長度（分鐘）"], ["practice-willingness", "願意開始"],
    ["practice-mental", "精神狀態"], ["practice-fatigue", "身體疲累"], ["practice-anxiety", "焦慮或躁動"],
    ["practice-distraction", "注意力最常跑去哪裡"], ["practice-pace", "整體速度"],
    ["practice-thought-label", "想法標記是否有效"], ["practice-grounding", "腳底是否能成為穩定錨點"],
    ["practice-helpful-line", "最有幫助的一句"], ["practice-awkward-line", "最出戲的一句"],
    ["practice-repeated", "覺得重複的地方"], ["practice-speed-notes", "太快／太慢的地方"],
    ["practice-brow", "眉心感覺"], ["practice-body-sensation", "其他身體感"],
    ["practice-dizziness", "頭暈"], ["practice-head-pressure", "頭脹"],
    ["practice-chest-tightness", "胸悶"], ["practice-nausea", "噁心"],
    ["practice-floating", "飄忽或不真實感"], ["practice-anxiety-rise", "焦慮升高"],
    ["practice-discomfort", "其他不舒服"], ["practice-grounding-help", "腳底注意力是否有幫助"],
    ["practice-first-word", "第一個字詞"], ["practice-first-image", "第一個畫面"],
    ["practice-first-emotion", "第一個情緒"], ["practice-first-body", "第一個身體感"],
    ["practice-interpretation", "後來自己補上的解釋"], ["practice-clear-after", "睜眼後是否清楚"],
    ["practice-recovery-seconds", "回到正常狀態（秒）"], ["practice-best-reorientation", "最有效的回神步驟"],
    ["practice-sudden-step", "仍然太突然的步驟"], ["practice-card", "抽到的牌"],
    ["practice-card-orientation", "正逆位"], ["practice-awake-for-tarot", "抽牌時是否完全清醒"],
    ["practice-tarot-match", "冥想與牌面一致處"], ["practice-tarot-mismatch", "冥想與牌面不一致處"],
    ["practice-followup-event", "後續實際事件"], ["practice-after-30", "30 分鐘後狀態"],
    ["practice-sleep", "當晚睡眠"], ["practice-next-day", "隔天狀態"],
    ["practice-willing-next", "下次是否願意再做"], ["practice-next-change", "最希望下一版修改的地方"]
  ];
  const fieldIds = fields.map(([id]) => id);
  const labelMap = Object.fromEntries([...fields, ["practice-no-content", "本次沒有明顯內容"]]);

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

  function createId(prefix = "practice") {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function nowParts() {
    const iso = window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString().slice(0, 19);
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }

  function fillSeverityOptions() {
    document.querySelectorAll("select[data-severity]").forEach((select) => {
      select.innerHTML = '<option value="無">無</option><option value="輕微">輕微</option><option value="明顯">明顯</option>';
    });
  }

  function updateRangeOutputs() {
    ["willingness", "mental", "fatigue", "anxiety"].forEach((name) => {
      const input = $(`practice-${name}`);
      const output = $(`practice-${name}-output`);
      if (input && output) output.textContent = input.value;
    });
  }

  function readForm() {
    const data = {};
    fieldIds.forEach((id) => { data[id] = $(id)?.value?.trim?.() ?? $(id)?.value ?? ""; });
    data["practice-no-content"] = $("practice-no-content").checked;
    return data;
  }

  function writeData(data = {}) {
    fieldIds.forEach((id) => {
      if ($(id)) $(id).value = data[id] ?? "";
    });
    $("practice-no-content").checked = Boolean(data["practice-no-content"]);
    updateRangeOutputs();
  }

  function resetForm({ keepWeek = true, clearDraft = true } = {}) {
    const currentWeek = weekInput.value;
    form.reset();
    fillSeverityOptions();
    recordIdInput.value = "";
    modeLabel.textContent = "新增模式";
    if (keepWeek && currentWeek) weekInput.value = currentWeek;
    const now = nowParts();
    $("practice-date").value = now.date;
    $("practice-time").value = now.time;
    $("practice-willingness").value = "10";
    $("practice-mental").value = "5";
    $("practice-fatigue").value = "5";
    $("practice-anxiety").value = "5";
    updateRangeOutputs();
    if (clearDraft) localStorage.removeItem(DRAFT_KEY);
  }

  function saveDraft() {
    const draft = { id: recordIdInput.value, data: readForm(), savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!draft?.data) return false;
      writeData(draft.data);
      recordIdInput.value = draft.id || "";
      modeLabel.textContent = draft.id ? "編輯草稿" : "未送出草稿";
      return true;
    } catch (error) {
      localStorage.removeItem(DRAFT_KEY);
      return false;
    }
  }

  function seedFirstWeekRecords() {
    if (localStorage.getItem(SEEDED_KEY)) return;
    if (!getRecords().length) {
      const base = {
        "practice-week": "第1週｜V8 基礎訓練",
        "practice-duration": "6",
        "practice-audio-duration": "6",
        "practice-willingness": "10",
        "practice-distraction": "思維",
        "practice-pace": "太快",
        "practice-helpful-line": "讓呼吸回到腳底",
        "practice-brow": "脹脹的",
        "practice-dizziness": "無",
        "practice-head-pressure": "無",
        "practice-chest-tightness": "無",
        "practice-nausea": "無",
        "practice-floating": "輕微",
        "practice-anxiety-rise": "無",
        "practice-clear-after": "是",
        "practice-recovery-seconds": "30",
        "practice-best-reorientation": "左看右看",
        "practice-no-content": true
      };
      const entries = [
        ["2026-06-29", "6", "6", "6", "1"],
        ["2026-07-01", "6", "6", "7", "2"],
        ["2026-07-02", "7", "7", "7", "3"]
      ].map(([date, mental, fatigue, anxiety, session]) => ({
        id: createId("seed"),
        createdAt: `${date}T12:00:00.000Z`,
        updatedAt: `${date}T12:00:00.000Z`,
        data: {
          ...Object.fromEntries(fieldIds.map((id) => [id, ""])),
          ...base,
          "practice-date": date,
          "practice-session-number": session,
          "practice-mental": mental,
          "practice-fatigue": fatigue,
          "practice-anxiety": anxiety
        }
      }));
      saveRecords(entries);
    }
    localStorage.setItem(SEEDED_KEY, "1");
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }

  function numeric(record, key) {
    const raw = record.data?.[key];
    if (raw === "" || raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function average(values) {
    const valid = values.filter((value) => value !== null && Number.isFinite(value));
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function safeText(value, fallback = "—") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function recordsForSelectedWeek(records) {
    const filtered = records.filter((record) => record.data?.["practice-week"] === weekInput.value);
    return { records: filtered.length ? filtered : records, exact: filtered.length > 0 };
  }

  function renderSummary() {
    const all = getRecords();
    if (!all.length) {
      summary.innerHTML = '<div class="practice-empty">尚未建立紀錄。</div>';
      return;
    }
    const selected = recordsForSelectedWeek(all);
    const source = selected.records;
    const avgDuration = average(source.map((record) => numeric(record, "practice-duration")));
    const avgRecovery = average(source.map((record) => numeric(record, "practice-recovery-seconds")));
    const mildFloating = source.filter((record) => record.data?.["practice-floating"] === "輕微").length;
    const obviousFloating = source.filter((record) => record.data?.["practice-floating"] === "明顯").length;
    const contentCount = source.filter((record) => ["practice-first-word", "practice-first-image", "practice-first-emotion", "practice-first-body"].some((key) => record.data?.[key])).length;
    summary.innerHTML = `
      <div class="practice-summary-card"><small>${selected.exact ? weekInput.value : "全部週期"}紀錄數</small><strong>${source.length}</strong></div>
      <div class="practice-summary-card"><small>平均完成時間</small><strong>${avgDuration === null ? "—" : `${avgDuration.toFixed(1)} 分`}</strong></div>
      <div class="practice-summary-card"><small>平均回神時間</small><strong>${avgRecovery === null ? "—" : `${Math.round(avgRecovery)} 秒`}</strong></div>
      <div class="practice-summary-card"><small>有具體內容的次數</small><strong>${contentCount}／${source.length}</strong></div>
      <div class="practice-summary-card"><small>飄忽感</small><strong>輕微 ${mildFloating}／明顯 ${obviousFloating}</strong></div>`;
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
      const top = document.createElement("div");
      top.className = "practice-record-topline";
      const head = document.createElement("div");
      const week = document.createElement("p");
      week.className = "practice-eyebrow";
      week.textContent = safeText(data["practice-week"], "未分類");
      const title = document.createElement("h3");
      title.textContent = `${safeText(data["practice-date"], "未填日期")} ${safeText(data["practice-time"], "")}`.trim();
      head.append(week, title);
      top.appendChild(head);

      const meta = document.createElement("div");
      meta.className = "practice-record-meta";
      [data["practice-duration"] ? `${data["practice-duration"]} 分鐘` : "未填時長", data["practice-pace"] || "未評節奏", `飄忽：${data["practice-floating"] || "未填"}`].forEach((text) => {
        const span = document.createElement("span");
        span.textContent = text;
        meta.appendChild(span);
      });

      const body = document.createElement("div");
      body.className = "practice-record-body";
      const firstContent = data["practice-first-word"] || data["practice-first-image"] || data["practice-first-emotion"] || data["practice-first-body"] || (data["practice-no-content"] ? "無明顯內容" : "未填");
      [["注意力", data["practice-distraction"]], ["眉心", data["practice-brow"]], ["第一內容", firstContent], ["回神", data["practice-recovery-seconds"] ? `${data["practice-recovery-seconds"]} 秒` : "未填"], ["有效步驟", data["practice-best-reorientation"]], ["希望修改", data["practice-next-change"]]].forEach(([label, value]) => {
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
      [["edit", "編輯"], ["download", "下載單筆"], ["delete", "刪除"]].forEach(([action, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action;
        button.dataset.id = record.id;
        button.textContent = label;
        actions.appendChild(button);
      });
      card.append(top, meta, body, actions);
      recordList.appendChild(card);
    });
    renderSummary();
  }

  function fileSafe(value) {
    return String(value || "practice").replace(/[\\/:*?"<>|\s]+/g, "-");
  }

  function download(filename, content, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([content], { type }));
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
      } else if (value !== undefined && value !== null && String(value).trim() !== "") {
        lines.push(`${label}：${value}`);
      }
    });
    return lines.join("\n");
  }

  function feedbackText(records) {
    const selected = recordsForSelectedWeek(records);
    const source = [...selected.records].sort((a, b) => String(a.data?.["practice-date"] || "").localeCompare(String(b.data?.["practice-date"] || "")));
    const avgDuration = average(source.map((record) => numeric(record, "practice-duration")));
    const avgRecovery = average(source.map((record) => numeric(record, "practice-recovery-seconds")));
    return [
      `EVAN 修煉回饋｜${selected.exact ? weekInput.value : "全部週期"}`,
      `總計：${source.length} 次`,
      `平均完成時間：${avgDuration === null ? "未填" : `${avgDuration.toFixed(1)} 分鐘`}`,
      `平均回神時間：${avgRecovery === null ? "未填" : `${Math.round(avgRecovery)} 秒`}`,
      "",
      ...source.flatMap((record, index) => [`===== 第 ${index + 1} 次 =====`, recordToText(record), ""])
    ].join("\n");
  }

  function toCsv(records) {
    const keys = [...fieldIds, "practice-no-content"];
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return `\uFEFF${[keys.map((key) => escape(labelMap[key] || key)).join(","), ...records.map((record) => keys.map((key) => escape(record.data?.[key] ?? "")).join(","))].join("\r\n")}`;
  }

  async function confirmAction(text, title = "確認操作") {
    if (window.EvanDialog?.confirm) return window.EvanDialog.confirm(text, title);
    return window.confirm(text);
  }

  form.addEventListener("input", () => { updateRangeOutputs(); saveDraft(); });
  form.addEventListener("change", saveDraft);
  weekInput.addEventListener("change", renderSummary);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("practice-date").value || !weekInput.value) return showMessage("請先填寫日期與訓練週期。", true);
    const records = getRecords();
    const id = recordIdInput.value || createId();
    const index = records.findIndex((record) => record.id === id);
    const record = { id, createdAt: index >= 0 ? records[index].createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(), data: readForm() };
    if (index >= 0) records[index] = record; else records.push(record);
    saveRecords(records);
    localStorage.removeItem(DRAFT_KEY);
    resetForm({ keepWeek: true, clearDraft: false });
    renderRecords();
    showMessage(index >= 0 ? "紀錄已更新。" : "本次練習已保存。");
  });

  $("practice-reset").addEventListener("click", () => { resetForm({ keepWeek: true }); showMessage("表單已清空。"); });

  recordList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const records = getRecords();
    const record = records.find((item) => item.id === button.dataset.id);
    if (!record) return;
    if (button.dataset.action === "edit") {
      writeData(record.data);
      recordIdInput.value = record.id;
      modeLabel.textContent = "編輯模式";
      saveDraft();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (button.dataset.action === "download") download(`EVAN-修煉紀錄-${fileSafe(record.data?.["practice-date"] || "undated")}.txt`, recordToText(record));
    if (button.dataset.action === "delete") {
      if (!await confirmAction("刪除這筆練習紀錄？", "刪除紀錄")) return;
      saveRecords(records.filter((item) => item.id !== record.id));
      renderRecords();
    }
  });

  $("practice-export-feedback").addEventListener("click", () => {
    const records = getRecords();
    if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
    download(`EVAN-${fileSafe(weekInput.value)}-回饋給ChatGPT.txt`, feedbackText(records));
  });
  $("practice-export-csv").addEventListener("click", () => {
    const records = getRecords();
    if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
    download("EVAN-修煉紀錄.csv", toCsv(records), "text/csv;charset=utf-8");
  });
  $("practice-export-json").addEventListener("click", () => {
    const records = getRecords();
    if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
    download("EVAN-修煉紀錄完整備份.json", JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2), "application/json;charset=utf-8");
  });

  $("practice-import-json").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(incoming)) throw new Error("Invalid records");
      if (!await confirmAction(`匯入 ${incoming.length} 筆紀錄並取代目前資料？`, "匯入備份")) return;
      saveRecords(incoming);
      localStorage.setItem(SEEDED_KEY, "1");
      renderRecords();
      showMessage(`已匯入 ${incoming.length} 筆紀錄。`);
    } catch (error) {
      console.error(error);
      showMessage("無法讀取這份 JSON 備份。", true);
    } finally {
      event.target.value = "";
    }
  });

  $("practice-delete-all").addEventListener("click", async () => {
    if (!getRecords().length) return;
    if (!await confirmAction("這會刪除目前瀏覽器內的全部修煉紀錄。建議先下載 JSON 備份。", "刪除全部紀錄")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(SEEDED_KEY, "1");
    resetForm({ keepWeek: true });
    renderRecords();
  });

  fillSeverityOptions();
  ["willingness", "mental", "fatigue", "anxiety"].forEach((name) => $(`practice-${name}`).addEventListener("input", updateRangeOutputs));
  seedFirstWeekRecords();
  if (!loadDraft()) resetForm({ keepWeek: false, clearDraft: false });
  renderRecords();
})();
