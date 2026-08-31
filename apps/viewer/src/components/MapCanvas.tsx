import { useEffect, useRef, useState } from "react";
import maplibregl, { type MapGeoJSONFeature } from "maplibre-gl";
import { Protocol } from "pmtiles";

import { DEFAULT_BBOX } from "../lib/api";
import { fixtureStyleUrl } from "../lib/assets";
import { segmentFeatureCollection, type RenderableSegment } from "../lib/segments";

import "maplibre-gl/dist/maplibre-gl.css";

type MapCanvasProps = Readonly<{
  segments: RenderableSegment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTilesReady: () => void;
  onTilesError: (message: string) => void;
}>;

let protocolRegistered = false;

function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

function mapErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Embedded map assets could not be read.";
}

export function MapCanvas({ segments, selectedId, onSelect, onTilesReady, onTilesError }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const callbacks = useRef({ onSelect, onTilesReady, onTilesError });
  callbacks.current = { onSelect, onTilesReady, onTilesError };
  const latestData = useRef({ segments, selectedId });
  latestData.current = { segments, selectedId };
  const [rendered, setRendered] = useState(false);
  const [featureCount, setFeatureCount] = useState<number | null>(null);
  const [segmentsOnMap, setSegmentsOnMap] = useState(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtilesProtocol();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: fixtureStyleUrl(),
      center: [151.2105, -33.8675],
      zoom: 14.55,
      minZoom: 13.4,
      maxZoom: 17,
      attributionControl: false,
      cooperativeGestures: true,
      renderWorldCopies: false
    });
    mapRef.current = map;
    let announcedReady = false;

    map.on("load", () => {
      map.addSource("published-segments", { type: "geojson", data: segmentFeatureCollection(latestData.current.segments) });
      map.addLayer({
        id: "published-segments-glow",
        type: "line",
        source: "published-segments",
        paint: { "line-color": "#00e5ff", "line-width": 8, "line-opacity": 0.18, "line-blur": 3 }
      });
      map.addLayer({
        id: "published-segments-line",
        type: "line",
        source: "published-segments",
        paint: {
          "line-color": ["match", ["get", "kind"], "seed", "#f4eddd", "#00e5ff"],
          "line-width": ["case", ["==", ["get", "id"], latestData.current.selectedId ?? ""], 5, 3],
          "line-opacity": 0.96
        }
      });
      map.on("click", "published-segments-line", (event) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const id = feature?.properties?.id;
        if (typeof id === "string") callbacks.current.onSelect(id);
      });
      map.on("mouseenter", "published-segments-line", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "published-segments-line", () => { map.getCanvas().style.cursor = ""; });
      map.once("idle", () => {
        setFeatureCount(map.queryRenderedFeatures({ layers: ["paths", "streets", "major-roads"] }).length);
        setSegmentsOnMap(latestData.current.segments.length);
        setRendered(true);
        callbacks.current.onTilesReady();
        announcedReady = true;
      });
    });
    map.on("error", (event) => {
      if (!announcedReady) callbacks.current.onTilesError(mapErrorMessage(event.error));
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("published-segments") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(segmentFeatureCollection(segments));
      map.once("idle", () => { setSegmentsOnMap(segments.length); });
    }
    if (map.getLayer("published-segments-line")) {
      map.setPaintProperty("published-segments-line", "line-width", [
        "case",
        ["==", ["get", "id"], selectedId ?? ""],
        5,
        3
      ]);
    }
  }, [segments, selectedId]);

  const centre = [
    (DEFAULT_BBOX.minLng + DEFAULT_BBOX.maxLng) / 2,
    (DEFAULT_BBOX.minLat + DEFAULT_BBOX.maxLat) / 2
  ];

  return (
    <section className="map-shell" aria-label="Map of Sydney CBD">
      <div className="map-toolbar" aria-label="Map data sources">
        <span><i className="status-dot status-dot--local" aria-hidden="true" /> Embedded PMTiles</span>
        {featureCount !== null && <span>{featureCount.toLocaleString()} local features</span>}
        <span><i className="status-dot status-dot--live" aria-hidden="true" /> Live public segments</span>
      </div>
      <div className="map-canvas" ref={containerRef} data-map-centre={centre.join(",")} data-map-ready={rendered ? "true" : "false"} data-map-segments={segmentsOnMap} />
      <p className="map-attribution">© OpenStreetMap contributors · ODbL · offline fixture: Sydney CBD</p>
    </section>
  );
}
