import assert from "node:assert/strict";
import test from "node:test";

import { createDemoController, SYDNEY_BBOX } from "./app.js";

const A = { lat: -33.8688, lng: 151.2093 };
const B = { lat: -33.8695, lng: 151.2102 };
const C = { lat: -33.8701, lng: 151.2111 };
const D = { lat: -33.8705, lng: 151.2120 };

function routedGeometry(origin, destination) {
  return [
    { ...origin, elevationM: 10 },
    { lat: (origin.lat + destination.lat) / 2, lng: (origin.lng + destination.lng) / 2, elevationM: 18 },
    { ...destination, elevationM: 10 }
  ];
}

function harness({ online = true, rows = [], restored = null, routeError = null } = {}) {
  const calls = [];
  const saved = [];
  let nextUuid = 1;
  const router = {
    async loadPack(pack) { calls.push(["load", pack.byteLength]); },
    async route(origin, destination) {
      calls.push(["route", origin, destination]);
      if (routeError) throw routeError;
      const geometry = routedGeometry(origin, destination);
      return { geometry, polyline: geometry, distanceM: 130, pointCount: geometry.length };
    }
  };
  const tileServer = { async start() { calls.push(["tiles"]); } };
  const api = {
    async publishSegment(payload, idempotencyKey) {
      calls.push(["publish", payload, idempotencyKey]);
      return { id: "segment-1", publicationState: "published" };
    },
    async listSegments(bbox) { calls.push(["list", bbox]); return rows; }
  };
  const draftStore = {
    async load() { calls.push(["restore"]); return restored; },
    async save(value) { calls.push(["save"]); saved.push(structuredClone(value)); }
  };
  return {
    controller: createDemoController({
      router,
      tileServer,
      api,
      pack: new Uint8Array([1]),
      online: () => online,
      draftStore,
      uuid: () => `00000000-0000-4000-8000-${String(nextUuid++).padStart(12, "0")}`
    }),
    calls,
    saved
  };
}

async function routedController(options) {
  const result = harness(options);
  await result.controller.boot();
  await result.controller.tapPoint(A);
  await result.controller.tapPoint(B);
  await result.controller.tapPoint(C);
  return result;
}

test("boot starts local services, loads the embedded pack and restores a local draft", async () => {
  const first = harness();
  const ready = await first.controller.boot();
  assert.equal(ready.status, "ready");
  assert.deepEqual(first.calls.slice(0, 3), [["tiles"], ["load", 1], ["restore"]]);

  await first.controller.tapPoint(A);
  const restored = harness({ restored: first.saved.at(-1) });
  const state = await restored.controller.boot();
  assert.equal(state.draft.controlPoints.length, 1);
  assert.equal(state.status, "ready");
});

test("successive map taps create a multipoint route and only calculate the new leg", async () => {
  const { controller, calls } = harness();
  await controller.boot();
  assert.equal((await controller.tapPoint(A)).status, "awaiting_next_point");
  assert.equal((await controller.tapPoint(B)).routeSource, "local_native");
  const three = await controller.tapPoint(C);

  assert.equal(three.draft.controlPoints.length, 3);
  assert.equal(three.route.polyline.length, 5);
  assert.deepEqual(calls.filter(([name]) => name === "route").map((call) => call.slice(1)), [[A, B], [B, C]]);
});

test("moving, deleting and reordering points recalculate only invalidated adjacent legs", async () => {
  const { controller, calls } = await routedController();
  calls.length = 0;
  const middleId = controller.snapshot().draft.controlPoints[1].id;
  await controller.beginMove(middleId);
  await controller.tapPoint(D);
  assert.equal(controller.snapshot().moveTargetId, null);
  assert.deepEqual(calls.filter(([name]) => name === "route").map((call) => call.slice(1)), [[A, D], [D, C]]);

  calls.length = 0;
  await controller.reorderPoint(middleId, 0);
  assert.equal(calls.filter(([name]) => name === "route").length, 2);

  calls.length = 0;
  await controller.removePoint(middleId);
  assert.equal(calls.filter(([name]) => name === "route").length, 1);
});

test("undo, redo and optional loop preserve local routing semantics", async () => {
  const { controller, calls } = await routedController();
  const before = controller.snapshot().draft.controlPoints.length;
  await controller.undo();
  assert.equal(controller.snapshot().draft.controlPoints.length, before - 1);
  await controller.redo();
  assert.equal(controller.snapshot().draft.controlPoints.length, before);

  calls.length = 0;
  const loop = await controller.setLoop(true);
  assert.equal(loop.draft.closedLoop, true);
  assert.deepEqual(calls.filter(([name]) => name === "route").map((call) => call.slice(1)), [[C, A]]);
  await controller.setLoop(false);
  assert.equal(controller.snapshot().draft.closedLoop, false);
});

