import assert from "node:assert/strict";
import test from "node:test";

import {
  lineFeature,
  pointFeature,
  profilePath,
  profileRangeViewModel,
  selectionFromProfileGesture,
  stepTrimRange,
  xToProfileDistance
} from "./studioViewModel.ts";

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

test("trim stepping clamps both handles and never crosses the selection", () => {
  assert.deepEqual(stepTrimRange(1000, null, "start", 1), { startM: 50, endM: 1000 });
  assert.deepEqual(stepTrimRange(1000, { startM: 100, endM: 200 }, "start", 99), { startM: 150, endM: 200 });
  assert.deepEqual(stepTrimRange(1000, { startM: 100, endM: 200 }, "end", -99), { startM: 100, endM: 150 });
  assert.deepEqual(stepTrimRange(0, null, "end", 1), { startM: 0, endM: 0 });
});

test("profile gestures map horizontal touch positions to clamped route distances", () => {
  assert.equal(xToProfileDistance(-40, 200, 1000), 0);
  assert.equal(xToProfileDistance(50, 200, 1000), 250);
  assert.equal(xToProfileDistance(240, 200, 1000), 1000);
  assert.equal(xToProfileDistance(Number.NaN, 200, 1000), 0);
  assert.equal(xToProfileDistance(50, 0, 1000), 0);
});

test("direct trim gestures clamp handles and preserve a minimum selectable span", () => {
  assert.deepEqual(selectionFromProfileGesture(1000, null, "start", 300), { startM: 300, endM: 1000 });
  assert.deepEqual(selectionFromProfileGesture(1000, { startM: 300, endM: 700 }, "start", 900), { startM: 699, endM: 700 });
  assert.deepEqual(selectionFromProfileGesture(1000, { startM: 300, endM: 700 }, "end", 100), { startM: 300, endM: 301 });
  assert.deepEqual(selectionFromProfileGesture(0, null, "start", 10), { startM: 0, endM: 0 });
});

test("profile range view model exposes selected and cursor percentages for mobile rendering", () => {
  assert.deepEqual(profileRangeViewModel(1000, { startM: 250, endM: 750 }, 500), {
    startPct: 25,
    endPct: 75,
    selectedLeftPct: 25,
    selectedWidthPct: 50,
    beforeWidthPct: 25,
    afterLeftPct: 75,
    cursorPct: 50
  });
  assert.deepEqual(profileRangeViewModel(1000, null, null), {
    startPct: 0,
    endPct: 100,
    selectedLeftPct: 0,
    selectedWidthPct: 100,
    beforeWidthPct: 0,
    afterLeftPct: 100,
    cursorPct: null
  });
});

test("mobile elevation profile uses a finite vector path including flat routes", () => {
  const profile = geometry.map((point, index) => ({ ...point, distanceM: index * 100 }));
  assert.equal(profilePath(profile), "M0.00,132.00 L300.00,10.00 L600.00,71.00");
  assert.equal(profilePath(profile.map((point) => ({ ...point, elevationM: 12 }))), "M0.00,132.00 L300.00,132.00 L600.00,132.00");
  assert.equal(profilePath([]), "");
  assert.equal(profilePath(profile.slice(0, 1)), "");
  assert.doesNotMatch(profilePath(profile), /NaN|Infinity/);
});
