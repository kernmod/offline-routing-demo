import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mapMocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  let latestMap: FakeMap | undefined;
  const markers: FakeMarker[] = [];
  class FakeMarker {
    handler?: Handler;
    position = { lng: 151.21, lat: -33.869 };
    constructor() { markers.push(this); }
    setLngLat(value: [number, number]) { this.position = { lng: value[0], lat: value[1] }; return this; }
    addTo() { return this; }
    on(_event: string, handler: Handler) { this.handler = handler; return this; }
    getLngLat() { return this.position; }
    remove = vi.fn();
    triggerDragEnd() { this.handler?.(); }
  }
  class FakeMap {
    options: unknown;
    handlers = new Map<string, Handler>();
    source = { setData: vi.fn() };
    canvas = { style: { cursor: "" } };
    addSource = vi.fn();
    addLayer = vi.fn();
    remove = vi.fn();
    setPaintProperty = vi.fn();
    easeTo = vi.fn();
    getSource = vi.fn(() => this.source);
    getLayer = vi.fn(() => ({ id: "published-segments-line" }));
    getCanvas = vi.fn(() => this.canvas);
    isStyleLoaded = vi.fn(() => true);
    queryRenderedFeatures = vi.fn(() => []);
    constructor(options?: unknown) { this.options = options; latestMap = this; }
    on(event: string, layerOrHandler: string | Handler, possibleHandler?: Handler) {
      const layer = typeof layerOrHandler === "string" ? layerOrHandler : "";
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : possibleHandler;
      if (handler) this.handlers.set(`${event}:${layer}`, handler);
      return this;
    }
    once(event: string, handler: Handler) { this.handlers.set(`${event}:`, handler); return this; }
    trigger(event: string, data?: unknown, layer = "") { this.handlers.get(`${event}:${layer}`)?.(data); }
  }
  const addProtocol = vi.fn();
  return { FakeMap, FakeMarker, addProtocol, latest: () => latestMap, markers, reset: () => { latestMap = undefined; markers.length = 0; } };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: mapMocks.FakeMap, Marker: mapMocks.FakeMarker, addProtocol: mapMocks.addProtocol },
  Map: mapMocks.FakeMap,
  Marker: mapMocks.FakeMarker
}));
vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));

import { MapCanvas } from "../src/components/MapCanvas";

afterEach(cleanup);
beforeEach(() => { mapMocks.addProtocol.mockClear(); mapMocks.reset(); });

const segment = {
  id: "seed-sydney-cbd-001",
  encodedGeometry: "vxdr_Awgal_Hfw@gw@",
  pointCount: 2,
  distanceM: 130,
  isSeed: true as const,
  kind: "seed" as const,
  coordinates: [[151.2091, -33.8696], [151.21, -33.8687]] as [number, number][]
};

