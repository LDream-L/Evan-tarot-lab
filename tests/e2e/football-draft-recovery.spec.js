import { test, expect } from "@playwright/test";

/**
 * 模擬登入到期造成的同分頁 reload。
 * 測試準備／驗證時間 O(p+b)，空間 O(p+b)，p<=5、b=1。
 * 更快替代方案比較：只測 sessionStorage JSON 會漏掉真正的 module 重載與 DOM 恢復；
 * 本測試實際 reload 頁面，驗證隨機牌、判讀與投注都維持原值。
 */
test("未鎖定的隨機牌、判讀與投注在重新整理後完整恢復", async ({ page }) => {
  await page.route(/googleapis|accounts\.google|script\.google|gstatic/, (route) => route.abort());
  await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(
    window.FootballLabBundle?.ready
    && window.FootballDraftPersistenceRuntime
    && window.FootballBettingRuntime?.restoreDraftBets
  ));

  const before = await page.evaluate(() => {
    sessionStorage.removeItem(window.FootballDraftPersistenceRuntime.storageKey);
    window.FootballLabCore.clearDraft();

    const match = {
      competition: "草稿恢復測試賽",
      stage: "小組賽",
      kickoff: "2026-08-12T12:00:00.000Z",
      infoState: "unreleased",
      homeTeam: "測試主隊",
      awayTeam: "測試客隊",
      mode: "structure",
      cardSource: "random",
      odds: { home: null, draw: null, away: null },
      knownInfo: "登入到期前資訊",
      sportType: "football",
    };

    const draft = window.FootballLabCore.createDraft(match);
    window.FootballLabRender.renderDraft(draft);

    const notes = document.getElementById("football-structure-notes");
    notes.value = "這段判讀必須在 reload 後保留";
    notes.dispatchEvent(new Event("input", { bubbles: true }));

    window.FootballBettingRuntime.restoreDraftBets([
      {
        id: "draft-bet-1",
        marketType: "match_result",
        selection: "H",
        odds: 2.25,
        stake: 200,
      },
    ], draft);

    window.FootballDraftPersistenceRuntime.saveNow(true);
    return {
      cards: draft.cards.map((card) => ({ name: card.name, orientation: card.orientation, position: card.position })),
      drawnAt: draft.drawnAt,
    };
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(
    window.FootballLabBundle?.ready
    && window.FootballDraftPersistenceRuntime
    && window.FootballLabCore?.getDraft?.()
  ));

  const after = await page.evaluate(() => {
    const draft = window.FootballLabCore.getDraft();
    return {
      cards: draft.cards.map((card) => ({ name: card.name, orientation: card.orientation, position: card.position })),
      drawnAt: draft.drawnAt,
      notes: document.getElementById("football-structure-notes")?.value || "",
      bets: window.FootballBettingRuntime.getDraftBets(),
    };
  });

  expect(after.cards).toEqual(before.cards);
  expect(after.drawnAt).toBe(before.drawnAt);
  expect(after.notes).toBe("這段判讀必須在 reload 後保留");
  expect(after.bets).toHaveLength(1);
  expect(after.bets[0]).toMatchObject({
    marketType: "match_result",
    selection: "H",
    odds: 2.25,
    stake: 200,
  });
});
