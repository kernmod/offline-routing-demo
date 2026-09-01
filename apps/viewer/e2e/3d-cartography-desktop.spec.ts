import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/segments?bbox=*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ segments: [] })
  }));
});

test("starts in 3D and keeps the map interactive across accessible view changes", async ({ page }) => {
  await page.goto("./");
  const map = page.getByLabel("Map of Sydney CBD");
  const canvas = page.locator(".maplibregl-canvas");

  await expect(page.locator("[data-map-ready=true]")).toBeVisible({ timeout: 10_000 });
  await expect(map).toHaveAttribute("data-map-mode", "3d");
  await expect(canvas).toBeVisible();

  await page.getByRole("button", { name: "Switch map to 2D" }).click();
  await expect(map).toHaveAttribute("data-map-mode", "2d");
  await expect(page.getByRole("button", { name: "Switch map to 3D" })).toBeVisible();
  await expect(canvas).toBeVisible();

  await page.getByRole("button", { name: "Switch map to 3D" }).click();
  await expect(map).toHaveAttribute("data-map-mode", "3d");
  await expect(page.getByRole("button", { name: "Switch map to 2D" })).toBeVisible();
});

test("loads the public style with an extruded-building layer", async ({ page }) => {
  const basePath = process.env.VITE_VIEWER_BASE ?? "/";
  const expectedPrefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const styleUrl = new URL("style.json", new URL(expectedPrefix, "http://127.0.0.1:4173"));

  const response = await page.request.get(styleUrl.toString());
  expect(response.ok()).toBe(true);
  const style = await response.json() as { layers?: Array<{ id?: string; type?: string }> };
  expect(style.layers).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fill-extrusion" })
  ]));
});
