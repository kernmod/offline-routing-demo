import test from "node:test";
import assert from "node:assert/strict";

import {
  addControlPoint,
  beginDraftPublication,
  buildPublishPayload,
  completeDraftPublication,
  createDraft,
  failDraftPublication,
  getComposedGeometry,
  getDraftMetrics,
  getElevationProfile,
  getGeometryForRange,
  getMetricsForRange,
  getSelectionMetrics,
  getTrimmedGeometry,
  lookupProfileAtDistance,
  moveControlPoint,
  normalizeSegmentName,
  redoDraft,
  removeControlPoint,
  reorderControlPoints,
  resetToFullSelection,
  resumeDraftEditing,
  restoreDraft,
  serializeDraft,
  setClosedLoop,
  setControlPointPreview,
  setDraftName,
  setLegResult,
  prepareDraftForPublication,
  trimDraft,
  undoDraft
} from "./index.js";

const point = (lat, lng, elevationM) => ({ lat, lng, elevationM });

const start = point(0, 0, 10);
const middle = point(0, 0.001, 25);
const finish = point(0, 0.002, 18);
const extra = point(0.001, 0.0015, 30);

function routingResult(points, elevations = []) {
  return {
    geometry: points.map((entry, index) => ({
      lat: entry.lat,
      lng: entry.lng,
      elevationM: elevations[index] ?? entry.elevationM ?? 0
    }))
  };
}

function createRoutedDraft() {
  let draft = createDraft();
  draft = setDraftName(draft, "harbour loop");
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, middle], [10, 25]));
  draft = setLegResult(draft, 1, routingResult([middle, finish], [25, 18]));
  return draft;
}

test("createDraft starts with schema metadata, draft status and bounded history", () => {
  const draft = createDraft({ historyLimit: 2 });

  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.status, "draft");
  assert.equal(draft.revision, 0);
  assert.equal(draft.name, "");
  assert.deepEqual(draft.controlPoints, []);
  assert.equal(draft.closedLoop, false);
  assert.equal(draft.selection, null);
  assert.equal(draft.undoStack.length, 0);
  assert.equal(draft.redoStack.length, 0);
  assert.equal(draft.historyLimit, 2);
});

test("normalizeSegmentName enforces NFC, visibility, controls and 80 code-point limit", () => {
  assert.equal(normalizeSegmentName("  cafe\u0301   loop  "), "café loop");
  assert.equal(normalizeSegmentName("A\u00A0B"), "A B");
  assert.throws(() => normalizeSegmentName("   "), /required/);
  assert.throws(() => normalizeSegmentName(42), /string/);
  assert.throws(() => normalizeSegmentName("abc\u0007def"), /control/i);
  assert.throws(() => normalizeSegmentName("abc\u202Edef"), /bidi/i);
  assert.throws(() => normalizeSegmentName("x".repeat(81)), /80 code points/);
});

test("committed edits increment revision while previews and leg recomputes do not", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  assert.equal(draft.revision, 3);

  const preview = setControlPointPreview(draft, "cp-0002", extra);
  assert.equal(preview.revision, 3);
  assert.equal(preview.undoStack.length, draft.undoStack.length);

  const recomputed = setLegResult(draft, 0, routingResult([start, middle], [10, 25]));
  assert.equal(recomputed.revision, 3);
  assert.equal(recomputed.undoStack.length, draft.undoStack.length);

  const renamed = setDraftName(draft, "  harbour   loop  ");
  assert.equal(renamed.revision, 4);
  assert.equal(renamed.name, "harbour loop");
});

test("addControlPoint appends ids and invalidates only adjacent legs", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);

  assert.deepEqual(
    draft.controlPoints.map((entry) => entry.id),
    ["cp-0001", "cp-0002", "cp-0003"]
  );
  assert.deepEqual(draft.invalidatedLegIndexes, [1]);
  assert.equal(draft.undoStack.length, 3);
});

test("moveControlPoint retargets only adjacent legs and preview changes avoid history", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);

  const preview = setControlPointPreview(draft, "cp-0002", extra);
  assert.equal(preview.controlPoints[1].lat, extra.lat);
  assert.deepEqual(preview.invalidatedLegIndexes, [0, 1]);
  assert.equal(preview.undoStack.length, draft.undoStack.length);
  assert.equal(preview.revision, draft.revision);

  const committed = moveControlPoint(draft, "cp-0002", extra);
  assert.deepEqual(committed.invalidatedLegIndexes, [0, 1]);
  assert.equal(committed.undoStack.length, draft.undoStack.length + 1);
  assert.equal(committed.revision, draft.revision + 1);
});

