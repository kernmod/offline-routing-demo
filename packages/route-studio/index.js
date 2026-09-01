import { validatePoint } from "../shared/point.js";

const DEFAULT_HISTORY_LIMIT = 50;
const EARTH_RADIUS_M = 6_378_137;
const UNSAFE_CONTROL = /[\p{Cc}]/u;
const UNSAFE_BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const DRAFT_STATUSES = new Set(["draft", "ready", "publishing", "published"]);

export function createDraft(options = {}) {
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  assertPositiveInteger(historyLimit, "historyLimit");
  return {
    schemaVersion: 2,
    status: "draft",
    revision: 0,
    name: "",
    controlPoints: [],
    closedLoop: false,
    legResults: [],
    invalidatedLegIndexes: [],
    selection: null,
    historyLimit,
    nextControlPointNumber: 1,
    undoStack: [],
    redoStack: []
  };
}

export function normalizeSegmentName(name) {
  if (typeof name !== "string") throw new TypeError("name must be a string");
  const normalized = name.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!normalized) throw new TypeError("name is required");
  if (UNSAFE_CONTROL.test(normalized)) throw new TypeError("name must not contain control characters");
  if (UNSAFE_BIDI.test(normalized)) throw new TypeError("name must not contain bidi override characters");
  if (Array.from(normalized).length > 80) throw new TypeError("name must be at most 80 code points");
  return normalized;
}

export function setDraftName(draft, name) {
  return commit(draft, (working) => {
    working.name = normalizeSegmentName(name);
  });
}

export function addControlPoint(draft, point) {
  return commit(draft, (working) => {
    const nextPoint = normalizeControlPoint(point);
    const nextId = `cp-${String(working.nextControlPointNumber).padStart(4, "0")}`;
    const insertIndex = working.controlPoints.length;
    working.controlPoints.push({ id: nextId, ...nextPoint });
    working.nextControlPointNumber += 1;
    invalidateLegs(working, impactedIndexesForInsert(insertIndex, working.controlPoints.length, working.closedLoop));
  });
}

export function moveControlPoint(draft, controlPointId, point) {
  return commit(draft, (working) => {
    moveControlPointInPlace(working, controlPointId, point);
  });
}

export function setControlPointPreview(draft, controlPointId, point) {
  return mutate(draft, (working) => {
    moveControlPointInPlace(working, controlPointId, point);
  });
}

export function removeControlPoint(draft, controlPointId) {
  return commit(draft, (working) => {
    const index = findControlPointIndex(working.controlPoints, controlPointId);
    working.controlPoints.splice(index, 1);
    if (working.controlPoints.length < 2) {
      working.closedLoop = false;
    }
    invalidateLegs(working, impactedIndexesForRemoval(index, working.controlPoints.length, working.closedLoop));
    clampSelectionToGeometry(working);
  });
}

export function reorderControlPoints(draft, controlPointId, targetIndex) {
  return commit(draft, (working) => {
    assertIntegerInRange(targetIndex, 0, working.controlPoints.length - 1, "target index");
    const fromIndex = findControlPointIndex(working.controlPoints, controlPointId);
    if (fromIndex === targetIndex) {
      working.invalidatedLegIndexes = [];
      return;
    }
    const [controlPoint] = working.controlPoints.splice(fromIndex, 1);
    working.controlPoints.splice(targetIndex, 0, controlPoint);
    invalidateLegs(
      working,
      impactedIndexesForReorder(fromIndex, targetIndex, working.controlPoints.length, working.closedLoop)
    );
    clampSelectionToGeometry(working);
  });
}

export function setClosedLoop(draft, closedLoop) {
  if (typeof closedLoop !== "boolean") throw new TypeError("closedLoop must be a boolean");
  return commit(draft, (working) => {
    const previousClosedLoop = working.closedLoop;
    const previousClosingIndex = closingLegIndex(working.controlPoints.length, previousClosedLoop);
    const enabled = closedLoop && working.controlPoints.length > 1;
    if (working.closedLoop === enabled) {
      working.invalidatedLegIndexes = [];
      return;
    }
    working.closedLoop = enabled;
    const nextClosingIndex = closingLegIndex(working.controlPoints.length, enabled);
    invalidateLegs(working, [previousClosingIndex, nextClosingIndex].filter((entry) => entry !== null));
    clampSelectionToGeometry(working);
  });
}

