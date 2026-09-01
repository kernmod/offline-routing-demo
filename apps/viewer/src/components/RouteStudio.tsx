import { useEffect, useMemo, useRef, useState } from "react";

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
  trimDraft,
  undoDraft,
  type GeometryPoint,
  type PublishPayload,
  type RouteStudioDraft
} from "@offline-routing/route-studio";

import { publishSegmentV2, type ApiSegmentV2 } from "../lib/api";
import type { LocalRouter } from "../lib/router";
import { recomputeInvalidatedLegs } from "../lib/router";
import type { RenderableSegment } from "../lib/segments";
import { MapCanvas } from "./MapCanvas";
import { SegmentList } from "./SegmentList";

const DRAFT_STORAGE_KEY = "offline-routing.route-studio.v2";

type RouteStudioProps = Readonly<{
  segments: RenderableSegment[];
  invalidGeometryCount?: number;
  selectedId: string | null;
  router: LocalRouter | null;
  routerStatus: "loading" | "ready" | "error";
  apiBase: string;
  fetcher?: typeof fetch;
  onSelect: (id: string) => void;
  onPublished: (segment: ApiSegmentV2) => void;
  onTilesReady: () => void;
  onTilesError: (message: string) => void;
}>;

function restoreLocalDraft(): RouteStudioDraft {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!stored) return createDraft();
    const restored = restoreDraft(stored);
    if (restored.status === "publishing") return resumeDraftEditing(failDraftPublication(restored));
    if (restored.status === "ready") return resumeDraftEditing(restored);
    return restored;
  } catch {
    return createDraft();
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pointRole(index: number, count: number): string {
  if (index === 0) return "start";
  if (index === count - 1) return "finish";
  return `via ${index}`;
}

function elevationPath(profile: ReturnType<typeof getElevationProfile>): string {
  if (profile.length < 2) return "";
  const total = profile.at(-1)?.distanceM ?? 1;
  const elevations = profile.map((point) => point.elevationM);
  const minimum = Math.min(...elevations);
  const span = Math.max(1, Math.max(...elevations) - minimum);
  return profile.map((point, index) => {
    const x = (point.distanceM / total) * 600;
    const y = 128 - ((point.elevationM - minimum) / span) * 100;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function formatDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${distanceM} m`;
}

export function RouteStudio({
  segments,
  invalidGeometryCount = 0,
  selectedId,
  router,
  routerStatus,
  apiBase,
  fetcher,
  onSelect,
  onPublished,
  onTilesReady,
  onTilesError
}: RouteStudioProps) {
  const [draft, setDraft] = useState<RouteStudioDraft>(restoreLocalDraft);
  const draftRef = useRef(draft);
  const [nameInput, setNameInput] = useState(draft.name);
  const [routePhase, setRoutePhase] = useState<"idle" | "routing" | "ready" | "error">(
    getComposedGeometry(draft).length >= 2 ? "ready" : "idle"
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [profileDistance, setProfileDistance] = useState(0);
  const [confirmation, setConfirmation] = useState<{ payload: PublishPayload; key: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const routeToken = useRef(0);
  const routeTimer = useRef<number | null>(null);

  const fullGeometry = useMemo(() => getComposedGeometry(draft), [draft]);
  const selectedGeometry = useMemo(() => getTrimmedGeometry(draft), [draft]);
  const metrics = useMemo(() => getDraftMetrics(draft), [draft]);
  const selectedMetrics = useMemo(() => getSelectionMetrics(draft), [draft]);
  const profile = useMemo(() => getElevationProfile(draft), [draft]);
  const activeProfilePoint = useMemo(
    () => lookupProfileAtDistance(draft, profileDistance),
    [draft, profileDistance]
  );
  const selectedPublic = segments.find((segment) => segment.id === selectedId) ?? null;

  function updateDraft(next: RouteStudioDraft): void {
    draftRef.current = next;
    setDraft(next);
  }

  async function routeChangedDraft(changed: RouteStudioDraft): Promise<void> {
    if (!router || changed.controlPoints.length < 2) {
      setRoutePhase("idle");
      return;
    }
    const token = ++routeToken.current;
    setRoutePhase("routing");
    setNotice(null);
    if (routeTimer.current !== null) window.clearTimeout(routeTimer.current);
    routeTimer.current = window.setTimeout(async () => {
      try {
        const routed = await recomputeInvalidatedLegs(changed, router);
        if (token !== routeToken.current || draftRef.current.revision !== changed.revision) return;
        updateDraft(routed);
        setRoutePhase(getComposedGeometry(routed).length >= 2 ? "ready" : "idle");
      } catch {
        if (token !== routeToken.current) return;
        setRoutePhase("error");
        setNotice("Local route unavailable. Move a control point and try again.");
      } finally {
        if (routeToken.current === token) routeTimer.current = null;
      }
    }, 0);
  }

  function applyEdit(change: (current: RouteStudioDraft) => RouteStudioDraft, reroute = true): void {
    if (draftRef.current.status !== "draft") return;
    const changed = change(draftRef.current);
    updateDraft(changed);
    if (reroute) void routeChangedDraft(changed);
  }

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, serializeDraft(draft));
    } catch {
      // Local storage is a progressive enhancement; editing remains available.
    }
  }, [draft]);

  function saveDraft(): void {
    try {
      const named = nameInput.trim() ? setDraftName(draftRef.current, nameInput) : draftRef.current;
      updateDraft(named);
      localStorage.setItem(DRAFT_STORAGE_KEY, serializeDraft(named));
      setNameInput(named.name);
      setNotice("Private draft saved on this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Draft could not be saved.");
    }
  }

  function reviewPublication(): void {
    try {
      const named = setDraftName(draftRef.current, nameInput);
      const ready = prepareDraftForPublication(named);
      const payload = buildPublishPayload(ready);
      updateDraft(ready);
      setNameInput(ready.name);
      setConfirmation({ payload, key: createIdempotencyKey() });
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Complete the route before publishing.");
    }
  }

  async function publishConfirmed(): Promise<void> {
    if (!confirmation) return;
    let publishingDraft: RouteStudioDraft;
    try {
      publishingDraft = beginDraftPublication(draftRef.current);
      updateDraft(publishingDraft);
    } catch {
      setNotice("Publication state could not be prepared. Return to editing and review again.");
      return;
    }
    setPublishing(true);
    setNotice(null);
    try {
      const published = await publishSegmentV2(apiBase, confirmation.payload, confirmation.key, fetcher);
      updateDraft(completeDraftPublication(publishingDraft));
      setConfirmation(null);
      setNotice(`Published · ${published.name}`);
      onPublished(published);
    } catch {
      if (draftRef.current.status === "publishing") updateDraft(failDraftPublication(draftRef.current));
      setNotice("Publication failed. Your local draft is intact; retry uses the same request key.");
    } finally {
      setPublishing(false);
    }
  }

  const selectionStart = Math.round(draft.selection?.startM ?? 0);
  const selectionEnd = Math.round(draft.selection?.endM ?? metrics.distanceM);
  const sliderMaximum = Math.max(1, metrics.distanceM);
  const path = elevationPath(profile);
  const editable = draft.status === "draft";

  function returnToEditing(): void {
    if (draftRef.current.status === "ready" || draftRef.current.status === "published") {
      updateDraft(resumeDraftEditing(draftRef.current));
    }
    setConfirmation(null);
  }

  return (
    <section className="workspace workspace--studio" id="map">
      <article className="map-panel">
        <MapCanvas
          segments={segments}
          selectedId={selectedId}
          onSelect={onSelect}
          onTilesReady={onTilesReady}
          onTilesError={onTilesError}
          draftGeometry={fullGeometry}
          selectedGeometry={selectedGeometry}
          controlPoints={draft.controlPoints}
          activeProfilePoint={activeProfilePoint}
          onMapPoint={routerStatus === "ready" && editable ? (point) => applyEdit((current) => addControlPoint(current, point)) : undefined}
          onControlMove={editable ? (id, point) => applyEdit((current) => moveControlPoint(current, id, point)) : undefined}
        />
        {invalidGeometryCount > 0 && (
          <p className="invalid-notice" role="status">
            {invalidGeometryCount} invalid geometry {invalidGeometryCount === 1 ? "row was" : "rows were"} excluded from the map.
          </p>
        )}
      </article>

      <aside className="side-rail studio-rail" aria-label="Route Studio editor" data-draft-status={draft.status}>
        <section className="rail-section studio-intro">
          <div className="rail-heading"><span>01</span><h2>Route studio</h2></div>
          <p>Click the map to place start, finish and up to fourteen via points. Every leg stays on this device.</p>
          <div className="engine-state" aria-live="polite">
            {routerStatus === "loading" && "Loading local routing pack…"}
            {routerStatus === "error" && <span role="alert">Local routing engine unavailable.</span>}
            {routerStatus === "ready" && routePhase === "idle" && "Add at least two control points."}
            {routerStatus === "ready" && routePhase === "routing" && "Routing locally…"}
            {routerStatus === "ready" && routePhase === "ready" && "Route ready · computed locally"}
            {routePhase === "error" && <span role="alert">{notice}</span>}
          </div>
        </section>

        <section className="rail-section" aria-label="Control points">
          <div className="section-title-row">
            <h3>{draft.controlPoints.length} control points</h3>
            <div className="compact-actions">
              <button type="button" aria-label="Undo last edit" disabled={!editable || draft.undoStack.length === 0} onClick={() => applyEdit(undoDraft)}>undo</button>
              <button type="button" aria-label="Redo last edit" disabled={!editable || draft.redoStack.length === 0} onClick={() => applyEdit(redoDraft)}>redo</button>
            </div>
          </div>
          <ol className="control-list">
            {draft.controlPoints.map((point, index) => {
              const role = pointRole(index, draft.controlPoints.length);
              return (
                <li key={point.id}>
                  <span className="control-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{role}</strong><small>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small></span>
                  <span className="point-actions">
                    <button type="button" aria-label={`Move ${role} up`} disabled={!editable || index === 0} onClick={() => applyEdit((current) => reorderControlPoints(current, point.id, index - 1))}>↑</button>
                    <button type="button" aria-label={`Move ${role} down`} disabled={!editable || index === draft.controlPoints.length - 1} onClick={() => applyEdit((current) => reorderControlPoints(current, point.id, index + 1))}>↓</button>
                    <button type="button" aria-label={`Delete ${role}`} disabled={!editable} onClick={() => applyEdit((current) => removeControlPoint(current, point.id))}>×</button>
                  </span>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="loop-toggle"
            disabled={!editable || draft.controlPoints.length < 2}
            aria-pressed={draft.closedLoop}
            aria-label={draft.closedLoop ? "Open loop" : "Close loop"}
            onClick={() => applyEdit((current) => setClosedLoop(current, !current.closedLoop))}
          >
            {draft.closedLoop ? "loop closed · open it" : "close route as a loop"}
          </button>
        </section>

        <section className="rail-section elevation-section" aria-label="Elevation and trim">
          <div className="rail-heading"><span>02</span><h2>Elevation cut</h2></div>
          {profile.length >= 2 ? (
            <>
              <svg className="elevation-chart" role="img" aria-label="Elevation profile" viewBox="0 0 600 150" preserveAspectRatio="none">
                <path className="elevation-fill" d={`${path} L600,145 L0,145 Z`} />
                <path className="elevation-line" d={path} />
                <line className="trim-handle" x1={(selectionStart / sliderMaximum) * 600} x2={(selectionStart / sliderMaximum) * 600} y1="8" y2="145" />
                <line className="trim-handle" x1={(selectionEnd / sliderMaximum) * 600} x2={(selectionEnd / sliderMaximum) * 600} y1="8" y2="145" />
                <line className="scrub-line" x1={(profileDistance / sliderMaximum) * 600} x2={(profileDistance / sliderMaximum) * 600} y1="8" y2="145" />
              </svg>
              <label className="range-field">profile position
                <input aria-label="Profile position" type="range" min="0" max={sliderMaximum} value={Math.min(profileDistance, sliderMaximum)} onChange={(event) => setProfileDistance(Number(event.target.value))} />
              </label>
              <div className="trim-ranges">
                <label>trim from
                <input aria-label="Selection start" type="range" min="0" max={sliderMaximum} value={selectionStart} disabled={!editable} onChange={(event) => {
                    const next = Math.min(Number(event.target.value), selectionEnd);
                    applyEdit((current) => trimDraft(current, next, selectionEnd), false);
                  }} />
                </label>
                <label>trim to
                <input aria-label="Selection end" type="range" min="0" max={sliderMaximum} value={selectionEnd} disabled={!editable} onChange={(event) => {
                    const next = Math.max(Number(event.target.value), selectionStart);
                    applyEdit((current) => trimDraft(current, selectionStart, next), false);
                  }} />
                </label>
              </div>
              <div className="metric-grid">
                <span><small>{draft.selection ? "selected" : "full route"}</small><strong>{formatDistance(selectedMetrics.distanceM)}</strong></span>
                <span><small>elevation</small><strong>D+ {selectedMetrics.ascentM} m · D− {selectedMetrics.descentM} m</strong></span>
              </div>
              <button type="button" className="text-action" aria-label="Use full route" disabled={!editable || !draft.selection} onClick={() => applyEdit(resetToFullSelection, false)}>reset trim</button>
            </>
          ) : <p className="empty-list">Elevation appears after the first local leg.</p>}
        </section>

        <section className="rail-section publish-section">
          <div className="rail-heading"><span>03</span><h2>Publish</h2></div>
          <label className="name-field">segment name
            <input aria-label="Segment name" maxLength={80} value={nameInput} disabled={!editable} onChange={(event) => setNameInput(event.target.value)} placeholder="e.g. harbour rise" />
          </label>
          <div className="publish-actions">
            <button type="button" className="secondary-action" aria-label="Save private draft" disabled={!editable} onClick={saveDraft}>save draft</button>
            <button type="button" className="primary-action" aria-label="Review publication" disabled={!editable || routePhase !== "ready"} onClick={reviewPublication}>review publication</button>
          </div>
          {notice && routePhase !== "error" && <p className="notice" role="status">{notice}</p>}
          {draft.status === "published" && (
            <button type="button" className="text-action continue-editing" aria-label="Continue editing published draft" onClick={returnToEditing}>continue editing a private copy</button>
          )}
        </section>

        <section className="rail-section public-section">
          <div className="rail-heading"><span>04</span><h2>Nearby routes</h2></div>
          <SegmentList segments={segments} selectedId={selectedId} onSelect={onSelect} />
          {selectedPublic && (
            <section className="selection" aria-label="Selected segment">
              <p className="selection__eyebrow">{selectedPublic.kind === "seed" ? "fixture seed" : "public snapshot"}</p>
              <h3>{selectedPublic.name?.trim() || selectedPublic.id}</h3>
              <dl>
                <div><dt>state</dt><dd>{selectedPublic.publicationState ?? "published"}</dd></div>
                <div><dt>distance</dt><dd>{selectedPublic.distanceM} m</dd></div>
                {selectedPublic.elevationGainM !== undefined && selectedPublic.elevationGainM !== null &&
                  selectedPublic.elevationLossM !== undefined && selectedPublic.elevationLossM !== null && (
                    <div><dt>elevation</dt><dd>D+ {selectedPublic.elevationGainM} m · D− {selectedPublic.elevationLossM} m</dd></div>
                  )}
                {selectedPublic.metricsVersion !== undefined && (
                  <div><dt>contract</dt><dd>metrics v{selectedPublic.metricsVersion}</dd></div>
                )}
                <div><dt>geometry</dt><dd>{selectedPublic.pointCount} points</dd></div>
                <div><dt>origin</dt><dd>{selectedPublic.kind === "seed" ? "fixture seed" : "live API"}</dd></div>
                <div><dt>id</dt><dd><code>{selectedPublic.id}</code></dd></div>
              </dl>
            </section>
          )}
        </section>
      </aside>

      {confirmation && (
        <div className="modal-backdrop">
          <div className="confirmation-card" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title">
            <p className="eyebrow">immutable public snapshot</p>
            <h2 id="publish-dialog-title">Confirm publication</h2>
            <h3>{confirmation.payload.name}</h3>
            <dl>
              <div><dt>selection</dt><dd>{formatDistance(selectedMetrics.distanceM)}</dd></div>
              <div><dt>elevation</dt><dd>D+ {selectedMetrics.ascentM} m · D− {selectedMetrics.descentM} m</dd></div>
              <div><dt>controls</dt><dd>{confirmation.payload.controlPoints.length}</dd></div>
            </dl>
            <p>The public API receives this final geometry only. Your editable draft stays local.</p>
            <div className="publish-actions">
              <button type="button" className="secondary-action" disabled={publishing} onClick={returnToEditing}>back to edit</button>
              <button type="button" className="primary-action" aria-label="Publish segment" disabled={publishing} onClick={() => void publishConfirmed()}>{publishing ? "publishing…" : "publish segment"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