test("removeControlPoint and reorderControlPoints only invalidate the impacted neighbourhood", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = addControlPoint(draft, extra);

  const removed = removeControlPoint(draft, "cp-0002");
  assert.deepEqual(removed.controlPoints.map((entry) => entry.id), ["cp-0001", "cp-0003", "cp-0004"]);
  assert.deepEqual(removed.invalidatedLegIndexes, [0, 1]);

  const reordered = reorderControlPoints(draft, "cp-0004", 1);
  assert.deepEqual(reordered.controlPoints.map((entry) => entry.id), ["cp-0001", "cp-0004", "cp-0002", "cp-0003"]);
  assert.deepEqual(reordered.invalidatedLegIndexes, [0, 1, 2]);
});

test("closed loop insert and reorder across endpoints invalidate the closing leg", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setClosedLoop(draft, true);

  const extended = addControlPoint(draft, extra);
  assert.deepEqual(extended.invalidatedLegIndexes, [2, 3]);

  const reordered = reorderControlPoints(extended, "cp-0004", 0);
  assert.equal(reordered.invalidatedLegIndexes.includes(3), true);
});

test("closed loop adds the final leg and invalidates the closing edge only", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);

  const closed = setClosedLoop(draft, true);
  assert.equal(closed.closedLoop, true);
  assert.deepEqual(closed.invalidatedLegIndexes, [2]);

  const reopened = setClosedLoop(closed, false);
  assert.equal(reopened.closedLoop, false);
  assert.deepEqual(reopened.invalidatedLegIndexes, [2]);
});

test("closed loop ignores non-boolean input, no-op toggles and endpoint invalidation", () => {
  assert.throws(() => setClosedLoop(createDraft(), "yes"), /boolean/);

  let draft = createDraft();
  draft = addControlPoint(draft, start);
  const singlePointLoop = setClosedLoop(draft, true);
  assert.equal(singlePointLoop.closedLoop, false);
  assert.deepEqual(singlePointLoop.invalidatedLegIndexes, []);

  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setClosedLoop(draft, true);
  draft = setLegResult(draft, 0, routingResult([start, middle], [10, 20]));
  draft = setLegResult(draft, 1, routingResult([middle, finish], [20, 15]));
  draft = setLegResult(draft, 2, routingResult([finish, start], [15, 10]));

  const movedStart = moveControlPoint(draft, "cp-0001", point(0.0002, 0, 12));
  assert.deepEqual(movedStart.invalidatedLegIndexes, [0, 2]);

  const sameToggle = setClosedLoop(draft, true);
  assert.deepEqual(sameToggle.invalidatedLegIndexes, []);
});

test("setLegResult stores leg geometry and composed route deduplicates shared joints", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, middle], [10, 20]));
  draft = setLegResult(draft, 1, routingResult([middle, finish], [20, 15]));

  assert.deepEqual(
    getComposedGeometry(draft),
    [
      { lat: 0, lng: 0, elevationM: 10 },
      { lat: 0, lng: 0.001, elevationM: 20 },
      { lat: 0, lng: 0.002, elevationM: 15 }
    ]
  );
});

test("composed geometry stays empty until every required leg is present", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);

  assert.deepEqual(getComposedGeometry(draft), []);

  draft = setLegResult(draft, 0, routingResult([start, middle], [10, 20]));
  assert.deepEqual(getComposedGeometry(draft), []);
});

test("draft metrics aggregate distance and elevation across composed geometry", () => {
  const draft = createRoutedDraft();

  const metrics = getDraftMetrics(draft);
  assert.equal(metrics.pointCount, 3);
  assert.equal(metrics.distanceM > 200, true);
  assert.equal(metrics.ascentM, 15);
  assert.equal(metrics.descentM, 7);
});

test("draft metrics return zeros for empty geometry", () => {
  assert.deepEqual(getDraftMetrics(createDraft()), {
    pointCount: 0,
    distanceM: 0,
    ascentM: 0,
    descentM: 0
  });
});

