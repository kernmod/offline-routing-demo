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
  getSelectionMetrics,
  getTrimmedGeometry,
  lookupProfileAtDistance,
  moveControlPoint,
  prepareDraftForPublication,
  redoDraft,
  removeControlPoint,
  reorderControlPoints,
  resetToFullSelection,
  restoreDraft,
  resumeDraftEditing,
  serializeDraft,
  setClosedLoop,
  setDraftName,
  setLegResult,
  trimDraft,
  undoDraft
} from "@offline-routing/route-studio";

export const SYDNEY_BBOX = { minLng: 151.204, minLat: -33.873, maxLng: 151.217, maxLat: -33.862 };
/** @type {{ load(): Promise<any>, save(value: any): Promise<void> }} */
const emptyStore = { async load() { return null; }, async save(_value) {} };

function randomUuid() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function initialState() {
  return {
    status: "booting", message: "Preparing local map assets.", draft: createDraft(), nameInput: "", segments: [],
    publishStatus: "idle", pendingPublishKey: null, lastPublishedId: null, moveTargetId: null,
    profileCursor: null, routeSource: "local_native"
  };
}

function derive(state) {
  const geometry = getComposedGeometry(state.draft);
  const metrics = getDraftMetrics(state.draft);
  return {
    ...state,
    route: geometry.length > 1 ? {
      geometry, polyline: geometry, distanceM: metrics.distanceM, pointCount: metrics.pointCount,
      elevationGainM: metrics.ascentM, elevationLossM: metrics.descentM
    } : null,
    metrics,
    selectedGeometry: getTrimmedGeometry(state.draft),
    selectionMetrics: getSelectionMetrics(state.draft),
    profile: getElevationProfile(state.draft)
  };
}

function editableDraft(draft) {
  return draft;
}

function legEndpoints(draft, legIndex) {
  const origin = draft.controlPoints[legIndex];
  const destination = legIndex === draft.controlPoints.length - 1 ? draft.controlPoints[0] : draft.controlPoints[legIndex + 1];
  if (!origin || !destination) throw new Error("invalidated_leg_has_no_endpoints");
  return [origin, destination];
}

function routeGeometry(result) {
  const geometry = result?.geometry ?? result?.polyline;
  if (!Array.isArray(geometry) || geometry.length < 2) throw new Error("local_route_has_no_geometry");
  return geometry;
}