export function setLegResult(draft, legIndex, result) {
  return mutate(draft, (working) => {
    assertIntegerInRange(legIndex, 0, legCountForDraft(working) - 1, "leg index");
    const geometry = normalizeGeometry(result?.geometry, "result.geometry");
    working.legResults[legIndex] = geometry;
    working.invalidatedLegIndexes = working.invalidatedLegIndexes.filter((index) => index !== legIndex);
    clampSelectionToGeometry(working);
  });
}

export function getComposedGeometry(draft) {
  const requiredLegCount = legCountForDraft(draft);
  if (requiredLegCount === 0) return [];
  if (draft.legResults.length < requiredLegCount || draft.legResults.slice(0, requiredLegCount).some((entry) => !entry)) {
    return [];
  }
  const geometry = [];
  for (let index = 0; index < requiredLegCount; index += 1) {
    const legGeometry = draft.legResults[index];
    for (let pointIndex = 0; pointIndex < legGeometry.length; pointIndex += 1) {
      const point = legGeometry[pointIndex];
      if (geometry.length > 0 && pointIndex === 0 && samePoint(geometry[geometry.length - 1], point)) {
        continue;
      }
      geometry.push(clonePoint(point));
    }
  }
  return geometry;
}

export function getDraftMetrics(draft) {
  return metricsFromGeometry(getComposedGeometry(draft));
}

export function trimDraft(draft, startM, endM) {
  return commit(draft, (working) => {
    const total = getDraftMetrics(working).distanceM;
    assertFiniteNumber(startM, "startM");
    assertFiniteNumber(endM, "endM");
    if (startM > endM) throw new RangeError("startM must be <= endM");
    if (startM < 0 || endM > total) throw new RangeError("trim range must stay within route distance");
    if (startM === 0 && endM === total) {
      working.selection = { startM, endM };
      return;
    }
    working.selection = { startM, endM };
  });
}

export function resetToFullSelection(draft) {
  return commit(draft, (working) => {
    working.selection = null;
  });
}

export function getTrimmedGeometry(draft) {
  const geometry = getComposedGeometry(draft);
  if (geometry.length === 0) return [];
  if (!draft.selection) return geometry;
  return trimGeometry(geometry, draft.selection.startM, draft.selection.endM);
}

export function getSelectionMetrics(draft) {
  return metricsFromGeometry(getTrimmedGeometry(draft));
}

export function getElevationProfile(draft) {
  return profileFromGeometry(getComposedGeometry(draft));
}

export function lookupProfileAtDistance(draft, distanceM) {
  const profile = getElevationProfile(draft);
  if (profile.length === 0) return null;
  assertFiniteNumber(distanceM, "distanceM");
  const clamped = clamp(distanceM, 0, profile[profile.length - 1].distanceM);
  let result = profile[profile.length - 1];
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    if (clamped <= current.distanceM) {
      const span = current.distanceM - previous.distanceM;
      const ratio = span === 0 ? 0 : (clamped - previous.distanceM) / span;
      result = {
        distanceM: clamped,
        elevationM: lerp(previous.elevationM, current.elevationM, ratio),
        lat: lerp(previous.lat, current.lat, ratio),
        lng: lerp(previous.lng, current.lng, ratio)
      };
      break;
    }
  }
  return result;
}

export function prepareDraftForPublication(draft) {
  assertStatus(draft, "draft", "ready");
  if (draft.controlPoints.length < 2) throw new TypeError("at least two control points are required");
  if (draft.invalidatedLegIndexes.length > 0) throw new TypeError("all invalidated legs must be recalculated");
  buildPublishPayload(draft);
  return transitionStatus(draft, "ready");
}

export function beginDraftPublication(draft) {
  assertStatus(draft, "ready", "publishing");
  return transitionStatus(draft, "publishing");
}

