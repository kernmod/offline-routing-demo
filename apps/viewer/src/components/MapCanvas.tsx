import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

import { fixtureStyleUrl } from "../lib/assets";
import { segmentFeatureCollection, type RenderableSegment } from "../lib/segments";

import "maplibre-gl/dist/maplibre-gl.css";

type LngLatPoint = Readonly<{ lat: number; lng: number }>;
type GeometryPoint = Readonly<{ lat: number; lng: number; elevationM?: number }>;
type ControlPoint = Readonly<{ id: string; lat: number; lng: number; elevationM: number }>;

type MapCanvasProps = Readonly<{
  segments: RenderableSegment[];
  selectedId: string | null;
  draftGeometry?: GeometryPoint[];
  selectedGeometry?: GeometryPoint[];
  controlPoints?: ControlPoint[];
  activeProfilePoint?: LngLatPoint | null;
  onSelect: (id: string) => void;
  onTilesReady: () => void;
  onTilesError: (message: string) => void;
  onMapAddPoint?: (point: GeometryPoint) => void;
  onMapPoint?: (point: GeometryPoint) => void;
  onControlMove?: (id: string, point: GeometryPoint) => void;
}>;

const EMPTY_GEOJSON = { type: "FeatureCollection", features: [] } as const;

function controlPointFeatures(controlPoints: NonNullable<MapCanvasProps["controlPoints"]>) {
  return {
    type: "FeatureCollection" as const,
    features: controlPoints.map((point, index) => ({
      type: "Feature" as const,
      properties: { id: point.id, index },
      geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] }
    }))
  };
}

function lineFeature(id: string, geometry: GeometryPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: geometry.length >= 2
      ? [{
        type: "Feature" as const,
        properties: { id },
        geometry: {
          type: "LineString" as const,
          coordinates: geometry.map((point) => [point.lng, point.lat])
        }
      }]
      : []
  };
}

function profileMarkerFeature(point: LngLatPoint | null | undefined) {
  return {
    type: "FeatureCollection" as const,
    features: point
      ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] } }]
      : []
  };
}

