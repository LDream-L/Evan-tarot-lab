// 世足賽事驗證 v1.2.0｜分離模型與畫面渲染
// renderDraft：O(p*d) 時間、O(p*d) DOM 空間，p<=5、d=78；renderRecords：O(r) 時間、O(r) DOM 空間。
(function defineFootballLabRender() {
  "use strict";

  const core = window.FootballLabCore;
  const { resultLabels, modeLabels, cardSourceLabels, deck } = core.data;

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
    select.id = `football-card-${card.group}-${card.position}`;
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
    select.id = `football-orientation-${card.group}-${card.position}`;
    ["正位", "逆位"].forEach((orientation) => {
      const option = document.createElement("option");
      option.value = orientation;
      option.textContent = orientation;
      option.selected = orientation === card.orientation;
      select.appendChild(option);
    });
    return select;
  }

  function appendGroupHeading(fragment, group) {
    const heading = document.createElement("div");
    heading.className = "football-card-group-heading";
    const title = document.createElement("h4");
    title.textContent = group === "direct" ? "A｜單張結果模型" : "B｜四張攻防模型";
    const note = document.createElement("p");
    note.textContent = group === "direct"
      ? "這一組只問 90 分鐘主勝、和局或客勝。"
      : "這一組獨立抽牌，由主隊進攻＋客隊防守推估主隊進球，客隊進攻＋主隊防守推估客隊進球。";
    heading.append(title, note);
    fragment.appendChild(heading);
  }

  function renderCardEntries(draft) {
    const fragment = document.createDocumentFragment();
    let currentGroup = "";
    let orderInGroup = 0;
    draft.cards.forEach((card) => {
      if (card.group !== currentGroup) {
        currentGroup = card.group;
        orderInGroup = 0;
        appendGroupHeading(fragment, currentGroup);
      }
      orderInGroup += 1;
      const article = document.createElement("article");
      article.className = "football-card";
      const order = document.createElement("span");
      order.className = "football-card-order";
      order.textContent = `本組第 ${orderInGroup} 張`;
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

  function configureReadingMode(mode) {
    byId("football-direct-reading").classList.toggle("football-hidden", !core.modeIncludesDirect(mode));
    byId("football-structure-reading").classList.toggle("football-hidden", !core.modeIncludesStructure(mode));
  }

  function renderDraft(draft) {
    const summaryFragment = document.createDocumentFragment();
    addSummaryItem(summaryFragment, "賽事", draft.match.competition);
    addSummaryItem(summaryFragment, "對戰", `${draft.match.homeTeam} vs ${draft.match.awayTeam}`);
    addSummaryItem(summaryFragment, "實驗模式", modeLabels[draft.match.mode]);
    addSummaryItem(summaryFragment, "牌面來源", cardSourceLabels[draft.match.cardSource]);
    byId("football-match-summary").replaceChildren(summaryFragment);

    const manualDual = draft.match.cardSource === "manual" && draft.match.mode === "dual";
    byId("football-card-entry-note").textContent = draft.match.cardSource === "manual"
      ? (manualDual
        ? "請把兩個模型視為兩次獨立抽牌：先記單張結果牌，再重新洗牌後記四張攻防牌。同名牌可跨模型再次出現，但同一組內不能重複。"
        : "請依固定位置輸入實際抽到的牌與正逆位；同一組抽牌內不能重複。")
      : "網站會讓兩個模型各自獨立洗牌；不能局部重抽或交換牌位。";
    renderCardEntries(draft);
    configureReadingMode(draft.match.mode);

    byId("football-direct-home-label").textContent = `${draft.match.homeTeam} 勝`;
    byId("football-direct-away-label").textContent = `${draft.match.awayTeam} 勝`;
    byId("football-structure-home-label").textContent = `${draft.match.homeTeam} 預測進球`;
    byId("football-structure-away-label").textContent = `${draft.match.awayTeam} 預測進球`;
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
    const mae = stats.structureEligible ? Math.round((stats.structureErrorTotal / stats.structureEligible) * 100) / 100 : null;
    const items = [
      ["總紀錄", String(stats.total), `${stats.completed} 場已核對`],
      ["單張賽果", formatRate(stats.directHits, stats.directEligible), `${stats.directHits}／${stats.directEligible}`],
      ["攻防推導賽果", formatRate(stats.structureResultHits, stats.structureEligible), `${stats.structureResultHits}／${stats.structureEligible}`],
      ["攻防確切比分", formatRate(stats.structureExactHits, stats.structureEligible), mae == null ? "—" : `平均總誤差 ${mae} 球`],
      ["雙模型一致率", formatRate(stats.dualAgreements, stats.dualEligible), `${stats.dualAgreements}／${stats.dualEligible}`],
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

  function describeCards(record) {
    return record.cards.map((card) => `${card.positionTitle}：${card.name}${card.orientation}`).join("；");
  }

  function describePrediction(record) {
    const mode = core.getMode(record);
    const p = record.prediction;
    if (mode === "legacy5") return `${resultLabels[p.result] || "—"}｜舊版五牌位`;
    const parts = [];
    if (core.modeIncludesDirect(mode)) parts.push(`單張：${resultLabels[p.directResult]}`);
    if (core.modeIncludesStructure(mode)) {
      const structureResult = core.getResult(p.structureHomeGoals, p.structureAwayGoals);
      parts.push(`攻防：${p.structureHomeGoals}：${p.structureAwayGoals}（${resultLabels[structureResult]}）`);
    }
    return parts.join("｜");
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

  function describeHit(record, evaluation) {
    if (!evaluation) return ["—", "等待賽後核對"];
    if (evaluation.type === "legacy5") return [`${evaluation.hitCount}／5`, "舊版計分"];
    const parts = [];
    if (core.modeIncludesDirect(evaluation.type)) parts.push(`單張${evaluation.directResultHit ? "命中" : "未中"}`);
    if (core.modeIncludesStructure(evaluation.type)) parts.push(`攻防賽果${evaluation.structureResultHit ? "命中" : "未中"}`);
    const detail = core.modeIncludesStructure(evaluation.type)
      ? `比分${evaluation.structureExactHit ? "命中" : "未中"}／總誤差 ${evaluation.structureAbsoluteError} 球`
      : "";
    return [parts.join("／"), detail];
  }

  function renderRecords() {
    renderKpis();
    const records = core.getRecords().sort((a, b) => String(b.match.kickoff).localeCompare(String(a.match.kickoff)));
    const fragment = document.createDocumentFragment();
    records.forEach((record) => {
      const evaluation = core.calculateEvaluation(record);
      const mode = core.getMode(record);
      const [hitText, hitDetail] = describeHit(record, evaluation);
      const row = document.createElement("tr");
      row.appendChild(createTextCell(core.formatDateTime(record.match.kickoff), `${record.match.competition}｜${record.match.stage}`));
      row.appendChild(createTextCell(`${record.match.homeTeam} vs ${record.match.awayTeam}`, `${modeLabels[mode]}｜${describeCards(record)}`));
      row.appendChild(createTextCell(describePrediction(record), cardSourceLabels[record.match.cardSource] || "舊版未標記"));
      row.appendChild(createTextCell(record.actual ? `${record.actual.homeGoals}：${record.actual.awayGoals}` : "尚未輸入", record.actual ? resultLabels[evaluation.actualResult] : "等待賽後核對"));
      row.appendChild(createTextCell(hitText, hitDetail));
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

  function appendScoreItem(grid, label, hit, detail) {
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
  }

  function renderScorecard(record) {
    const container = byId("football-scorecard");
    const evaluation = core.calculateEvaluation(record);
    if (!evaluation) {
      container.classList.add("football-hidden");
      return;
    }
    const title = document.createElement("h4");
    const grid = document.createElement("div");
    grid.className = "football-score-grid";
    if (evaluation.type === "legacy5") {
      title.textContent = `舊版五牌位核心命中 ${evaluation.hitCount}／5`;
      Object.entries(evaluation.checks).forEach(([key, hit]) => appendScoreItem(grid, key, hit, "舊版欄位"));
    } else {
      title.textContent = `${modeLabels[evaluation.type]}核對`;
      if (core.modeIncludesDirect(evaluation.type)) {
        appendScoreItem(grid, "單張結果", evaluation.directResultHit, `預測 ${resultLabels[record.prediction.directResult]}／實際 ${resultLabels[evaluation.actualResult]}`);
      }
      if (core.modeIncludesStructure(evaluation.type)) {
        appendScoreItem(grid, "攻防推導賽果", evaluation.structureResultHit, `預測 ${resultLabels[evaluation.structureResult]}／實際 ${resultLabels[evaluation.actualResult]}`);
        appendScoreItem(grid, "主隊進球", evaluation.structureHomeGoalHit, `預測 ${record.prediction.structureHomeGoals}／實際 ${record.actual.homeGoals}`);
        appendScoreItem(grid, "客隊進球", evaluation.structureAwayGoalHit, `預測 ${record.prediction.structureAwayGoals}／實際 ${record.actual.awayGoals}`);
        appendScoreItem(grid, "確切比分", evaluation.structureExactHit, `總誤差 ${evaluation.structureAbsoluteError} 球`);
      }
    }
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
    addSummaryItem(summary, "模式", modeLabels[core.getMode(record)]);
    addSummaryItem(summary, "鎖定預測", describePrediction(record));
    byId("football-evaluation-summary").replaceChildren(summary);
    clearMessage("football-evaluation-message");
    renderScorecard(record);
    byId("football-evaluation-panel").classList.remove("football-hidden");
    byId("football-evaluation-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.FootballLabRender = Object.freeze({
    byId,
    setMessage,
    clearMessage,
    renderDraft,
    renderRecords,
    renderScorecard,
    openEvaluation,
  });
})();
