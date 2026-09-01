import { describe, expect, it, vi } from "vitest";

import { createLocalRouter, recomputeInvalidatedLegs } from "../src/lib/router";

const route = {
  geometry: [
    { lat: -33.87, lng: 151.2, elevationM: 8 },
    { lat: -33.869, lng: 151.201, elevationM: 14 }
  ],
  polyline: [],
  distanceM: 130,
  totalWeight: 7,
  elevationGainM: 6,
  elevationLossM: 0,
  source: "local_wasm" as const
};

describe("LocalRouter adapter", () => {
  it("delegates every leg to the on-device WASM engine", async () => {
    const engine = { route: vi.fn().mockReturnValue(route) };
    const router = createLocalRouter(engine);

    await expect(
      router.route({ lat: -33.87, lng: 151.2 }, { lat: -33.869, lng: 151.201 })
    ).resolves.toEqual({ geometry: route.geometry });
    expect(engine.route).toHaveBeenCalledOnce();
  });

  it("recomputes only invalidated adjacent legs", async () => {
    const first = { lat: -33.87, lng: 151.2, elevationM: 0 };
    const via = { lat: -33.8695, lng: 151.2005, elevationM: 0 };
    const last = { lat: -33.869, lng: 151.201, elevationM: 0 };
    const router = {
      route: vi.fn(async (from, to) => ({ geometry: [{ ...from, elevationM: 8 }, { ...to, elevationM: 14 }] }))
    };
    const draft = {
      controlPoints: [
        { id: "cp-0001", ...first },
        { id: "cp-0002", ...via },
        { id: "cp-0003", ...last }
      ],
      closedLoop: false,
      invalidatedLegIndexes: [1],
      legResults: [[first, via], undefined]
    };
    const setLegResult = vi.fn((current, legIndex, result) => ({
      ...current,
      invalidatedLegIndexes: current.invalidatedLegIndexes.filter((index: number) => index !== legIndex),
      lastResult: result
    }));

    const result = await recomputeInvalidatedLegs(draft, router, setLegResult);

    expect(router.route).toHaveBeenCalledWith(
      { lat: via.lat, lng: via.lng },
      { lat: last.lat, lng: last.lng }
    );
    expect(router.route).toHaveBeenCalledOnce();
    expect(result.invalidatedLegIndexes).toEqual([]);
  });

  it("has no HTTP or straight-line fallback when local routing fails", async () => {
    const router = createLocalRouter({ route: vi.fn(() => { throw new Error("no_path"); }) });

    await expect(router.route({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).rejects.toThrow("no_path");
  });
});
