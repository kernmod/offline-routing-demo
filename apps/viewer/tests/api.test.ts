import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BBOX, fetchSegments, makeSegmentsUrl } from "../src/lib/api";

describe("live segments API client", () => {
  it("encodes the bounded Sydney bbox in the GET request", async () => {
    const url = makeSegmentsUrl("https://api.example/", DEFAULT_BBOX);

    expect(url).toBe(
      "https://api.example/segments?bbox=-33.871%2C151.208%2C-33.868%2C151.212"
    );
  });

  it("returns public segment rows from the API contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          segments: [
            {
              id: "seed-sydney-cbd-001",
              encodedGeometry: "vxdr_Awgal_Hfw@gw@",
              pointCount: 2,
              distanceM: 130,
              isSeed: true
            }
          ]
        }),
        { status: 200 }
      )
    );

    await expect(fetchSegments("https://api.example", DEFAULT_BBOX, fetcher)).resolves.toEqual([
      expect.objectContaining({ id: "seed-sydney-cbd-001", isSeed: true })
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/segments?bbox="),
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  it("exposes a safe API error for an unavailable endpoint", async () => {
    await expect(
      fetchSegments("https://api.example", DEFAULT_BBOX, vi.fn().mockRejectedValue(new TypeError("network")))
    ).rejects.toMatchObject({ code: "network_error", message: "Live data is unavailable." });
  });

  it("rejects malformed successful payloads", async () => {
    await expect(
      fetchSegments(
        "https://api.example",
        DEFAULT_BBOX,
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: [] }), { status: 200 }))
      )
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});
