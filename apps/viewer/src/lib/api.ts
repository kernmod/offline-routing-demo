export type Bbox = Readonly<{ minLat: number; minLng: number; maxLat: number; maxLng: number }>;

export type ApiSegment = Readonly<{
  id: string;
  name?: string;
  encodedGeometry: string;
  pointCount: number;
  distanceM: number;
  isSeed: boolean;
  publicationState?: "published";
  controlPoints?: number[];
  elevationsM?: number[] | null;
  elevationGainM?: number | null;
  elevationLossM?: number | null;
  createdAt?: string;
  expiresAt?: string | null;
}>;

export type ApiSegmentV2 = ApiSegment & Readonly<{
  name: string;
  publicationState: "published";
  controlPoints: number[];
  elevationsM: number[] | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  metricsVersion: 1 | 2;
}>;

export const DEFAULT_BBOX: Bbox = {
  minLat: -33.871,
  minLng: 151.208,
  maxLat: -33.868,
  maxLng: 151.212
};

export class SegmentsApiError extends Error {
  readonly code: "http_error" | "network_error" | "invalid_payload";

  constructor(code: SegmentsApiError["code"], message: string) {
    super(message);
    this.name = "SegmentsApiError";
    this.code = code;
  }
}

export function makeSegmentsUrl(baseUrl: string, bbox: Bbox = DEFAULT_BBOX): string {
  const url = new URL("segments", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("bbox", [bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng].join(","));
  return url.toString();
}

export function makeSegmentsV2Url(baseUrl: string, bbox: Bbox = DEFAULT_BBOX): string {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return makeSegmentsUrl(new URL("v2/", root).toString(), bbox);
}

function isSegment(value: unknown): value is ApiSegment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.encodedGeometry === "string" &&
    typeof candidate.pointCount === "number" &&
    typeof candidate.distanceM === "number" &&
    typeof candidate.isSeed === "boolean"
  );
}

function isSegmentV2(value: unknown): value is ApiSegmentV2 {
  if (!isSegment(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.publicationState === "published" &&
    Array.isArray(candidate.controlPoints) &&
    (candidate.elevationsM === null || Array.isArray(candidate.elevationsM)) &&
    (candidate.elevationGainM === null || typeof candidate.elevationGainM === "number") &&
    (candidate.elevationLossM === null || typeof candidate.elevationLossM === "number") &&
    (candidate.metricsVersion === 1 || candidate.metricsVersion === 2)
  );
}

function isPublishedRecord(value: unknown): value is Pick<ApiSegmentV2, "id" | "publicationState"> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && candidate.publicationState === "published";
}

export type PublishSegmentInput = Readonly<{
  name: string;
  geometry: Array<{ lat: number; lng: number; elevationM: number }>;
  controlPoints: number[];
}>;

export async function fetchSegments(
  apiBase: string,
  bbox: Bbox = DEFAULT_BBOX,
  fetcher: typeof fetch = window.fetch.bind(window)
): Promise<ApiSegment[]> {
  try {
    const response = await fetcher(makeSegmentsUrl(apiBase, bbox), {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new SegmentsApiError("http_error", "Live data is unavailable.");
    }
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray((payload as { segments?: unknown }).segments) ||
      !(payload as { segments: unknown[] }).segments.every(isSegment)
    ) {
      throw new SegmentsApiError("invalid_payload", "The live response could not be read.");
    }
    return (payload as { segments: ApiSegment[] }).segments;
  } catch (error) {
    if (error instanceof SegmentsApiError) throw error;
    throw new SegmentsApiError("network_error", "Live data is unavailable.");
  }
}

export async function fetchSegmentsV2(
  apiBase: string,
  bbox: Bbox = DEFAULT_BBOX,
  fetcher: typeof fetch = window.fetch.bind(window)
): Promise<ApiSegmentV2[]> {
  try {
    const response = await fetcher(makeSegmentsV2Url(apiBase, bbox), {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new SegmentsApiError("http_error", "Live data is unavailable.");
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray((payload as { segments?: unknown }).segments) ||
      !(payload as { segments: unknown[] }).segments.every(isSegmentV2)
    ) {
      throw new SegmentsApiError("invalid_payload", "The live response could not be read.");
    }
    return (payload as { segments: ApiSegmentV2[] }).segments;
  } catch (error) {
    if (error instanceof SegmentsApiError) throw error;
    throw new SegmentsApiError("network_error", "Live data is unavailable.");
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function publishSegmentV2(
  apiBase: string,
  segment: PublishSegmentInput,
  idempotencyKey: string,
  fetcher: typeof fetch = window.fetch.bind(window)
): Promise<ApiSegmentV2> {
  if (!UUID_V4.test(idempotencyKey)) {
    throw new SegmentsApiError("invalid_payload", "The publication request could not be prepared.");
  }
  const url = new URL("v2/segments", apiBase.endsWith("/") ? apiBase : `${apiBase}/`).toString();
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(segment)
    });
    if (!response.ok) throw new SegmentsApiError("http_error", "Publication failed.");
    const payload: unknown = await response.json();
    if (!isSegmentV2(payload) && !isPublishedRecord(payload)) {
      throw new SegmentsApiError("invalid_payload", "The publication response could not be read.");
    }
    return payload as ApiSegmentV2;
  } catch (error) {
    if (error instanceof SegmentsApiError) throw error;
    throw new SegmentsApiError("network_error", "Publication failed.");
  }
}