export function failDraftPublication(draft) {
  assertStatus(draft, "publishing", "ready");
  return transitionStatus(draft, "ready");
}

export function completeDraftPublication(draft) {
  assertStatus(draft, "publishing", "published");
  return transitionStatus(draft, "published");
}

export function resumeDraftEditing(draft) {
  if (draft.status !== "ready" && draft.status !== "published") {
    throw new TypeError(`${draft.status} -> draft is not a legal draft transition`);
  }
  return transitionStatus(draft, "draft");
}

export function undoDraft(draft) {
  assertEditableDraft(draft);
  if (draft.undoStack.length === 0) return draft;
  const previous = draft.undoStack[draft.undoStack.length - 1];
  return {
    ...cloneState(previous),
    revision: draft.revision + 1,
    undoStack: draft.undoStack.slice(0, -1),
    redoStack: [snapshotState(draft), ...draft.redoStack]
  };
}

export function redoDraft(draft) {
  assertEditableDraft(draft);
  if (draft.redoStack.length === 0) return draft;
  const [next, ...rest] = draft.redoStack;
  return {
    ...cloneState(next),
    revision: draft.revision + 1,
    undoStack: pushHistory(draft.undoStack, snapshotState(draft), draft.historyLimit),
    redoStack: rest
  };
}

export function serializeDraft(draft) {
  return JSON.stringify(validateDraft(draft));
}

export function restoreDraft(serializedDraft) {
  if (typeof serializedDraft !== "string") throw new TypeError("serialized draft must be a string");
  return validateDraft(JSON.parse(serializedDraft));
}

export function buildPublishPayload(draft) {
  const name = normalizeSegmentName(draft.name);
  const geometry = getTrimmedGeometry(draft);
  if (geometry.length < 2) throw new TypeError("geometry is required");
  const fullGeometry = getComposedGeometry(draft);
  const anchors = controlAnchorIndexes(draft, fullGeometry);
  const selected = [];
  selected.push(0);
  for (const anchor of anchors.slice(1, -1)) {
    const match = geometry.findIndex((point) => samePoint(point, fullGeometry[anchor]));
    if (match > 0 && match < geometry.length - 1) {
      selected.push(match);
    }
  }
  if (geometry.length > 1) {
    selected.push(geometry.length - 1);
  }
  return {
    name,
    geometry,
    controlPoints: [...new Set(selected)].sort((left, right) => left - right)
  };
}

function controlAnchorIndexes(draft, geometry) {
  if (geometry.length === 0 || draft.controlPoints.length === 0) return [];
  const anchors = [0];
  let cursor = 0;
  const legCount = Math.min(legCountForDraft(draft), draft.legResults.length);
  for (let index = 0; index < legCount; index += 1) {
    const leg = draft.legResults[index];
    if (!leg || leg.length < 2) continue;
    cursor += leg.length - 1;
    anchors.push(Math.min(cursor, geometry.length - 1));
  }
  return anchors;
}

function commit(draft, producer) {
  const next = mutate(draft, producer, { pushUndo: true });
  next.revision = draft.revision + 1;
  return next;
}

function mutate(draft, producer, options = {}) {
  assertEditableDraft(draft);
  const working = cloneState(validateDraft(draft));
  producer(working);
  validateDraft(working);
  if (!options.pushUndo) return working;
  return {
    ...working,
    undoStack: pushHistory(draft.undoStack, snapshotState(draft), draft.historyLimit),
    redoStack: []
  };
}

function snapshotState(draft) {
  const { undoStack: _undoStack, redoStack: _redoStack, ...rest } = cloneState(draft);
  return rest;
}

function cloneState(draft) {
  return {
    ...draft,
    controlPoints: draft.controlPoints.map((entry) => ({ ...entry })),
    legResults: draft.legResults.map((entry) => (entry ? entry.map(clonePoint) : entry)),
    invalidatedLegIndexes: [...draft.invalidatedLegIndexes],
    selection: draft.selection ? { ...draft.selection } : null,
    undoStack: (draft.undoStack ?? []).map((entry) => snapshotState({ ...entry, undoStack: [], redoStack: [] })),
    redoStack: (draft.redoStack ?? []).map((entry) => snapshotState({ ...entry, undoStack: [], redoStack: [] }))
  };
}