test("trimDraft is non-destructive and interpolates the selected geometry", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(
    draft,
    0,
    routingResult(
      [
        point(0, 0, 10),
        point(0, 0.001, 20)
      ],
      [10, 20]
    )
  );
  draft = setLegResult(
    draft,
    1,
    routingResult(
      [
        point(0, 0.001, 20),
        point(0, 0.002, 30)
      ],
      [20, 30]
    )
  );

  const total = getDraftMetrics(draft).distanceM;
  const trimmed = trimDraft(draft, total * 0.25, total * 0.75);

  assert.deepEqual(getComposedGeometry(draft), [
    { lat: 0, lng: 0, elevationM: 10 },
    { lat: 0, lng: 0.001, elevationM: 20 },
    { lat: 0, lng: 0.002, elevationM: 30 }
  ]);
  assert.deepEqual(trimmed.selection, {
    startM: total * 0.25,
    endM: total * 0.75
  });

  const geometry = getTrimmedGeometry(trimmed);
  assert.equal(geometry.length, 3);
  assert.equal(geometry[0].lng > 0 && geometry[0].lng < 0.001, true);
  assert.equal(geometry[0].elevationM > 10 && geometry[0].elevationM < 20, true);
  assert.equal(geometry[2].lng > 0.001 && geometry[2].lng < 0.002, true);
});

test("range previews derive geometry and metrics without mutating draft history", () => {
  const draft = createRoutedDraft();
  const total = getDraftMetrics(draft).distanceM;
  const before = structuredClone(draft);
  const geometry = getGeometryForRange(draft, total * 0.25, total * 0.75);
  const metrics = getMetricsForRange(draft, total * 0.25, total * 0.75);

  assert.ok(geometry.length >= 2);
  assert.ok(metrics.distanceM < total);
  assert.deepEqual(draft, before);
  assert.equal(draft.undoStack.length, before.undoStack.length);
});

test("resetToFullSelection clears the trim and increments revision", () => {
  const draft = trimDraft(createRoutedDraft(), 10, 50);
  const reset = resetToFullSelection(draft);

  assert.equal(reset.selection, null);
  assert.deepEqual(getTrimmedGeometry(reset), getComposedGeometry(reset));
  assert.equal(reset.revision, draft.revision + 1);
});

test("selection clamps to remaining geometry after control-point removal", () => {
  let draft = createRoutedDraft();
  const total = getDraftMetrics(draft).distanceM;
  draft = trimDraft(draft, total - 5, total);

  const shrunk = removeControlPoint(draft, "cp-0003");
  assert.deepEqual(shrunk.selection, { startM: 111, endM: 111 });
});

test("selection clears when geometry disappears and reorders invalid stored bounds safely", () => {
  let routed = createDraft();
  routed = setDraftName(routed, "short");
  routed = addControlPoint(routed, start);
  routed = addControlPoint(routed, finish);
  routed = setLegResult(routed, 0, routingResult([start, finish], [10, 18]));
  routed = trimDraft(routed, 1, 5);
  const collapsed = removeControlPoint(routed, "cp-0002");
  assert.equal(collapsed.selection, null);

  const persisted = JSON.parse(serializeDraft(createRoutedDraft()));
  persisted.selection = { startM: 50, endM: 10 };
  const reordered = removeControlPoint(restoreDraft(JSON.stringify(persisted)), "cp-0003");
  assert.deepEqual(reordered.selection, { startM: 50, endM: 50 });
});

test("removing the only control point collapses to an empty route", () => {
  const empty = removeControlPoint(addControlPoint(createDraft(), start), "cp-0001");
  assert.deepEqual(empty.controlPoints, []);
  assert.deepEqual(empty.invalidatedLegIndexes, []);
});

test("full-range trim returns the original geometry and clamps lookups", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, finish], [10, 18]));
  const total = getDraftMetrics(draft).distanceM;

  draft = trimDraft(draft, 0, total);
  assert.deepEqual(getTrimmedGeometry(draft), getComposedGeometry(draft));

  const beforeStart = lookupProfileAtDistance(draft, -1);
  const afterEnd = lookupProfileAtDistance(draft, total + 999);
  assert.equal(beforeStart.distanceM, 0);
  assert.equal(Math.round(afterEnd.distanceM), total);
});

