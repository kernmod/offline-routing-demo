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

test("desktop: edits, trims and publishes a multipoint route with local WASM only", async ({ page }) => {
  const routingRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/route(?:\?|$)/.test(new URL(request.url()).pathname)) routingRequests.push(request.url());
  });
  await page.route("**/v2/segments", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      name: string;
      geometry: Array<{ lat: number; lng: number; elevationM: number }>;
      controlPoints: number[];
    };
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(["controlPoints", "geometry", "name"]);
    expect(body.geometry.length).toBeGreaterThan(2);
    expect(body.geometry.every((point) => Number.isFinite(point.elevationM))).toBe(true);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "779a8cf1-e8e5-4590-8aa8-f46d30c3194d",
        name: body.name,
        publicationState: "published",
        encodedGeometry: seed.encodedGeometry,
        pointCount: body.geometry.length,
        distanceM: 422,
        isSeed: false,
        elevationsM: body.geometry.map((point) => point.elevationM),
        controlPoints: body.controlPoints,
        elevationGainM: 21,
        elevationLossM: 30,
        metricsVersion: 2,
        createdAt: "2026-09-01T00:00:00.000Z",
        expiresAt: null
      })
    });
  });

  await page.goto("./");
  await expect(page.getByText("Add at least two control points.")).toBeVisible({ timeout: 15_000 });
  const canvas = page.locator(".maplibregl-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("map canvas has no bounds");
  for (const [xRatio, yRatio] of [[0.32, 0.67], [0.48, 0.55], [0.64, 0.46]]) {
    await canvas.click({ position: { x: bounds.width * xRatio, y: bounds.height * yRatio } });
  }

  await expect(page.getByText("3 control points")).toBeVisible();
  await expect(page.getByText("Route ready · computed locally")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("img", { name: "Elevation profile" })).toBeVisible();
  await page.getByRole("button", { name: "Close loop" }).click();
  await expect(page.getByRole("button", { name: "Open loop" })).toBeVisible();
  await expect(page.getByText("Route ready · computed locally")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("slider", { name: "Selection end" }).press("ArrowLeft");
  await expect(page.getByText("selected")).toBeVisible();

  await page.getByRole("textbox", { name: "Segment name" }).fill("Harbour field test");
  await page.getByRole("button", { name: "Review publication" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm publication" })).toBeVisible();
  await page.getByRole("button", { name: "Publish segment" }).click();

  await expect(page.getByText("Published · Harbour field test")).toBeVisible();
  await expect(page.getByLabel("Route Studio editor")).toHaveAttribute("data-draft-status", "published");
  await expect(page.getByRole("button", { name: "Segment Harbour field test" })).toHaveAttribute("aria-pressed", "true");
  expect(routingRequests).toEqual([]);
});