function validateDraft(draft) {
  if (typeof draft !== "object" || draft === null) throw new TypeError("draft must be an object");
  if (draft.schemaVersion !== 2) throw new TypeError("draft.schemaVersion must be 2");
  if (!DRAFT_STATUSES.has(draft.status)) throw new TypeError("draft.status is invalid");
  assertNonNegativeInteger(draft.revision, "revision");
  assertPositiveInteger(draft.historyLimit, "historyLimit");
  assertPositiveInteger(draft.nextControlPointNumber, "nextControlPointNumber");
  if (typeof draft.name !== "string") throw new TypeError("name must be a string");
  if (typeof draft.closedLoop !== "boolean") throw new TypeError("closedLoop must be a boolean");
  assertArray(draft.controlPoints, "controlPoints");
  assertArray(draft.legResults, "legResults");
  assertArray(draft.invalidatedLegIndexes, "invalidatedLegIndexes");
  assertArray(draft.undoStack, "undoStack");
  assertArray(draft.redoStack, "redoStack");
  draft.controlPoints.forEach((entry, index) => {
    if (typeof entry.id !== "string" || !entry.id) throw new TypeError(`controlPoints[${index}].id must be a non-empty string`);
    normalizeControlPoint(entry, `controlPoints[${index}]`);
  });
  draft.legResults.forEach((entry, index) => {
    if (entry !== undefined && entry !== null) normalizeGeometry(entry, `legResults[${index}]`);
  });
  draft.invalidatedLegIndexes.forEach((entry, index) => assertPositiveInteger(entry + 1, `invalidatedLegIndexes[${index}]`));
  if (draft.selection !== null) {
    if (typeof draft.selection !== "object") throw new TypeError("selection must be an object or null");
    assertFiniteNumber(draft.selection.startM, "selection.startM");
    assertFiniteNumber(draft.selection.endM, "selection.endM");
  }
  draft.undoStack.forEach((entry, index) => validateSnapshot(entry, `undoStack[${index}]`));
  draft.redoStack.forEach((entry, index) => validateSnapshot(entry, `redoStack[${index}]`));
  return draft;
}

function validateSnapshot(snapshot, label) {
  if (typeof snapshot !== "object" || snapshot === null) throw new TypeError(`${label} must be an object`);
  if (snapshot.schemaVersion !== 2) throw new TypeError(`${label}.schemaVersion must be 2`);
  if (snapshot.status !== "draft") throw new TypeError(`${label}.status must be draft`);
  assertNonNegativeInteger(snapshot.revision, `${label}.revision`);
  assertPositiveInteger(snapshot.historyLimit, `${label}.historyLimit`);
  assertPositiveInteger(snapshot.nextControlPointNumber, `${label}.nextControlPointNumber`);
  if (typeof snapshot.name !== "string") throw new TypeError(`${label}.name must be a string`);
  if (typeof snapshot.closedLoop !== "boolean") throw new TypeError(`${label}.closedLoop must be a boolean`);
  assertArray(snapshot.controlPoints, `${label}.controlPoints`);
  assertArray(snapshot.legResults, `${label}.legResults`);
  assertArray(snapshot.invalidatedLegIndexes, `${label}.invalidatedLegIndexes`);
  snapshot.controlPoints.forEach((entry, index) => {
    if (typeof entry?.id !== "string" || !entry.id) {
      throw new TypeError(`${label}.controlPoints[${index}].id must be a non-empty string`);
    }
    normalizeControlPoint(entry, `${label}.controlPoints[${index}]`);
  });
  snapshot.legResults.forEach((entry, index) => {
    if (entry !== undefined && entry !== null) normalizeGeometry(entry, `${label}.legResults[${index}]`);
  });
  snapshot.invalidatedLegIndexes.forEach((entry, index) => {
    assertPositiveInteger(entry + 1, `${label}.invalidatedLegIndexes[${index}]`);
  });
  if (snapshot.selection !== null) {
    if (typeof snapshot.selection !== "object") throw new TypeError(`${label}.selection must be an object or null`);
    assertFiniteNumber(snapshot.selection.startM, `${label}.selection.startM`);
    assertFiniteNumber(snapshot.selection.endM, `${label}.selection.endM`);
  }
}

