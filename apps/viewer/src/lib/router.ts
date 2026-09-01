import { setLegResult, type GeometryPoint } from "@offline-routing/route-studio";

import { createWasmRouteEngine, type WasmRouteEngine } from "./wasm-router";

export type LocalRouteResult = Readonly<{ geometry: GeometryPoint[] }>;
export type LocalRouter = Readonly<{
  route(from: Pick<GeometryPoint, "lat" | "lng">, to: Pick<GeometryPoint, "lat" | "lng">): Promise<LocalRouteResult>;
}>;

type LocalEngine = Pick<WasmRouteEngine, "route">;

export function createLocalRouter(engine: LocalEngine): LocalRouter {
  return {
    async route(from, to) {
      const result = engine.route(from as { lat: number; lng: number }, to as { lat: number; lng: number });
      return { geometry: result.geometry };
    }
  };
}

export async function loadLocalRouter(fetcher: typeof fetch = fetch): Promise<LocalRouter> {
  return createLocalRouter(await createWasmRouteEngine({ fetcher }));
}

type DraftLike = Readonly<{
  controlPoints: Array<{ lat: number; lng: number }>;
  closedLoop: boolean;
  invalidatedLegIndexes: number[];
  legResults: Array<GeometryPoint[] | undefined>;
}>;
type SetLegResult<T extends DraftLike> = (draft: T, legIndex: number, result: LocalRouteResult) => T;

export async function recomputeInvalidatedLegs<T extends DraftLike>(
  draft: T,
  router: LocalRouter,
  applyLegResult: SetLegResult<T> = setLegResult as unknown as SetLegResult<T>
): Promise<T> {
  let routed = draft;
  const requiredLegCount = Math.max(0, draft.controlPoints.length - 1) +
    (draft.closedLoop && draft.controlPoints.length > 1 ? 1 : 0);
  const missing = Array.from({ length: requiredLegCount }, (_, index) => index)
    .filter((index) => !draft.legResults[index]);
  const invalidated = [...new Set([...draft.invalidatedLegIndexes, ...missing])]
    .sort((left, right) => left - right);
  for (const legIndex of invalidated) {
    const from = draft.controlPoints[legIndex];
    const to = draft.controlPoints[(legIndex + 1) % draft.controlPoints.length];
    if (!from || !to || (!draft.closedLoop && legIndex >= draft.controlPoints.length - 1)) continue;
    const result = await router.route({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
    routed = applyLegResult(routed, legIndex, result);
  }
  return routed;
}
