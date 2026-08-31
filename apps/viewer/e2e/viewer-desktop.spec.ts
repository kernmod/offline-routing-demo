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

test("desktop: shows a rendered WebGL map and the public seed", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByLabel("Map of Sydney CBD")).toBeVisible();
  await expect(page.locator("[data-map-ready=true]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-map-segments=\"1\"]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".map-toolbar")).toContainText(/local features/);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Segment seed-sydney-cbd-001" })).toBeVisible();
  await expect(page).toHaveScreenshot("viewer-desktop.png", { maxDiffPixelRatio: 0.04 });
});

test("API down: retains the local-map availability message", async ({ page }) => {
  await page.route("**/segments?bbox=*", async (route) => route.fulfill({ status: 503, body: '{"error":"maintenance"}' }));
  await page.goto("./");
  await expect(page.getByText("Local map is still available")).toBeVisible();
  await expect(page.getByLabel("Map of Sydney CBD")).toBeVisible();
});
