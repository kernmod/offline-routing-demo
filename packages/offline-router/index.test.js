import assert from "node:assert/strict";
import test from "node:test";

import { createOfflineRouter, normalizeRoutePayload } from "./index.js";

const packBytes = new Uint8Array([82, 67, 76, 80, 49]);

function nativeDouble(overrides = {}) {
  return {
    async loadPack(pack) { return { bytes: pack.byteLength, nodeCount: 8 }; },
    async route(origin, destination) {
      return { polyline: [origin, destination], pointCount: 2, distanceM: 130, totalWeight: 140 };
    },
    async benchmark(request) {
      return { device: request.device ?? "redroid14-x86_64 (AX102)", corpusSize: 1024, p50Micros: 31, p95Micros: 54 };
    },
    ...overrides
  };
}

test("the public router only accepts a routing-only native bridge", () => {
  assert.throws(() => createOfflineRouter(null), /native bridge/);
  assert.throws(() => createOfflineRouter({ nodes: [], arcs: [] }), /loadPack/);
  assert.throws(() => createOfflineRouter({ loadPack() {}, route() {} }), /benchmark/);
});

test("the pack loads before a route can cross the native boundary", async () => {
  const router = createOfflineRouter(nativeDouble());
  await assert.rejects(() => router.route({ lat: -33.8688, lng: 151.2093 }, { lat: -33.8695, lng: 151.2102 }), /pack_not_loaded/);
  await assert.rejects(() => router.loadPack(new Uint8Array()), /non-empty Uint8Array/);
  assert.deepEqual(await router.loadPack(packBytes), { bytes: 5, nodeCount: 8 });
});

test("routes retain only geometry, metrics and their local-native source", async () => {
  const router = createOfflineRouter(nativeDouble());
  await router.loadPack(packBytes);
  const route = await router.route({ lat: -33.8688, lng: 151.2093 }, { lat: -33.8695, lng: 151.2102 });
  assert.deepEqual(route, { polyline: [{ lat: -33.8688, lng: 151.2093 }, { lat: -33.8695, lng: 151.2102 }], pointCount: 2, distanceM: 130, totalWeight: 140, source: "local_native" });
  assert.equal("id" in route, false);
  assert.equal("hash" in route, false);
});

test("malformed native route payloads never reach the map", () => {
  assert.throws(() => normalizeRoutePayload(null), /object/);
  assert.throws(() => normalizeRoutePayload({ polyline: [{ lat: 0, lng: 0 }], distanceM: 0 }), /polyline/);
  assert.throws(() => normalizeRoutePayload({ polyline: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], pointCount: 2, distanceM: -1 }), /distanceM/);
});

test("the named-device benchmark always uses the 1024-query corpus", async () => {
  const router = createOfflineRouter(nativeDouble());
  await router.loadPack(packBytes);
  assert.deepEqual(await router.benchmark({ device: "redroid14-x86_64 (AX102)" }), { device: "redroid14-x86_64 (AX102)", corpusSize: 1024, p50Micros: 31, p95Micros: 54 });
});

test("native failures and malformed benchmark values remain observable", async () => {
  const router = createOfflineRouter(nativeDouble({
    async route(origin, destination) { return { polyline: [origin, destination], pointCount: 2, distanceM: 1, totalWeight: -1 }; },
    async benchmark() { return { device: "device", corpusSize: 1000, p50Micros: 9, p95Micros: 2 }; }
  }));
  await router.loadPack(packBytes);
  await assert.rejects(() => router.route({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), /totalWeight/);
  await assert.rejects(() => router.benchmark(), /corpusSize/);
});

test("a rejected native load never flips the loaded state", async () => {
  const router = createOfflineRouter(nativeDouble({ async loadPack() { throw new Error("bad native pack"); } }));
  await assert.rejects(() => router.loadPack(packBytes), /bad native pack/);
  await assert.rejects(() => router.route({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), /pack_not_loaded/);
});
