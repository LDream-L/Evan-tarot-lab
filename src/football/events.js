// 世足賽事驗證｜表單事件、匯出、匯入與雲端同步協調
//
// 本模組不自行猜測 window.FootballLabCore／Render；由 workflow runtime
// 在淘汰賽流程完成後注入正確的核心與呈現層。
//
// 主要函式複雜度：
// - buildCards：時間／空間 O(p)，p <= 5。
// - buildCsv：時間／輸出空間 O(r)，r = 紀錄數。
// - bind：時間／空間 O(1)，固定數量事件監聽器。
// - syncCreatedRecord／syncActual：前端時間／空間 O(1)，網路成本另計。
//
// 更快替代方案比較：
// - 舊版在每個匯出欄位重複查找紀錄或排序三項賠率。
// - 本版單次掃描紀錄；市場熱門只比較固定三項，不建立排序副本。

/** CSV 欄位轉義：時間／空間 O(n)，n = 欄位字串長度。 */
export function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** 固定三項賠率取最小值：時間／空間 O(1)。 */
export function getMarketFavorite(odds = {}) {
  const entries = [
    ["H", odds.home],
    ["D", odds.draw],
    ["A", odds.away],
  ];
  if (!entries.every(([, value]) => Number.isFinite(value))) return "";

  let favorite = entries[0];
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index][1] < favorite[1]) favorite = entries[index];
  }
  return favorite[0];
}

/**
 * 建立事件控制器；autoBind=false 可只測資料建構，不觸碰真實 DOM 事件。
 * 建立時間／空間 O(1)。
 */
