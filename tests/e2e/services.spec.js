const { test, expect } = require("@playwright/test");

/**
 * 將雲端服務固定成可預期測試資料，並阻擋不影響公開頁的 Google 外部元件。
 * 每次請求判斷時間／空間 O(1)。
 *
 * 替代方案比較：直接依賴正式 Apps Script 會受網路與資料內容影響；
 * 本測試攔截服務 API，專注驗證公開頁的資料契約與操作流程。
 */
async function installCloudRoutes(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "services") {
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
              priceLabel: "NT$1,200／次",
              durationLabel: "2 個工作天",
              deliveryLabel: "文字報告",
              followUpLabel: "3 日內追問 1 次",
              policyNote: "送出需求後另行確認。",
              bookingTopic: "relationship-plus",
              sortOrder: 50,
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
}

test("公開服務可由雲端更新並帶入預約選項", async ({ page }) => {
  await installCloudRoutes(page);
  await page.goto("/services.html", { waitUntil: "domcontentloaded" });

  const list = page.locator("#service-list");
  await expect(list).toHaveAttribute("aria-busy", "false");
  await expect(list).toContainText("關係動態完整占卜");
  await expect(list).toContainText("NT$1,200／次");
  await expect(list).toContainText("3 日內追問 1 次");

  await list.getByRole("button", { name: "選擇這個項目" }).click();
  await expect(page.locator('#booking-form select[name="topic"]')).toHaveValue("relationship-plus");
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
  await expect(page.locator("#service-admin-price")).toBeAttached();
});