test("trim stays non-destructive, exposes selection metrics and resets to the full route", async () => {
  const { controller } = await routedController();
  const full = controller.snapshot();
  const selected = await controller.setTrim(full.metrics.distanceM * 0.2, full.metrics.distanceM * 0.8);

  assert.equal(selected.route.polyline.length, full.route.polyline.length);
  assert.ok(selected.selectionMetrics.distanceM < selected.metrics.distanceM);
  assert.ok(selected.selectedGeometry.length >= 2);
  assert.ok(selected.profile.length >= 2);
  assert.ok(controller.scrubProfile(selected.metrics.distanceM / 2).profileCursor);

  const reset = await controller.resetTrim();
  assert.equal(reset.draft.selection, null);
  assert.deepEqual(reset.selectedGeometry, reset.route.polyline);
});

test("publishing requires a valid name, confirmation and a UUID", async () => {
  const { controller, calls } = await routedController();
  await assert.rejects(controller.requestPublish(), /name is required/);
  await controller.setName("  Harbour   study  ");
  const confirmation = await controller.requestPublish();
  assert.equal(confirmation.publishStatus, "confirming");
  assert.equal(confirmation.draft.status, "ready");
  assert.equal(calls.some(([name]) => name === "publish"), false);

  const published = await controller.confirmPublish();
  const publish = calls.find(([name]) => name === "publish");
  assert.equal(published.publishStatus, "published");
  assert.equal(published.draft.status, "published");
  assert.equal(publish[1].name, "Harbour study");
  assert.deepEqual(Object.keys(publish[1]).sort(), ["controlPoints", "geometry", "name"]);
  assert.match(publish[2], /^[0-9a-f-]{36}$/i);
  assert.equal(publish[1].geometry.every((point) => Number.isInteger(point.elevationM)), true);
  const resumed = await controller.resumeEditing();
  assert.equal(resumed.draft.status, "draft");
});

test("failed publication retains the complete local draft and idempotency key", async () => {
  const { controller, calls, saved } = await routedController();
  await controller.setName("Retry route");
  await controller.requestPublish();
  let attempts = 0;
  controller.replaceApiForTest({
    async publishSegment(_payload, key) {
      calls.push(["attempt", key]);
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return { id: "retried", publicationState: "published" };
    },
    async listSegments() { return []; }
  });

  await assert.rejects(controller.confirmPublish(), /offline/);
  assert.equal(controller.snapshot().publishStatus, "failed");
  assert.equal(controller.snapshot().draft.status, "ready");
  assert.equal(controller.snapshot().draft.controlPoints.length, 3);
  await controller.requestPublish();
  await controller.confirmPublish();
  const attemptsMade = calls.filter(([name]) => name === "attempt");
  assert.equal(attemptsMade[0][1], attemptsMade[1][1]);
  assert.equal(saved.at(-1).pendingPublishKey, null);
});

test("cancelling confirmation resumes editing and a new draft clears the local editor", async () => {
  const { controller } = await routedController();
  await controller.setName("Disposable route");
  await controller.requestPublish();
  const cancelled = await controller.cancelPublish();
  assert.equal(cancelled.draft.status, "draft");
  assert.equal(cancelled.publishStatus, "idle");

  const empty = await controller.newDraft();
  assert.equal(empty.draft.controlPoints.length, 0);
  assert.equal(empty.nameInput, "");
  assert.equal(empty.metrics.distanceM, 0);
});

test("airplane mode never calls the API and editing remains fully available", async () => {
  const { controller, calls } = await routedController({ online: false });
  await controller.setName("Offline draft");
  assert.match((await controller.requestPublish()).message, /network connection/);
  assert.match((await controller.refreshSegments()).message, /network connection/);
  await controller.tapPoint(D);
  assert.equal(controller.snapshot().draft.controlPoints.length, 4);
  assert.equal(calls.some(([name]) => name === "publish" || name === "list"), false);
});

test("nearby refresh uses the v2 bbox loop without altering the draft", async () => {
  const { controller, calls } = await routedController({ rows: [{ id: "seed", name: "Seed" }] });
  const revision = controller.snapshot().draft.revision;
  const state = await controller.refreshSegments();
  assert.equal(state.segments.length, 1);
  assert.equal(state.draft.revision, revision);
  assert.deepEqual(calls.at(-1), ["list", SYDNEY_BBOX]);
});

test("a local no-route error keeps the changed draft recoverable and never falls back to network routing", async () => {
  const { controller, calls, saved } = harness({ routeError: new Error("no_route") });
  await controller.boot();
  await controller.tapPoint(A);
  await assert.rejects(controller.tapPoint(B), /no_route/);
  const state = controller.snapshot();
  assert.equal(state.status, "route_error");
  assert.equal(state.draft.controlPoints.length, 2);
  assert.deepEqual(state.draft.invalidatedLegIndexes, [0]);
  assert.equal(saved.length, 2);
  assert.equal(calls.some(([name]) => name === "publish" || name === "list"), false);
});

test("the editor prevents an unpublishable seventeenth control point", async () => {
  const { controller } = harness();
  await controller.boot();
  for (let index = 0; index < 16; index += 1) {
    await controller.tapPoint({ lat: A.lat + index * 0.00001, lng: A.lng + index * 0.00001 });
  }
  await assert.rejects(controller.tapPoint(D), /control_point_limit/);
  assert.equal(controller.snapshot().draft.controlPoints.length, 16);
});