function assertEditableDraft(draft) {
  if (draft?.status !== "draft") throw new TypeError(`${draft?.status ?? "unknown"} draft is not editable`);
}

function assertStatus(draft, currentStatus, nextStatus) {
  validateDraft(draft);
  if (draft.status !== currentStatus) {
    throw new TypeError(`${draft.status} -> ${nextStatus} is not a legal draft transition`);
  }
}

function transitionStatus(draft, status) {
  const next = cloneState(validateDraft(draft));
  next.status = status;
  next.revision = draft.revision + 1;
  return validateDraft(next);
}

function normalizeControlPoint(point, label = "control point") {
  const validated = validatePoint(point, label);
  const elevationM = point.elevationM ?? point.ele ?? 0;
  assertFiniteNumber(elevationM, `${label}.elevationM`);
  return { lat: validated.lat, lng: validated.lng, elevationM: Math.round(elevationM) };
}

function normalizeGeometry(points, label) {
  assertArray(points, label);
  if (points.length < 2) throw new TypeError(`${label} must contain at least two points`);
  return points.map((entry, index) => normalizeControlPoint(entry, `${label}[${index}]`));
}

function moveControlPointInPlace(working, controlPointId, point) {
  const index = findControlPointIndex(working.controlPoints, controlPointId);
  working.controlPoints[index] = { ...working.controlPoints[index], ...normalizeControlPoint(point) };
  invalidateLegs(working, impactedIndexesForMove(index, working.controlPoints.length, working.closedLoop));
  clampSelectionToGeometry(working);
}

function findControlPointIndex(controlPoints, controlPointId) {
  const index = controlPoints.findIndex((entry) => entry.id === controlPointId);
  if (index === -1) throw new RangeError(`Unknown control point: ${controlPointId}`);
  return index;
}

function invalidateLegs(working, indexes) {
  const sorted = [...new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0))].sort((left, right) => left - right);
  const currentLegCount = legCountForDraft(working);
  for (const index of sorted) {
    if (index < currentLegCount) working.legResults[index] = undefined;
  }
  working.legResults.length = currentLegCount;
  working.invalidatedLegIndexes = sorted;
}

function impactedIndexesForInsert(index, controlPointCount, closedLoop) {
  if (controlPointCount < 2) return [];
  const indexes = [];
  if (index > 0) indexes.push(index - 1);
  if (closedLoop && controlPointCount > 2 && index === controlPointCount - 1) indexes.push(controlPointCount - 1);
  return indexes;
}

function impactedIndexesForMove(index, controlPointCount, closedLoop) {
  const indexes = [];
  if (index > 0) indexes.push(index - 1);
  if (index < controlPointCount - 1) indexes.push(index);
  if (closedLoop && controlPointCount > 2 && (index === 0 || index === controlPointCount - 1)) {
    indexes.push(controlPointCount - 1);
  }
  return indexes;
}

function impactedIndexesForRemoval(index, controlPointCountAfter, closedLoop) {
  const indexes = [];
  if (controlPointCountAfter === 0) return indexes;
  if (index > 0) indexes.push(index - 1);
  if (index < controlPointCountAfter) indexes.push(index);
  if (closedLoop && controlPointCountAfter > 1 && (index === 0 || index >= controlPointCountAfter)) {
    indexes.push(closingLegIndex(controlPointCountAfter, true));
  }
  return indexes;
}

