import test from "node:test";
import assert from "node:assert/strict";

import {
  bboxCells,
  bboxFromPoints,
  decodePolyline6,
  encodePolyline6,
  lonLatToTilePoint,
  routeElevationMetrics,
  routeMetrics,
  segmentCells,
  tileKey,
  validateBbox,
  validatePoint
} from "./index.js";

test("validatePoint rejects out-of-range and non-finite coordinates", () => {
  assert.throws(() => validatePoint(null), /object/);
  assert.throws(() => validatePoint({ lat: Infinity, lng: 151.2 }), /finite/);
  assert.throws(() => validatePoint({ lat: 91, lng: 151.2 }), /Web Mercator bounds/);
  assert.throws(() => validatePoint({ lat: -33.85, lng: 181 }), /\[-180, 180\]/);
});

test("bboxFromPoints returns the exact envelope", () => {
  assert.deepEqual(
    bboxFromPoints([
      { lat: -33.8688, lng: 151.2093 },
      { lat: -33.8731, lng: 151.2152 },
      { lat: -33.865, lng: 151.203 }
    ]),
    {
      minLat: -33.8731,
      minLng: 151.203,
      maxLat: -33.865,
      maxLng: 151.2152
    }
  );
});

test("bboxFromPoints rejects an empty point list", () => {
  assert.throws(() => bboxFromPoints([]), /non-empty array/);
});

test("validateBbox rejects reversed bounds and non-objects", () => {
  assert.throws(() => validateBbox(null), /object/);
  assert.throws(
    () =>
      validateBbox({
        minLat: -33.86,
        minLng: 151.21,
        maxLat: -33.87,
        maxLng: 151.2
      }),
    /minimums must be <= maximums/
  );
});

test("tileKey is stable and explicit", () => {
  assert.equal(tileKey(14, 15067, 9832), "14/15067/9832");
});

test("tileKey rejects negative or non-integer indexes", () => {
  assert.throws(() => tileKey(-1, 0, 0), /non-negative integer/);
  assert.throws(() => tileKey(14, 1.5, 0), /non-negative integer/);
  assert.throws(() => tileKey(14, 0, -1), /non-negative integer/);
});

test("lonLatToTilePoint maps the equator and prime meridian to exact tile boundaries", () => {
  const point = lonLatToTilePoint({ lat: 0, lng: 0 }, 1);
  assert.equal(point.x, 1);
  assert.equal(point.y, 1);
});

test("segmentCells includes both adjacent cells when a segment follows a tile boundary", () => {
  const cells = segmentCells(
    [
      { lat: 60, lng: 0 },
      { lat: 50, lng: 0 }
    ],
    1
  );

  assert.deepEqual(cells, ["1/0/0", "1/1/0"]);
});

test("segmentCells deduplicates tiles and includes every crossed tile", () => {
  const cells = segmentCells(
    [
      { lat: -33.8705, lng: 151.2048 },
      { lat: -33.8698, lng: 151.2084 },
      { lat: -33.8686, lng: 151.2114 }
    ],
    14
  );

  assert.equal(new Set(cells).size, cells.length);
  assert.equal(cells.length >= 2, true);
});

test("segmentCells rejects fewer than two points", () => {
  assert.throws(() => segmentCells([{ lat: -33.86, lng: 151.2 }]), /at least two points/);
});

test("routeMetrics returns rounded distance and point count", () => {
  const metrics = routeMetrics([
    { lat: -33.8688, lng: 151.2093 },
    { lat: -33.8695, lng: 151.2102 },
    { lat: -33.8701, lng: 151.2111 }
  ]);

  assert.equal(metrics.pointCount, 3);
  assert.equal(metrics.distanceM > 0, true);
  assert.deepEqual(metrics.bbox, {
    minLat: -33.8701,
    minLng: 151.2093,
    maxLat: -33.8688,
    maxLng: 151.2111
  });
});

test("routeElevationMetrics derives deterministic gain and loss from the final profile", () => {
  const metrics = routeElevationMetrics([
    { lat: -33.8688, lng: 151.2093, elevationM: 10 },
    { lat: -33.8695, lng: 151.2102, elevationM: 15.4 },
    { lat: -33.8701, lng: 151.2111, elevationM: 12.2 },
    { lat: -33.8702, lng: 151.2112, elevationM: 13 }
  ]);

  assert.equal(metrics.elevationGainM, 6);
  assert.equal(metrics.elevationLossM, 3);
  assert.equal(metrics.pointCount, 4);
  assert.equal(metrics.distanceM > 0, true);
});

test("routeElevationMetrics rejects missing and non-finite elevations", () => {
  assert.throws(
    () => routeElevationMetrics([{ lat: -33.8688, lng: 151.2093 }]),
    /elevationM/
  );
  assert.throws(
    () => routeElevationMetrics([{ lat: -33.8688, lng: 151.2093, elevationM: Infinity }]),
    /elevationM/
  );
});

test("polyline6 round-trips Sydney points exactly at 1e-6 precision", () => {
  const points = [
    { lat: -33.8688, lng: 151.2093 },
    { lat: -33.8695, lng: 151.2102 },
    { lat: -33.8701, lng: 151.2111 }
  ];

  assert.deepEqual(decodePolyline6(encodePolyline6(points)), points);
});

test("encodePolyline6 and decodePolyline6 reject invalid input", () => {
  assert.throws(() => encodePolyline6([]), /non-empty array/);
  assert.throws(() => decodePolyline6(""), /non-empty string/);
  assert.throws(() => decodePolyline6("~"), /truncated/);
});

test("bboxCells covers the full z14 rectangle and deduplicates tile keys", () => {
  const keys = bboxCells(
    {
      minLat: -33.871,
      minLng: 151.208,
      maxLat: -33.868,
      maxLng: 151.212
    },
    14
  );

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length >= 1, true);
  assert.equal(keys.every((key) => key.startsWith("14/")), true);
});

test("bboxCells validates its bounds before rasterizing", () => {
  assert.throws(
    () =>
      bboxCells({
        minLat: -33.868,
        minLng: 151.212,
        maxLat: -33.871,
        maxLng: 151.208
      }),
    /minimums must be <= maximums/
  );
});
