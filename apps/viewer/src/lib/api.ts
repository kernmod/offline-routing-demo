export type Bbox = Readonly<{ minLat: number; minLng: number; maxLat: number; maxLng: number }>;

export type ApiSegment = Readonly<{
  id: string;
  encodedGeometry: string;
  pointCount: number;
  distanceM: number;
  isSeed: boolean;
  createdAt?: string;
  expiresAt?: string | null;
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
