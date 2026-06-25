// 世足賽事驗證 v1.0.0｜表單事件、匯出與匯入
// 所有主要操作為 O(1)；CSV 匯出與紀錄渲染為 O(r)。
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
      odds: {
        home: readOptionalNumber("football-home-odds"),
        draw: readOptionalNumber("football-draw-odds"),
        away: readOptionalNumber("football-away-odds"),
      },
      knownInfo: readText("football-known-info"),
    };
  }

  function buildPrediction() {
    return {
      homeAttackBand: readText("football-home-attack-band"),
      homeDefenseBand: readText("football-home-defense-band"),
      awayAttackBand: readText("football-away-attack-band"),
      awayDefenseBand: readText("football-away-defense-band"),
      result: readText("football-result-prediction"),
      confidence: Number(readText("football-confidence") || 3),
      homeExact: readOptionalNumber("football-home-exact"),
      awayExact: readOptionalNumber("football-away-exact"),
      advance: readText("football-advance-prediction"),
      notes: readText("football-reading-notes"),
    };
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function buildCsv() {
    const headers = [
      "id", "modelVersion", "competition", "stage", "kickoff", "infoState", "homeTeam", "awayTeam",
      "homeOdds", "drawOdds", "awayOdds", "cards", "homeAttackBand", "homeDefenseBand", "awayAttackBand",
      "awayDefenseBand", "resultPrediction", "confidence", "homeExactPrediction", "awayExactPrediction",
      "advancePrediction", "readingNotes", "lockedAt", "actualHomeGoals", "actualAwayGoals", "extraHomeGoals",
      "extraAwayGoals", "actualAdvance", "actualNotes", "homeAttackHit", "homeDefenseHit", "awayAttackHit",
      "awayDefenseHit", "resultHit", "coreHitCount", "exactScoreHit", "advanceHit"
    ];
    const rows = core.getRecords().map((record) => {
      const e = core.calculateEvaluation(record);
      const cards = record.cards.map((card) => `${card.positionTitle}：${card.name}${card.orientation}`).join("；");
      return [
        record.id, record.modelVersion, record.match.competition, record.match.stage, record.match.kickoff,
        record.match.infoState, record.match.homeTeam, record.match.awayTeam, record.match.odds?.home,
        record.match.odds?.draw, record.match.odds?.away, cards, record.prediction.homeAttackBand,
        record.prediction.homeDefenseBand, record.prediction.awayAttackBand, record.prediction.awayDefenseBand,
        record.prediction.result, record.prediction.confidence, record.prediction.homeExact, record.prediction.awayExact,
        record.prediction.advance, record.prediction.notes, record.lockedAt, record.actual?.homeGoals,
        record.actual?.awayGoals, record.actual?.extraHomeGoals, record.actual?.extraAwayGoals, record.actual?.advance,
        record.actual?.notes, e?.checks.homeAttack, e?.checks.homeDefense, e?.checks.awayAttack,
        e?.checks.awayDefense, e?.checks.result, e?.hitCount, e?.exactEligible ? e.exactHit : "",
        e?.advanceEligible ? e.advanceHit : ""
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
      ui.setMessage("football-match-message", "五張牌已固定抽出。請完成賽前判讀並鎖定。", "is-success");
    } catch (drawError) {
      ui.setMessage("football-match-message", drawError.message || "抽牌失敗。", "is-error");
    }
  });

  byId("football-reading-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    ui.clearMessage("football-reading-message");
    const prediction = buildPrediction();
    const error = core.validatePrediction(prediction);
    if (error) return ui.setMessage("football-reading-message", error, "is-error");
    try {
      core.lockDraft(prediction);
      byId("football-reading-form").reset();
      byId("football-reading-panel").classList.add("football-hidden");
      byId("football-match-form").reset();
      byId("football-competition").value = "2026 FIFA 世界盃";
      ui.renderRecords();
      ui.setMessage("football-match-message", "賽前判讀已鎖定並加入驗證紀錄。", "is-success");
      byId("football-records").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (lockError) {
      ui.setMessage("football-reading-message", lockError.message, "is-error");
    }
  });

  byId("football-abandon-draft")?.addEventListener("click", () => {
    if (!core.getDraft() || window.confirm("確定放棄本次五張牌與尚未鎖定的判讀？")) {
      core.clearDraft();
      byId("football-reading-form").reset();
      byId("football-reading-panel").classList.add("football-hidden");
      ui.clearMessage("football-reading-message");
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
    ui.setMessage("football-evaluation-message", "賽果已儲存，並完成五項核心核對。", "is-success");
  });

  byId("football-close-evaluation")?.addEventListener("click", () => byId("football-evaluation-panel").classList.add("football-hidden"));
  byId("football-export-csv")?.addEventListener("click", () => downloadFile(`football_tarot_records_${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(), "text/csv;charset=utf-8"));
  byId("football-export-json")?.addEventListener("click", () => downloadFile(`football_tarot_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schema: "evan-football-tarot-v1", exportedAt: new Date().toISOString(), records: core.getRecords() }, null, 2), "application/json;charset=utf-8"));
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

  ui.renderRecords();
})();
