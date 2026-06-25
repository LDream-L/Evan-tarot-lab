// 世足賽事驗證 v1.1.0｜牌位輸入與畫面渲染
// renderDraft：O(p*d) 時間、O(p*d) DOM 空間，p=5、d=78；renderRecords：O(r) 時間、O(r) DOM 空間。
// 牌名選項先以固定牌組建立；五個牌位一次渲染，避免重複查詢 DOM。
(function defineFootballLabRender() {
  "use strict";

  const core = window.FootballLabCore;
  const { resultLabels, bandLabels, cardSourceLabels, deck } = core.data;

  function byId(id) { return document.getElementById(id); }

  function setMessage(id, text, type = "") {
    const element = byId(id);
    if (!element) return;
    element.textContent = text;
    element.classList.remove("football-hidden", "is-error", "is-success");
    if (type) element.classList.add(type);
  }

  function clearMessage(id) {
    const element = byId(id);
    if (!element) return;
    element.textContent = "";
    element.classList.add("football-hidden");
    element.classList.remove("is-error", "is-success");
  }

  function addSummaryItem(container, label, value) {
    const item = document.createElement("div");
    item.className = "football-summary-item";
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value || "—";
    item.append(small, strong);
    container.appendChild(item);
  }

  function createCardSelect(card) {
    const select = document.createElement("select");
    select.id = `football-card-${card.position}`;
    select.required = true;
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "選擇抽到的牌";
    select.appendChild(empty);
    deck.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === card.name;
      select.appendChild(option);
    });
    return select;
  }

  function createOrientationSelect(card) {
    const select = document.createElement("select");
    select.id = `football-orientation-${card.position}`;
    ["正位", "逆位"].forEach((orientation) => {
      const option = document.createElement("option");
      option.value = orientation;
      option.textContent = orientation;
      option.selected = orientation === card.orientation;
      select.appendChild(option);
    });
    return select;
  }

  function renderCardEntries(draft) {
    const fragment = document.createDocumentFragment();
    draft.cards.forEach((card, index) => {
      const article = document.createElement("article");
      article.className = "football-card";
      const order = document.createElement("span");
      order.className = "football-card-order";
      order.textContent = `位置 ${index + 1}`;
      const title = document.createElement("h4");
      title.className = "football-card-name";
      title.textContent = card.positionTitle;
      const note = document.createElement("p");
      note.className = "football-card-role";
      note.textContent = card.positionNote;

      if (draft.match.cardSource === "manual") {
        const cardLabel = document.createElement("label");
        cardLabel.textContent = "抽到的牌";
        cardLabel.appendChild(createCardSelect(card));
        const orientationLabel = document.createElement("label");
        orientationLabel.textContent = "正逆位";
        orientationLabel.appendChild(createOrientationSelect(card));
        article.append(order, title, note, cardLabel, orientationLabel);
      } else {
        const name = document.createElement("strong");
        name.className = "football-random-card-name";
        name.textContent = card.name;
        const orientation = document.createElement("span");
        orientation.className = `football-orientation${card.orientation === "逆位" ? " is-reversed" : ""}`;
        orientation.textContent = card.orientation;
        article.append(order, title, note, name, orientation);
      }
      fragment.appendChild(article);
    });
    byId("football-card-grid").replaceChildren(fragment);
  }

  function renderDraft(draft) {
    const summaryFragment = document.createDocumentFragment();
    addSummaryItem(summaryFragment, "賽事", draft.match.competition);
    addSummaryItem(summaryFragment, "對戰", `${draft.match.homeTeam} vs ${draft.match.awayTeam}`);
    addSummaryItem(summaryFragment, "開賽", core.formatDateTime(draft.match.kickoff));
    addSummaryItem(summaryFragment, "牌面來源", cardSourceLabels[draft.match.cardSource]);
    byId("football-match-summary").replaceChildren(summaryFragment);

    byId("football-card-entry-note").textContent = draft.match.cardSource === "manual"
      ? "請依你實際抽牌的順序，將牌名與正逆位填入下列固定位置；同一張牌不能重複。"
      : "以下五張由網站一次隨機抽出並固定，不能局部重抽或交換牌位。";
    renderCardEntries(draft);

    byId("football-home-reading-title").textContent = `${draft.match.homeTeam}｜得分與防守`;
    byId("football-away-reading-title").textContent = `${draft.match.awayTeam}｜得分與防守`;
    byId("football-advance-home").textContent = `${draft.match.homeTeam} 晉級`;
    byId("football-advance-away").textContent = `${draft.match.awayTeam} 晉級`;
    byId("football-reading-panel").classList.remove("football-hidden");
    byId("football-reading-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function formatRate(hits, total) {
    return total ? `${Math.round((hits / total) * 1000) / 10}%` : "—";
  }

  function renderKpis() {
    const stats = core.calculateStats();
    const items = [
      ["總紀錄", String(stats.total), `${stats.completed} 場已核對`],
      ["90 分鐘賽果", formatRate(stats.resultHits, stats.completed), `${stats.resultHits}／${stats.completed}`],
      ["四項攻防", formatRate(stats.dimensionHits, stats.dimensionTotal), `${stats.dimensionHits}／${stats.dimensionTotal}`],
      ["確切比分", formatRate(stats.exactHits, stats.exactEligible), `${stats.exactHits}／${stats.exactEligible}`],
      ["市場熱門基準", formatRate(stats.marketHits, stats.marketEligible), `${stats.marketHits}／${stats.marketEligible}`],
    ];
    const fragment = document.createDocumentFragment();
    items.forEach(([label, value, detail]) => {
      const card = document.createElement("article");
      card.className = "football-kpi";
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      const span = document.createElement("span");
      span.textContent = detail;
      card.append(small, strong, span);
      fragment.appendChild(card);
    });
    byId("football-kpis").replaceChildren(fragment);
  }

  function describeCards(cards) {
    return cards.map((card) => `${card.positionTitle}：${card.name}${card.orientation}`).join("；");
  }

  function describePrediction(record) {
    const p = record.prediction;
    return `${resultLabels[p.result] || "—"}｜${bandLabels[p.homeAttackBand]}：${bandLabels[p.awayAttackBand]}`;
  }

  function createTextCell(value, smallValue = "") {
    const cell = document.createElement("td");
    const text = document.createElement("span");
    text.textContent = value;
    cell.appendChild(text);
    if (smallValue) {
      const small = document.createElement("small");
      small.textContent = smallValue;
      cell.appendChild(small);
    }
    return cell;
  }

  function renderRecords() {
    renderKpis();
    const records = core.getRecords().sort((a, b) => String(b.match.kickoff).localeCompare(String(a.match.kickoff)));
    const fragment = document.createDocumentFragment();
    records.forEach((record) => {
      const evaluation = core.calculateEvaluation(record);
      const row = document.createElement("tr");
      const source = cardSourceLabels[record.match.cardSource] || "舊版未標記";
      row.appendChild(createTextCell(core.formatDateTime(record.match.kickoff), `${record.match.competition}｜${record.match.stage}`));
      row.appendChild(createTextCell(`${record.match.homeTeam} vs ${record.match.awayTeam}`, `${source}｜${describeCards(record.cards)}`));
      row.appendChild(createTextCell(describePrediction(record), `信心 ${record.prediction.confidence}／5`));
      row.appendChild(createTextCell(record.actual ? `${record.actual.homeGoals}：${record.actual.awayGoals}` : "尚未輸入", record.actual ? resultLabels[evaluation.actualResult] : "等待賽後核對"));
      row.appendChild(createTextCell(evaluation ? `${evaluation.hitCount}／5` : "—", evaluation?.exactEligible ? `確切比分：${evaluation.exactHit ? "命中" : "未中"}` : ""));
      row.appendChild(createTextCell(record.actual ? "已核對" : "待核對", `鎖定：${core.formatDateTime(record.lockedAt)}`));

      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "football-row-actions";
      [["evaluate", record.actual ? "更新賽果" : "填入賽果", ""], ["delete", "刪除", " is-danger"]].forEach(([action, label, extra]) => {
        const button = document.createElement("button");
        button.className = `football-small-button${extra}`;
        button.type = "button";
        button.dataset.action = action;
        button.dataset.id = record.id;
        button.textContent = label;
        actions.appendChild(button);
      });
      actionCell.appendChild(actions);
      row.appendChild(actionCell);
      fragment.appendChild(row);
    });
    byId("football-records-body").replaceChildren(fragment);
    byId("football-empty-state").classList.toggle("football-hidden", records.length > 0);
  }

  function renderScorecard(record) {
    const container = byId("football-scorecard");
    const evaluation = core.calculateEvaluation(record);
    if (!evaluation) {
      container.classList.add("football-hidden");
      return;
    }
    const p = record.prediction;
    const a = record.actual;
    const items = [
      ["主隊得分牌", evaluation.checks.homeAttack, `預測 ${bandLabels[p.homeAttackBand]}／實際 ${a.homeGoals} 球`],
      ["主隊防守牌", evaluation.checks.homeDefense, `預測失 ${bandLabels[p.homeDefenseBand]}／實際失 ${a.awayGoals} 球`],
      ["客隊得分牌", evaluation.checks.awayAttack, `預測 ${bandLabels[p.awayAttackBand]}／實際 ${a.awayGoals} 球`],
      ["客隊防守牌", evaluation.checks.awayDefense, `預測失 ${bandLabels[p.awayDefenseBand]}／實際失 ${a.homeGoals} 球`],
      ["90 分鐘結果", evaluation.checks.result, `預測 ${resultLabels[p.result]}／實際 ${resultLabels[evaluation.actualResult]}`],
    ];
    const title = document.createElement("h4");
    title.textContent = `本場核心命中 ${evaluation.hitCount}／5`;
    const grid = document.createElement("div");
    grid.className = "football-score-grid";
    items.forEach(([label, hit, detail]) => {
      const item = document.createElement("div");
      item.className = `football-score-item ${hit ? "is-hit" : "is-miss"}`;
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = hit ? "命中" : "未中";
      const span = document.createElement("span");
      span.textContent = detail;
      item.append(small, strong, span);
      grid.appendChild(item);
    });
    container.replaceChildren(title, grid);
    container.classList.remove("football-hidden");
  }

  function openEvaluation(record) {
    byId("football-evaluation-id").value = record.id;
    byId("football-actual-home").value = record.actual?.homeGoals ?? "";
    byId("football-actual-away").value = record.actual?.awayGoals ?? "";
    byId("football-extra-home").value = record.actual?.extraHomeGoals ?? "";
    byId("football-extra-away").value = record.actual?.extraAwayGoals ?? "";
    byId("football-actual-advance").value = record.actual?.advance || "";
    byId("football-actual-notes").value = record.actual?.notes || "";
    byId("football-actual-advance-home").textContent = `${record.match.homeTeam} 晉級`;
    byId("football-actual-advance-away").textContent = `${record.match.awayTeam} 晉級`;

    const summary = document.createDocumentFragment();
    addSummaryItem(summary, "對戰", `${record.match.homeTeam} vs ${record.match.awayTeam}`);
    addSummaryItem(summary, "預測", resultLabels[record.prediction.result]);
    addSummaryItem(summary, "主隊得分／防守", `${bandLabels[record.prediction.homeAttackBand]}／失 ${bandLabels[record.prediction.homeDefenseBand]}`);
    addSummaryItem(summary, "客隊得分／防守", `${bandLabels[record.prediction.awayAttackBand]}／失 ${bandLabels[record.prediction.awayDefenseBand]}`);
    byId("football-evaluation-summary").replaceChildren(summary);
    clearMessage("football-evaluation-message");
    renderScorecard(record);
    byId("football-evaluation-panel").classList.remove("football-hidden");
    byId("football-evaluation-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.FootballLabRender = Object.freeze({ byId, setMessage, clearMessage, renderDraft, renderRecords, renderScorecard, openEvaluation });
})();
