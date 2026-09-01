import initWasm, { WasmRouter } from "../wasm/pkg/cch_routing_lite_wasm";

export type RoutePoint = { lat: number; lng: number; elevationM: number };
export type WasmRoute = {
  geometry: RoutePoint[];
  polyline: RoutePoint[];
  legs?: WasmRoute[];
  controlCount?: number;
  closedLoop?: boolean;
  distanceM: number;
  totalWeight: number;
  elevationGainM: number;
  elevationLossM: number;
  source: "local_wasm";
};

type RouterInstance = {
  route(originLat: number, originLng: number, destinationLat: number, destinationLng: number): string;
  routeManyJson(controlsJson: string, closedLoop: boolean): string;
  statsJson(): string;
};

type WasmModule = {
  init: () => Promise<unknown>;
  Router: new (pack: Uint8Array) => RouterInstance;
};

export type WasmRouteEngine = {
  stats: Record<string, unknown>;
  route: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) => WasmRoute;
  routeMany: (controls: Array<{ lat: number; lng: number }>, options?: { closedLoop?: boolean }) => WasmRoute;
};

function defaultModule(): WasmModule {
  return {
    init: () => initWasm(),
    Router: WasmRouter
  };
}

export async function createWasmRouteEngine({
  fetcher = fetch,
  packUrl = `${import.meta.env.BASE_URL}routing.pack`,
  wasm = defaultModule()
}: {
  fetcher?: typeof fetch;
  packUrl?: string;
  wasm?: WasmModule;
} = {}): Promise<WasmRouteEngine> {
  await wasm.init();
  const response = await fetcher(packUrl, { headers: { accept: "application/octet-stream" } });
  if (!response.ok) throw new Error("routing_pack_unavailable");
  const pack = new Uint8Array(await response.arrayBuffer());
  if (pack.byteLength === 0) throw new Error("routing_pack_empty");
  const router = new wasm.Router(pack);
  return {
    stats: JSON.parse(router.statsJson()) as Record<string, unknown>,
    route(origin, destination) {
      return normalizeRoute(
        router.route(origin.lat, origin.lng, destination.lat, destination.lng),
        "route"
      );
    },
    routeMany(controls, options = {}) {
      if (controls.length < 2 || controls.length > 16) {
        throw new Error("route_many_control_count");
      }
      const closedLoop = options.closedLoop ?? false;
      if (typeof closedLoop !== "boolean") throw new Error("route_many_closed_loop");
      return normalizeRoute(router.routeManyJson(JSON.stringify(controls), closedLoop), "routeMany");
    }
  };
}

function normalizeRoute(json: string, label: string): WasmRoute {
  const parsed = JSON.parse(json) as Partial<WasmRoute>;
  if (!Array.isArray(parsed.geometry) || parsed.geometry.length < 2) {
    throw new Error(`${label}_bad_geometry`);
  }
  const distanceM = parsed.distanceM;
  const totalWeight = parsed.totalWeight;
  if (typeof distanceM !== "number" || !Number.isFinite(distanceM) || typeof totalWeight !== "number" || !Number.isFinite(totalWeight)) {
    throw new Error(`${label}_bad_metrics`);
  }
  return {
    ...parsed,
    geometry: parsed.geometry,
    polyline: Array.isArray(parsed.polyline) ? parsed.polyline : parsed.geometry,
    distanceM,
    totalWeight,
    elevationGainM: Number(parsed.elevationGainM ?? 0),
    elevationLossM: Number(parsed.elevationLossM ?? 0),
    source: "local_wasm"
  };
}
