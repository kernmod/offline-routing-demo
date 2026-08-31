import { expect, test } from "@playwright/test";

const seed = {
  id: "seed-sydney-cbd-001",
  encodedGeometry: "vxdr_Awgal_Hfw@gw@",
  pointCount: 2,
  distanceM: 130,
  isSeed: true
};

test.beforeEach(async ({ page }) => {
  await page.route("**/segments?bbox=*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ segments: [seed] }) });
  });
});

test("mobile: exposes segment detail without relying on hover", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("[data-map-ready=true]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-map-segments=\"1\"]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".map-toolbar")).toContainText(/local features/);
  await page.getByRole("button", { name: "Segment seed-sydney-cbd-001" }).click();
  await expect(page.getByRole("region", { name: "Selected segment" })).toContainText("130 m");
  await expect(page).toHaveScreenshot("viewer-mobile.png", { maxDiffPixelRatio: 0.04 });
});
