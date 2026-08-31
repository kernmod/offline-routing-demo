import { useEffect, useMemo, useReducer } from "react";

import { DEFAULT_BBOX, fetchSegments, type ApiSegment } from "./lib/api";
import { decodeRenderableSegments } from "./lib/segments";
import { initialViewerState, nextViewerState, viewerCopy } from "./lib/viewer-state";
import { MapCanvas } from "./components/MapCanvas";
import { SegmentList } from "./components/SegmentList";

import "./styles.css";

type AppProps = Readonly<{ apiBase?: string; fetcher?: typeof fetch }>;

function resolveApiBase(configured: string | undefined): string {
  if (configured) return configured;
  return import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
}

export function App({ apiBase, fetcher }: AppProps) {
  const [state, dispatch] = useReducer(nextViewerState, undefined, initialViewerState);
  const liveApi = resolveApiBase(apiBase);
  const copy = viewerCopy(state);
  const renderable = useMemo(() => decodeRenderableSegments(state.segments), [state.segments]);
  const selected = renderable.find((segment) => segment.id === state.selectedId) ?? null;

  useEffect(() => {
    let active = true;
    fetchSegments(liveApi, DEFAULT_BBOX, fetcher)
      .then((segments) => { if (active) dispatch({ type: "data-ready", segments }); })
      .catch((error: unknown) => {
        if (active) dispatch({ type: "data-error", message: error instanceof Error ? error.message : "Live data is unavailable." });
      });
    return () => { active = false; };
  }, [liveApi, fetcher]);

  return (
    <main className="laboratory">
      <header className="masthead">
        <a className="wordmark" href="#map">ATLAS<span>/</span>RELAY</a>
        <p className="masthead__meta">public build · fixture 01 · Sydney CBD</p>
      </header>
      <section className="hero" aria-live="polite">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
      </section>
      <section className="workspace" id="map">
        <article className="map-panel">
          <MapCanvas
            segments={renderable}
            selectedId={state.selectedId}
            onSelect={(id) => dispatch({ type: "select", id })}
            onTilesReady={() => dispatch({ type: "tiles-ready" })}
            onTilesError={(message) => dispatch({ type: "tiles-error", message })}
          />
          {renderable.invalid.length > 0 && (
            <p className="invalid-notice" role="status">
              {renderable.invalid.length} invalid geometry {renderable.invalid.length === 1 ? "row was" : "rows were"} excluded from the map.
            </p>
          )}
        </article>
        <aside className="side-rail" aria-label="Viewer inspection panel">
          <section className="rail-section">
            <div className="rail-heading"><span>01</span><h2>Public records</h2></div>
            <SegmentList segments={renderable} selectedId={state.selectedId} onSelect={(id) => dispatch({ type: "select", id })} />
          </section>
          <section className="rail-section selection" aria-label="Selected segment">
            <div className="rail-heading"><span>02</span><h2>Inspection</h2></div>
            {selected ? (
              <dl>
                <div><dt>distance</dt><dd>{selected.distanceM} m</dd></div>
                <div><dt>geometry</dt><dd>{selected.pointCount} points</dd></div>
                <div><dt>origin</dt><dd>{selected.kind === "seed" ? "fixture seed" : "live API"}</dd></div>
                <div><dt>id</dt><dd><code>{selected.id}</code></dd></div>
              </dl>
            ) : <p className="selection-empty">Choose a record to inspect its public, derived fields.</p>}
          </section>
          <section className="rail-section provenance">
            <div className="rail-heading"><span>03</span><h2>Boundary</h2></div>
            <p>Map tiles are an embedded public PMTiles fixture. Only the segment list is requested from the live API.</p>
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap attribution</a>
          </section>
        </aside>
      </section>
      <footer>WebGL map · PMTiles protocol · bounded bbox API · no account · no tracking</footer>
    </main>
  );
}

export type { ApiSegment };
