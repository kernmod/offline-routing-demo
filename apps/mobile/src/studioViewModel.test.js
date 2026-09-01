import assert from "node:assert/strict";
import test from "node:test";

import { lineFeature, pointFeature, profileBars, stepTrimRange } from "./studioViewModel.ts";

const geometry = [
  { lat: -33.87, lng: 151.20, elevationM: 10 },
  { lat: -33.869, lng: 151.21, elevationM: 30 },
  { lat: -33.868, lng: 151.22, elevationM: 20 }
];

test("map view models preserve lng/lat ordering and elevation metadata", () => {
  assert.deepEqual(lineFeature(geometry).features[0].geometry.coordinates[0], [151.2, -33.87, 10]);
  assert.equal(lineFeature([]).features.length, 0);
  assert.equal(pointFeature(geometry, "cursor").features[2].properties.kind, "cursor");
});

test("profile bars normalize public DEM elevations and remain finite on flat profiles", () => {
  assert.deepEqual(profileBars(geometry.map((point, index) => ({ ...point, distanceM: index * 100 })), 40), [0, 40, 20]);
  assert.deepEqual(profileBars(geometry.map((point) => ({ ...point, elevationM: 12, distanceM: 0 })), 40), [20, 20, 20]);
  assert.deepEqual(profileBars([], 40), []);
});

test("trim stepping clamps both handles and never crosses the selection", () => {
  assert.deepEqual(stepTrimRange(1000, null, "start", 1), { startM: 50, endM: 1000 });
  assert.deepEqual(stepTrimRange(1000, { startM: 100, endM: 200 }, "start", 99), { startM: 150, endM: 200 });
  assert.deepEqual(stepTrimRange(1000, { startM: 100, endM: 200 }, "end", -99), { startM: 100, endM: 150 });
  assert.deepEqual(stepTrimRange(0, null, "end", 1), { startM: 0, endM: 0 });
});