function impactedIndexesForReorder(fromIndex, targetIndex, controlPointCount, closedLoop) {
  const lower = Math.min(fromIndex, targetIndex);
  const upper = Math.max(fromIndex, targetIndex);
  const indexes = [];
  for (let index = Math.max(0, lower - 1); index <= Math.min(controlPointCount - 2, upper); index += 1) {
    indexes.push(index);
  }
  if (closedLoop && controlPointCount > 2 && (fromIndex === 0 || targetIndex === 0 || fromIndex === controlPointCount - 1 || targetIndex === controlPointCount - 1)) {
    indexes.push(controlPointCount - 1);
  }
  return indexes;
}

function closingLegIndex(controlPointCount, closedLoop) {
  if (!closedLoop || controlPointCount < 2) return null;
  return controlPointCount - 1;
}

function legCountForDraft(draft) {
  if (draft.controlPoints.length < 2) return 0;
  return draft.controlPoints.length - 1 + (draft.closedLoop ? 1 : 0);
}

function metricsFromGeometry(geometry) {
  if (geometry.length === 0) return { pointCount: 0, distanceM: 0, ascentM: 0, descentM: 0 };
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const from = geometry[index];
    const to = geometry[index + 1];
    distanceM += distanceBetween(from, to);
    const delta = to.elevationM - from.elevationM;
    if (delta > 0) ascentM += delta;
    else descentM += Math.abs(delta);
  }
  return {
    pointCount: geometry.length,
    distanceM: Math.round(distanceM),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM)
  };
}

function profileFromGeometry(geometry) {
  if (geometry.length === 0) return [];
  let distanceM = 0;
  return geometry.map((point, index) => {
    if (index > 0) distanceM += distanceBetween(geometry[index - 1], point);
    return { distanceM, lat: point.lat, lng: point.lng, elevationM: point.elevationM };
  });
}

function trimGeometry(geometry, startM, endM) {
  const profile = profileFromGeometry(geometry);
  if (profile.length === 0) return [];
  const total = profile[profile.length - 1].distanceM;
  if (startM === 0 && endM === total) return geometry;
  const selected = [interpolateAtDistance(profile, startM)];
  for (let index = 1; index < profile.length - 1; index += 1) {
    if (profile[index].distanceM > startM && profile[index].distanceM < endM) {
      selected.push(clonePoint(profile[index]));
    }
  }
  selected.push(interpolateAtDistance(profile, endM));
  return selected.map(({ distanceM: _distanceM, ...point }) => point);
}

function interpolateAtDistance(profile, distanceM) {
  const clamped = clamp(distanceM, 0, profile[profile.length - 1].distanceM);
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    if (clamped <= current.distanceM) {
      const span = current.distanceM - previous.distanceM;
      const ratio = span === 0 ? 0 : (clamped - previous.distanceM) / span;
      return {
        distanceM: clamped,
        lat: lerp(previous.lat, current.lat, ratio),
        lng: lerp(previous.lng, current.lng, ratio),
        elevationM: Math.round(lerp(previous.elevationM, current.elevationM, ratio))
      };
    }
  }
  return profile[profile.length - 1];
}

function clampSelectionToGeometry(working) {
  if (!working.selection) return;
  const total = metricsFromGeometry(getComposedGeometry(working)).distanceM;
  if (total === 0) {
    working.selection = null;
    return;
  }
  working.selection = {
    startM: clamp(working.selection.startM, 0, total),
    endM: clamp(working.selection.endM, 0, total)
  };
  if (working.selection.endM < working.selection.startM) {
    working.selection.endM = working.selection.startM;
  }
}

function pushHistory(history, entry, limit) {
  return [...history, entry].slice(-limit);
}

function clonePoint(point) {
  return { lat: point.lat, lng: point.lng, elevationM: point.elevationM };
}

function samePoint(left, right) {
  return left.lat === right.lat && left.lng === right.lng && left.elevationM === right.elevationM;
}

function distanceBetween(left, right) {
  const leftLat = (left.lat * Math.PI) / 180;
  const rightLat = (right.lat * Math.PI) / 180;
  const dLat = rightLat - leftLat;
  const dLng = ((right.lng - left.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function lerp(start, end, ratio) {
  return start + (end - start) * ratio;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
}

function assertIntegerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}`);
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
}
