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

test("mobile: creates a local multipoint draft with touch-sized accessible controls", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText("Add at least two control points.")).toBeVisible({ timeout: 15_000 });
  const canvas = page.locator(".maplibregl-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("map canvas has no bounds");
  await page.touchscreen.tap(bounds.x + bounds.width * .34, bounds.y + bounds.height * .62);
  await page.touchscreen.tap(bounds.x + bounds.width * .53, bounds.y + bounds.height * .48);
  await page.touchscreen.tap(bounds.x + bounds.width * .68, bounds.y + bounds.height * .4);

  await expect(page.getByText("3 control points")).toBeVisible();
  await expect(page.getByText("Route ready · computed locally")).toBeVisible({ timeout: 10_000 });
  const deleteVia = page.getByRole("button", { name: "Delete via 1" });
  await deleteVia.scrollIntoViewIfNeeded();
  const size = await deleteVia.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(36);
  expect(size?.height).toBeGreaterThanOrEqual(36);
  await page.getByRole("button", { name: "Close loop" }).click();
  await expect(page.getByRole("button", { name: "Open loop" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Elevation profile" })).toBeVisible();
});
