import type { ApiSegment } from "./api";

export type ViewerState = Readonly<{
  tiles: "loading" | "ready" | "error";
  data: "loading" | "ready" | "error";
  segments: ApiSegment[];
  selectedId: string | null;
  message: string | null;
}>;

export type ViewerEvent =
  | { type: "tiles-ready" }
  | { type: "tiles-error"; message: string }
  | { type: "data-ready"; segments: ApiSegment[] }
  | { type: "data-error"; message: string }
  | { type: "select"; id: string };

export function initialViewerState(): ViewerState {
  return { tiles: "loading", data: "loading", segments: [], selectedId: null, message: null };
}

export function nextViewerState(state: ViewerState, event: ViewerEvent): ViewerState {
  switch (event.type) {
    case "tiles-ready":
      return { ...state, tiles: "ready" };
    case "tiles-error":
      return { ...state, tiles: "error", message: event.message };
    case "data-ready":
      return {
        ...state,
        data: "ready",
        segments: event.segments,
        selectedId: state.selectedId && event.segments.some((segment) => segment.id === state.selectedId) ? state.selectedId : null,
        message: null
      };
    case "data-error":
      return { ...state, data: "error", segments: [], selectedId: null, message: event.message };
    case "select":
      return state.segments.some((segment) => segment.id === event.id) ? { ...state, selectedId: event.id } : state;
  }
}

export function viewerCopy(state: ViewerState): { eyebrow: string; title: string; detail: string } {
  if (state.data === "error") {
    return {
      eyebrow: "live data unavailable",
      title: "Local map is still available",
      detail: state.message ?? "Live data is unavailable."
    };
  }
  if (state.tiles === "error") {
    return { eyebrow: "local tiles unavailable", title: "Map assets could not be read", detail: state.message ?? "Check the fixture files." };
  }
  if (state.tiles === "loading") {
    return { eyebrow: "initializing map", title: "Sydney cartographic test field", detail: "Opening the embedded PMTiles fixture." };
  }
  if (state.data === "loading") {
    return { eyebrow: "reading live data", title: "Local map is ready", detail: "Requesting public segments in this viewport." };
  }
  if (state.segments.length === 0) {
    return { eyebrow: "no segments in view", title: "Local map is ready", detail: "Publish from the mobile demo, then refresh this area." };
  }
  const seeds = state.segments.filter((segment) => segment.isSeed).length;
  return {
    eyebrow: `${state.segments.length} segments visible`,
    title: "Sydney cartographic test field",
    detail: `${seeds} seeded reference${seeds === 1 ? "" : "s"} · ${state.segments.length - seeds} live publication${state.segments.length - seeds === 1 ? "" : "s"}`
  };
}
