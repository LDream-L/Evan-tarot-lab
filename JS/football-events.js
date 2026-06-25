// 世足賽事驗證 v1.2.0｜分離模型表單事件、匯出與匯入
// buildCards：O(p) 時間、O(p) 空間，p<=5；buildCsv：O(r) 時間、O(r) 空間。
(function initFootballLabEvents() {
  "use strict";

  const core = window.FootballLabCore;
  const ui = window.FootballLabRender;
  const byId = ui.byId;

  function readText(id) { return String(byId(id)?.value || "").trim(); }

  function readOptionalNumber(id) {
    const raw = readText(id);
    if (raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

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

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function buildCsv() {
    const headers = [
      "id", "modelVersion", "mode", "competition", "stage", "kickoff", "infoState", "homeTeam", "awayTeam",
      "cardSource", "homeOdds", "drawOdds", "awayOdds", "cardsJson", "directResult", "directConfidence",
      "directNotes", "structureHomeGoals", "structureAwayGoals", "structureResult", "structureConfidence",
      "structureNotes", "advancePrediction", "lockedAt", "actualHomeGoals", "actualAwayGoals", "extraHomeGoals",
      "extraAwayGoals", "actualAdvance", "actualNotes", "directResultHit", "structureResultHit", "structureExactHit",
      "structureAbsoluteError", "modelsAgree", "marketFavorite"
    ];
    const rows = core.getRecords().map((record) => {
      const e = core.calculateEvaluation(record);
      const mode = core.getMode(record);
      const structureResult = core.modeIncludesStructure(mode)
        ? core.getResult(record.prediction.structureHomeGoals, record.prediction.structureAwayGoals)
        : "";
      const odds = record.match.odds || {};
      const marketFavorite = [odds.home, odds.draw, odds.away].every(Number.isFinite)
        ? [["H", odds.home], ["D", odds.draw], ["A", odds.away]].sort((a, b) => a[1] - b[1])[0][0]
        : "";
      return [
        record.id, record.modelVersion, mode, record.match.competition, record.match.stage, record.match.kickoff,
        record.match.infoState, record.match.homeTeam, record.match.awayTeam, record.match.cardSource || "legacy",
        odds.home, odds.draw, odds.away, JSON.stringify(record.cards), record.prediction.directResult,
        record.prediction.directConfidence, record.prediction.directNotes, record.prediction.structureHomeGoals,
        record.prediction.structureAwayGoals, structureResult, record.prediction.structureConfidence,
        record.prediction.structureNotes, record.prediction.advance, record.lockedAt, record.actual?.homeGoals,
        record.actual?.awayGoals, record.actual?.extraHomeGoals, record.actual?.extraAwayGoals, record.actual?.advance,
        record.actual?.notes, e?.directResultHit, e?.structureResultHit, e?.structureExactHit,
        e?.structureAbsoluteError, e?.modelsAgree, marketFavorite,
      ].map(csvEscape).join(",");
    });
    return `\uFEFF${[headers.map(csvEscape).join(","), ...rows].join("\n")}`;
  }

  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  byId("football-match-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    ui.clearMessage("football-match-message");
    const match = buildMatch();
    const error = core.validateMatch(match);
    if (error) return ui.setMessage("football-match-message", error, "is-error");
    try {
      ui.renderDraft(core.createDraft(match));
      const count = core.getDraft().cards.length;
      const message = match.cardSource === "manual"
        ? `${count} 個牌位已建立。請依模型分組填入實際抽到的牌。`
        : `${count} 張牌已按模型分開抽出並固定。請完成各自的賽前判讀。`;
      ui.setMessage("football-match-message", message, "is-success");
    } catch (errorObject) {
      ui.setMessage("football-match-message", errorObject.message || "建立牌位失敗。", "is-error");
    }
  });

  byId("football-reading-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    ui.clearMessage("football-reading-message");
    const draft = core.getDraft();
    if (!draft) return ui.setMessage("football-reading-message", "目前沒有可鎖定的草稿。", "is-error");
    const cards = buildCards();
    const cardError = core.validateCards(cards, draft.match.mode);
    if (cardError) return ui.setMessage("football-reading-message", cardError, "is-error");
    const prediction = buildPrediction(draft.match.mode);
    const predictionError = core.validatePrediction(prediction, draft.match.mode);
    if (predictionError) return ui.setMessage("football-reading-message", predictionError, "is-error");
    try {
      core.lockDraft(prediction, cards);
      byId("football-reading-form").reset();
      byId("football-reading-panel").classList.add("football-hidden");
      byId("football-match-form").reset();
      byId("football-competition").value = "2026 FIFA 世界盃";
      byId("football-mode").value = "dual";
      byId("football-card-source").value = "manual";
      updateStructurePreview();
      ui.renderRecords();
      ui.setMessage("football-match-message", "兩個模型已分開鎖定並加入驗證紀錄。", "is-success");
      byId("football-records").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (errorObject) {
      ui.setMessage("football-reading-message", errorObject.message, "is-error");
    }
  });

  byId("football-structure-home-goals")?.addEventListener("input", updateStructurePreview);
  byId("football-structure-away-goals")?.addEventListener("input", updateStructurePreview);

  byId("football-abandon-draft")?.addEventListener("click", () => {
    if (!core.getDraft() || window.confirm("確定放棄本次分組抽牌與尚未鎖定的判讀？")) {
      core.clearDraft();
      byId("football-reading-form").reset();
      byId("football-reading-panel").classList.add("football-hidden");
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
    if (button.dataset.action === "delete" && window.confirm(`確定刪除「${record.match.homeTeam} vs ${record.match.awayTeam}」？`)) {
      core.deleteRecord(record.id);
      byId("football-evaluation-panel").classList.add("football-hidden");
      ui.renderRecords();
    }
  });

  byId("football-evaluation-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const homeGoals = readOptionalNumber("football-actual-home");
    const awayGoals = readOptionalNumber("football-actual-away");
    if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) {
      return ui.setMessage("football-evaluation-message", "請輸入有效的 90 分鐘整數比分。", "is-error");
    }
    const record = core.updateActual(readText("football-evaluation-id"), {
      homeGoals,
      awayGoals,
      extraHomeGoals: readOptionalNumber("football-extra-home"),
      extraAwayGoals: readOptionalNumber("football-extra-away"),
      advance: readText("football-actual-advance"),
      notes: readText("football-actual-notes"),
    });
    ui.renderRecords();
    ui.renderScorecard(record);
    ui.setMessage("football-evaluation-message", "賽果已儲存，兩個模型已分別完成核對。", "is-success");
  });

  byId("football-close-evaluation")?.addEventListener("click", () => byId("football-evaluation-panel").classList.add("football-hidden"));
  byId("football-export-csv")?.addEventListener("click", () => downloadFile(`football_tarot_records_${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(), "text/csv;charset=utf-8"));
  byId("football-export-json")?.addEventListener("click", () => downloadFile(`football_tarot_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schema: "evan-football-tarot-v2", exportedAt: new Date().toISOString(), records: core.getRecords() }, null, 2), "application/json;charset=utf-8"));
  byId("football-import-json")?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const parsed = JSON.parse(await file.text());
      const count = core.importRecords(Array.isArray(parsed) ? parsed : parsed.records || []);
      ui.renderRecords();
      window.alert(`已匯入 ${count} 筆有效紀錄。`);
    } catch (error) {
      window.alert(`匯入失敗：${error.message || "檔案格式不正確"}`);
    } finally {
      event.target.value = "";
    }
  });

  updateStructurePreview();
  ui.renderRecords();
})();
