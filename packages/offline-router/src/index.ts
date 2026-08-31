import { NitroModules } from "react-native-nitro-modules";
import type { Coordinate, OfflineRouterNative } from "./specs/offline-router.nitro";

export type NativeRoute = {
  polyline: Coordinate[];
  pointCount: number;
  distanceM: number;
  totalWeight: number;
};

export type NativeBenchmark = {
  device: string;
  corpusSize: number;
  successes: number;
  failures: number;
  minMicros: number;
  p50Micros: number;
  p95Micros: number;
  p99Micros: number;
  maxMicros: number;
  packLoadMicros: number;
};

const earthRadiusM = 6_378_137;

function distanceMeters(points: Coordinate[]): number {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const lat1 = (previous.lat * Math.PI) / 180;
    const lat2 = (current.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLng = ((current.lng - previous.lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    result += 2 * earthRadiusM * Math.asin(Math.sqrt(a));
  }
  return Math.round(result);
}

function parseRoute(raw: string): NativeRoute {
  const decoded = JSON.parse(raw) as { polyline: Coordinate[]; total_weight: number };
  if (!Array.isArray(decoded.polyline) || decoded.polyline.length < 2 || !Number.isFinite(decoded.total_weight)) {
    throw new Error("native_router_bad_payload");
  }
  return {
    polyline: decoded.polyline,
    pointCount: decoded.polyline.length,
    distanceM: distanceMeters(decoded.polyline),
    totalWeight: decoded.total_weight
  };
}

function nativeOrThrow() {
  return NitroModules.createHybridObject<OfflineRouterNative>("OfflineRouterNative");
}

export function createNativeOfflineRouter() {
  const native = nativeOrThrow();
  return {
    loadPack(pack: ArrayBuffer) { return JSON.parse(native.loadPack(pack)) as { bytes: number }; },
    route(origin: Coordinate, destination: Coordinate) { return parseRoute(native.route(origin, destination)); },
    benchmark(device: string) {
      if (!/^[a-zA-Z0-9._() -]{1,80}$/.test(device)) throw new Error("invalid_benchmark_device");
      const result = JSON.parse(native.benchmark(device)) as NativeBenchmark;
      if (result.device !== device || result.corpusSize !== 1024 || result.successes + result.failures !== 1024 || result.p50Micros > result.p95Micros || result.p95Micros > result.p99Micros) throw new Error("native_benchmark_bad_payload");
      return result;
    },
    startTileServer(assetDirectory: string) { return native.startTileServer(assetDirectory, 0); },
    stopTileServer() { native.stopTileServer(); }
  };
}
