import { NitroModules } from "react-native-nitro-modules";
import type { Coordinate, OfflineRouterNative } from "./specs/offline-router.nitro";

export type NativeRoute = {
  geometry: RoutePoint[];
  /** Backward-compatible alias consumed by the original two-tap mobile demo. */
  polyline: RoutePoint[];
  pointCount: number;
  distanceM: number;
  totalWeight: number;
  elevationGainM: number;
  elevationLossM: number;
};

export type RoutePoint = Coordinate & { elevationM: number };

export type NativeMultiRoute = NativeRoute & {
  controlCount: number;
  closedLoop: boolean;
  legs: NativeRoute[];
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

function parseRoute(raw: string): NativeRoute {
  const decoded = JSON.parse(raw) as Record<string, unknown>;
  const rawGeometry = decoded.geometry ?? decoded.polyline;
  if (!Array.isArray(rawGeometry) || rawGeometry.length < 2) {
    throw new Error("native_router_bad_payload");
  }
  const geometry = rawGeometry.map((value) => {
    const point = value as Partial<RoutePoint>;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isInteger(point.elevationM)) {
      throw new Error("native_router_bad_payload");
    }
    return { lat: point.lat as number, lng: point.lng as number, elevationM: point.elevationM as number };
  });
  const totalWeight = decoded.totalWeight ?? decoded.total_weight;
  const metrics = [decoded.distanceM, totalWeight, decoded.elevationGainM, decoded.elevationLossM];
  if (!metrics.every((value) => Number.isInteger(value) && (value as number) >= 0)) {
    throw new Error("native_router_bad_payload");
  }
  if ((decoded.elevationGainM as number) - (decoded.elevationLossM as number) !== geometry.at(-1)!.elevationM - geometry[0].elevationM) {
    throw new Error("native_router_bad_payload");
  }
  return {
    geometry,
    polyline: geometry,
    pointCount: geometry.length,
    distanceM: decoded.distanceM as number,
    totalWeight: totalWeight as number,
    elevationGainM: decoded.elevationGainM as number,
    elevationLossM: decoded.elevationLossM as number
  };
}

function parseMultiRoute(raw: string, controlCount: number, closedLoop: boolean): NativeMultiRoute {
  const decoded = JSON.parse(raw) as Record<string, unknown>;
  const route = parseRoute(raw);
  if (decoded.controlCount !== controlCount || decoded.closedLoop !== closedLoop || !Array.isArray(decoded.legs)) {
    throw new Error("native_router_bad_payload");
  }
  const legs = decoded.legs.map((leg) => parseRoute(JSON.stringify(leg)));
  if (legs.length !== controlCount - 1 + Number(closedLoop)) throw new Error("native_router_bad_payload");
  const composed = legs.flatMap((leg, index) => index === 0 ? leg.geometry : leg.geometry.slice(1));
  if (composed.length !== route.geometry.length || composed.some((point, index) => {
    const expected = route.geometry[index];
    return point.lat !== expected.lat || point.lng !== expected.lng || point.elevationM !== expected.elevationM;
  })) {
    throw new Error("native_router_bad_payload");
  }
  for (const metric of ["distanceM", "totalWeight", "elevationGainM", "elevationLossM"] as const) {
    if (legs.reduce((sum, leg) => sum + leg[metric], 0) !== route[metric]) {
      throw new Error("native_router_bad_payload");
    }
  }
  return { ...route, controlCount, closedLoop, legs };
}

function validateControls(controls: Coordinate[]): void {
  if (controls.length < 2 || controls.length > 16) throw new Error("invalid_control_count");
  for (const point of controls) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) {
      throw new Error("invalid_control_coordinate");
    }
  }
}

function nativeOrThrow() {
  return NitroModules.createHybridObject<OfflineRouterNative>("OfflineRouterNative");
}

export function createNativeOfflineRouter() {
  const native = nativeOrThrow();
  return {
    loadPack(pack: ArrayBuffer) { return JSON.parse(native.loadPack(pack)) as { bytes: number }; },
    route(origin: Coordinate, destination: Coordinate) { return parseRoute(native.route(origin, destination)); },
    routeMany(controls: Coordinate[], options: { closedLoop?: boolean } = {}) {
      validateControls(controls);
      const closedLoop = options.closedLoop ?? false;
      if (typeof closedLoop !== "boolean") throw new Error("invalid_closed_loop");
      return parseMultiRoute(native.routeMany(controls, closedLoop), controls.length, closedLoop);
    },
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
