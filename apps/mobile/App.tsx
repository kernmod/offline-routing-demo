import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, type NativeSyntheticEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Camera, GeoJSONSource, Layer, Map as MapView, type PressEvent } from "@maplibre/maplibre-react-native";
import type { RouteStudioDraft } from "@offline-routing/route-studio";

import { createDemoController } from "./app.js";
import { parseBenchmarkUrl } from "./src/benchmarkLink";
import {
  ControlPointList,
  EditorToolbar,
  ElevationProfile,
  MetricStrip,
  PublicationPanel,
  PublishConfirmation,
  StudioSheet,
  TrimStepper,
  type ProfileMode
} from "./src/components/StudioControls";
import { mobileDraftStore } from "./src/mobileDraftStore";
import { listSegments, networkDisabled, publishSegment } from "./src/networkApi";
import { networkAttemptCount } from "./src/networkMonitor";
import { prepareOfflineFixture } from "./src/offlineBoot";
import { parseRouteUrl } from "./src/routeLink";
import { lineFeature, pointFeature, stepTrimRange, type ElevationPoint, type ProfilePoint } from "./src/studioViewModel";

type Metrics = { pointCount: number; distanceM: number; ascentM: number; descentM: number };
type StudioState = {
  status: string;
  message: string;
  draft: RouteStudioDraft;
  nameInput: string;
  publishStatus: string;
  moveTargetId: string | null;
  routeSource: "local_native";
  route: null | { polyline: ElevationPoint[]; distanceM: number; pointCount: number };
  metrics: Metrics;
  selectionMetrics: Metrics;
  selectedGeometry: ElevationPoint[];
  profile: ProfilePoint[];
  profileCursor: ProfilePoint | null;
  segments: Array<{ id: string; name?: string }>;
  lastPublishedId: string | null;
};
type Controller = {
  boot(): Promise<StudioState>;
  tapPoint(point: { lat: number; lng: number }): Promise<StudioState>;
  beginMove(id: string): Promise<StudioState>;
  removePoint(id: string): Promise<StudioState>;
  reorderPoint(id: string, index: number): Promise<StudioState>;
  undo(): Promise<StudioState>;
  redo(): Promise<StudioState>;
  setLoop(value: boolean): Promise<StudioState>;
  setTrim(startM: number, endM: number): Promise<StudioState>;
  resetTrim(): Promise<StudioState>;
  scrubProfile(distanceM: number): StudioState;
  setName(value: string): Promise<StudioState>;
  requestPublish(): Promise<StudioState>;
  cancelPublish(): Promise<StudioState>;
  confirmPublish(): Promise<StudioState>;
  resumeEditing(): Promise<StudioState>;
  refreshSegments(): Promise<StudioState>;
  newDraft(): Promise<StudioState>;
  snapshot(): StudioState;
};

const sydneyCenter = [151.2105, -33.8675] as [number, number];
const sydneyInitialView = { center: sydneyCenter, zoom: 14, pitch: 48, bearing: -18 };
const emptyMetrics: Metrics = { pointCount: 0, distanceM: 0, ascentM: 0, descentM: 0 };

