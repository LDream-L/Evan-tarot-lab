// 世足賽事驗證 v1.6.0｜單張能量表單相容
// refresh：O(1) 時間／O(1) 空間。
(function initFootballDirectEnergyFormCompatibility() {
  "use strict";

  const mode = document.getElementById("football-mode");
  const goalBand = document.getElementById("football-direct-goal-band");
  const drawTendency = document.getElementById("football-direct-draw-tendency");
  if (!mode || !goalBand || !drawTendency) return;

  function refresh() {
    const active = mode.value === "direct" || mode.value === "dual";
    [goalBand, drawTendency].forEach((field) => {
      field.required = false;
      field.disabled = !active;
    });
  }

  mode.addEventListener("change", refresh);
  window.addEventListener("football-energy-render", refresh);
  refresh();
})();