export function createFootballEvents({
  core,
  ui,
  browserWindow = window,
  documentRef = document,
  autoBind = true,
} = {}) {
  if (!core || !ui || typeof ui.byId !== "function") {
    throw new Error("世足事件層需要有效的核心與 Render。");
  }

  const byId = ui.byId;
  let bound = false;

  /** 文字欄位：時間／空間 O(1)。 */
  function readText(id) {
    return String(byId(id)?.value || "").trim();
  }

  /** 選填數字：時間／空間 O(1)。 */
  function readOptionalNumber(id) {
    const raw = readText(id);
    if (raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  /** 固定賽事欄位：時間／空間 O(1)。 */
  function buildMatch() {
    return {
      competition: readText("football-competition"),
      stage: readText("football-stage"),
      kickoff: core.toIsoFromLocal(readText("football-kickoff")),
      infoState: readText("football-info-state"),
      homeTeam: readText("football-home-team"),
      awayTeam: readText("football-away-team"),
      mode: readText("football-mode"),
      cardSource: readText("football-card-source"),
      odds: {
        home: readOptionalNumber("football-home-odds"),
        draw: readOptionalNumber("football-draw-odds"),
        away: readOptionalNumber("football-away-odds"),
      },
      knownInfo: readText("football-known-info"),
    };
  }

  /** 讀取固定牌位：時間／空間 O(p)，p <= 5。 */
  function buildCards() {
    const draft = core.getDraft();
    if (!draft) return [];
    if (draft.match.cardSource === "random") return draft.cards;

    return draft.cards.map((card) => ({
      group: card.group,
      position: card.position,
      positionTitle: card.positionTitle,
      positionNote: card.positionNote,
      name: readText(`football-card-${card.group}-${card.position}`),
      orientation: readText(`football-orientation-${card.group}-${card.position}`),
    }));
  }

  /** 固定預測欄位：時間／空間 O(1)。 */
  function buildPrediction(mode) {
    const prediction = {
      directResult: "",
      directConfidence: null,
      directNotes: "",
      structureHomeGoals: null,
      structureAwayGoals: null,
      structureConfidence: null,
      structureNotes: "",
      advance: readText("football-advance-prediction"),
    };

    if (core.modeIncludesDirect(mode)) {
      prediction.directResult = readText("football-direct-result");
      prediction.directConfidence = Number(readText("football-direct-confidence") || 3);
      prediction.directNotes = readText("football-direct-notes");
    }

    if (core.modeIncludesStructure(mode)) {
      prediction.structureHomeGoals = readOptionalNumber("football-structure-home-goals");
      prediction.structureAwayGoals = readOptionalNumber("football-structure-away-goals");
      prediction.structureConfidence = Number(readText("football-structure-confidence") || 3);
      prediction.structureNotes = readText("football-structure-notes");
    }

    return prediction;
  }

  /** 固定賽後欄位：時間／空間 O(1)。 */
  function buildActual() {
    return {
      homeGoals: readOptionalNumber("football-actual-home"),
      awayGoals: readOptionalNumber("football-actual-away"),
      extraHomeGoals: readOptionalNumber("football-extra-home"),
      extraAwayGoals: readOptionalNumber("football-extra-away"),
      advance: readText("football-actual-advance"),
      notes: readText("football-actual-notes"),
      reviewAnalysis: readText("football-review-analysis"),
    };
  }

  /** 比分預覽：時間／空間 O(1)。 */
  function updateStructurePreview() {
    const home = readOptionalNumber("football-structure-home-goals");
    const away = readOptionalNumber("football-structure-away-goals");
    const preview = byId("football-structure-result-preview");
    if (!preview) return;

    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      preview.textContent = "填完兩隊進球後自動產生";
      return;
    }

    preview.textContent = `${home}：${away}｜${core.data.resultLabels[core.getResult(home, away)]}`;
  }

  /** 單筆雲端建立：前端時間／空間 O(1)。失敗不回滾本機資料。 */
  async function syncCreatedRecord(record) {
    const cloud = browserWindow.FootballLabCloud;
    if (!cloud?.isConfigured?.()) return "local-only";
    if (!cloud.hasToken()) {
      cloud.setStatus("新紀錄已保存於本機；登入 Google 後按「同步全部本機紀錄」即可補傳。", "is-warning");
      return "signin-required";
    }

    try {
      await cloud.saveRecord(record);
      cloud.setStatus(`「${record.match.homeTeam} vs ${record.match.awayTeam}」已同步到新試算表。`, "is-success");
      return "synced";
    } catch (error) {
      cloud.setStatus(`本機已保存，但雲端同步失敗：${error.message}`, "is-error");
      return "failed";
    }
  }

  /** 單筆賽果雲端更新：前端時間／空間 O(1)。 */
  async function syncActual(record) {
    const cloud = browserWindow.FootballLabCloud;
    if (!cloud?.isConfigured?.()) return "local-only";
    if (!cloud.hasToken()) {
      cloud.setStatus("賽果與回顧已保存於本機；登入 Google 後按「同步全部本機紀錄」即可補傳。", "is-warning");
      return "signin-required";
    }

    try {
      await cloud.updateActual(record.id, record.actual);
      cloud.setStatus(`「${record.match.homeTeam} vs ${record.match.awayTeam}」的賽果與回顧已更新到試算表。`, "is-success");
      return "synced";
    } catch (error) {
      cloud.setStatus(`本機已保存，但雲端更新失敗：${error.message}`, "is-error");
      return "failed";
    }
  }

  /** 單次掃描匯出：時間／輸出空間 O(r)。 */
  function buildCsv() {
    const headers = [
      "id", "modelVersion", "mode", "competition", "stage", "kickoff", "infoState", "homeTeam", "awayTeam",
      "cardSource", "homeOdds", "drawOdds", "awayOdds", "cardsJson", "directResult", "directConfidence",
      "directNotes", "structureHomeGoals", "structureAwayGoals", "structureResult", "structureConfidence",
      "structureNotes", "advancePrediction", "lockedAt", "actualHomeGoals", "actualAwayGoals", "extraHomeGoals",
      "extraAwayGoals", "actualAdvance", "actualNotes", "reviewAnalysis", "directResultHit", "structureResultHit",
      "structureExactHit", "structureAbsoluteError", "modelsAgree", "marketFavorite",
    ];

    const rows = core.getRecords().map((record) => {
      const evaluation = core.calculateEvaluation(record);
      const mode = core.getMode(record);
      const structureResult = core.modeIncludesStructure(mode)
        ? core.getResult(
          record.prediction.structureHomeGoals,
          record.prediction.structureAwayGoals
        )
        : "";
      const odds = record.match.odds || {};

      return [
        record.id,
        record.modelVersion,
        mode,
        record.match.competition,
        record.match.stage,
        record.match.kickoff,
        record.match.infoState,
        record.match.homeTeam,
        record.match.awayTeam,
        record.match.cardSource || "legacy",
        odds.home,
        odds.draw,
        odds.away,
        JSON.stringify(record.cards),
        record.prediction.directResult,
        record.prediction.directConfidence,
        record.prediction.directNotes,
        record.prediction.structureHomeGoals,
        record.prediction.structureAwayGoals,
        structureResult,
        record.prediction.structureConfidence,
        record.prediction.structureNotes,
        record.prediction.advance,
        record.lockedAt,
        record.actual?.homeGoals,
        record.actual?.awayGoals,
        record.actual?.extraHomeGoals,
        record.actual?.extraAwayGoals,
        record.actual?.advance,
        record.actual?.notes,
        record.actual?.reviewAnalysis,
        evaluation?.directResultHit,
        evaluation?.structureResultHit,
        evaluation?.structureExactHit,
        evaluation?.structureAbsoluteError,
        evaluation?.modelsAgree,
        getMarketFavorite(odds),
      ].map(csvEscape).join(",");
    });

    return `\uFEFF${[headers.map(csvEscape).join(","), ...rows].join("\n")}`;
  }

  /** 下載輸出檔：時間／空間 O(n)，n = 輸出內容長度。 */
  function downloadFile(filename, content, type) {
    const url = browserWindow.URL.createObjectURL(
      new browserWindow.Blob([content], { type })
    );
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = filename;
    documentRef.body.appendChild(link);
    link.click();
    link.remove();
    browserWindow.URL.revokeObjectURL(url);
  }

  /** 固定表單重設：時間／空間 O(1)。 */
  function resetAfterLock() {
    byId("football-reading-form")?.reset();
    byId("football-reading-panel")?.classList.add("football-hidden");
    byId("football-match-form")?.reset();
    const competition = byId("football-competition");
    const mode = byId("football-mode");
    const source = byId("football-card-source");
    if (competition) competition.value = "2026 FIFA 世界盃";
    if (mode) mode.value = "dual";
    if (source) source.value = "manual";
    updateStructurePreview();
  }

  /** 綁定固定數量事件監聽器：時間／空間 O(1)。 */
  function bind() {
    if (bound) return api;
    bound = true;

    byId("football-match-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      ui.clearMessage("football-match-message");
      const match = buildMatch();
      const error = core.validateMatch(match);
      if (error) {
        ui.setMessage("football-match-message", error, "is-error");
        return;
      }

      try {
        ui.renderDraft(core.createDraft(match));
        const count = core.getDraft().cards.length;
        const message = match.cardSource === "manual"
          ? `${count} 個牌位已建立。請依模型分組填入實際抽到的牌。`
          : `${count} 張牌已按模型分開抽出並固定。請完成各自的賽前判讀。`;
        ui.setMessage("football-match-message", message, "is-success");
      } catch (errorObject) {
        ui.setMessage(
          "football-match-message",
          errorObject.message || "建立牌位失敗。",
          "is-error"
        );
      }
    });

    byId("football-reading-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      ui.clearMessage("football-reading-message");
      const draft = core.getDraft();
      if (!draft) {
        ui.setMessage("football-reading-message", "目前沒有可鎖定的草稿。", "is-error");
        return;
      }

      const cards = buildCards();
      const cardError = core.validateCards(cards, draft.match.mode);
      if (cardError) {
        ui.setMessage("football-reading-message", cardError, "is-error");
        return;
      }

      const prediction = buildPrediction(draft.match.mode);
      const predictionError = core.validatePrediction(prediction, draft.match.mode);
      if (predictionError) {
        ui.setMessage("football-reading-message", predictionError, "is-error");
        return;
      }

      try {
        const record = core.lockDraft(prediction, cards);
        resetAfterLock();
        ui.renderRecords();
        ui.setMessage(
          "football-match-message",
          "模型已鎖定並保存於本機，正在檢查雲端同步。",
          "is-success"
        );
        byId("football-records")?.scrollIntoView({ behavior: "smooth", block: "start" });

        const cloudState = await syncCreatedRecord(record);
        if (cloudState === "synced") {
          ui.setMessage("football-match-message", "模型已鎖定，並同步到新的 Google 試算表。", "is-success");
        } else if (cloudState === "signin-required") {
          ui.setMessage("football-match-message", "模型已鎖定並保存於本機；登入 Google 後可補同步。", "is-success");
        } else if (cloudState === "failed") {
          ui.setMessage("football-match-message", "模型已安全保存於本機，但本次雲端同步失敗。", "is-success");
        }
      } catch (errorObject) {
        ui.setMessage("football-reading-message", errorObject.message, "is-error");
      }
    });

    byId("football-structure-home-goals")?.addEventListener("input", updateStructurePreview);
    byId("football-structure-away-goals")?.addEventListener("input", updateStructurePreview);

    byId("football-abandon-draft")?.addEventListener("click", () => {
      if (!core.getDraft() || browserWindow.confirm("確定放棄本次分組抽牌與尚未鎖定的判讀？")) {
        core.clearDraft();
        byId("football-reading-form")?.reset();
        byId("football-reading-panel")?.classList.add("football-hidden");
        ui.clearMessage("football-reading-message");
        updateStructurePreview();
      }
    });

    byId("football-records-body")?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const record = core.getRecord(button.dataset.id);
      if (!record) return;

      if (button.dataset.action === "evaluate") ui.openEvaluation(record);
      if (
        button.dataset.action === "delete"
        && browserWindow.confirm(`確定刪除「${record.match.homeTeam} vs ${record.match.awayTeam}」？`)
      ) {
        core.deleteRecord(record.id);
        byId("football-evaluation-panel")?.classList.add("football-hidden");
        ui.renderRecords();
      }
    });

    byId("football-evaluation-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const actual = buildActual();
      if (
        !Number.isInteger(actual.homeGoals)
        || !Number.isInteger(actual.awayGoals)
        || actual.homeGoals < 0
        || actual.awayGoals < 0
      ) {
        ui.setMessage(
          "football-evaluation-message",
          "請輸入有效的 90 分鐘整數比分。",
          "is-error"
        );
        return;
      }

      const record = core.updateActual(readText("football-evaluation-id"), actual);
      ui.renderRecords();
      ui.renderScorecard(record);
      ui.setMessage(
        "football-evaluation-message",
        "賽果與回顧已保存於本機，正在檢查雲端更新。",
        "is-success"
      );

      const cloudState = await syncActual(record);
      if (cloudState === "synced") {
        ui.setMessage("football-evaluation-message", "賽果與回顧已保存，並更新到 Google 試算表。", "is-success");
      } else if (cloudState === "signin-required") {
        ui.setMessage("football-evaluation-message", "賽果與回顧已保存於本機；登入 Google 後可補同步。", "is-success");
      } else if (cloudState === "failed") {
        ui.setMessage("football-evaluation-message", "資料已安全保存於本機，但本次雲端更新失敗。", "is-success");
      }
    });

    byId("football-close-evaluation")?.addEventListener("click", () => {
      byId("football-evaluation-panel")?.classList.add("football-hidden");
    });

    byId("football-export-csv")?.addEventListener("click", () => {
      downloadFile(
        `football_tarot_records_${new Date().toISOString().slice(0, 10)}.csv`,
        buildCsv(),
        "text/csv;charset=utf-8"
      );
    });

    byId("football-export-json")?.addEventListener("click", () => {
      downloadFile(
        `football_tarot_backup_${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({
          schema: "evan-football-tarot-v3",
          exportedAt: new Date().toISOString(),
          records: core.getRecords(),
        }, null, 2),
        "application/json;charset=utf-8"
      );
    });

    byId("football-import-json")?.addEventListener("change", async (event) => {
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        const parsed = JSON.parse(await file.text());
        const count = core.importRecords(
          Array.isArray(parsed) ? parsed : parsed.records || []
        );
        ui.renderRecords();
        browserWindow.alert(`已匯入 ${count} 筆有效紀錄。可登入 Google 後按「同步全部本機紀錄」補傳。`);
      } catch (error) {
        browserWindow.alert(`匯入失敗：${error.message || "檔案格式不正確"}`);
      } finally {
        event.target.value = "";
      }
    });

    updateStructurePreview();
    ui.renderRecords();
    return api;
  }

  const api = Object.freeze({
    core,
    ui,
    readText,
    readOptionalNumber,
    buildMatch,
    buildCards,
    buildPrediction,
    buildActual,
    updateStructurePreview,
    syncCreatedRecord,
    syncActual,
    buildCsv,
    bind,
    isBound: () => bound,
  });

  if (autoBind) bind();
  return api;
}
