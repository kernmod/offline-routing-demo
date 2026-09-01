import { recordNetworkAttempt } from "./networkMonitor";

export type PublishedPoint = { lat: number; lng: number; elevationM: number };
export type PublishPayload = { name: string; geometry: PublishedPoint[]; controlPoints: number[] };
export type PublishedSegment = { id: string; name?: string; publicationState: "published"; [key: string]: unknown };
const apiBase = process.env.EXPO_PUBLIC_SEGMENTS_API_URL?.replace(/\/$/, "") ?? "";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const networkDisabled = apiBase.length === 0;
function endpoint(path: string) { if (networkDisabled) throw new Error("networkDisabled"); return `${apiBase}${path}`; }
function isPublishedSegment(value: unknown): value is PublishedSegment {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" &&
    "publicationState" in value && value.publicationState === "published" && (!("name" in value) || typeof value.name === "string");
}
export async function publishSegment(payload: PublishPayload, idempotencyKey: string): Promise<PublishedSegment> {
  if (!UUID_V4.test(idempotencyKey)) throw new TypeError("idempotency key must be a UUIDv4");
  const url = endpoint("/v2/segments"); recordNetworkAttempt("publish", url);
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`publish_http_${response.status}`);
  const value: unknown = await response.json();
  if (!isPublishedSegment(value)) throw new Error("publish_invalid_response");
  return value;
}
export async function listSegments(bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }): Promise<PublishedSegment[]> {
  const encodedBbox = [bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng].join(",");
  const url = endpoint(`/v2/segments?bbox=${encodeURIComponent(encodedBbox)}`); recordNetworkAttempt("nearby", url);
  const response = await fetch(url); if (!response.ok) throw new Error(`nearby_http_${response.status}`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("segments" in payload) || !Array.isArray(payload.segments) || payload.segments.some((segment) => !isPublishedSegment(segment))) {
    throw new Error("nearby_invalid_response");
  }
  return payload.segments;
}
