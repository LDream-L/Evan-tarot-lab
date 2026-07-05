// 世足賽事驗證｜後續牌組輸入保留
// refresh：O(p)，p<=10；空間 O(p)。
(function () {
  "use strict";
  const core = window.FootballLabCore;
  if (!core) return;
  const values = new Map();
  let pending = false;

  const byId = (id) => document.getElementById(id);
  const text = (id) => String(byId(id)?.value || "").trim();
  const intOrNull = (id) => {
    const raw = text(id);
    if (raw === "") return null;
    const value = Number(raw);
    return Number.isInteger(value) ? value : null;
  };

  function remember() {
    document.querySelectorAll("#football-edit-extra-cards select, #football-edit-penalty-cards select")
      .forEach((select) => values.set(select.id, select.value));
  }

  function restore() {
    values.forEach((value, id) => {
      const select = byId(id);
      if (select) select.value = value;
    });
  }

  function results(mode, direct, home, away) {
    const list = [];
    if (core.modeIncludesDirect(mode) && ["H", "D", "A"].includes(direct)) list.push(direct);
    if (core.modeIncludesStructure(mode) && Number.isInteger(home) && Number.isInteger(away)) {
      list.push(core.getResult(home, away));
    }
    return list;
  }

  function refresh() {
    pending = false;
    restore();
    const record = core.getRecord(text("football-edit-id"));
    if (!record) return;
    const mode = core.getMode(record);
    const baseDraw = results(
      mode,
      record.prediction?.directResult,
      intOrNull("football-edit-structure-home-goals"),
      intOrNull("football-edit-structure-away-goals")
    ).includes("D");
    const rule = record.match?.knockoutRule || record.prediction?.knockout?.rule || "extra-time-then-penalties";
    const extra = byId("football-edit-extra-stage");
    const penalty = byId("football-edit-penalty-stage");
    const showExtra = baseDraw && rule !== "penalties-only";
    extra?.classList.toggle("football-hidden", !showExtra);
    const extraDraw = results(
      mode,
      text("football-edit-extra-direct-result"),
      intOrNull("football-edit-stage-extra-home"),
      intOrNull("football-edit-stage-extra-away")
    ).includes("D");
    penalty?.classList.toggle("football-hidden", !(baseDraw && (rule === "penalties-only" || (showExtra && extraDraw))));
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => requestAnimationFrame(refresh));
  }

  document.addEventListener("input", (event) => {
    if (event.target.closest?.("#football-edit-extra-cards, #football-edit-penalty-cards")) remember();
    schedule();
  }, true);
  document.addEventListener("change", (event) => {
    if (event.target.closest?.("#football-edit-extra-cards, #football-edit-penalty-cards")) remember();
    schedule();
  }, true);
  byId("football-records-body")?.addEventListener("click", (event) => {
    if (!event.target.closest?.('button[data-action="edit-match"]')) return;
    values.clear();
    setTimeout(() => { remember(); schedule(); }, 0);
  });
})();