/** Platform-neutral state machine: all route calls are local; only explicit publish/list actions use the API. */
export function createDemoController({ router, tileServer = null, api, pack = null, online, draftStore = emptyStore, uuid = randomUuid }) {
  if (!router?.route) throw new TypeError("router must expose local route operations");
  if (tileServer && !tileServer.start) throw new TypeError("tileServer.start is required");
  if (pack && !router.loadPack) throw new TypeError("router.loadPack is required for an embedded pack");
  if (!api?.publishSegment || !api?.listSegments) throw new TypeError("api must expose publish and list operations");
  if (typeof online !== "function") throw new TypeError("online must be a function");
  let activeApi = api;
  let state = initialState();
  let persistenceQueue = Promise.resolve();
  const snapshot = () => structuredClone(derive(state));
  const persist = () => {
    const envelope = {
      serializedDraft: serializeDraft(state.draft), nameInput: state.nameInput, pendingPublishKey: state.pendingPublishKey
    };
    persistenceQueue = persistenceQueue.catch(() => undefined).then(() => draftStore.save(envelope));
    return persistenceQueue;
  };
  const markEdited = (clearCursor = true) => {
    state = {
      ...state,
      publishStatus: "idle",
      pendingPublishKey: null,
      lastPublishedId: null,
      profileCursor: clearCursor ? null : state.profileCursor
    };
  };
  const recomputeInvalidated = async () => {
    const legCount = state.draft.controlPoints.length < 2 ? 0 : state.draft.controlPoints.length - 1 + Number(state.draft.closedLoop);
    const invalidated = state.draft.invalidatedLegIndexes.filter((index) => index < legCount);
    if (invalidated.length !== state.draft.invalidatedLegIndexes.length) {
      state = { ...state, draft: { ...state.draft, invalidatedLegIndexes: invalidated } };
    }
    if (invalidated.length === 0) return;
    state = { ...state, status: "routing", message: `Calculating ${invalidated.length} local leg${invalidated.length > 1 ? "s" : ""}.` };
    for (const legIndex of invalidated) {
      const [origin, destination] = legEndpoints(state.draft, legIndex);
      const result = await router.route({ lat: origin.lat, lng: origin.lng }, { lat: destination.lat, lng: destination.lng });
      state = { ...state, draft: setLegResult(state.draft, legIndex, { geometry: routeGeometry(result) }) };
    }
  };
  const finishEdit = async (draft, message) => {
    state = { ...state, draft, message, moveTargetId: null };
    markEdited();
    try {
      await recomputeInvalidated();
    } catch (error) {
      state = { ...state, status: "route_error", message: "No local route connects the changed control points." };
      await persist();
      throw error;
    }
    const metrics = getDraftMetrics(state.draft);
    state = {
      ...state,
      status: metrics.pointCount > 1 ? "route_ready" : state.draft.controlPoints.length ? "awaiting_next_point" : "ready",
      message: metrics.pointCount > 1 ? `${metrics.distanceM} m route ready offline.` : message
    };
    await persist();
    return snapshot();
  };

  return {
    async boot() {
      if (tileServer) await tileServer.start();
      if (pack) await router.loadPack(pack);
      const restored = await draftStore.load();
      if (restored) {
        try {
          let restoredDraft = restoreDraft(restored.serializedDraft);
          if (restoredDraft.status === "publishing") restoredDraft = failDraftPublication(restoredDraft);
          state = { ...state, draft: restoredDraft, nameInput: restored.nameInput, pendingPublishKey: restored.pendingPublishKey };
        } catch { /* Corrupt local state must not block an offline boot. */ }
      }
      const metrics = getDraftMetrics(state.draft);
      state = {
        ...state, status: metrics.pointCount > 1 ? "route_ready" : "ready",
        publishStatus: state.pendingPublishKey ? "failed" : "idle",
        message: metrics.pointCount > 1 ? `${metrics.distanceM} m draft restored offline.` : "Tap the map to add route points."
      };
      return snapshot();
    },
    async tapPoint(point) {
      const draft = editableDraft(state.draft);
      if (state.moveTargetId) return finishEdit(moveControlPoint(draft, state.moveTargetId, point), "Control point moved.");
      if (draft.controlPoints.length >= 16) throw new Error("control_point_limit");
      return finishEdit(addControlPoint(draft, point), "Tap again to add a destination or waypoint.");
    },
    async beginMove(controlPointId) {
      if (!state.draft.controlPoints.some((point) => point.id === controlPointId)) throw new Error("unknown_control_point");
      state = { ...state, moveTargetId: controlPointId, message: "Tap the map to place this control point." };
      return snapshot();
    },
    async cancelMove() { state = { ...state, moveTargetId: null, message: "Move cancelled." }; return snapshot(); },
    async newDraft() {
      state = { ...initialState(), status: "ready", message: "New private draft. Tap the map to begin." };
      await persist(); return snapshot();
    },
    async removePoint(controlPointId) { return finishEdit(removeControlPoint(editableDraft(state.draft), controlPointId), "Control point removed."); },
    async reorderPoint(controlPointId, targetIndex) { return finishEdit(reorderControlPoints(editableDraft(state.draft), controlPointId, targetIndex), "Control points reordered."); },
    async undo() { return finishEdit(undoDraft(editableDraft(state.draft)), "Last edit undone."); },
    async redo() { return finishEdit(redoDraft(editableDraft(state.draft)), "Edit restored."); },
    async setLoop(enabled) { return finishEdit(setClosedLoop(editableDraft(state.draft), enabled), enabled ? "Loop closed locally." : "Route opened."); },
    async setTrim(startM, endM) {
      state = { ...state, draft: trimDraft(editableDraft(state.draft), startM, endM), message: "Publication range updated." };
      markEdited(false); await persist(); return snapshot();
    },
    async resetTrim() {
      state = { ...state, draft: resetToFullSelection(editableDraft(state.draft)), message: "Full route restored." };
      markEdited(false); await persist(); return snapshot();
    },
    scrubProfile(distanceM) { state = { ...state, profileCursor: lookupProfileAtDistance(state.draft, distanceM) }; return snapshot(); },
    async setName(value) {
      if (typeof value !== "string") throw new TypeError("name must be a string");
      state = { ...state, draft: editableDraft(state.draft), nameInput: value, message: "Draft name saved locally." };
      markEdited(); await persist(); return snapshot();
    },
    async requestPublish() {
      if (!online()) {
        state = { ...state, publishStatus: "offline", message: "Publishing requires a network connection; the draft remains local." };
        return snapshot();
      }
      const editable = state.draft.status === "ready" ? resumeDraftEditing(state.draft) : state.draft;
      const draft = setDraftName(editable, state.nameInput);
      const readyDraft = prepareDraftForPublication(draft);
      const payload = buildPublishPayload(readyDraft);
      state = {
        ...state,
        draft: readyDraft,
        nameInput: readyDraft.name,
        publishStatus: "confirming",
        message: `Confirm publication of ${payload.geometry.length} route points.`
      };
      if (!state.pendingPublishKey) state = { ...state, pendingPublishKey: uuid() };
      await persist(); return snapshot();
    },
    async cancelPublish() {
      state = {
        ...state,
        draft: state.draft.status === "ready" ? resumeDraftEditing(state.draft) : state.draft,
        publishStatus: "idle",
        pendingPublishKey: null,
        message: "Publication cancelled; draft kept locally."
      };
      await persist(); return snapshot();
    },
    async confirmPublish() {
      if (state.publishStatus !== "confirming" && state.publishStatus !== "failed") throw new Error("publication_not_confirmed");
      if (!online()) {
        state = { ...state, publishStatus: "offline", message: "Publishing requires a network connection; the draft remains local." };
        return snapshot();
      }
      const publishingDraft = state.draft.status === "publishing" ? state.draft : beginDraftPublication(state.draft);
      const payload = buildPublishPayload(publishingDraft);
      const idempotencyKey = state.pendingPublishKey ?? uuid();
      state = {
        ...state,
        draft: publishingDraft,
        pendingPublishKey: idempotencyKey,
        publishStatus: "publishing",
        message: "Publishing the confirmed snapshot."
      };
      await persist();
      try {
        const published = await activeApi.publishSegment(payload, idempotencyKey);
        state = {
          ...state,
          draft: completeDraftPublication(state.draft),
          publishStatus: "published",
          pendingPublishKey: null,
          lastPublishedId: published.id, message: "Published. The editable route can be resumed on this device."
        };
        await persist(); return snapshot();
      } catch (error) {
        state = {
          ...state,
          draft: failDraftPublication(state.draft),
          publishStatus: "failed",
          message: "Publication failed; retry keeps the same draft and request ID."
        };
        await persist(); throw error;
      }
    },
    async resumeEditing() {
      state = {
        ...state,
        draft: resumeDraftEditing(state.draft),
        publishStatus: "idle",
        message: "Editing resumed from the published snapshot."
      };
      await persist(); return snapshot();
    },
    async refreshSegments() {
      if (!online()) { state = { ...state, message: "Nearby segments require a network connection." }; return snapshot(); }
      const segments = await activeApi.listSegments(SYDNEY_BBOX);
      state = { ...state, segments, message: `${segments.length} published segments loaded.` };
      return snapshot();
    },
    replaceApiForTest(nextApi) { activeApi = nextApi; },
    snapshot
  };
}