test("selection metrics report distance and elevation deltas for trimmed range", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, middle], [10, 25]));
  draft = setLegResult(draft, 1, routingResult([middle, finish], [25, 5]));
  draft = trimDraft(draft, 0, getDraftMetrics(draft).distanceM / 2);

  const metrics = getSelectionMetrics(draft);
  assert.equal(metrics.distanceM > 100, true);
  assert.equal(metrics.distanceM < getDraftMetrics(draft).distanceM, true);
  assert.equal(metrics.ascentM > 0, true);
  assert.equal(metrics.descentM, 0);
});

test("elevation profile and scrub lookup expose cumulative distance and interpolation", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, middle], [10, 25]));
  draft = setLegResult(draft, 1, routingResult([middle, finish], [25, 5]));

  const profile = getElevationProfile(draft);
  assert.deepEqual(
    profile.map((entry) => [entry.distanceM > -1, entry.elevationM]),
    [
      [true, 10],
      [true, 25],
      [true, 5]
    ]
  );

  const lookup = lookupProfileAtDistance(draft, getDraftMetrics(draft).distanceM * 0.75);
  assert.equal(lookup.elevationM < 25 && lookup.elevationM > 5, true);
  assert.equal(lookup.distanceM > 0, true);
});

test("empty profile and empty scrub lookup stay safe", () => {
  assert.deepEqual(getElevationProfile(createDraft()), []);
  assert.equal(lookupProfileAtDistance(createDraft(), 10), null);
});

test("profile lookup clamps beyond the route end to the final sampled point", () => {
  const draft = createRoutedDraft();
  const total = getDraftMetrics(draft).distanceM;
  const lookup = lookupProfileAtDistance(draft, total + 500);

  assert.equal(Math.round(lookup.distanceM), total);
  assert.equal(lookup.lat, finish.lat);
  assert.equal(lookup.lng, finish.lng);
  assert.equal(lookup.elevationM, finish.elevationM);
});

test("undo/redo is bounded and drops oldest snapshots beyond the limit", () => {
  let draft = createDraft({ historyLimit: 2 });
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);

  assert.equal(draft.undoStack.length, 2);
  assert.deepEqual(draft.undoStack[0].controlPoints.map((entry) => entry.id), ["cp-0001"]);

  const undone = undoDraft(draft);
  assert.deepEqual(undone.controlPoints.map((entry) => entry.id), ["cp-0001", "cp-0002"]);
  assert.equal(undone.redoStack.length, 1);
  assert.equal(undone.revision, draft.revision + 1);

  const redone = redoDraft(undone);
  assert.deepEqual(redone.controlPoints.map((entry) => entry.id), ["cp-0001", "cp-0002", "cp-0003"]);
  assert.equal(redone.revision, undone.revision + 1);
});

test("publication lifecycle is explicit, validated and revision-monotonic", () => {
  const draft = createRoutedDraft();
  const ready = prepareDraftForPublication(draft);
  assert.equal(ready.status, "ready");
  assert.equal(ready.revision, draft.revision + 1);

  const publishing = beginDraftPublication(ready);
  assert.equal(publishing.status, "publishing");
  assert.equal(publishing.revision, ready.revision + 1);

  const retryable = failDraftPublication(publishing);
  assert.equal(retryable.status, "ready");
  const retried = beginDraftPublication(retryable);
  const published = completeDraftPublication(retried);
  assert.equal(published.status, "published");
  assert.equal(published.revision, retried.revision + 1);

  const editableCopy = resumeDraftEditing(published);
  assert.equal(editableCopy.status, "draft");
  assert.equal(editableCopy.revision, published.revision + 1);
  assert.throws(() => beginDraftPublication(draft), /draft -> publishing/);
  assert.throws(() => completeDraftPublication(ready), /ready -> published/);
  assert.throws(() => failDraftPublication(ready), /ready -> ready/);
  assert.throws(() => resumeDraftEditing(draft), /draft -> draft/);
});

