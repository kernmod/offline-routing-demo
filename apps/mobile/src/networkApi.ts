import { recordNetworkAttempt } from "./networkMonitor";
const apiBase = process.env.EXPO_PUBLIC_SEGMENTS_API_URL?.replace(/\/$/, "") ?? "";
export const networkDisabled = apiBase.length === 0;
function endpoint(path: string) { if (networkDisabled) throw new Error("networkDisabled"); return `${apiBase}${path}`; }
export async function publishSegment(payload: { geometry: Array<{ lat: number; lng: number }> }) {
  const url = endpoint("/segments"); recordNetworkAttempt("publish", url);
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`publish_http_${response.status}`);
  return response.json() as Promise<{ id: string }>;
}
export async function listSegments(bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }) {
  const encodedBbox = [bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng].join(",");
  const url = endpoint(`/segments?bbox=${encodeURIComponent(encodedBbox)}`); recordNetworkAttempt("nearby", url);
  const response = await fetch(url); if (!response.ok) throw new Error(`nearby_http_${response.status}`);
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("segments" in payload) ||
    !Array.isArray(payload.segments) ||
    payload.segments.some((segment) => (
      typeof segment !== "object" ||
      segment === null ||
      !("id" in segment) ||
      typeof segment.id !== "string"
    ))
  ) {
    throw new Error("nearby_invalid_response");
  }
  return payload.segments as Array<{ id: string }>;
}