describe("MapCanvas", () => {
  it("registers PMTiles, renders local provenance and feeds public segments into a real map source", () => {
    const onTilesReady = vi.fn();
    const { rerender } = render(
      <MapCanvas segments={[]} selectedId={null} onSelect={vi.fn()} onTilesReady={onTilesReady} onTilesError={vi.fn()} />
    );
    expect(screen.getByLabelText("Map of Sydney CBD")).toBeVisible();
    expect(screen.getByText("Embedded PMTiles")).toBeVisible();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeVisible();
    expect(mapMocks.addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));

    act(() => mapMocks.latest()?.trigger("load"));
    act(() => mapMocks.latest()?.trigger("idle"));
    expect(onTilesReady).toHaveBeenCalledOnce();
    expect(mapMocks.latest()?.addSource).toHaveBeenCalledWith("published-segments", expect.anything());
    expect(mapMocks.latest()?.addLayer).toHaveBeenCalledTimes(4);

    rerender(<MapCanvas segments={[segment]} selectedId="seed-sydney-cbd-001" onSelect={vi.fn()} onTilesReady={onTilesReady} onTilesError={vi.fn()} />);
    expect(mapMocks.latest()?.source.setData).toHaveBeenCalledWith(expect.objectContaining({ features: [expect.anything()] }));
    expect(mapMocks.latest()?.setPaintProperty).toHaveBeenCalledWith("published-segments-line", "line-width", expect.any(Array));
  });

  it("forwards map selection and an early embedded-asset failure", () => {
    const onSelect = vi.fn();
    const onTilesError = vi.fn();
    render(<MapCanvas segments={[]} selectedId={null} onSelect={onSelect} onTilesReady={vi.fn()} onTilesError={onTilesError} />);

    act(() => mapMocks.latest()?.trigger("error", { error: new Error("style missing") }));
    expect(onTilesError).toHaveBeenCalledWith("style missing");
    act(() => mapMocks.latest()?.trigger("load"));
    act(() => mapMocks.latest()?.trigger("idle"));
    act(() => mapMocks.latest()?.trigger("click", { features: [{ properties: { id: "seed-sydney-cbd-001" } }] }, "published-segments-line"));
    expect(onSelect).toHaveBeenCalledWith("seed-sydney-cbd-001");
    act(() => mapMocks.latest()?.trigger("mouseenter", undefined, "published-segments-line"));
    expect(mapMocks.latest()?.canvas.style.cursor).toBe("pointer");
    act(() => mapMocks.latest()?.trigger("mouseleave", undefined, "published-segments-line"));
    expect(mapMocks.latest()?.canvas.style.cursor).toBe("");
  });

  it("uses the latest segment list when live data wins the race against map load", () => {
    render(<MapCanvas segments={[segment]} selectedId={null} onSelect={vi.fn()} onTilesReady={vi.fn()} onTilesError={vi.fn()} />);
    act(() => mapMocks.latest()?.trigger("load"));
    act(() => mapMocks.latest()?.trigger("idle"));
    expect(mapMocks.latest()?.addSource).toHaveBeenCalledWith(
      "published-segments",
      expect.objectContaining({ data: expect.objectContaining({ features: [expect.anything()] }) })
    );
  });

  it("uses a safe error message when the map library omits one", () => {
    const onTilesError = vi.fn();
    render(<MapCanvas segments={[]} selectedId={null} onSelect={vi.fn()} onTilesReady={vi.fn()} onTilesError={onTilesError} />);
    act(() => mapMocks.latest()?.trigger("error", { error: {} }));
    expect(onTilesError).toHaveBeenCalledWith("Embedded map assets could not be read.");
  });

  it("does not mutate paint before the MapLibre style is ready", () => {
    const props = { segments: [], onSelect: vi.fn(), onTilesReady: vi.fn(), onTilesError: vi.fn() };
    const { rerender } = render(<MapCanvas {...props} selectedId="pending" />);
    const map = mapMocks.latest();
    map?.isStyleLoaded.mockReturnValue(false);
    map?.setPaintProperty.mockClear();
    rerender(<MapCanvas {...props} selectedId="other" />);
    expect(map?.setPaintProperty).not.toHaveBeenCalled();
  });

  it("adds map points and commits draggable control markers without a routing request", () => {
    const onMapPoint = vi.fn();
    const onControlMove = vi.fn();
    render(
      <MapCanvas
        segments={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onTilesReady={vi.fn()}
        onTilesError={vi.fn()}
        onMapPoint={onMapPoint}
        onControlMove={onControlMove}
        controlPoints={[{ id: "cp-0001", lat: -33.87, lng: 151.2, elevationM: 8 }]}
      />
    );
    act(() => mapMocks.latest()?.trigger("load"));
    act(() => mapMocks.latest()?.trigger("click", { point: { x: 10, y: 10 }, lngLat: { lat: -33.869, lng: 151.211 } }));
    expect(onMapPoint).toHaveBeenCalledWith({ lat: -33.869, lng: 151.211, elevationM: 0 });

    expect(mapMocks.markers).toHaveLength(1);
    mapMocks.markers[0].position = { lat: -33.8685, lng: 151.2115 };
    act(() => mapMocks.markers[0].triggerDragEnd());
    expect(onControlMove).toHaveBeenCalledWith("cp-0001", { lat: -33.8685, lng: 151.2115, elevationM: 8 });
  });

  it("exposes a 2D/3D map mode without hiding route overlays", () => {
    render(<MapCanvas segments={[]} selectedId={null} onSelect={vi.fn()} onTilesReady={vi.fn()} onTilesError={vi.fn()} />);
    act(() => mapMocks.latest()?.trigger("load"));
    expect(mapMocks.latest()?.options).toEqual(expect.objectContaining({ bearing: -18, pitch: 48 }));
    expect(screen.getByLabelText("Map of Sydney CBD")).toHaveAttribute("data-map-mode", "3d");
    expect(screen.getByRole("button", { name: "Switch map to 2D" })).toBeVisible();
    expect(mapMocks.latest()?.addLayer.mock.calls.map(([layer]) => (layer as { id: string }).id)).toEqual([
      "published-segments-line",
      "draft-route-line",
      "selected-route-line",
      "profile-marker-circle"
    ]);

    act(() => screen.getByRole("button", { name: "Switch map to 2D" }).click());
    expect(mapMocks.latest()?.easeTo).toHaveBeenLastCalledWith({ bearing: 0, duration: 520, pitch: 0 });
    expect(screen.getByLabelText("Map of Sydney CBD")).toHaveAttribute("data-map-mode", "2d");
    expect(screen.getByRole("button", { name: "Switch map to 3D" })).toBeVisible();

    act(() => screen.getByRole("button", { name: "Switch map to 3D" }).click());
    expect(mapMocks.latest()?.easeTo).toHaveBeenLastCalledWith({ bearing: -18, duration: 520, pitch: 48 });
    expect(screen.getByLabelText("Map of Sydney CBD")).toHaveAttribute("data-map-mode", "3d");
  });
});