export function MapCanvas({
  segments,
  selectedId,
  draftGeometry = [],
  selectedGeometry = [],
  controlPoints = [],
  activeProfilePoint = null,
  onSelect,
  onTilesReady,
  onTilesError,
  onMapAddPoint,
  onMapPoint,
  onControlMove
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mountedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const publishedGeoJson = useMemo(() => segmentFeatureCollection(segments), [segments]);
  const draftGeoJson = useMemo(() => lineFeature("draft-route", draftGeometry), [draftGeometry]);
  const selectedGeoJson = useMemo(() => lineFeature("selected-route", selectedGeometry), [selectedGeometry]);
  const controlsGeoJson = useMemo(() => controlPointFeatures(controlPoints), [controlPoints]);
  const profileGeoJson = useMemo(() => profileMarkerFeature(activeProfilePoint), [activeProfilePoint]);
  const callbacksRef = useRef({ onMapAddPoint, onMapPoint, onSelect, onTilesError, onTilesReady });
  const initialDataRef = useRef({ controlsGeoJson, draftGeoJson, profileGeoJson, publishedGeoJson, selectedGeoJson });
  callbacksRef.current = { onMapAddPoint, onMapPoint, onSelect, onTilesError, onTilesReady };
  initialDataRef.current = { controlsGeoJson, draftGeoJson, profileGeoJson, publishedGeoJson, selectedGeoJson };

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: fixtureStyleUrl(),
      center: [151.2093, -33.8695],
      zoom: 15,
      attributionControl: false
    });
    mapRef.current = map;

    map.on("error", (event: { error?: { message?: string } }) => {
      callbacksRef.current.onTilesError(event.error?.message ?? "Embedded map assets could not be read.");
    });

    map.on("click", (event: { point?: maplibregl.PointLike; lngLat?: { lat: number; lng: number } }) => {
      if (event.point && map.getLayer("published-segments-line")) {
        const publishedHits = map.queryRenderedFeatures(event.point, { layers: ["published-segments-line"] });
        if (publishedHits.length > 0) return;
      }
      const point = event.lngLat ? { lat: event.lngLat.lat, lng: event.lngLat.lng, elevationM: 0 } : null;
      if (!point) return;
      callbacksRef.current.onMapAddPoint?.(point);
      callbacksRef.current.onMapPoint?.(point);
    });

    map.on("click", "published-segments-line", (event: { features?: Array<{ properties?: { id?: string } }> }) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") callbacksRef.current.onSelect(id);
    });
    map.on("mouseenter", "published-segments-line", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "published-segments-line", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("load", () => {
      const data = initialDataRef.current;
      map.addSource("published-segments", { type: "geojson", data: data.publishedGeoJson });
      map.addSource("draft-route", { type: "geojson", data: data.draftGeoJson });
      map.addSource("selected-route", { type: "geojson", data: data.selectedGeoJson });
      map.addSource("draft-controls", { type: "geojson", data: data.controlsGeoJson });
      map.addSource("profile-marker", { type: "geojson", data: data.profileGeoJson });
      map.addLayer({
        id: "published-segments-line",
        type: "line",
        source: "published-segments",
        paint: { "line-color": "#0d6b63", "line-width": 3, "line-opacity": 0.7 }
      });
      map.addLayer({
        id: "draft-route-line",
        type: "line",
        source: "draft-route",
        paint: { "line-color": "#c96f31", "line-width": 4 }
      });
      map.addLayer({
        id: "selected-route-line",
        type: "line",
        source: "selected-route",
        paint: { "line-color": "#f0d7a6", "line-width": 5, "line-opacity": 0.9 }
      });
      map.addLayer({
        id: "profile-marker-circle",
        type: "circle",
        source: "profile-marker",
        paint: { "circle-radius": 6, "circle-color": "#173c35" }
      });
    });
    map.once("idle", () => {
      setMapReady(true);
      callbacksRef.current.onTilesReady();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = controlPoints.map((point, index) => {
      const element = document.createElement("div");
      element.className = "control-marker";
      element.dataset.controlRole = index === 0 ? "start" : index === controlPoints.length - 1 ? "finish" : "via";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Control point ${index + 1}`);
      element.textContent = String(index + 1);
      const marker = new maplibregl.Marker({ element, draggable: Boolean(onControlMove), anchor: "center" })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      if (onControlMove) {
        marker.on("dragend", () => {
          const next = marker.getLngLat();
          onControlMove(point.id, { lat: next.lat, lng: next.lng, elevationM: point.elevationM });
        });
      }
      return marker;
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [controlPoints, onControlMove]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const source = map.getSource("published-segments") as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(publishedGeoJson);
    map.setPaintProperty("published-segments-line", "line-width", [
      "case",
      ["==", ["get", "id"], selectedId ?? ""],
      6,
      3
    ]);
  }, [publishedGeoJson, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("draft-route") as { setData?: (data: unknown) => void } | undefined)?.setData?.(draftGeoJson);
    (map.getSource("selected-route") as { setData?: (data: unknown) => void } | undefined)?.setData?.(selectedGeoJson);
    (map.getSource("draft-controls") as { setData?: (data: unknown) => void } | undefined)?.setData?.(controlsGeoJson);
    (map.getSource("profile-marker") as { setData?: (data: unknown) => void } | undefined)?.setData?.(profileGeoJson);
  }, [controlsGeoJson, draftGeoJson, profileGeoJson, selectedGeoJson]);

  return (
    <section className="map-shell" aria-label="Map of Sydney CBD">
      <div className="map-toolbar" aria-label="Map data sources">
        <span><i className="status-dot status-dot--local" aria-hidden="true" /> Embedded PMTiles</span>
        <span>offline local features</span>
        <span><i className="status-dot status-dot--live" aria-hidden="true" /> {segments.length} public segments</span>
        <span><i className="status-dot status-dot--edit" aria-hidden="true" /> local routing</span>
      </div>
      <div
        ref={containerRef}
        className="map-canvas"
        data-map-ready={mapReady}
        data-map-segments={segments.length}
      />
      <p className="map-attribution">© OpenStreetMap contributors · ODbL · embedded Sydney fixture</p>
    </section>
  );
}
