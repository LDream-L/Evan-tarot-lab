const { test, expect } = require("@playwright/test");

/**
 * 將雲端服務固定成可預期測試資料，並阻擋不影響公開頁的 Google 外部元件。
 * 每次請求判斷時間／空間 O(1)。
 *
 * 替代方案比較：直接依賴正式 Apps Script 會受網路與資料內容影響；
 * 本測試攔截服務 API，專注驗證公開頁的多方案契約與操作流程。
 */
async function installCloudRoutes(page, options = {}) {
  const state = { serviceRequests: 0 };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "services") {
      state.serviceRequests += 1;
      if (options.serviceDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.serviceDelayMs));
      }
      if (options.serviceFailure) {
        return route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          services: [
            {
              id: "relationship-plus",
              title: "關係動態完整占卜",
              summary: "測試服務資料由雲端載入。",
              suitableFor: ["曖昧", "斷聯"],
              focus: ["互動狀態", "下一步"],
              priceLabel: "費用依方案",
              durationLabel: "依問題規模",
              deliveryLabel: "文字或語音",
              followUpLabel: "依方案",
              policyNote: "送出需求後另行確認。",
              bookingTopic: "relationship-plus",
              sortOrder: 50,
              plans: [
                {
                  id: "full-text",
                  status: "published",
                  title: "多層次問題・文字完整版",
                  description: "包含關係脈絡、雙方狀態與下一步整理。",
                  priceLabel: "NT$1,200／次",
                  durationLabel: "2 個工作天",
                  deliveryMode: "text",
                  deliveryLabel: "文字報告",
                  followUpLabel: "3 日內追問 1 次",
                  calculationLabel: "含時間線比對",
                  sortOrder: 20,
                  bookingValue: "relationship-plus--full-text",
                },
              ],
            },
          ],
        }),
      });
    }

    if (["accounts.google.com", "script.google.com", "script.googleusercontent.com"].includes(url.hostname)) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  return state;
}

test("公開服務可由雲端更新並帶入方案預約選項", async ({ page }) => {
  // 保留足夠的 loading 視窗，避免快速 CI 主機在兩個 assertion 間剛好完成 mock 回應。
  const cloud = await installCloudRoutes(page, { serviceDelayMs: 1200 });
  await page.goto("/services.html", { waitUntil: "domcontentloaded" });

  const list = page.locator("#service-list");
  await expect(list).toHaveAttribute("data-source", "loading");
  await expect(list).toContainText("正在載入目前公開的方案");
  await expect(list).not.toContainText("人際 / 感情動態占卜");
  await expect(list).not.toContainText("工作 / 職涯路線占卜");
  await expect(list).not.toContainText("主題深度占卜");
  await expect(list).toHaveAttribute("aria-busy", "false");
  expect(cloud.serviceRequests).toBe(1);
  await expect(list).toContainText("關係動態完整占卜");
  await expect(list).toContainText("多層次問題・文字完整版");
  await expect(list).toContainText("NT$1,200／次");
  await expect(list).not.toContainText("3 日內追問 1 次");
  await expect(list).not.toContainText("含時間線比對");

  const card = list.locator(".service-plan-card");
  await expect(card.locator(".service-plan-details")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "查看詳情" })).toBeVisible();

  await card.getByRole("button", { name: "查看詳情" }).click();
  const dialog = page.locator("#service-plan-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#service-plan-dialog-title")).toHaveText("多層次問題・文字完整版");
  await expect(dialog.locator("#service-plan-dialog-price")).toHaveText("NT$1,200／次");
  await expect(dialog).toContainText("2 個工作天");
  await expect(dialog).toContainText("文字報告");
  await expect(dialog).toContainText("含時間線比對");
  await expect(dialog).toContainText("3 日內追問 1 次");
  await expect(dialog).toContainText("曖昧");
  await expect(dialog).toContainText("下一步");
  const dialogFontSize = await dialog.locator("#service-plan-dialog-description")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(dialogFontSize).toBeGreaterThanOrEqual(16);

  await dialog.getByRole("button", { name: "選擇此方案" }).click();
  await expect(page.locator('#booking-form select[name="topic"]')).toHaveValue("relationship-plus--full-text");
  await expect(page.locator('#booking-form select[name="mode"]')).toHaveValue("text");
  await expect(page.locator("#booking-selected-plan")).toContainText("多層次問題・文字完整版");
});

test("雲端方案失敗時不以虛擬服務冒充正式內容", async ({ page }) => {
  await installCloudRoutes(page, { serviceFailure: true });
  await page.goto("/services.html", { waitUntil: "domcontentloaded" });

  const list = page.locator("#service-list");
  await expect(list).toHaveAttribute("aria-busy", "false");
  await expect(list).toHaveAttribute("data-source", "unavailable");
  await expect(list).toContainText("目前無法載入公開方案");
  await expect(list.getByRole("button", { name: "重新載入方案" })).toBeVisible();
  await expect(list).not.toContainText("人際 / 感情動態占卜");
  await expect(list).not.toContainText("工作 / 職涯路線占卜");
  await expect(list).not.toContainText("主題深度占卜");
});

test("一般訪客看不到私人修煉入口", async ({ page }) => {
  await installCloudRoutes(page);
  await page.goto("/lab.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-admin-only-lab-item="private-access"]')).toBeHidden();
  await expect(page.locator('[data-admin-only-lab-item="private-practice"]')).toBeHidden();
  await expect(page.locator("#lab-project-count")).toHaveText("3");
});

test("服務管理頁未通過登入時不開放工作區", async ({ page }) => {
  await installCloudRoutes(page);
  await page.goto("/service-admin.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#service-admin-gate")).toBeVisible();
  await expect(page.locator("#service-admin-workspace")).toBeHidden();
  await expect(page.locator("#service-admin-add-plan")).toBeAttached();
  await expect(page.locator("#service-admin-price")).toBeAttached();
});
