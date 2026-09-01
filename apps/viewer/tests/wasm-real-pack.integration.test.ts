import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createWasmRouteEngine } from "../src/lib/wasm-router";
import { initSync, WasmRouter } from "../src/wasm/pkg/cch_routing_lite_wasm";

const pack = readFileSync(resolve(process.cwd(), "../../fixtures/sydney/routing.pack"));
const wasmBinary = readFileSync(resolve(process.cwd(), "src/wasm/pkg/cch_routing_lite_wasm_bg.wasm"));
const controls = [
  { lat: -33.8701, lng: 151.2088 },
  { lat: -33.8695, lng: 151.2101 },
  { lat: -33.8689, lng: 151.2113 }
];

const nativeGolden = {
  controlCount: 3,
  distanceM: 422,
  elevationGainM: 21,
  elevationLossM: 30,
  geometryCount: 28,
  first: { lat: -33.8699953, lng: 151.2089163, elevationM: 76 },
  last: { lat: -33.8690482, lng: 151.211077, elevationM: 67 }
};

describe("real CCHP2 browser boundary", () => {
  it("loads the byte-identical public pack into the generated WASM and matches the native golden", async () => {
    expect(createHash("sha256").update(pack).digest("hex")).toBe(
      "18cf63b62f29db48a760c4fb85b38a00d146f2441c2213868647a9c673bfbc95"
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/routing.pack");
      return new Response(pack, { status: 200 });
    });
    const engine = await createWasmRouteEngine({
      fetcher,
      packUrl: "/routing.pack",
      wasm: {
        init: async () => initSync({ module: wasmBinary }),
        Router: WasmRouter
      }
    });

    const route = engine.routeMany(controls);

    expect(route).toMatchObject({
      controlCount: nativeGolden.controlCount,
      distanceM: nativeGolden.distanceM,
      elevationGainM: nativeGolden.elevationGainM,
      elevationLossM: nativeGolden.elevationLossM
    });
    expect(route.geometry).toHaveLength(nativeGolden.geometryCount);
    expect(route.geometry[0]).toEqual(nativeGolden.first);
    expect(route.geometry.at(-1)).toEqual(nativeGolden.last);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.some(([url]) => /\/route(?:\?|$)/.test(String(url)))).toBe(false);
  });
});
