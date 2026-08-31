import { describe, expect, it } from "vitest";

import { decodeRenderableSegments, segmentFeatureCollection } from "../src/lib/segments";

describe("public segment geometry", () => {
  it("decodes valid polyline6 rows into selectable GeoJSON features", () => {
    const segments = decodeRenderableSegments([
      {
        id: "seed-sydney-cbd-001",
        encodedGeometry: "vxdr_Awgal_Hfw@gw@",
        pointCount: 2,
        distanceM: 130,
        isSeed: true
      }
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ id: "seed-sydney-cbd-001", kind: "seed" });
    expect(segmentFeatureCollection(segments).features[0]).toMatchObject({
      geometry: { type: "LineString" },
      properties: { id: "seed-sydney-cbd-001", kind: "seed" }
    });
  });

  it("keeps malformed rows out of the map and makes the failure inspectable", () => {
    const result = decodeRenderableSegments([
      {
        id: "broken-row",
        encodedGeometry: "~",
        pointCount: 2,
        distanceM: 9,
        isSeed: false
      }
    ]);

    expect(result).toEqual([]);
    expect(result.invalid).toEqual([{ id: "broken-row", reason: "invalid polyline6 geometry" }]);
  });

  it("rejects empty, out-of-range and invalid-byte geometry", () => {
    expect(() => decodeRenderableSegments([{ id: "empty", encodedGeometry: "", pointCount: 2, distanceM: 1, isSeed: false }])).not.toThrow();
    expect(decodeRenderableSegments([{ id: "bad-byte", encodedGeometry: " ", pointCount: 2, distanceM: 1, isSeed: false }]).invalid).toHaveLength(1);
  });
});
