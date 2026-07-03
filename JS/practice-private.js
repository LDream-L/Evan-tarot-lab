// Evan 修煉紀錄：私人解鎖後啟用，本機保存並同步到 Google Sheet。
(function preparePracticeTracker() {
  let initialized = false;

  window.addEventListener("practice:unlocked", initPracticeTracker, { once: true });
  if (window.EvanPracticeAuth?.isUnlocked()) initPracticeTracker();

  function initPracticeTracker() {
    if (initialized) return;
    initialized = true;

    const STORAGE_KEY = "evanPracticeRecords.v2";
    const LEGACY_STORAGE_KEY = "evanPracticeRecords.v1";
    const DRAFT_KEY = "evanPracticeDraft.v2";
    const configs = window.EvanPracticeWeekConfigs || {};
    const defaultWeekKey = window.EvanPracticeDefaultWeekKey || Object.keys(configs)[0] || "";
    const form = document.getElementById("practice-form");
    if (!form) return;

    const $ = (id) => document.getElementById(id);
    const recordList = $("practice-record-list");
    const summary = $("practice-summary");
    const message = $("practice-message");
    const cloudStatus = $("practice-cloud-status");
    const modeLabel = $("practice-form-mode");
    const recordIdInput = $("practice-record-id");
    const weekInput = $("practice-week");
    const weekFields = $("practice-week-fields");

    const coreFields = [
      ["practice-date", "日期"], ["practice-time", "時間"], ["practice-week", "訓練週期"],
      ["practice-session-number", "本週第幾次"], ["practice-duration", "實際完成時間（分鐘）"],
      ["practice-audio-duration", "實際音檔長度（分鐘）"], ["practice-willingness", "願意開始"],
      ["practice-mental", "精神狀態"], ["practice-fatigue", "身體疲累"], ["practice-anxiety", "焦慮或躁動"],
      ["practice-distraction", "注意力最常跑去哪裡"], ["practice-pace", "整體速度"],
      ["practice-helpful-line", "最有幫助的一句"], ["practice-awkward-line", "最出戲的一句"],
      ["practice-brow", "眉心感覺"], ["practice-body-sensation", "其他身體感"],
      ["practice-dizziness", "頭暈"], ["practice-head-pressure", "頭脹"],
      ["practice-chest-tightness", "胸悶"], ["practice-nausea", "噁心"],
      ["practice-floating", "飄忽或不真實感"], ["practice-anxiety-rise", "焦慮升高"],
      ["practice-discomfort", "其他不舒服"], ["practice-first-word", "第一個字詞"],
      ["practice-first-image", "第一個畫面"], ["practice-first-emotion", "第一個情緒"],
      ["practice-first-body", "第一個身體感"], ["practice-interpretation", "後來自己補上的解釋"],
      ["practice-clear-after", "睜眼後是否清楚"], ["practice-recovery-seconds", "回到正常狀態（秒）"],
      ["practice-best-reorientation", "最有效的回神步驟"], ["practice-sudden-step", "仍然太突然的步驟"],
      ["practice-card", "抽到的牌"], ["practice-card-orientation", "正逆位"],
      ["practice-awake-for-tarot", "抽牌時是否完全清醒"], ["practice-tarot-match", "冥想與牌面一致處"],
      ["practice-tarot-mismatch", "冥想與牌面不一致處"], ["practice-followup-event", "後續實際事件"],
      ["practice-after-30", "30 分鐘後狀態"], ["practice-sleep", "當晚睡眠"],
      ["practice-next-day", "隔天狀態"], ["practice-willing-next", "下次是否願意再做"],
      ["practice-next-change", "最希望下一版修改的地方"]
    ];
    const coreFieldIds = coreFields.map(([id]) => id);
    const coreLabelMap = Object.fromEntries([...coreFields, ["practice-no-content", "本次沒有明顯內容"]]);

    function createId(prefix = "practice") {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();
      return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function nowParts() {
      const iso = window.nowTaipeiISO ? window.nowTaipeiISO() : new Date().toISOString().slice(0, 19);
      return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
    }

    function safeText(value, fallback = "—") {
      const text = String(value ?? "").trim();
      return text || fallback;
    }

    function currentConfig() {
      return configs[weekInput.value] || configs[defaultWeekKey] || null;
    }

    function configByLegacyLabel(label) {
      return Object.values(configs).find((config) => config.label === label) || null;
    }

    // Time O(n), space O(n), where n is record count.
    function getRecords() {
      try {
        const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (Array.isArray(current)) return current;
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
        if (!Array.isArray(legacy) || !legacy.length) return [];
        const migrated = legacy.map(migrateLegacyRecord);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      } catch (error) {
        console.error("Unable to parse practice records", error);
        return [];
      }
    }

    // Time O(n), space O(n). Local storage is retained as an offline fallback before cloud sync.
    function saveRecords(records) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }

    function migrateLegacyRecord(record) {
      if (record?.weekKey) return record;
      const data = record?.data || {};
      const config = configByLegacyLabel(data["practice-week"]) || configs[defaultWeekKey];
      const weekDetails = {};
      if (config?.key === "week-1-v8") {
        weekDetails.breathToFeetHelpful = data["practice-helpful-line"] ? "有" : "";
        weekDetails.repeatedSection = data["practice-repeated"] || "";
        weekDetails.speedSection = data["practice-speed-notes"] || "";
        weekDetails.reorientationEffective = data["practice-best-reorientation"] ? "有效" : "";
        weekDetails.suddenStep = data["practice-sudden-step"] || "";
      }
      if (config?.key === "week-2-v9") {
        weekDetails.thoughtLabelEffective = data["practice-thought-label"] || "";
        weekDetails.groundingStable = data["practice-grounding"] || "";
        weekDetails.groundingReducedFloating = data["practice-grounding-help"] || "";
        weekDetails.rawFeeling = data["practice-first-word"] || data["practice-first-image"] || data["practice-first-emotion"] || data["practice-first-body"] || "";
        weekDetails.laterInterpretation = data["practice-interpretation"] || "";
      }
      return {
        ...record,
        weekKey: config?.key || defaultWeekKey,
        weekLabel: config?.label || data["practice-week"] || "未分類",
        version: config?.version || "",
        weekDetails
      };
    }

    function fillSeverityOptions() {
      document.querySelectorAll("select[data-severity]").forEach((select) => {
        const current = select.value;
        select.replaceChildren(...["無", "輕微", "明顯"].map((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          return option;
        }));
        if (current) select.value = current;
      });
    }

    function updateRangeOutputs() {
      ["willingness", "mental", "fatigue", "anxiety"].forEach((name) => {
        const input = $(`practice-${name}`);
        const output = $(`practice-${name}-output`);
        if (input && output) output.textContent = input.value;
      });
    }

    function populateWeekSelect() {
      weekInput.replaceChildren();
      Object.values(configs)
        .sort((left, right) => left.weekNumber - right.weekNumber)
        .forEach((config) => {
          const option = document.createElement("option");
          option.value = config.key;
          option.textContent = config.label;
          weekInput.appendChild(option);
        });
      weekInput.value = defaultWeekKey;
    }

    function createWeekField(field) {
      const label = document.createElement("label");
      label.dataset.weekField = field.key;
      if (field.span === 2) label.classList.add("practice-span-2");
      label.append(document.createTextNode(field.label));

      let input;
      if (field.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = field.rows || 3;
      } else if (field.type === "select") {
        input = document.createElement("select");
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "請選擇";
        input.appendChild(empty);
        (field.options || []).forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          input.appendChild(option);
        });
      } else {
        input = document.createElement("input");
        input.type = field.type === "number" ? "number" : "text";
      }
      input.id = `practice-week-${field.key}`;
      input.dataset.weekFieldInput = field.key;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.placeholder) input.placeholder = field.placeholder;
      label.appendChild(input);
      return label;
    }

    // Time O(f), space O(f), where f is the current week's field count.
    function renderWeekInterface(details = {}) {
      const config = currentConfig();
      if (!config) return;
      $("practice-week-title").textContent = config.title;
      $("practice-week-version").textContent = config.version;
      $("practice-week-objective").textContent = config.objective;
      $("practice-week-audio").textContent = config.audio;
      $("practice-week-frequency").textContent = config.frequency;
      const criteria = $("practice-week-next-criteria");
      criteria.replaceChildren(...config.nextCriteria.map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      }));
      $("practice-week-specific-title").textContent = `${config.label}｜專屬回饋`;
      weekFields.replaceChildren(...config.fields.map(createWeekField));
      config.fields.forEach((field) => {
        const input = $(`practice-week-${field.key}`);
        if (input) input.value = details[field.key] ?? "";
      });
    }

    function readCoreForm() {
      const data = {};
      coreFieldIds.forEach((id) => {
        const element = $(id);
        data[id] = element?.value?.trim?.() ?? element?.value ?? "";
      });
      data["practice-no-content"] = $("practice-no-content").checked;
      return data;
    }

    function readWeekDetails() {
      const config = currentConfig();
      const details = {};
      (config?.fields || []).forEach((field) => {
        const input = $(`practice-week-${field.key}`);
        details[field.key] = input?.value?.trim?.() ?? input?.value ?? "";
      });
      return details;
    }

    function writeCoreData(data = {}) {
      coreFieldIds.forEach((id) => {
        if ($(id)) $(id).value = data[id] ?? "";
      });
      $("practice-no-content").checked = Boolean(data["practice-no-content"]);
      fillSeverityOptions();
      updateRangeOutputs();
    }

    function writeRecord(record = {}) {
      const data = record.data || {};
      const config = configs[record.weekKey] || configByLegacyLabel(data["practice-week"]) || configs[defaultWeekKey];
      weekInput.value = config?.key || defaultWeekKey;
      renderWeekInterface(record.weekDetails || {});
      writeCoreData(data);
      weekInput.value = config?.key || defaultWeekKey;
    }

    function resetForm({ keepWeek = true, clearDraft = true } = {}) {
      const currentWeek = keepWeek ? weekInput.value : defaultWeekKey;
      form.reset();
      fillSeverityOptions();
      recordIdInput.value = "";
      modeLabel.textContent = "新增模式";
      weekInput.value = configs[currentWeek] ? currentWeek : defaultWeekKey;
      renderWeekInterface();
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

    function currentDraft() {
      const config = currentConfig();
      return {
        id: recordIdInput.value,
        weekKey: config?.key || weekInput.value,
        weekLabel: config?.label || "",
        version: config?.version || "",
        data: readCoreForm(),
        weekDetails: readWeekDetails(),
        savedAt: new Date().toISOString()
      };
    }

    function saveDraft() {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(currentDraft()));
    }

    function loadDraft() {
      try {
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
        if (!draft?.data) return false;
        writeRecord(draft);
        recordIdInput.value = draft.id || "";
        modeLabel.textContent = draft.id ? "編輯草稿" : "未送出草稿";
        return true;
      } catch (_) {
        localStorage.removeItem(DRAFT_KEY);
        return false;
      }
    }

    function showMessage(text, isError = false) {
      message.textContent = text;
      message.classList.toggle("is-error", isError);
    }

    function setCloudStatus(text, isError = false) {
      cloudStatus.textContent = text;
      cloudStatus.classList.toggle("is-error", isError);
    }

    function numeric(record, key) {
      const raw = record.data?.[key];
      if (raw === "" || raw === null || raw === undefined) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }

    function recordsForSelectedWeek(records) {
      const filtered = records.filter((record) => record.weekKey === weekInput.value);
      return { records: filtered.length ? filtered : records, exact: filtered.length > 0 };
    }

    // Time O(n), space O(1). Metrics are accumulated in one pass to avoid repeated filtering.
    function renderSummary() {
      const all = getRecords();
      if (!all.length) {
        summary.innerHTML = '<div class="practice-empty">尚未建立紀錄。</div>';
        return;
      }
      const selected = recordsForSelectedWeek(all);
      const source = selected.records;
      let durationSum = 0;
      let durationCount = 0;
      let recoverySum = 0;
      let recoveryCount = 0;
      let mildFloating = 0;
      let obviousFloating = 0;
      let contentCount = 0;

      source.forEach((record) => {
        const duration = numeric(record, "practice-duration");
        const recovery = numeric(record, "practice-recovery-seconds");
        if (duration !== null) { durationSum += duration; durationCount += 1; }
        if (recovery !== null) { recoverySum += recovery; recoveryCount += 1; }
        if (record.data?.["practice-floating"] === "輕微") mildFloating += 1;
        if (record.data?.["practice-floating"] === "明顯") obviousFloating += 1;
        if (["practice-first-word", "practice-first-image", "practice-first-emotion", "practice-first-body"].some((key) => record.data?.[key])) contentCount += 1;
      });

      const avgDuration = durationCount ? durationSum / durationCount : null;
      const avgRecovery = recoveryCount ? recoverySum / recoveryCount : null;
      const label = selected.exact ? currentConfig()?.label : "全部週期";
      summary.innerHTML = `
        <div class="practice-summary-card"><small>${label}紀錄數</small><strong>${source.length}</strong></div>
        <div class="practice-summary-card"><small>平均完成時間</small><strong>${avgDuration === null ? "—" : `${avgDuration.toFixed(1)} 分`}</strong></div>
        <div class="practice-summary-card"><small>平均回神時間</small><strong>${avgRecovery === null ? "—" : `${Math.round(avgRecovery)} 秒`}</strong></div>
        <div class="practice-summary-card"><small>有具體內容的次數</small><strong>${contentCount}／${source.length}</strong></div>
        <div class="practice-summary-card"><small>飄忽感</small><strong>輕微 ${mildFloating}／明顯 ${obviousFloating}</strong></div>`;
    }

    function appendTextElement(parent, tagName, text, className = "") {
      const element = document.createElement(tagName);
      if (className) element.className = className;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    }

    // Time O(n log n), space O(n) because records are copied and sorted for display.
    function renderRecords() {
      const records = [...getRecords()].sort((left, right) => {
        const a = `${left.data?.["practice-date"] || ""}${left.data?.["practice-time"] || ""}`;
        const b = `${right.data?.["practice-date"] || ""}${right.data?.["practice-time"] || ""}`;
        return b.localeCompare(a);
      });
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
        const heading = document.createElement("div");
        appendTextElement(heading, "p", record.weekLabel || configs[record.weekKey]?.label || "未分類", "practice-eyebrow");
        appendTextElement(heading, "h3", `${safeText(data["practice-date"], "未填日期")} ${safeText(data["practice-time"], "")}`.trim());
        top.appendChild(heading);

        const meta = document.createElement("div");
        meta.className = "practice-record-meta";
        [data["practice-duration"] ? `${data["practice-duration"]} 分鐘` : "未填時長", data["practice-pace"] || "未評節奏", `飄忽：${data["practice-floating"] || "未填"}`].forEach((text) => appendTextElement(meta, "span", text));

        const body = document.createElement("div");
        body.className = "practice-record-body";
        const firstContent = data["practice-first-word"] || data["practice-first-image"] || data["practice-first-emotion"] || data["practice-first-body"] || (data["practice-no-content"] ? "無明顯內容" : "未填");
        [["注意力", data["practice-distraction"]], ["眉心", data["practice-brow"]], ["第一內容", firstContent], ["回神", data["practice-recovery-seconds"] ? `${data["practice-recovery-seconds"]} 秒` : "未填"], ["版本", record.version], ["希望修改", data["practice-next-change"]]].forEach(([label, value]) => {
          const item = document.createElement("div");
          appendTextElement(item, "small", label);
          appendTextElement(item, "strong", safeText(value));
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
      const config = configs[record.weekKey];
      const lines = [`【${record.weekLabel || config?.label || "修煉紀錄"}｜${safeText(data["practice-date"], "未填日期")}】`];
      coreFields.forEach(([key, label]) => {
        const value = data[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") lines.push(`${label}：${value}`);
      });
      if (data["practice-no-content"]) lines.push(`${coreLabelMap["practice-no-content"]}：是`);
      if (config?.fields?.length) {
        lines.push("", `【${config.label}專屬回饋】`);
        config.fields.forEach((field) => {
          const value = record.weekDetails?.[field.key];
          if (value !== undefined && value !== null && String(value).trim() !== "") lines.push(`${field.label}：${value}`);
        });
      }
      return lines.join("\n");
    }

    // Time O(n log n), space O(n) because selected records are sorted once.
    function feedbackText(records) {
      const selected = recordsForSelectedWeek(records);
      const source = [...selected.records].sort((a, b) => String(a.data?.["practice-date"] || "").localeCompare(String(b.data?.["practice-date"] || "")));
      let durationSum = 0;
      let durationCount = 0;
      let recoverySum = 0;
      let recoveryCount = 0;
      source.forEach((record) => {
        const duration = numeric(record, "practice-duration");
        const recovery = numeric(record, "practice-recovery-seconds");
        if (duration !== null) { durationSum += duration; durationCount += 1; }
        if (recovery !== null) { recoverySum += recovery; recoveryCount += 1; }
      });
      return [
        `EVAN 修煉回饋｜${selected.exact ? currentConfig()?.label : "全部週期"}`,
        `總計：${source.length} 次`,
        `平均完成時間：${durationCount ? `${(durationSum / durationCount).toFixed(1)} 分鐘` : "未填"}`,
        `平均回神時間：${recoveryCount ? `${Math.round(recoverySum / recoveryCount)} 秒` : "未填"}`,
        "",
        ...source.flatMap((record, index) => [`===== 第 ${index + 1} 次 =====`, recordToText(record), ""])
      ].join("\n");
    }

    function toCsv(records) {
      const keys = [...coreFieldIds, "practice-no-content"];
      const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const headers = ["週次代碼", "週次名稱", "版本", ...keys.map((key) => coreLabelMap[key] || key), "週次專屬回饋 JSON"];
      const rows = [headers.map(escape).join(",")];
      records.forEach((record) => {
        const values = [record.weekKey, record.weekLabel, record.version, ...keys.map((key) => record.data?.[key] ?? ""), JSON.stringify(record.weekDetails || {})];
        rows.push(values.map(escape).join(","));
      });
      return `\uFEFF${rows.join("\r\n")}`;
    }

    async function confirmAction(text, title = "確認操作") {
      if (window.EvanDialog?.confirm) return window.EvanDialog.confirm(text, title);
      return window.confirm(text);
    }

    async function cloudRequest(payload) {
      const auth = window.EvanPracticeAuth;
      const config = auth?.getConfig();
      if (!auth || !config) throw new Error("私人連線已失效，請重新登入。");
      return auth.postJson(config.url, { ...payload, accessKey: config.accessKey });
    }

    async function syncRecord(record) {
      setCloudStatus("正在同步 Google Sheet…");
      const result = await cloudRequest({ action: "upsert", record });
      setCloudStatus(`Google Sheet 已同步：第 ${result.row || "—"} 列`);
      return result;
    }

    async function deleteCloudRecord(id) {
      setCloudStatus("正在刪除 Google Sheet 紀錄…");
      await cloudRequest({ action: "delete", recordId: id });
      setCloudStatus("Google Sheet 紀錄已刪除。");
    }

    form.addEventListener("input", () => { updateRangeOutputs(); saveDraft(); });
    form.addEventListener("change", saveDraft);
    weekInput.addEventListener("change", () => {
      renderWeekInterface();
      renderSummary();
      saveDraft();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!$("practice-date").value || !weekInput.value) return showMessage("請先填寫日期與訓練週期。", true);
      const config = currentConfig();
      const records = getRecords();
      const id = recordIdInput.value || createId();
      const index = records.findIndex((record) => record.id === id);
      const record = {
        id,
        createdAt: index >= 0 ? records[index].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        weekKey: config?.key || weekInput.value,
        weekLabel: config?.label || weekInput.value,
        version: config?.version || "",
        data: readCoreForm(),
        weekDetails: readWeekDetails()
      };
      if (index >= 0) records[index] = record;
      else records.push(record);
      saveRecords(records);
      localStorage.removeItem(DRAFT_KEY);
      resetForm({ keepWeek: true, clearDraft: false });
      renderRecords();
      showMessage(index >= 0 ? "本機紀錄已更新，正在同步。" : "本機紀錄已保存，正在同步。");
      try {
        await syncRecord(record);
        showMessage(index >= 0 ? "紀錄已更新並同步到 Google Sheet。" : "本次練習已保存並同步到 Google Sheet。");
      } catch (error) {
        console.error(error);
        setCloudStatus(`同步失敗：${error.message}`, true);
        showMessage("本機已保存，但 Google Sheet 同步失敗。請保留本頁並重新測試連線。", true);
      }
    });

    $("practice-reset").addEventListener("click", () => {
      resetForm({ keepWeek: true });
      showMessage("表單已清空。");
    });

    recordList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const records = getRecords();
      const record = records.find((item) => item.id === button.dataset.id);
      if (!record) return;
      if (button.dataset.action === "edit") {
        writeRecord(record);
        recordIdInput.value = record.id;
        modeLabel.textContent = "編輯模式";
        saveDraft();
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (button.dataset.action === "download") {
        download(`EVAN-修煉紀錄-${fileSafe(record.data?.["practice-date"] || "undated")}.txt`, recordToText(record));
      }
      if (button.dataset.action === "delete") {
        if (!await confirmAction("這會刪除本機與 Google Sheet 中的這筆紀錄。", "刪除紀錄")) return;
        saveRecords(records.filter((item) => item.id !== record.id));
        renderRecords();
        try {
          await deleteCloudRecord(record.id);
        } catch (error) {
          console.error(error);
          setCloudStatus(`雲端刪除失敗：${error.message}`, true);
        }
      }
    });

    $("practice-export-feedback").addEventListener("click", () => {
      const records = getRecords();
      if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
      download(`EVAN-${fileSafe(currentConfig()?.label || weekInput.value)}-回饋給ChatGPT.txt`, feedbackText(records));
    });

    $("practice-export-csv").addEventListener("click", () => {
      const records = getRecords();
      if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
      download("EVAN-修煉紀錄.csv", toCsv(records), "text/csv;charset=utf-8");
    });

    $("practice-export-json").addEventListener("click", () => {
      const records = getRecords();
      if (!records.length) return showMessage("目前沒有可匯出的紀錄。", true);
      download("EVAN-修煉紀錄完整備份.json", JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), records }, null, 2), "application/json;charset=utf-8");
    });

    $("practice-import-json").addEventListener("change", async (event) => {
      const [file] = event.target.files;
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const incoming = Array.isArray(parsed) ? parsed : parsed.records;
        if (!Array.isArray(incoming)) throw new Error("Invalid records");
        if (!await confirmAction(`匯入 ${incoming.length} 筆紀錄並取代目前本機資料？`, "匯入備份")) return;
        saveRecords(incoming.map(migrateLegacyRecord));
        renderRecords();
        showMessage(`已匯入 ${incoming.length} 筆本機紀錄；不會自動覆蓋 Google Sheet。`);
      } catch (error) {
        console.error(error);
        showMessage("無法讀取這份 JSON 備份。", true);
      } finally {
        event.target.value = "";
      }
    });

    $("practice-delete-all").addEventListener("click", async () => {
      if (!getRecords().length) return;
      if (!await confirmAction("只刪除這台裝置的全部修煉紀錄；Google Sheet 不會批次刪除。建議先下載 JSON 備份。", "刪除全部本機紀錄")) return;
      localStorage.removeItem(STORAGE_KEY);
      resetForm({ keepWeek: true });
      renderRecords();
    });

    $("practice-test-cloud").addEventListener("click", async () => {
      setCloudStatus("正在重新測試私人連線…");
      try {
        await window.EvanPracticeAuth.retest();
        setCloudStatus("私人連線正常。");
      } catch (error) {
        setCloudStatus(`連線失敗：${error.message}`, true);
      }
    });

    $("practice-forget-device").addEventListener("click", async () => {
      if (!await confirmAction("鎖定頁面並從這台裝置移除私人金鑰？本機紀錄不會刪除。", "鎖定私人頁面")) return;
      window.EvanPracticeAuth.forgetAndLock();
    });

    populateWeekSelect();
    fillSeverityOptions();
    ["willingness", "mental", "fatigue", "anxiety"].forEach((name) => $(`practice-${name}`).addEventListener("input", updateRangeOutputs));
    if (!loadDraft()) resetForm({ keepWeek: false, clearDraft: false });
    renderRecords();
    setCloudStatus("已通過金鑰驗證，等待同步。");
  }
})();
