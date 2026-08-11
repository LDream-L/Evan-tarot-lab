const { test, expect } = require("@playwright/test");

const BLOCKED_EXTERNAL_HOSTS = ["accounts.google.com", "script.google.com", "script.googleusercontent.com"];

/** 固定三個外部 host：時間／空間 O(1)。 */
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (BLOCKED_EXTERNAL_HOSTS.includes(host)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

/** 固定現有 KPI 卡：時間／DOM 空間 O(k)，k 為固定卡片數。 */
test("滾動績效卡片顯示本期、比較期、差異與明確樣本限制", async ({ page }) => {
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.FootballLabBundle?.ready))).toBe(true);
  await expect.poll(() => page.locator("#football-kpis > .football-kpi").count()).toBeGreaterThanOrEqual(7);
  await page.locator("#football-stats-accordion > summary").click();
  await page.locator("#football-performance-observer > summary").click();
  await expect(page.locator("#football-kpis .football-kpi-readable-label").first()).toBeVisible();

  await page.evaluate(() => {
    const grid = document.getElementById("football-kpis");
    const originalLabelOf = (card) => card.querySelector(":scope > small")?.textContent.trim() || "";
    const findCard = (labels) => Array.from(grid.querySelectorAll(":scope > .football-kpi"))
      .find((item) => labels.includes(originalLabelOf(item)));
    const byOriginalLabels = (...labels) => {
      const card = findCard(labels);
      if (!card) throw new Error(`找不到 KPI：${labels.join(" / ")}`);
      return card;
    };
    const setBase = (labels, value, detail) => {
      const card = byOriginalLabels(...labels);
      card.querySelector(":scope > strong").textContent = value;
      const originalDetail = Array.from(card.children).find((child) => child.tagName === "SPAN");
      if (!originalDetail) throw new Error(`找不到 KPI 明細：${labels.join(" / ")}`);
      originalDetail.textContent = detail;
      const meta = card.querySelector(":scope > .football-trend-card-meta");
      if (!meta) throw new Error(`找不到 KPI 比較區：${labels.join(" / ")}`);
      meta.replaceChildren();
      return card;
    };
    const addTrend = (card, delta, state, stateClass = "is-unknown") => {
      const meta = card.querySelector(":scope > .football-trend-card-meta");
      const line = document.createElement("div");
      line.className = `football-trend-detail ${stateClass}`;
      const deltaNode = document.createElement("span");
      deltaNode.className = "football-trend-delta";
      deltaNode.textContent = delta;
      const stateNode = document.createElement("strong");
      stateNode.className = "football-trend-state";
      stateNode.textContent = state;
      line.append(deltaNode, stateNode);
      meta.appendChild(line);
    };

    const total = setBase(["總紀錄"], "10", "10 場已核對");
    total.querySelector(":scope > .football-trend-card-meta").textContent = "截至 2026-07-12 最近 7 天";

    // 空資料頁固定存在舊版單張 KPI；其命中率、比較與樣本門檻和新版單張共用同一呈現邏輯。
    const direct = setBase(["舊版單張賽果", "單張賽果"], "20%", "2／10");
    addTrend(direct, "較前 7 天 +7.5 個百分點", "樣本不足，暫不確認趨勢");

    const structure = setBase(["攻防推導賽果", "攻防推論賽果"], "40%", "4／10");
    addTrend(structure, "較前 7 天 -2.9 個百分點", "大致持平", "is-flat");

    const exact = setBase(["攻防確切比分"], "0%", "平均總誤差 2.2 球");
    addTrend(exact, "確切比分較前 7 天 -14.3 個百分點", "觀察到下降，尚未確認", "is-down");
    addTrend(exact, "誤差較前 7 天 +0.56 球", "平均誤差惡化，尚未確認", "is-down");

    const agreement = setBase(
      ["雙模型一致率", "雙模型和局判斷一致率", "雙模型同判斷一致率"],
      "90%",
      "9／10"
    );
    addTrend(agreement, "較前 7 天 -10 個百分點", "觀察到下降，尚未確認", "is-down");

    const market = setBase(["市場熱門基準"], "—", "0／0");
    addTrend(market, "較前 7 天 —", "比較資料不足");
  });

  const direct = page.locator("#football-kpis > .football-kpi").filter({ hasText: "舊版單張｜賽果命中率" });
  await expect(direct).toContainText("本期20%（2／10 場）");
  await expect(direct).toContainText("前 7 天約 12.5%（依顯示差異回推）");
  await expect(direct).toContainText("比較期未達 10 場；本期已達門檻");
  await expect(direct.locator(":scope > small")).toBeHidden();
  await expect(direct.locator(":scope > small")).toHaveText(/舊版單張賽果|單張賽果/);

  const exact = page.locator("#football-kpis > .football-kpi").filter({ hasText: "攻防｜正確比分命中率" });
  await expect(exact).toContainText("正確比分0%（0／10 場）");
  await expect(exact).toContainText("平均總誤差2.2 球（越低越好）");
  await expect(exact).toContainText("前 7 天平均誤差約 1.64 球（依顯示差異回推）");

  const agreement = page.locator("#football-kpis > .football-kpi").filter({ hasText: "雙模型一致率（非命中率）" });
  await expect(agreement).toContainText("兩者一致不代表預測正確");
  await expect(agreement).toContainText("一致程度變化不等於預測準確度變化");

  const market = page.locator("#football-kpis > .football-kpi").filter({ hasText: "市場熱門選項命中率" });
  await expect(market).toContainText("本期沒有同時具備主勝、和局、客勝賠率的已核對紀錄");

  await expect(page.locator("#football-kpi-legend")).toContainText("診斷指標＝模型行為，不等於預測正確");
});
