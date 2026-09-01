import { describe, expect, it, vi } from "vitest";

import { createWasmRouteEngine } from "../src/lib/wasm-router";

function wasmDouble() {
  class Router {
    constructor(readonly pack: Uint8Array) {}
    statsJson() {
      return JSON.stringify({ nodeCount: this.pack.byteLength, originalArcCount: 2 });
    }
    route() {
      return JSON.stringify({
        geometry: [
          { lat: -33.87, lng: 151.2, elevationM: 10 },
          { lat: -33.87, lng: 151.201, elevationM: 14 }
        ],
        polyline: [
          { lat: -33.87, lng: 151.2, elevationM: 10 },
          { lat: -33.87, lng: 151.201, elevationM: 14 }
        ],
        distanceM: 92,
        totalWeight: 7,
        elevationGainM: 4,
        elevationLossM: 0
      });
    }
    routeManyJson(controlsJson: string, closedLoop: boolean) {
      const controls = JSON.parse(controlsJson);
      return JSON.stringify({
        geometry: controls.map((point: { lat: number; lng: number }, index: number) => ({
          ...point,
          elevationM: 10 + index
        })),
        legs: [],
        controlCount: controls.length,
        closedLoop,
        distanceM: 184,
        totalWeight: 14,
        elevationGainM: 2,
        elevationLossM: 0
      });
    }
  }
  return { init: vi.fn().mockResolvedValue(undefined), Router };
}

describe("WASM route engine", () => {
  it("loads the static routing pack and never calls a route endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([67, 67, 72, 80, 50])));
    const engine = await createWasmRouteEngine({
      fetcher,
      packUrl: "/offline-routing-demo/routing.pack",
      wasm: wasmDouble()
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/offline-routing-demo/routing.pack",
      expect.objectContaining({ headers: { accept: "application/octet-stream" } })
    );
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/route"))).toBe(false);
    expect(engine.stats.nodeCount).toBe(5);
  });

  it("routes single and multipoint requests locally through the wasm module", async () => {
    const engine = await createWasmRouteEngine({
      fetcher: vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))),
      wasm: wasmDouble()
    });

    expect(engine.route({ lat: -33.87, lng: 151.2 }, { lat: -33.87, lng: 151.201 })).toMatchObject({
      source: "local_wasm",
      distanceM: 92,
      elevationGainM: 4
    });
    expect(
      engine.routeMany([
        { lat: -33.87, lng: 151.2 },
        { lat: -33.87, lng: 151.201 },
        { lat: -33.87, lng: 151.202 }
      ])
    ).toMatchObject({ source: "local_wasm", controlCount: 3, distanceM: 184 });
  });

  it("surfaces bounded load and route validation errors", async () => {
    await expect(
      createWasmRouteEngine({
        fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
        wasm: wasmDouble()
      })
    ).rejects.toThrow(/routing_pack_unavailable/);

    const engine = await createWasmRouteEngine({
      fetcher: vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))),
      wasm: wasmDouble()
    });
    expect(() => engine.routeMany([{ lat: 0, lng: 0 }])).toThrow(/route_many_control_count/);
    expect(() => engine.routeMany([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], { closedLoop: "yes" as never })).toThrow(
      /route_many_closed_loop/
    );
  });
});