export default function App() {
  const controllerRef = useRef<Controller | null>(null);
  const nativeRouterRef = useRef<Awaited<ReturnType<typeof prepareOfflineFixture>>["router"] | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("Preparing the embedded map and route pack.");
  const [busy, setBusy] = useState(true);
  const [profileMode, setProfileMode] = useState<ProfileMode>("inspect");
  const [mapMode, setMapMode] = useState<"3d" | "2d">("3d");

  const routeFeature = useMemo(() => lineFeature(studio?.route?.polyline ?? []), [studio?.route?.polyline]);
  const selectedFeature = useMemo(() => lineFeature(studio?.selectedGeometry ?? []), [studio?.selectedGeometry]);
  const controlFeature = useMemo(() => pointFeature((studio?.draft.controlPoints ?? []) as ElevationPoint[], "control"), [studio?.draft.controlPoints]);
  const cursorFeature = useMemo(() => pointFeature(studio?.profileCursor ? [studio.profileCursor] : [], "cursor"), [studio?.profileCursor]);
  const mapCamera = useMemo(() => ({
    pitch: mapMode === "3d" ? 48 : 0,
    bearing: mapMode === "3d" ? -18 : 0
  }), [mapMode]);

  const run = async (operation: () => Promise<StudioState>) => {
    setBusy(true);
    try {
      const next = await operation();
      setStudio(next);
      setFeedback(next.message);
      if (next.route) {
        console.log(
          `OfflineRoutingRoute ${JSON.stringify({
            routeSource: "local_native",
            distanceM: next.route.distanceM,
            pointCount: next.route.pointCount,
            networkAttempts: networkAttemptCount()
          })}`
        );
      }
    } catch (error) {
      const current = controllerRef.current?.snapshot();
      if (current) setStudio(current);
      setFeedback(current?.message ?? (error instanceof Error ? error.message.replaceAll("_", " ") : "The requested edit failed."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    prepareOfflineFixture()
      .then(async (fixture) => {
        if (cancelled) return;
        nativeRouterRef.current = fixture.router;
        const controller = createDemoController({
          router: fixture.router,
          api: { publishSegment, listSegments },
          online: () => !networkDisabled,
          draftStore: mobileDraftStore
        }) as Controller;
        controllerRef.current = controller;
        const ready = await controller.boot();
        if (cancelled) return;
        setStyleUrl(fixture.styleUrl);
        setStudio(ready);
        setFeedback(ready.message);
        setBusy(false);
      })
      .catch((error: unknown) => {
        console.log(`OfflineRoutingBootFailure ${error instanceof Error ? error.message : String(error)}`);
        if (!cancelled) {
          setFeedback("The embedded fixture could not be prepared.");
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!studio || !controllerRef.current) return;
    let cancelled = false;
    const handleDeepLink = async (url: string | null) => {
      if (!url || cancelled) return;
      const benchmark = parseBenchmarkUrl(url);
      if (benchmark && nativeRouterRef.current) {
        setFeedback(`Benchmarking ${benchmark.device}.`);
        try {
          const result = nativeRouterRef.current.benchmark(benchmark.device);
          console.log(`OfflineRoutingBenchmark ${JSON.stringify(result)}`);
          if (!cancelled) setFeedback(`Benchmark ready: p50 ${result.p50Micros} us · p95 ${result.p95Micros} us.`);
        } catch {
          if (!cancelled) setFeedback("Benchmark failed on this device.");
        }
        return;
      }
      const route = parseRouteUrl(url);
      if (!route || !controllerRef.current) return;
      await run(async () => {
        await controllerRef.current!.newDraft();
        await controllerRef.current!.tapPoint(route.origin);
        return controllerRef.current!.tapPoint(route.destination);
      });
    };
    Linking.getInitialURL().then(handleDeepLink).catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => {
      void handleDeepLink(event.url);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [Boolean(studio)]);

  const onMapPress = (event: NativeSyntheticEvent<PressEvent>) => {
    if (!controllerRef.current || busy) return;
    const [lng, lat] = event.nativeEvent.lngLat;
    void run(() => controllerRef.current!.tapPoint({ lat, lng }));
  };

  const applyTrim = (handle: "start" | "end", distanceM: number) => {
    if (!studio || !controllerRef.current || studio.metrics.distanceM <= 0) return;
    const current = studio.draft.selection ?? { startM: 0, endM: studio.metrics.distanceM };
    const next =
      handle === "start"
        ? { startM: Math.min(distanceM, current.endM - 1), endM: current.endM }
        : { startM: current.startM, endM: Math.max(distanceM, current.startM + 1) };
    void run(() => controllerRef.current!.setTrim(Math.max(0, next.startM), Math.min(studio.metrics.distanceM, next.endM)));
  };

  const scrubProfile = (distanceM: number) => {
    if (!controllerRef.current) return;
    const inspected = controllerRef.current.scrubProfile(distanceM);
    setStudio(inspected);
    if (profileMode !== "inspect") applyTrim(profileMode, distanceM);
  };

  const stepTrim = (handle: "start" | "end", direction: number) => {
    if (!studio || !controllerRef.current) return;
    const next = stepTrimRange(studio.metrics.distanceM, studio.draft.selection, handle, direction);
    void run(() => controllerRef.current!.setTrim(next.startM, next.endM));
  };

  const editName = (name: string) => {
    if (!controllerRef.current) return;
    setStudio((current) => current ? { ...current, nameInput: name } : current);
    controllerRef.current.setName(name).then((next) => setStudio(next)).catch((error: unknown) => {
      setFeedback(error instanceof Error ? error.message : "The draft name could not be saved.");
    });
  };

  const metrics = studio?.metrics ?? emptyMetrics;
  const selectionMetrics = studio?.selectionMetrics ?? emptyMetrics;
  const confirmed = studio?.draft.status === "ready" && studio.publishStatus === "confirming";
  const locked = busy || studio?.draft.status === "publishing";

  return (
    <View style={styles.shell} accessibilityLabel="Offline route studio demonstration">
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>OFFLINE ROUTE STUDIO</Text>
          <Text style={styles.title}>shape a route, locally.</Text>
        </View>
        <View style={styles.localBadge}>
          <View style={styles.localDot} />
          <Text style={styles.localText}>device engine</Text>
        </View>
        <Text style={styles.status}>{feedback}</Text>
      </View>
      {styleUrl ? (
        <View style={styles.mapFrame}>
          <MapView
            androidView="texture"
            style={styles.map}
            mapStyle={styleUrl}
            onPress={onMapPress}
            onDidFinishLoadingMap={() => {
              console.log(`OfflineRoutingMapReady ${JSON.stringify({ styleUrl, networkAttempts: networkAttemptCount() })}`);
            }}
          >
            <Camera
              initialViewState={sydneyInitialView}
              pitch={mapCamera.pitch}
              bearing={mapCamera.bearing}
              duration={420}
              easing="ease"
            />
            <GeoJSONSource id="route-source" data={routeFeature as never}>
              <Layer
                id="route-shadow-line"
                type="line"
                paint={{ "line-color": "#111611", "line-width": 16, "line-opacity": 0.64, "line-blur": 1 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
              <Layer
                id="route-casing-line"
                type="line"
                paint={{ "line-color": "#f7ead0", "line-width": 12, "line-opacity": 0.98 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
              <Layer
                id="route-line"
                type="line"
                paint={{ "line-color": "#f2b36f", "line-width": 6 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="selected-route-source" data={selectedFeature as never}>
              <Layer
                id="selected-route-shadow-line"
                type="line"
                paint={{ "line-color": "#111611", "line-width": 13, "line-opacity": 0.68, "line-blur": 0.8 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
              <Layer
                id="selected-route-casing-line"
                type="line"
                paint={{ "line-color": "#f7ead0", "line-width": 10, "line-opacity": 0.98 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
              <Layer
                id="selected-route-line"
                type="line"
                paint={{ "line-color": "#c4663a", "line-width": 5 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="control-point-source" data={controlFeature as never}>
              <Layer
                id="control-point-halo"
                type="circle"
                paint={{ "circle-color": "#111611", "circle-radius": 11, "circle-opacity": 0.34 }}
              />
              <Layer
                id="control-point-circle"
                type="circle"
                paint={{ "circle-color": "#eee9dc", "circle-radius": 8, "circle-stroke-color": "#1a1d1a", "circle-stroke-width": 3.5 }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="profile-cursor-source" data={cursorFeature as never}>
              <Layer
                id="profile-cursor-halo"
                type="circle"
                paint={{ "circle-color": "#f7ead0", "circle-radius": 11, "circle-opacity": 0.98 }}
              />
              <Layer
                id="profile-cursor-circle"
                type="circle"
                paint={{ "circle-color": "#9ab88a", "circle-radius": 5, "circle-stroke-color": "#111611", "circle-stroke-width": 1 }}
              />
            </GeoJSONSource>
          </MapView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mapMode === "3d" ? "Switch map to 2D" : "Switch map to 3D"}
            accessibilityHint="Changes the camera angle without using the network."
            hitSlop={8}
            onPress={() => setMapMode((current) => current === "3d" ? "2d" : "3d")}
            style={styles.mapModeButton}
          >
            {({ pressed }) => (
              <View style={[styles.mapModeButtonFace, pressed && styles.mapModeButtonPressed]}>
                <Text style={styles.mapModeEyebrow}>VIEW</Text>
                <Text style={styles.mapModeValue}>{mapMode.toUpperCase()}</Text>
              </View>
            )}
          </Pressable>
          {busy && (
            <View style={styles.mapBusy}>
              <ActivityIndicator color="#d2a16f" />
              <Text style={styles.mapBusyText}>local calculation</Text>
            </View>
          )}
          {studio?.moveTargetId && (
            <View style={styles.moveHint}>
              <Text style={styles.moveHintText}>tap map to move selected point</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color="#d2a16f" />
          <Text style={styles.loadingText}>Opening embedded PMTiles…</Text>
        </View>
      )}
      {studio && (
        <StudioSheet>
          <MetricStrip full={metrics} selected={selectionMetrics} />
          <EditorToolbar
            draft={studio.draft}
            busy={locked}
            onUndo={() => void run(() => controllerRef.current!.undo())}
            onRedo={() => void run(() => controllerRef.current!.redo())}
            onLoop={() => void run(() => controllerRef.current!.setLoop(!studio.draft.closedLoop))}
            onReset={() => void run(() => controllerRef.current!.newDraft())}
          />
          <ControlPointList
            points={studio.draft.controlPoints}
            movingId={studio.moveTargetId}
            disabled={locked}
            onMove={(id) => void run(() => controllerRef.current!.beginMove(id))}
            onDelete={(id) => void run(() => controllerRef.current!.removePoint(id))}
            onReorder={(id, index) => void run(() => controllerRef.current!.reorderPoint(id, index))}
          />
          <ElevationProfile
            profile={studio.profile}
            selection={studio.draft.selection}
            cursorDistanceM={studio.profileCursor?.distanceM ?? null}
            mode={profileMode}
            onMode={setProfileMode}
            onScrub={scrubProfile}
          />
          <TrimStepper disabled={locked || metrics.distanceM <= 1} onStep={stepTrim} onReset={() => void run(() => controllerRef.current!.resetTrim())} />
          <PublicationPanel
            name={studio.nameInput}
            status={studio.publishStatus}
            disabled={locked || !studio.route}
            onName={editName}
            onPublish={() => void run(() => controllerRef.current!.requestPublish())}
            onResume={() => void run(() => controllerRef.current!.resumeEditing())}
            onNearby={() => void run(() => controllerRef.current!.refreshSegments())}
          />
          <Text style={styles.footer}>
            network attempts: {networkAttemptCount()} · published nearby: {studio.segments.length} · route source: local_native
          </Text>
        </StudioSheet>
      )}
      <PublishConfirmation
        visible={confirmed}
        name={studio?.nameInput ?? ""}
        metrics={selectionMetrics}
        pointCount={studio?.selectedGeometry.length ?? 0}
        onCancel={() => void run(() => controllerRef.current!.cancelPublish())}
        onConfirm={() => void run(() => controllerRef.current!.confirmPublish())}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#161a18" },
  header: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 12, borderBottomWidth: 1, borderColor: "#364039" },
  kicker: { color: "#d2a16f", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  title: { color: "#eee9dc", fontSize: 25, fontWeight: "800", letterSpacing: -0.7, marginTop: 3 },
  status: { color: "#a7b1a5", fontSize: 11, lineHeight: 16, marginTop: 8, paddingRight: 110 },
  localBadge: {
    position: "absolute",
    right: 18,
    top: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#3a463e",
    borderRadius: 13,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  localDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#a5c294" },
  localText: { color: "#a5c294", fontSize: 9, fontWeight: "700" },
  mapFrame: { height: "36%", minHeight: 240, borderBottomWidth: 1, borderColor: "#364039" },
  map: { flex: 1 },
  mapModeButton: { position: "absolute", top: 10, left: 10, zIndex: 2 },
  mapModeButtonFace: {
    minWidth: 52,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(232,226,211,0.26)",
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(26,29,26,0.92)",
    elevation: 4
  },
  mapModeButtonPressed: { borderColor: "#c89b6b", backgroundColor: "rgba(42,38,31,0.96)" },
  mapModeEyebrow: { color: "#9ab88a", fontSize: 7, fontWeight: "800", letterSpacing: 1.4 },
  mapModeValue: { color: "#e8e2d3", fontSize: 14, fontWeight: "900", letterSpacing: 0.8, marginTop: 1 },
  loading: { height: "36%", minHeight: 240, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#1d2420" },
  loadingText: { color: "#a7b1a5" },
  mapBusy: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(22,26,24,0.88)"
  },
  mapBusyText: { color: "#eee9dc", fontSize: 10 },
  moveHint: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
    alignItems: "center",
    borderRadius: 12,
    padding: 9,
    backgroundColor: "rgba(210,161,111,0.94)"
  },
  moveHintText: { color: "#161a18", fontWeight: "900", fontSize: 11 },
  footer: { color: "#78827a", fontSize: 9, lineHeight: 14, paddingTop: 4 }
});
