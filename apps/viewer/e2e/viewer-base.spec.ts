import { expect, test } from "@playwright/test";

const seed = {
  id: "seed-sydney-cbd-001",
  encodedGeometry: "vxdr_Awgal_Hfw@gw@",
  pointCount: 2,
  distanceM: 130,
  isSeed: true
};

test("static assets remain below the configured Vite base path", async ({ page }) => {
  const basePath = process.env.VITE_VIEWER_BASE ?? "/";
  const expectedPrefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const origin = "http://127.0.0.1:4173";
  const expectedStylePath = new URL("style.json", new URL(expectedPrefix, origin)).pathname;
  const expectedTilePath = new URL("map.pmtiles", new URL(expectedPrefix, origin)).pathname;
  const expectedGlyphUrl = new URL("glyphs/Offline%20Sans/0-255.pbf", new URL(expectedPrefix, origin)).toString();
  const styleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === expectedStylePath);
  const tileResponse = page.waitForResponse((response) => new URL(response.url()).pathname === expectedTilePath);
  await page.route("**/segments?bbox=*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ segments: [seed] }) }));

  await page.goto("./");
  await expect(page).toHaveURL(new RegExp(`${expectedPrefix.replaceAll("/", "\\/")}$`));
  await expect(page.locator("[data-map-ready=true]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-map-segments=\"1\"]")).toBeVisible({ timeout: 10_000 });
  expect((await styleResponse).ok()).toBe(true);
  expect((await tileResponse).status()).toBe(206);
  expect((await page.request.get(expectedGlyphUrl)).ok()).toBe(true);
});
