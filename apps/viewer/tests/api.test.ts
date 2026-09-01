import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BBOX,
  fetchSegments,
  fetchSegmentsV2,
  makeSegmentsUrl,
  makeSegmentsV2Url,
  publishSegmentV2
} from "../src/lib/api";

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

  it("reads named, published v2 records without weakening the v1 reader", async () => {
    const row = {
      id: "77aeafc2-d8dc-40a7-bfd9-d231cf5e04e0",
      name: "Harbour rise",
      publicationState: "published",
      encodedGeometry: "vxdr_Awgal_Hfw@gw@",
      pointCount: 2,
      distanceM: 130,
      isSeed: false,
      elevationsM: [8, 14],
      controlPoints: [0, 1],
      elevationGainM: 6,
      elevationLossM: 0,
      metricsVersion: 2,
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: null
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ segments: [row] }), { status: 200 })
    );

    expect(makeSegmentsV2Url("https://api.example", DEFAULT_BBOX)).toContain("/v2/segments?bbox=");
    await expect(fetchSegmentsV2("https://api.example", DEFAULT_BBOX, fetcher)).resolves.toEqual([row]);
  });

  it("publishes the exact v2 body with a UUIDv4 idempotency header", async () => {
    const payload = {
      name: "Harbour rise",
      geometry: [
        { lat: -33.87, lng: 151.2, elevationM: 8 },
        { lat: -33.869, lng: 151.201, elevationM: 14 }
      ],
      controlPoints: [0, 1]
    };
    const record = {
      id: "77aeafc2-d8dc-40a7-bfd9-d231cf5e04e0",
      name: payload.name,
      encodedGeometry: "vxdr_Awgal_Hfw@gw@",
      pointCount: 2,
      distanceM: 130,
      isSeed: false,
      publicationState: "published",
      elevationsM: [8, 14],
      controlPoints: [0, 1],
      elevationGainM: 6,
      elevationLossM: 0,
      metricsVersion: 2
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(record), { status: 201 }));
    const idempotencyKey = "779a8cf1-e8e5-4590-8aa8-f46d30c3194d";

    await expect(
      publishSegmentV2("https://api.example", payload, idempotencyKey, fetcher)
    ).resolves.toMatchObject({ id: record.id, publicationState: "published" });
    expect(fetcher).toHaveBeenCalledWith("https://api.example/v2/segments", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(payload)
    });
  });

  it("rejects a successful publication response that omits the full v2 record", async () => {
    const payload = {
      name: "Harbour rise",
      geometry: [
        { lat: -33.87, lng: 151.2, elevationM: 8 },
        { lat: -33.869, lng: 151.201, elevationM: 14 }
      ],
      controlPoints: [0, 1]
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "77aeafc2-d8dc-40a7-bfd9-d231cf5e04e0",
          publicationState: "published"
        }),
        { status: 201 }
      )
    );

    await expect(
      publishSegmentV2(
        "https://api.example",
        payload,
        "779a8cf1-e8e5-4590-8aa8-f46d30c3194d",
        fetcher
      )
    ).rejects.toMatchObject({
      code: "invalid_payload",
      message: "The publication response could not be read."
    });
  });

  it("rejects invalid idempotency keys before making a request", async () => {
    const fetcher = vi.fn();
    await expect(
      publishSegmentV2(
        "https://api.example",
        {
          name: "Harbour rise",
          geometry: [
            { lat: -33.87, lng: 151.2, elevationM: 8 },
            { lat: -33.869, lng: 151.201, elevationM: 14 }
          ],
          controlPoints: [0, 1]
        },
        "not-a-uuid",
        fetcher
      )
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
