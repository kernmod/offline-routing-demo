import assert from "node:assert/strict";
import test from "node:test";
import { createDemoController, SYDNEY_BBOX } from "./app.js";

function harness({ online = true, rows = [] } = {}) {
  const calls = [];
  const router = { async loadPack(pack) { calls.push(["load", pack.byteLength]); }, async route(origin, destination) { calls.push(["route", origin, destination]); return { polyline: [origin, destination], distanceM: 130, pointCount: 2 }; } };
  const tileServer = { async start() { calls.push(["tiles"]); } };
  const api = { async publishSegment(payload) { calls.push(["publish", payload]); return { id: "segment-1" }; }, async listSegments(bbox) { calls.push(["list", bbox]); return rows; } };
  return { controller: createDemoController({ router, tileServer, api, pack: new Uint8Array([1]), online: () => online }), calls };
}

test("boot only starts local services and loads the embedded route pack", async () => {
  const { controller, calls } = harness();
  assert.equal((await controller.boot()).status, "ready");
  assert.deepEqual(calls, [["tiles"], ["load", 1]]);
});

test("two taps route on the native boundary and third tap resets the selection", async () => {
  const { controller, calls } = harness();
  await controller.boot();
  assert.equal((await controller.tapPoint({ lat: -33.8688, lng: 151.2093 })).status, "awaiting_destination");
  assert.equal((await controller.tapPoint({ lat: -33.8695, lng: 151.2102 })).routeSource, "local_native");
  assert.equal((await controller.tapPoint({ lat: -33.8701, lng: 151.2111 })).selectedPoints.length, 1);
  assert.equal(calls.filter(([name]) => name === "route").length, 1);
});

test("airplane mode never calls the API", async () => {
  const { controller, calls } = harness({ online: false });
  await controller.boot(); await controller.tapPoint({ lat: -33.8688, lng: 151.2093 }); await controller.tapPoint({ lat: -33.8695, lng: 151.2102 });
  assert.match((await controller.publishRoute()).message, /requires a network/);
  assert.match((await controller.refreshSegments()).message, /require a network/);
  assert.equal(calls.some(([name]) => name === "publish" || name === "list"), false);
});

test("online actions are restricted to explicit publish and nearby-list requests", async () => {
  const { controller, calls } = harness({ rows: [{ id: "seed" }] });
  await controller.boot(); await controller.tapPoint({ lat: -33.8688, lng: 151.2093 }); await controller.tapPoint({ lat: -33.8695, lng: 151.2102 });
  assert.equal((await controller.publishRoute()).lastPublishedId, "segment-1");
  assert.equal((await controller.refreshSegments()).segments.length, 1);
  assert.deepEqual(calls.at(-1), ["list", SYDNEY_BBOX]);
});
