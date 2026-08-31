import type { FeatureCollection, LineString } from "geojson";

import type { ApiSegment } from "./api";

export type RenderableSegment = ApiSegment & Readonly<{
  kind: "seed" | "fresh";
  coordinates: [number, number][];
}>;

export type RenderableSegments = RenderableSegment[] & {
  invalid: ReadonlyArray<{ id: string; reason: string }>;
};

function decodeValue(encoded: string, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = start;
  while (true) {
    if (cursor >= encoded.length) throw new TypeError("encoded polyline is truncated");
    const byte = encoded.charCodeAt(cursor) - 63;
    if (byte < 0 || byte > 63) throw new TypeError("encoded polyline has an invalid byte");
    cursor += 1;
    value |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) break;
    if (shift > 30) throw new TypeError("encoded polyline is too large");
  }
  return { value: value & 1 ? ~(value >> 1) : value >> 1, next: cursor };
}

export function decodePolyline6(encoded: string): [number, number][] {
  if (!encoded) throw new TypeError("encoded polyline is empty");
  const coordinates: [number, number][] = [];
  let lat = 0;
  let lng = 0;
  let cursor = 0;
  while (cursor < encoded.length) {
    const latitude = decodeValue(encoded, cursor);
    const longitude = decodeValue(encoded, latitude.next);
    lat += latitude.value;
    lng += longitude.value;
    cursor = longitude.next;
    const point: [number, number] = [lng / 1e6, lat / 1e6];
    if (point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) {
      throw new TypeError("decoded coordinate is out of range");
    }
    coordinates.push(point);
  }
  if (coordinates.length < 2) throw new TypeError("segment needs at least two coordinates");
  return coordinates;
}

export function decodeRenderableSegments(segments: ApiSegment[]): RenderableSegments {
  const result = [] as unknown as RenderableSegments;
  const invalid: { id: string; reason: string }[] = [];
  for (const segment of segments) {
    try {
      result.push({
        ...segment,
        kind: segment.isSeed ? "seed" : "fresh",
        coordinates: decodePolyline6(segment.encodedGeometry)
      });
    } catch {
      invalid.push({ id: segment.id, reason: "invalid polyline6 geometry" });
    }
  }
  Object.defineProperty(result, "invalid", { value: invalid, enumerable: false });
  return result;
}

export function segmentFeatureCollection(segments: RenderableSegment[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: segments.map((segment) => ({
      type: "Feature" as const,
      properties: {
        id: segment.id,
        kind: segment.kind,
        distanceM: segment.distanceM,
        pointCount: segment.pointCount
      },
      geometry: { type: "LineString" as const, coordinates: segment.coordinates }
    }))
  };
}
