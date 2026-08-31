import { describe, expect, it } from "vitest";

import { initialViewerState, nextViewerState, viewerCopy } from "../src/lib/viewer-state";

describe("viewer state machine", () => {
  it("starts with local tiles loading and no live-data claim", () => {
    expect(initialViewerState()).toMatchObject({ tiles: "loading", data: "loading", segments: [] });
    expect(viewerCopy(initialViewerState()).eyebrow).toBe("initializing map");
  });

  it("distinguishes ready local tiles from a live API failure", () => {
    const state = nextViewerState(initialViewerState(), { type: "tiles-ready" });
    const failed = nextViewerState(state, { type: "data-error", message: "Live data is unavailable." });

    expect(viewerCopy(failed)).toMatchObject({
      eyebrow: "live data unavailable",
      title: "Local map is still available",
      detail: "Live data is unavailable."
    });
  });

  it("selects a visible segment and reports empty rows separately", () => {
    const ready = nextViewerState(initialViewerState(), {
      type: "data-ready",
      segments: [{ id: "seed", isSeed: true, distanceM: 130, pointCount: 2, encodedGeometry: "x" }]
    });
    const selected = nextViewerState(ready, { type: "select", id: "seed" });

    expect(selected.selectedId).toBe("seed");
    const empty = nextViewerState(
      nextViewerState(initialViewerState(), { type: "tiles-ready" }),
      { type: "data-ready", segments: [] }
    );
    expect(viewerCopy(empty).eyebrow).toBe(
      "no segments in view"
    );
  });

  it("reports a local-tile failure and does not select a row outside the current data", () => {
    const tilesFailed = nextViewerState(initialViewerState(), { type: "tiles-error", message: "asset missing" });
    expect(viewerCopy(tilesFailed)).toMatchObject({ eyebrow: "local tiles unavailable", detail: "asset missing" });
    expect(nextViewerState(tilesFailed, { type: "select", id: "absent" })).toEqual(tilesFailed);
  });

  it("retains an existing selection only when a refreshed dataset still has it", () => {
    const chosen = nextViewerState(
      nextViewerState(initialViewerState(), {
        type: "data-ready",
        segments: [{ id: "one", isSeed: false, distanceM: 1, pointCount: 2, encodedGeometry: "x" }]
      }),
      { type: "select", id: "one" }
    );
    expect(nextViewerState(chosen, { type: "data-ready", segments: chosen.segments }).selectedId).toBe("one");
    expect(nextViewerState(chosen, { type: "data-ready", segments: [] }).selectedId).toBeNull();
  });

  it("formats plural seed and live counts after both sources are ready", () => {
    const ready = nextViewerState(
      nextViewerState(initialViewerState(), { type: "tiles-ready" }),
      {
        type: "data-ready",
        segments: [
          { id: "seed-1", isSeed: true, distanceM: 1, pointCount: 2, encodedGeometry: "x" },
          { id: "seed-2", isSeed: true, distanceM: 1, pointCount: 2, encodedGeometry: "x" },
          { id: "fresh-1", isSeed: false, distanceM: 1, pointCount: 2, encodedGeometry: "x" },
          { id: "fresh-2", isSeed: false, distanceM: 1, pointCount: 2, encodedGeometry: "x" }
        ]
      }
    );
    expect(viewerCopy(ready).detail).toBe("2 seeded references · 2 live publications");
  });
});