test("ready and publishing states freeze edits until explicitly resumed", () => {
  const ready = prepareDraftForPublication(createRoutedDraft());
  assert.throws(() => setDraftName(ready, "changed"), /not editable/);
  assert.throws(() => addControlPoint(ready, extra), /not editable/);

  const editable = resumeDraftEditing(ready);
  assert.equal(setDraftName(editable, "changed").name, "changed");
  assert.throws(() => prepareDraftForPublication(createDraft()), /control points/);
  let unrouted = setDraftName(createDraft(), "unrouted");
  unrouted = addControlPoint(unrouted, start);
  unrouted = addControlPoint(unrouted, finish);
  assert.throws(() => prepareDraftForPublication(unrouted), /invalidated legs/);
});

test("undo/redo no-op on empty stacks", () => {
  const draft = createDraft();
  assert.equal(undoDraft(draft), draft);
  assert.equal(redoDraft(draft), draft);
});

test("serializeDraft and restoreDraft keep local state round-trippable", () => {
  let draft = createDraft();
  draft = setDraftName(draft, "harbour loop");
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, finish], [10, 18]));
  draft = trimDraft(draft, 10, 50);

  const restored = restoreDraft(serializeDraft(draft));
  assert.deepEqual(restored, draft);
});

test("restoreDraft validates stored schema shape", () => {
  assert.throws(() => createDraft({ historyLimit: 0 }), /positive integer/);
  assert.throws(() => restoreDraft(12), /string/);
  assert.throws(
    () =>
      restoreDraft(
        JSON.stringify({
          schemaVersion: 2,
          status: "draft",
          revision: 0,
          name: "",
          controlPoints: "nope",
          closedLoop: false,
          legResults: [],
          invalidatedLegIndexes: [],
          selection: null,
          historyLimit: 10,
          nextControlPointNumber: 1,
          undoStack: [],
          redoStack: []
        })
      ),
    /controlPoints must be an array/
  );
  assert.throws(
    () =>
      restoreDraft(
        JSON.stringify({
          schemaVersion: 2,
          status: "draft",
          revision: -1,
          name: "",
          controlPoints: [{ id: "", lat: 0, lng: 0 }],
          closedLoop: false,
          legResults: [],
          invalidatedLegIndexes: [],
          selection: { startM: "x", endM: 0 },
          historyLimit: 10,
          nextControlPointNumber: 1,
          undoStack: [],
          redoStack: []
        })
      ),
    /non-empty string|non-negative integer/
  );
  assert.throws(
    () =>
      restoreDraft(
        JSON.stringify({
          schemaVersion: 2,
          status: "draft",
          revision: 0,
          name: "",
          controlPoints: [{ id: "cp-0001", lat: 0, lng: 0 }],
          closedLoop: false,
          legResults: [],
          invalidatedLegIndexes: [],
          selection: "bad",
          historyLimit: 10,
          nextControlPointNumber: 1,
          undoStack: [],
          redoStack: []
        })
      ),
    /selection must be an object or null/
  );
  assert.throws(() => restoreDraft(JSON.stringify({ schemaVersion: 1 })), /schemaVersion|status|historyLimit/);
});

test("restoreDraft validates nested snapshot metadata", () => {
  assert.throws(
    () =>
      restoreDraft(
        JSON.stringify({
          schemaVersion: 2,
          status: "draft",
          revision: 1,
          name: "",
          controlPoints: [],
          closedLoop: false,
          legResults: [],
          invalidatedLegIndexes: [],
          selection: null,
          historyLimit: 10,
          nextControlPointNumber: 1,
          undoStack: [
            {
              schemaVersion: 2,
              status: "published",
              revision: 0,
              name: "",
              controlPoints: [],
              closedLoop: false,
              legResults: [],
              invalidatedLegIndexes: [],
              selection: null,
              historyLimit: 10,
              nextControlPointNumber: 1
            }
          ],
          redoStack: []
        })
      ),
    /undoStack\[0\]\.status/
  );
});

test("restoreDraft rejects malformed nested snapshot state before undo", () => {
  const draft = addControlPoint(createDraft(), start);
  const persisted = JSON.parse(serializeDraft(draft));
  persisted.undoStack[0].controlPoints = null;

  assert.throws(
    () => restoreDraft(JSON.stringify(persisted)),
    /undoStack\[\d+\]\.controlPoints must be an array/
  );
});

