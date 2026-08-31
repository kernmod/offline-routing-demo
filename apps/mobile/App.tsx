import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, type NativeSyntheticEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Camera, GeoJSONSource, Layer, Map as MapView, type PressEvent } from "@maplibre/maplibre-react-native";

import { listSegments, networkDisabled, publishSegment } from "./src/networkApi";
import { parseBenchmarkUrl } from "./src/benchmarkLink";
import { networkAttemptCount } from "./src/networkMonitor";
import { prepareOfflineFixture } from "./src/offlineBoot";
import { parseRouteUrl } from "./src/routeLink";

type Point = { lat: number; lng: number };
type Route = { polyline: Point[]; distanceM: number; pointCount: number; totalWeight: number };
const sydneyCenter = [151.2105, -33.8675] as [number, number];

function lineFeature(route: Route | null) {
  return {
    type: "FeatureCollection" as const,
    features: route ? [{
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: route.polyline.map((point) => [point.lng, point.lat]) }
    }] : []
  };
}

export default function App() {
  const [router, setRouter] = useState<Awaited<ReturnType<typeof prepareOfflineFixture>>["router"] | null>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const [status, setStatus] = useState("Preparing the offline fixture.");
  const [nearby, setNearby] = useState<Array<{ id: string }>>([]);
  const routeFeature = useMemo(() => lineFeature(route), [route]);

  const runRoute = (origin: Point, destination: Point) => {
    if (!router) return;
    setPoints([origin, destination]);
    setStatus("Calculating locally.");
    const next = router.route(origin, destination);
    console.log(`OfflineRoutingRoute ${JSON.stringify({ routeSource: "local_native", distanceM: next.distanceM, pointCount: next.pointCount, networkAttempts: networkAttemptCount() })}`);
    setRoute(next);
    setStatus(`${next.distanceM} m route ready offline.`);
  };

  useEffect(() => {
    if (!router) return;
    const activeRouter = router;
    let cancelled = false;
    async function handleDeepLink(url: string | null) {
      if (!url) return;
      const request = parseBenchmarkUrl(url);
      if (request) {
        setStatus(`Benchmarking ${request.device}.`);
        try {
          const result = activeRouter.benchmark(request.device);
          if (cancelled) return;
          console.log(`OfflineRoutingBenchmark ${JSON.stringify(result)}`);
          setStatus(`Benchmark ready for ${result.device}: p50 ${result.p50Micros} us · p95 ${result.p95Micros} us.`);
        } catch {
          if (!cancelled) {
            setStatus("Benchmark failed on this device.");
          }
        }
        return;
      }
      const routeRequest = parseRouteUrl(url);
      if (!routeRequest) return;
      try {
        runRoute(routeRequest.origin, routeRequest.destination);
      } catch {
        if (!cancelled) {
          setStatus("The smoke route failed on this device.");
        }
      }
    }
    Linking.getInitialURL().then(handleDeepLink).catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => {
      void handleDeepLink(event.url);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    prepareOfflineFixture().then((fixture) => {
      setRouter(fixture.router); setStyleUrl(fixture.styleUrl);
      setStatus("Tap two points to calculate a route on this device.");
    }).catch((error: unknown) => {
      console.log(`OfflineRoutingBootFailure ${error instanceof Error ? error.message : String(error)}`);
      setStatus("The embedded fixture could not be prepared.");
    });
  }, []);

  const onMapPress = (event: NativeSyntheticEvent<PressEvent>) => {
    if (!router) return;
    const [lng, lat] = event.nativeEvent.lngLat;
    const selected = points.length === 2 ? [{ lat, lng }] : [...points, { lat, lng }];
    setPoints(selected);
    if (selected.length !== 2) { setRoute(null); setStatus("Tap a destination point."); return; }
    try {
      runRoute(selected[0], selected[1]);
    } catch { setStatus("No local route connects those two points."); }
  };

  const publish = async () => {
    if (!route) return;
    if (networkDisabled) { setStatus("Publishing is disabled until a public API URL is configured."); return; }
    try { await publishSegment({ geometry: route.polyline }); setStatus("Segment published."); }
    catch { setStatus("Publishing failed; the offline route remains available."); }
  };

  const refreshNearby = async () => {
    if (networkDisabled) { setStatus("Nearby segments require a network connection."); return; }
    try { const rows = await listSegments({ minLng: 151.204, minLat: -33.873, maxLng: 151.217, maxLat: -33.862 }); setNearby(rows); setStatus(`${rows.length} nearby segments loaded.`); }
    catch { setStatus("Nearby segments could not be loaded."); }
  };

  return <View style={styles.shell} accessibilityLabel="Offline routing demonstration">
    <StatusBar style="light" />
    <View style={styles.header}><Text style={styles.kicker}>OFFLINE ROUTING LAB</Text><Text style={styles.title}>local map. local route.</Text><Text style={styles.status}>{status}</Text></View>
    {styleUrl ? <MapView style={styles.map} mapStyle={styleUrl} onDidFinishLoadingMap={() => {
      console.log(`OfflineRoutingMapReady ${JSON.stringify({ styleUrl, networkAttempts: networkAttemptCount() })}`);
    }} onPress={onMapPress}>
      <Camera initialViewState={{ center: sydneyCenter, zoom: 14 }} />
      <GeoJSONSource id="route-source" data={routeFeature as never}>
        <Layer id="route-line" type="line" paint={{ "line-color": "#28d7e7", "line-width": 5 }} layout={{ "line-cap": "round", "line-join": "round" }} />
      </GeoJSONSource>
    </MapView> : <View style={styles.loading}><ActivityIndicator color="#28d7e7" /><Text style={styles.loadingText}>Opening embedded PMTiles…</Text></View>}
    <View style={styles.panel}>
      <Text style={styles.metric}>{route ? `${route.distanceM} m · ${route.pointCount} points` : "two taps start a local route"}</Text>
      <Text style={styles.detail}>network attempts this session: {networkAttemptCount()} · nearby: {nearby.length}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Publish route" disabled={!route} onPress={publish} style={[styles.action, !route && styles.disabled]}><Text style={styles.actionText}>Publish segment</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Load nearby segments" onPress={refreshNearby} style={styles.secondary}><Text style={styles.secondaryText}>Nearby</Text></Pressable>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#07131d" }, header: { paddingHorizontal: 22, paddingTop: 64, paddingBottom: 18 },
  kicker: { color: "#28d7e7", fontSize: 11, fontWeight: "800", letterSpacing: 2.4 }, title: { color: "#f1eee5", fontSize: 32, fontWeight: "700", letterSpacing: -1, marginTop: 6 },
  status: { color: "#b4c6ca", marginTop: 10, lineHeight: 20 }, map: { flex: 1, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#244451" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#0a1b27" }, loadingText: { color: "#b4c6ca" },
  panel: { padding: 18, backgroundColor: "#0b1d28" }, metric: { color: "#f1eee5", fontWeight: "700" }, detail: { color: "#8ea6ad", fontSize: 12, marginTop: 5 },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 }, action: { flex: 1, alignItems: "center", padding: 13, backgroundColor: "#28d7e7" }, disabled: { opacity: 0.35 }, actionText: { color: "#07131d", fontWeight: "800" },
  secondary: { alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderWidth: 1, borderColor: "#46717b" }, secondaryText: { color: "#d8e5e6", fontWeight: "700" }
});
