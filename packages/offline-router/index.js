import { validatePoint } from "../shared/point.js";

function assertFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
}

function assertPack(pack) {
  if (!(pack instanceof Uint8Array) || pack.byteLength === 0) throw new TypeError("pack must be a non-empty Uint8Array");
}

export function normalizeRoutePayload(payload) {
  if (typeof payload !== "object" || payload === null) throw new TypeError("route payload must be an object");
  if (!Array.isArray(payload.polyline) || payload.polyline.length < 2) throw new TypeError("route payload must contain a polyline with at least two points");
  const polyline = payload.polyline.map((point, index) => validatePoint(point, `route.polyline[${index}]`));
  const pointCount = Number(payload.pointCount ?? polyline.length);
  const distanceM = Number(payload.distanceM);
  const totalWeight = Number(payload.totalWeight);
  if (!Number.isInteger(pointCount) || pointCount !== polyline.length) throw new TypeError("route payload pointCount must match geometry");
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new TypeError("route payload distanceM must be a finite number >= 0");
  if (!Number.isFinite(totalWeight) || totalWeight < 0) throw new TypeError("route payload totalWeight must be a finite number >= 0");
  return { polyline, pointCount, distanceM: Math.round(distanceM), totalWeight: Math.round(totalWeight), source: "local_native" };
}

function normalizeBenchmarkPayload(payload) {
  if (typeof payload !== "object" || payload === null) throw new TypeError("benchmark payload must be an object");
  const device = payload.device;
  const corpusSize = Number(payload.corpusSize);
  const p50Micros = Number(payload.p50Micros);
  const p95Micros = Number(payload.p95Micros);
  if (typeof device !== "string" || device.trim().length === 0) throw new TypeError("benchmark payload device must be a non-empty string");
  if (corpusSize !== 1024) throw new TypeError("benchmark payload corpusSize must be 1024");
  if (![p50Micros, p95Micros].every((value) => Number.isFinite(value) && value >= 0) || p50Micros > p95Micros) throw new TypeError("benchmark payload percentiles must be ordered finite microseconds");
  return { device, corpusSize, p50Micros, p95Micros };
}

/** A narrow JS facade over the routing-only Nitro HybridObject. */
export function createOfflineRouter(nativeBridge) {
  if (typeof nativeBridge !== "object" || nativeBridge === null) throw new TypeError("native bridge must be an object");
  assertFunction(nativeBridge.loadPack, "nativeBridge.loadPack");
  assertFunction(nativeBridge.route, "nativeBridge.route");
  assertFunction(nativeBridge.benchmark, "nativeBridge.benchmark");
  let loaded = false;
  return {
    async loadPack(pack) { assertPack(pack); const result = await nativeBridge.loadPack(pack); loaded = true; return result; },
    async route(origin, destination) {
      if (!loaded) throw new Error("pack_not_loaded");
      return normalizeRoutePayload(await nativeBridge.route(validatePoint(origin, "origin"), validatePoint(destination, "destination")));
    },
    async benchmark(request = {}) {
      if (!loaded) throw new Error("pack_not_loaded");
      return normalizeBenchmarkPayload(await nativeBridge.benchmark(request));
    }
  };
}
