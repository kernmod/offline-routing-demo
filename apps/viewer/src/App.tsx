import { useEffect, useMemo, useState } from "react";

import { fetchSegments, fetchSegmentsV2, type ApiSegment } from "./lib/api";
import { loadLocalRouter, type LocalRouter } from "./lib/router";
import { decodeRenderableSegments } from "./lib/segments";
import { initialViewerState, nextViewerState, viewerCopy } from "./lib/viewer-state";
import { RouteStudio } from "./components/RouteStudio";

import "./styles.css";

type AppProps = Readonly<{
  apiBase?: string;
  fetcher?: typeof fetch;
  studioRouter?: LocalRouter | null;
}>;

function resolveApiBase(configured?: string): string {
  if (configured) return configured;
  return import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
}

async function readSegments(apiBase: string, fetcher?: typeof fetch): Promise<ApiSegment[]> {
  try {
    return await fetchSegmentsV2(apiBase, undefined, fetcher);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "invalid_payload") {
      return fetchSegments(apiBase, undefined, fetcher);
    }
    throw error;
  }
}

export function App({ apiBase, fetcher, studioRouter = null }: AppProps) {
  const [viewerState, setViewerState] = useState(initialViewerState);
  const [router, setRouter] = useState<LocalRouter | null>(studioRouter);
  const [routerStatus, setRouterStatus] = useState<"loading" | "ready" | "error">(studioRouter ? "ready" : "loading");
  const liveApi = resolveApiBase(apiBase);
  const copy = viewerCopy(viewerState);
  const renderable = useMemo(() => decodeRenderableSegments(viewerState.segments), [viewerState.segments]);

  useEffect(() => {
    let active = true;
    readSegments(liveApi, fetcher)
      .then((segments) => {
        if (active) setViewerState((current) => nextViewerState(current, { type: "data-ready", segments }));
      })
      .catch((error: unknown) => {
        if (active) {
          setViewerState((current) =>
            nextViewerState(current, {
              type: "data-error",
              message: error instanceof Error ? error.message : "Live data is unavailable."
            })
          );
        }
      });
    return () => {
      active = false;
    };
  }, [fetcher, liveApi]);

  useEffect(() => {
    if (studioRouter) return;
    let active = true;
    loadLocalRouter()
      .then((loaded) => {
        if (!active) return;
        setRouter(loaded);
        setRouterStatus("ready");
      })
      .catch(() => {
        if (active) setRouterStatus("error");
      });
    return () => {
      active = false;
    };
  }, [fetcher, studioRouter]);

  return (
    <main className="laboratory">
      <header className="masthead">
        <a className="wordmark" href="#map">ATLAS<span>/</span>RELAY</a>
        <p className="masthead__meta">public build · route studio · Sydney CBD</p>
      </header>

      <section className="hero" aria-live="polite">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
      </section>

      <RouteStudio
        segments={renderable}
        invalidGeometryCount={renderable.invalid.length}
        selectedId={viewerState.selectedId}
        router={router}
        routerStatus={routerStatus}
        apiBase={liveApi}
        fetcher={fetcher}
        onSelect={(id) => setViewerState((current) => nextViewerState(current, { type: "select", id }))}
        onPublished={(segment) =>
          setViewerState((current) => nextViewerState(current, { type: "published", segment }))
        }
        onTilesReady={() => setViewerState((current) => nextViewerState(current, { type: "tiles-ready" }))}
        onTilesError={(message) => setViewerState((current) => nextViewerState(current, { type: "tiles-error", message }))}
      />

    </main>
  );
}