test("restoreDraft rejects malformed nested geometry, selection and point identity", () => {
  const base = JSON.parse(serializeDraft(trimDraft(createRoutedDraft(), 10, 50)));
  for (const mutateSnapshot of [
    (snapshot) => { snapshot.controlPoints[0].id = ""; },
    (snapshot) => { snapshot.legResults = [[{ lat: 0, lng: 0, elevationM: 1 }]]; },
    (snapshot) => { snapshot.selection = "invalid"; },
    (snapshot) => { snapshot.selection = { startM: "invalid", endM: 1 }; },
    (snapshot) => { snapshot.invalidatedLegIndexes = ["invalid"]; }
  ]) {
    const persisted = structuredClone(base);
    mutateSnapshot(persisted.undoStack.at(-1));
    assert.throws(() => restoreDraft(JSON.stringify(persisted)), /undoStack\[\d+\]/);
  }
});

test("buildPublishPayload returns final geometry and monotonically increasing control point indices", () => {
  let draft = createDraft();
  draft = setDraftName(draft, "  harbour  loop ");
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(
    draft,
    0,
    routingResult(
      [
        point(0, 0, 10),
        point(0, 0.0005, 17),
        point(0, 0.001, 25)
      ],
      [10, 17, 25]
    )
  );
  draft = setLegResult(
    draft,
    1,
    routingResult(
      [
        point(0, 0.001, 25),
        point(0, 0.0015, 21),
        point(0, 0.002, 18)
      ],
      [25, 21, 18]
    )
  );

  const total = getDraftMetrics(draft).distanceM;
  draft = trimDraft(draft, total * 0.2, total * 0.8);

  const payload = buildPublishPayload(draft);
  assert.deepEqual(payload, {
    name: "harbour loop",
    geometry: getTrimmedGeometry(draft),
    controlPoints: [0, 2, 4]
  });
});

test("buildPublishPayload drops anchors outside the selected geometry and omits ids or status", () => {
  let draft = createRoutedDraft();
  draft = trimDraft(draft, 20, getDraftMetrics(draft).distanceM - 20);
  const payload = buildPublishPayload(draft);

  assert.equal(payload.controlPoints[0], 0);
  assert.equal(payload.controlPoints[payload.controlPoints.length - 1], payload.geometry.length - 1);
  assert.equal("status" in payload, false);
  assert.equal(payload.controlPoints.every((entry, index, values) => index === 0 || entry > values[index - 1]), true);
});

test("operations validate ids, indexes and trim ranges", () => {
  const empty = createDraft();

  assert.throws(() => addControlPoint(empty, { lat: null, lng: 0 }), /finite/);

  let draft = addControlPoint(empty, start);
  draft = addControlPoint(draft, finish);
  draft = setLegResult(draft, 0, routingResult([start, finish], [10, 18]));

  assert.throws(() => moveControlPoint(draft, "missing", middle), /Unknown control point/);
  assert.throws(() => reorderControlPoints(draft, "cp-0001", 4), /target index/);
  assert.throws(() => setLegResult(draft, 9, routingResult([start, finish])), /leg index/);
  assert.throws(() => setLegResult(draft, 0, { geometry: [{ lat: 0, lng: 0, elevationM: Number.NaN }] }), /at least two points/);
  assert.throws(() => lookupProfileAtDistance(draft, Number.NaN), /finite number/);
  assert.throws(() => trimDraft(draft, 50, 10), /startM must be <= endM/);
  assert.throws(() => restoreDraft("{}"), /schemaVersion|historyLimit/);
  assert.throws(() => buildPublishPayload(createDraft()), /required/);
});

test("reorder no-op and removal collapse loop safely", () => {
  let draft = createDraft();
  draft = addControlPoint(draft, start);
  draft = addControlPoint(draft, middle);
  draft = addControlPoint(draft, finish);
  draft = setClosedLoop(draft, true);

  const sameOrder = reorderControlPoints(draft, "cp-0002", 1);
  assert.deepEqual(sameOrder.invalidatedLegIndexes, []);

  const removedFirst = removeControlPoint(draft, "cp-0001");
  assert.equal(removedFirst.closedLoop, true);
  assert.deepEqual(removedFirst.invalidatedLegIndexes, [0, 1]);

  const removedAgain = removeControlPoint(removedFirst, "cp-0002");
  assert.equal(removedAgain.closedLoop, false);
});
