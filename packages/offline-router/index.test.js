import assert from "node:assert/strict";
import test from "node:test";

import { createOfflineRouter, normalizeRoutePayload } from "./index.js";

const packBytes = new Uint8Array([82, 67, 76, 80, 49]);

function multipointPayload(controls, closedLoop) {
  const elevated = controls.map((point, index) => ({ ...point, elevationM: 10 + index * 4 }));
  const pairs = elevated.slice(0, -1).map((point, index) => [point, elevated[index + 1]]);
  if (closedLoop) pairs.push([elevated.at(-1), elevated[0]]);
  const legs = pairs.map(([origin, destination], index) => {
    const delta = destination.elevationM - origin.elevationM;
    return {
      geometry: [origin, destination],
      distanceM: 100,
      totalWeight: 10 + index,
      elevationGainM: Math.max(delta, 0),
      elevationLossM: Math.max(-delta, 0)
    };
  });
  const geometry = [...elevated, ...(closedLoop ? [elevated[0]] : [])];
  return {
    geometry,
    legs,
    controlCount: controls.length,
    closedLoop,
    distanceM: legs.length * 100,
    totalWeight: legs.reduce((sum, leg) => sum + leg.totalWeight, 0),
    elevationGainM: legs.reduce((sum, leg) => sum + leg.elevationGainM, 0),
    elevationLossM: legs.reduce((sum, leg) => sum + leg.elevationLossM, 0)
  };
}

function nativeDouble(overrides = {}) {
  return {
    async loadPack(pack) { return { bytes: pack.byteLength, nodeCount: 8 }; },
    async route(origin, destination) {
      return { geometry: [{ ...origin, elevationM: 10 }, { ...destination, elevationM: 18 }], pointCount: 2, distanceM: 130, totalWeight: 140, elevationGainM: 8, elevationLossM: 0 };
    },
    async routeMany(controls, closedLoop) {
      return multipointPayload(controls, closedLoop);
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
  assert.throws(() => createOfflineRouter({ loadPack() {}, route() {} }), /routeMany/);
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
  assert.deepEqual(route, {
    geometry: [{ lat: -33.8688, lng: 151.2093, elevationM: 10 }, { lat: -33.8695, lng: 151.2102, elevationM: 18 }],
    polyline: [{ lat: -33.8688, lng: 151.2093, elevationM: 10 }, { lat: -33.8695, lng: 151.2102, elevationM: 18 }],
    pointCount: 2,
    distanceM: 130,
    totalWeight: 140,
    elevationGainM: 8,
    elevationLossM: 0,
    source: "local_native"
  });
  assert.equal("id" in route, false);
  assert.equal("hash" in route, false);
});

test("malformed native route payloads never reach the map", () => {
  assert.throws(() => normalizeRoutePayload(null), /object/);
  assert.throws(() => normalizeRoutePayload({ polyline: [{ lat: 0, lng: 0 }], distanceM: 0 }), /geometry/);
  assert.throws(() => normalizeRoutePayload({ polyline: [{ lat: 0, lng: 0, elevationM: 0 }, { lat: 0, lng: 1, elevationM: 0 }], pointCount: 2, distanceM: -1 }), /distanceM/);
  assert.throws(() => normalizeRoutePayload({ geometry: [{ lat: 0, lng: 0, elevationM: 0 }, { lat: 0, lng: 1, elevationM: 2 }], pointCount: 2, distanceM: 1, totalWeight: 1, elevationGainM: 1, elevationLossM: 0 }), /invariant/);
});

test("routeMany validates 2..16 controls, preserves order and supports closed loops", async () => {
  const calls = [];
  const router = createOfflineRouter(nativeDouble({
    async routeMany(controls, closedLoop) {
      calls.push([controls, closedLoop]);
      return multipointPayload(controls, closedLoop);
    }
  }));
  await router.loadPack(packBytes);
  const controls = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }];
  const route = await router.routeMany(controls, { closedLoop: true });
  assert.deepEqual(calls, [[controls, true]]);
  assert.equal(route.controlCount, 3);
  assert.equal(route.closedLoop, true);
  await assert.rejects(() => router.routeMany([controls[0]]), /2 and 16/);
  await assert.rejects(() => router.routeMany(Array(17).fill(controls[0])), /2 and 16/);
  await assert.rejects(() => router.routeMany(controls, { closedLoop: "yes" }), /closedLoop/);
  await assert.rejects(() => router.routeMany(controls, null), /options/);
});

test("routeMany rejects malformed native boundaries and inconsistent leg aggregates", async () => {
  const controls = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }];
  const cases = [
    [() => null, /object/],
    [(payload) => ({ ...payload, controlCount: 1 }), /controlCount/],
    [(payload) => ({ ...payload, closedLoop: "false" }), /closedLoop/],
    [(payload) => ({ ...payload, legs: {} }), /legs must be an array/],
    [(payload) => ({ ...payload, controlCount: 2 }), /match the request/],
    [(payload) => ({ ...payload, legs: payload.legs.slice(0, 1) }), /adjacent controls/],
    [(payload) => {
      payload.legs[1].geometry[0] = { ...payload.legs[1].geometry[0], lat: 0.1 };
      return payload;
    }, /not adjacent/],
    [(payload) => {
      payload.geometry[1] = { ...payload.geometry[1], lat: 0.1 };
      return payload;
    }, /geometry does not match/],
    [(payload) => ({ ...payload, distanceM: payload.distanceM + 1 }), /distanceM does not match/]
  ];

  for (const [mutate, expected] of cases) {
    const router = createOfflineRouter(nativeDouble({
      async routeMany(requestControls, closedLoop) {
        const payload = structuredClone(multipointPayload(requestControls, closedLoop));
        return mutate(payload);
      }
    }));
    await router.loadPack(packBytes);
    await assert.rejects(() => router.routeMany(controls), expected);
  }
});

test("the named-device benchmark always uses the 1024-query corpus", async () => {
  const router = createOfflineRouter(nativeDouble());
  await router.loadPack(packBytes);
  assert.deepEqual(await router.benchmark({ device: "redroid14-x86_64 (AX102)" }), { device: "redroid14-x86_64 (AX102)", corpusSize: 1024, p50Micros: 31, p95Micros: 54 });
});

test("native failures and malformed benchmark values remain observable", async () => {
  const router = createOfflineRouter(nativeDouble({
    async route(origin, destination) { return { polyline: [{ ...origin, elevationM: 0 }, { ...destination, elevationM: 0 }], pointCount: 2, distanceM: 1, totalWeight: -1, elevationGainM: 0, elevationLossM: 0 }; },
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
