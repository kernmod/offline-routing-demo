import { validatePoint } from "../shared/point.js";

function assertFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
}

function assertPack(pack) {
  if (!(pack instanceof Uint8Array) || pack.byteLength === 0) throw new TypeError("pack must be a non-empty Uint8Array");
}

export function normalizeRoutePayload(payload) {
  if (typeof payload !== "object" || payload === null) throw new TypeError("route payload must be an object");
  const geometry = payload.geometry ?? payload.polyline;
  if (!Array.isArray(geometry) || geometry.length < 2) throw new TypeError("route payload must contain a geometry with at least two points");
  const coordinates = geometry.map((point, index) => validatePoint(point, `route.geometry[${index}]`));
  const pointCount = Number(payload.pointCount ?? coordinates.length);
  const distanceM = Number(payload.distanceM);
  const totalWeight = Number(payload.totalWeight);
  if (!Number.isInteger(pointCount) || pointCount !== coordinates.length) throw new TypeError("route payload pointCount must match geometry");
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new TypeError("route payload distanceM must be a finite number >= 0");
  if (!Number.isFinite(totalWeight) || totalWeight < 0) throw new TypeError("route payload totalWeight must be a finite number >= 0");
  const polyline = geometry.map((point, index) => normalizeRoutePoint(point, `route.geometry[${index}]`));
  const elevationGainM = normalizeMetric(payload.elevationGainM, "route payload elevationGainM");
  const elevationLossM = normalizeMetric(payload.elevationLossM, "route payload elevationLossM");
  if (elevationGainM - elevationLossM !== polyline.at(-1).elevationM - polyline[0].elevationM) {
    throw new TypeError("route payload elevation invariant is invalid");
  }
  return {
    geometry: polyline,
    polyline,
    pointCount,
    distanceM: Math.round(distanceM),
    totalWeight: Math.round(totalWeight),
    elevationGainM,
    elevationLossM,
    source: "local_native"
  };
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
  assertFunction(nativeBridge.routeMany, "nativeBridge.routeMany");
  assertFunction(nativeBridge.benchmark, "nativeBridge.benchmark");
  let loaded = false;
  return {
    async loadPack(pack) { assertPack(pack); const result = await nativeBridge.loadPack(pack); loaded = true; return result; },
    async route(origin, destination) {
      if (!loaded) throw new Error("pack_not_loaded");
      return normalizeRoutePayload(await nativeBridge.route(validatePoint(origin, "origin"), validatePoint(destination, "destination")));
    },
    async routeMany(controls, options = {}) {
      if (!loaded) throw new Error("pack_not_loaded");
      if (!Array.isArray(controls) || controls.length < 2 || controls.length > 16) {
        throw new TypeError("controls must contain between 2 and 16 points");
      }
      if (typeof options !== "object" || options === null || Array.isArray(options)) {
        throw new TypeError("routeMany options must be an object");
      }
      const closedLoop = options.closedLoop ?? false;
      if (typeof closedLoop !== "boolean") {
        throw new TypeError("closedLoop must be a boolean");
      }
      const normalizedControls = controls.map((point, index) => validatePoint(point, `controls[${index}]`));
      return normalizeMultiRoutePayload(
        await nativeBridge.routeMany(normalizedControls, closedLoop),
        normalizedControls.length,
        closedLoop
      );
    },
    async benchmark(request = {}) {
      if (!loaded) throw new Error("pack_not_loaded");
      return normalizeBenchmarkPayload(await nativeBridge.benchmark(request));
    }
  };
}

function normalizeRoutePoint(point, label) {
  const coordinate = validatePoint(point, label);
  const elevationM = Number(point?.elevationM);
  if (!Number.isInteger(elevationM)) throw new TypeError(`${label}.elevationM must be an integer`);
  return { ...coordinate, elevationM };
}

function normalizeMetric(value, label) {
  const metric = Number(value ?? 0);
  if (!Number.isInteger(metric) || metric < 0) throw new TypeError(`${label} must be an integer >= 0`);
  return metric;
}

function normalizeMultiRoutePayload(payload, expectedControlCount, expectedClosedLoop) {
  if (typeof payload !== "object" || payload === null) throw new TypeError("routeMany payload must be an object");
  const route = normalizeRoutePayload(payload);
  const controlCount = Number(payload.controlCount);
  if (!Number.isInteger(controlCount) || controlCount < 2 || controlCount > 16) {
    throw new TypeError("routeMany payload controlCount must be an integer between 2 and 16");
  }
  if (typeof payload.closedLoop !== "boolean") {
    throw new TypeError("routeMany payload closedLoop must be a boolean");
  }
  if (!Array.isArray(payload.legs)) {
    throw new TypeError("routeMany payload legs must be an array");
  }
  if (controlCount !== expectedControlCount || payload.closedLoop !== expectedClosedLoop) {
    throw new TypeError("routeMany payload does not match the request");
  }
  const expectedLegCount = controlCount - 1 + Number(payload.closedLoop);
  if (payload.legs.length !== expectedLegCount) {
    throw new TypeError("routeMany payload legs do not match adjacent controls");
  }
  const legs = payload.legs.map((leg) =>
    normalizeRoutePayload({
      ...leg,
      pointCount: leg.pointCount ?? leg.geometry?.length ?? leg.polyline?.length
    })
  );
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1].geometry.at(-1);
    const current = legs[index].geometry[0];
    if (previous.lat !== current.lat || previous.lng !== current.lng || previous.elevationM !== current.elevationM) {
      throw new TypeError("routeMany payload legs are not adjacent");
    }
  }
  const composed = legs.flatMap((leg, index) => index === 0 ? leg.geometry : leg.geometry.slice(1));
  if (composed.length !== route.geometry.length || composed.some((point, index) => {
    const expected = route.geometry[index];
    return point.lat !== expected.lat || point.lng !== expected.lng || point.elevationM !== expected.elevationM;
  })) {
    throw new TypeError("routeMany payload geometry does not match legs");
  }
  for (const metric of ["distanceM", "totalWeight", "elevationGainM", "elevationLossM"]) {
    if (legs.reduce((sum, leg) => sum + leg[metric], 0) !== route[metric]) {
      throw new TypeError(`routeMany payload ${metric} does not match legs`);
    }
  }
  return {
    ...route,
    controlCount,
    closedLoop: payload.closedLoop,
    legs
  };
}
