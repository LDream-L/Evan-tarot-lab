// 世足賽事驗證 v1.2.3｜晉級欄位顯示條件
// 只有賽前真的填了晉級預測，賽後才顯示實際晉級隊伍。
// openEvaluation：O(1) 時間／O(1) 空間。
(function patchFootballAdvanceVisibility() {
  "use strict";

  const original = window.FootballLabRender;
  if (!original || typeof original.openEvaluation !== "function") return;

  /**
   * 先沿用原本賽後視窗，再依是否有賽前晉級預測決定顯示欄位。
   * 暴力替代：所有比賽都顯示，再要求使用者自行判斷是否適用。
   * 本版選擇條件顯示，避免無關欄位干擾一般賽事。
   * 時間複雜度：O(1)
   * 空間複雜度：O(1)
   */
  function openEvaluation(record) {
    original.openEvaluation(record);

    const select = document.getElementById("football-actual-advance");
    const field = select?.closest("label");
    const hasAdvancePrediction = record?.prediction?.advance === "H" || record?.prediction?.advance === "A";

    if (field) field.classList.toggle("football-hidden", !hasAdvancePrediction);
    if (!hasAdvancePrediction && select) select.value = "";
  }

  window.FootballLabRender = Object.freeze({
    ...original,
    openEvaluation,
  });
})();
