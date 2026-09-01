import {
  bboxCells,
  encodePolyline6,
  routeElevationMetrics,
  routeMetrics,
  segmentCells,
  validateBbox,
  validatePoint,
  type Bbox,
  type Point
} from "@offline-routing/shared";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  RATE_LIMITER?: RateLimit;
  RATE_LIMIT_SALT?: string;
}

export type WorkerHandler = {
  fetch(request: Request, env: Env, executionContext?: ExecutionContext): Promise<Response>;
};

export type SegmentRecord = {
  id: string;
  encodedGeometry: string;
  pointCount: number;
  distanceM: number;
  bbox: Bbox;
  createdAt: string;
  expiresAt: string | null;
  isSeed: boolean;
};

export type PublishedSegmentV2Record = SegmentRecord & {
  name: string;
  publicationState: "published";
  elevationsM: number[] | null;
  controlPoints: number[];
  elevationGainM: number | null;
  elevationLossM: number | null;
  metricsVersion: 1 | 2;
};

type ElevationPoint = Point & { elevationM: number };
type CanonicalPublication = {
  name: string;
  geometry: ElevationPoint[];
  controlPoints: number[];
};

type Query = { sql: string; bindings: unknown[] };
type SegmentRow = {
  id: string;
  encoded_geometry: string;
  point_count: number;
  distance_m: number;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
  created_at: string;
  expires_at: string | null;
  is_seed: number;
};

type SegmentV2Row = SegmentRow & {
  name: string;
  publication_state: string;
  elevations_json: string | null;
  control_points_json: string | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  metrics_version: number;
  idempotency_body_hash?: string | null;
};

const LIMITS = {
  bodyBytes: 16 * 1024,
  points: 128,
  cellsPerSegment: 64,
  cellsPerQuery: 64,
  bboxSpan: 0.02,
  zoom: 14,
  queryLimit: 50,
  ttlHours: 24
} as const;

const V2_LIMITS = {
  bodyBytes: 512 * 1024,
  points: 4_096,
  queryLimit: 10,
  controlPoints: 16,
  minElevationM: -500,
  maxElevationM: 9_000,
  nameCodePoints: 80
} as const;

const SYDNEY_BOUNDS: Bbox = {
  minLat: -33.91,
  minLng: 151.16,
  maxLat: -33.84,
  maxLng: 151.27
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function minuteIso(date: Date): string {
  const rounded = new Date(date);
  rounded.setUTCSeconds(0, 0);
  return rounded.toISOString();
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, idempotency-key",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

function response(request: Request, env: Env, payload: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request, env),
      ...extra
    }
  });
}

function error(request: Request, env: Env, status: number, code: string, extra: HeadersInit = {}): Response {
  return response(request, env, { error: code }, status, extra);
}

function isAllowedCorsRequest(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins(env).has(origin);
}

function bodyError(status: number = 400): Error {
  return Object.assign(new Error("invalid request"), { status });
}

function idempotencyConflict(): Error {
  return Object.assign(new Error("idempotency conflict"), { status: 409, code: "idempotency_conflict" });
}

function rateLimiterUnavailable(): Error {
  return Object.assign(new Error("rate limiter unavailable"), { status: 503, code: "rate_limiter_unavailable" });
}

async function readPublishBody(request: Request, maxBodyBytes = LIMITS.bodyBytes): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw bodyError();

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) throw bodyError();
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBodyBytes) throw bodyError(413);
  }

  if (!request.body) throw bodyError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) {
        await reader.cancel();
        throw bodyError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw bodyError();
  }
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function assertSydneyBbox(bbox: Bbox): Bbox {
  if (
    bbox.minLat < SYDNEY_BOUNDS.minLat ||
    bbox.maxLat > SYDNEY_BOUNDS.maxLat ||
    bbox.minLng < SYDNEY_BOUNDS.minLng ||
    bbox.maxLng > SYDNEY_BOUNDS.maxLng ||
    bbox.maxLat - bbox.minLat > LIMITS.bboxSpan ||
    bbox.maxLng - bbox.minLng > LIMITS.bboxSpan
  ) {
    throw bodyError();
  }
  return bbox;
}

function normalizeGeometry(body: unknown): Point[] {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !hasExactKeys(body, ["geometry"])) {
    throw bodyError();
  }
  const geometry = (body as { geometry?: unknown }).geometry;
  if (!Array.isArray(geometry) || geometry.length < 2) throw bodyError();
  if (geometry.length > LIMITS.points) throw bodyError(413);

  const points = geometry.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !hasExactKeys(value, ["lat", "lng"])) {
      throw bodyError();
    }
    try {
      return validatePoint(value, `geometry[${index}]`);
    } catch {
      throw bodyError();
    }
  });

  assertSydneyBbox(routeMetrics(points).bbox);
  return points;
}

function canonicalCoordinate(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalElevation(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw bodyError();
  const name = value.trim().normalize("NFC");
  if (
    Array.from(name).length < 1 ||
    Array.from(name).length > V2_LIMITS.nameCodePoints ||
    UNSAFE_NAME_CHARACTERS.test(name)
  ) {
    throw bodyError();
  }
  return name;
}

function normalizeV2Geometry(value: unknown): ElevationPoint[] {
  if (!Array.isArray(value) || value.length < 2) throw bodyError();
  if (value.length > V2_LIMITS.points) throw bodyError(413);
  const geometry = value.map((candidate, index) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      !hasExactKeys(candidate, ["elevationM", "lat", "lng"])
    ) {
      throw bodyError();
    }
    const raw = candidate as { lat?: unknown; lng?: unknown; elevationM?: unknown };
    if (typeof raw.elevationM !== "number" || !Number.isFinite(raw.elevationM)) throw bodyError();
    if (raw.elevationM < V2_LIMITS.minElevationM || raw.elevationM > V2_LIMITS.maxElevationM) throw bodyError();
    let point: Point;
    try {
      point = validatePoint({ lat: raw.lat, lng: raw.lng }, `geometry[${index}]`);
    } catch {
      throw bodyError();
    }
    return {
      lat: canonicalCoordinate(point.lat),
      lng: canonicalCoordinate(point.lng),
      elevationM: canonicalElevation(raw.elevationM)
    };
  });
  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1];
    const current = geometry[index];
    if (previous && current && previous.lat === current.lat && previous.lng === current.lng) throw bodyError();
  }
  assertSydneyBbox(routeMetrics(geometry).bbox);
  return geometry;
}

function normalizeControlPoints(value: unknown, pointCount: number): number[] {
  if (!Array.isArray(value) || value.length < 2) throw bodyError();
  if (value.length > V2_LIMITS.controlPoints) throw bodyError(413);
  const controls = value.map((candidate) => {
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate >= pointCount) throw bodyError();
    return candidate;
  });
  if (controls[0] !== 0 || controls.at(-1) !== pointCount - 1) throw bodyError();
  if (controls.some((control, index) => index > 0 && control <= controls[index - 1]!)) throw bodyError();
  return controls;
}

function normalizeV2Publication(body: unknown): CanonicalPublication {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !hasExactKeys(body, ["controlPoints", "geometry", "name"])
  ) {
    throw bodyError();
  }
  const candidate = body as { name?: unknown; geometry?: unknown; controlPoints?: unknown };
  const geometry = normalizeV2Geometry(candidate.geometry);
  return {
    name: normalizeName(candidate.name),
    geometry,
    controlPoints: normalizeControlPoints(candidate.controlPoints, geometry.length)
  };
}

function parseBbox(request: Request): Bbox {
  const raw = new URL(request.url).searchParams.get("bbox");
  if (!raw) throw bodyError();
  const values = raw.split(",").map((value) => Number(value.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw bodyError();
  try {
    return assertSydneyBbox(
      validateBbox({ minLat: values[0], minLng: values[1], maxLat: values[2], maxLng: values[3] })
    );
  } catch {
    throw bodyError();
  }
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function idempotencyHash(request: Request): Promise<string | null> {
  const key = request.headers.get("idempotency-key");
  if (!key) return null;
  if (!UUID_V4.test(key)) throw bodyError();
  return sha256(key.toLowerCase());
}

async function requiredIdempotencyHash(request: Request): Promise<string> {
  const hash = await idempotencyHash(request);
  if (!hash) throw bodyError();
  return hash;
}

function canonicalPublicationJson(publication: CanonicalPublication): string {
  return JSON.stringify({
    name: publication.name,
    geometry: publication.geometry,
    controlPoints: publication.controlPoints
  });
}

async function hmacClientKey(clientIp: string, salt: string): Promise<string> {
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    new TextEncoder().encode(`offline-routing-segments:v1:${clientIp}`)
  );
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Uses Cloudflare's shared Rate Limiting binding. The request IP, HMAC key, and
 * secret remain transient: none are logged or persisted by this Worker.
 */
export class CloudflareRateLimiter {
  async enforce(request: Request, env: Env): Promise<boolean> {
    const clientIp = request.headers.get("cf-connecting-ip");
    const salt = env.RATE_LIMIT_SALT;
    const binding = env.RATE_LIMITER;
    if (!clientIp || !salt || !binding) throw rateLimiterUnavailable();
    try {
      const key = await hmacClientKey(clientIp, salt);
      return (await binding.limit({ key })).success;
    } catch {
      throw rateLimiterUnavailable();
    }
  }
}

function selectByIdempotencyQuery(hash: string): Query {
  return {
    sql: "SELECT id, encoded_geometry, point_count, distance_m, min_lat, min_lng, max_lat, max_lng, created_at, expires_at, is_seed FROM segments WHERE idempotency_key_hash = ? LIMIT 1",
    bindings: [hash]
  };
}

const V2_COLUMNS = [
  "id", "encoded_geometry", "point_count", "distance_m", "min_lat", "min_lng", "max_lat", "max_lng",
  "created_at", "expires_at", "is_seed", "name", "publication_state", "elevations_json",
  "control_points_json", "elevation_gain_m", "elevation_loss_m", "metrics_version"
].map((column) => `s.${column}`).join(", ");

function selectV2ByIdempotencyQuery(hash: string): Query {
  return {
    sql: `SELECT ${V2_COLUMNS}, s.idempotency_body_hash FROM segments s WHERE s.idempotency_key_hash = ? LIMIT 1`,
    bindings: [hash]
  };
}

function mapRow(row: SegmentRow | null): SegmentRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    encodedGeometry: row.encoded_geometry,
    pointCount: row.point_count,
    distanceM: row.distance_m,
    bbox: { minLat: row.min_lat, minLng: row.min_lng, maxLat: row.max_lat, maxLng: row.max_lng },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    isSeed: row.is_seed === 1
  };
}

function parseNumberArray(value: string | null, fallback: number[] | null): number[] | null {
  if (value === null) return fallback;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("invalid stored array");
  }
  return parsed;
}

function mapV2Row(row: SegmentV2Row | null): PublishedSegmentV2Record | null {
  if (!row) return null;
  if (row.publication_state !== "published" || (row.metrics_version !== 1 && row.metrics_version !== 2)) {
    throw new Error("invalid stored publication");
  }
  const base = mapRow(row);
  if (!base) return null;
  return {
    ...base,
    name: row.name,
    publicationState: "published",
    elevationsM: parseNumberArray(row.elevations_json, null),
    controlPoints: parseNumberArray(row.control_points_json, [0, row.point_count - 1]) ?? [0, row.point_count - 1],
    elevationGainM: row.elevation_gain_m,
    elevationLossM: row.elevation_loss_m,
    metricsVersion: row.metrics_version
  };
}

function prepared(database: D1Database, query: Query): D1PreparedStatement {
  return database.prepare(query.sql).bind(...query.bindings);
}

export function listNearbySegmentsQuery({ tileKeys, bbox, nowIso, limit = LIMITS.queryLimit }: {
  tileKeys: string[];
  bbox: Bbox;
  nowIso: string;
  limit?: number;
}): Query {
  const placeholders = tileKeys.map(() => "?").join(", ");
  return {
    sql: [
      "SELECT DISTINCT s.id, s.encoded_geometry, s.point_count, s.distance_m, s.min_lat, s.min_lng, s.max_lat, s.max_lng, s.created_at, s.expires_at, s.is_seed",
      "FROM segment_cells sc",
      "JOIN segments s ON s.id = sc.segment_id",
      `WHERE sc.tile_key IN (${placeholders})`,
      "  AND s.max_lat >= ? AND s.min_lat <= ? AND s.max_lng >= ? AND s.min_lng <= ?",
      "  AND (s.is_seed = 1 OR s.expires_at > ?)",
      "ORDER BY s.created_at DESC",
      "LIMIT ?"
    ].join("\n"),
    bindings: [...tileKeys, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, nowIso, limit]
  };
}

export function listNearbySegmentsV2Query({ tileKeys, bbox, nowIso, limit = V2_LIMITS.queryLimit }: {
  tileKeys: string[];
  bbox: Bbox;
  nowIso: string;
  limit?: number;
}): Query {
  const placeholders = tileKeys.map(() => "?").join(", ");
  return {
    sql: [
      `SELECT DISTINCT ${V2_COLUMNS}`,
      "FROM segment_cells sc",
      "JOIN segments s ON s.id = sc.segment_id",
      `WHERE sc.tile_key IN (${placeholders})`,
      "  AND s.publication_state = 'published'",
      "  AND s.max_lat >= ? AND s.min_lat <= ? AND s.max_lng >= ? AND s.min_lng <= ?",
      "  AND (s.is_seed = 1 OR s.expires_at > ?)",
      "ORDER BY s.created_at DESC",
      "LIMIT ?"
    ].join("\n"),
    bindings: [...tileKeys, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, nowIso, limit]
  };
}

function purgeStatements(database: D1Database, nowIso: string): D1PreparedStatement[] {
  return [
    database.prepare("DELETE FROM segment_cells WHERE segment_id IN (SELECT id FROM segments WHERE is_seed = 0 AND expires_at IS NOT NULL AND expires_at <= ?)").bind(nowIso),
    database.prepare("DELETE FROM segments WHERE is_seed = 0 AND expires_at IS NOT NULL AND expires_at <= ?").bind(nowIso)
  ];
}

async function publish(request: Request, env: Env, now: () => Date): Promise<Response> {
  const body = await readPublishBody(request);
  const points = normalizeGeometry(body);
  const idempotencyKeyHash = await idempotencyHash(request);
  const permitted = await new CloudflareRateLimiter().enforce(request, env);
  if (!permitted) return error(request, env, 429, "rate_limited", { "retry-after": "60" });
  const nowIso = minuteIso(now());

  await env.DB.batch(purgeStatements(env.DB, nowIso));
  if (idempotencyKeyHash) {
    const existing = mapRow(await prepared(env.DB, selectByIdempotencyQuery(idempotencyKeyHash)).first<SegmentRow>());
    if (existing) return response(request, env, existing, 200);
  }

  const metrics = routeMetrics(points);
  const cells = segmentCells(points, LIMITS.zoom);
  if (cells.length > LIMITS.cellsPerSegment) throw bodyError(413);
  const record: SegmentRecord = {
    id: crypto.randomUUID(),
    encodedGeometry: encodePolyline6(points),
    pointCount: metrics.pointCount,
    distanceM: metrics.distanceM,
    bbox: metrics.bbox,
    createdAt: nowIso,
    expiresAt: minuteIso(addHours(new Date(nowIso), LIMITS.ttlHours)),
    isSeed: false
  };
  const inserts = [
    env.DB.prepare("INSERT INTO segments (id, encoded_geometry, point_count, distance_m, min_lat, min_lng, max_lat, max_lng, created_at, expires_at, idempotency_key_hash, is_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").bind(
      record.id, record.encodedGeometry, record.pointCount, record.distanceM, record.bbox.minLat, record.bbox.minLng,
      record.bbox.maxLat, record.bbox.maxLng, record.createdAt, record.expiresAt, idempotencyKeyHash
    ),
    ...cells.map((cell) => env.DB.prepare("INSERT INTO segment_cells (tile_key, segment_id) VALUES (?, ?)").bind(cell, record.id))
  ];
  try {
    await env.DB.batch(inserts);
  } catch {
    if (idempotencyKeyHash) {
      const existing = mapRow(await prepared(env.DB, selectByIdempotencyQuery(idempotencyKeyHash)).first<SegmentRow>());
      if (existing) return response(request, env, existing, 200);
    }
    throw new Error("database write failed");
  }
  return response(request, env, record, 201);
}

async function nearby(request: Request, env: Env, now: () => Date): Promise<Response> {
  const bbox = parseBbox(request);
  const cells = bboxCells(bbox, LIMITS.zoom);
  if (cells.length > LIMITS.cellsPerQuery) throw bodyError();
  const permitted = await new CloudflareRateLimiter().enforce(request, env);
  if (!permitted) return error(request, env, 429, "rate_limited", { "retry-after": "60" });
  const nowIso = minuteIso(now());
  const query = listNearbySegmentsQuery({ tileKeys: cells, bbox, nowIso });
  const result = await prepared(env.DB, query).all<SegmentRow>();
  return response(request, env, { segments: result.results.map((row) => mapRow(row)) }, 200);
}

async function publishV2(request: Request, env: Env, now: () => Date): Promise<Response> {
  const body = await readPublishBody(request, V2_LIMITS.bodyBytes);
  const publication = normalizeV2Publication(body);
  const idempotencyKeyHash = await requiredIdempotencyHash(request);
  const idempotencyBodyHash = await sha256(canonicalPublicationJson(publication));
  const permitted = await new CloudflareRateLimiter().enforce(request, env);
  if (!permitted) return error(request, env, 429, "rate_limited", { "retry-after": "60" });
  const nowIso = minuteIso(now());

  await env.DB.batch(purgeStatements(env.DB, nowIso));
  const existingRow = await prepared(env.DB, selectV2ByIdempotencyQuery(idempotencyKeyHash)).first<SegmentV2Row>();
  if (existingRow) {
    if (existingRow.idempotency_body_hash !== idempotencyBodyHash) throw idempotencyConflict();
    return response(request, env, mapV2Row(existingRow), 200);
  }

  const metrics = routeElevationMetrics(publication.geometry);
  const cells = segmentCells(publication.geometry, LIMITS.zoom);
  if (cells.length > LIMITS.cellsPerSegment) throw bodyError(413);
  const record: PublishedSegmentV2Record = {
    id: crypto.randomUUID(),
    name: publication.name,
    publicationState: "published",
    encodedGeometry: encodePolyline6(publication.geometry),
    elevationsM: publication.geometry.map((point) => point.elevationM),
    controlPoints: publication.controlPoints,
    pointCount: metrics.pointCount,
    distanceM: metrics.distanceM,
    elevationGainM: metrics.elevationGainM,
    elevationLossM: metrics.elevationLossM,
    metricsVersion: 2,
    bbox: metrics.bbox,
    createdAt: nowIso,
    expiresAt: minuteIso(addHours(new Date(nowIso), LIMITS.ttlHours)),
    isSeed: false
  };
  const inserts = [
    env.DB.prepare([
      "INSERT INTO segments (",
      "id, encoded_geometry, point_count, distance_m, min_lat, min_lng, max_lat, max_lng, created_at, expires_at,",
      "idempotency_key_hash, is_seed, name, publication_state, elevations_json, control_points_json,",
      "elevation_gain_m, elevation_loss_m, metrics_version, idempotency_body_hash",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'published', ?, ?, ?, ?, 2, ?)"
    ].join(" ")).bind(
      record.id,
      record.encodedGeometry,
      record.pointCount,
      record.distanceM,
      record.bbox.minLat,
      record.bbox.minLng,
      record.bbox.maxLat,
      record.bbox.maxLng,
      record.createdAt,
      record.expiresAt,
      idempotencyKeyHash,
      record.name,
      JSON.stringify(record.elevationsM),
      JSON.stringify(record.controlPoints),
      record.elevationGainM,
      record.elevationLossM,
      idempotencyBodyHash
    ),
    ...cells.map((cell) => env.DB.prepare("INSERT INTO segment_cells (tile_key, segment_id) VALUES (?, ?)").bind(cell, record.id))
  ];
  try {
    await env.DB.batch(inserts);
  } catch {
    const raced = await prepared(env.DB, selectV2ByIdempotencyQuery(idempotencyKeyHash)).first<SegmentV2Row>();
    if (raced) {
      if (raced.idempotency_body_hash !== idempotencyBodyHash) throw idempotencyConflict();
      return response(request, env, mapV2Row(raced), 200);
    }
    throw new Error("database write failed");
  }
  return response(request, env, record, 201);
}

async function nearbyV2(request: Request, env: Env, now: () => Date): Promise<Response> {
  const bbox = parseBbox(request);
  const cells = bboxCells(bbox, LIMITS.zoom);
  if (cells.length > LIMITS.cellsPerQuery) throw bodyError();
  const permitted = await new CloudflareRateLimiter().enforce(request, env);
  if (!permitted) return error(request, env, 429, "rate_limited", { "retry-after": "60" });
  const query = listNearbySegmentsV2Query({ tileKeys: cells, bbox, nowIso: minuteIso(now()) });
  const result = await prepared(env.DB, query).all<SegmentV2Row>();
  return response(request, env, { segments: result.results.map((row) => mapV2Row(row)) }, 200);
}

export function createWorker({ now = () => new Date() }: { now?: () => Date } = {}): WorkerHandler {
  return {
    async fetch(request, env): Promise<Response> {
      if (!isAllowedCorsRequest(request, env)) return error(request, env, 403, "origin_not_allowed");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      try {
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/health") {
          await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
          return response(request, env, { ok: true });
        }
        if (request.method === "POST" && path === "/segments") return await publish(request, env, now);
        if (request.method === "GET" && path === "/segments") return await nearby(request, env, now);
        if (request.method === "POST" && path === "/v2/segments") return await publishV2(request, env, now);
        if (request.method === "GET" && path === "/v2/segments") return await nearbyV2(request, env, now);
        return error(request, env, 404, "not_found");
      } catch (caught) {
        const status = typeof caught === "object" && caught !== null && "status" in caught ? (caught as { status?: unknown }).status : 500;
        if (status === 400 || status === 413) return error(request, env, status, status === 413 ? "payload_too_large" : "invalid_request");
        if (status === 409) return error(request, env, 409, "idempotency_conflict");
        if (status === 503) return error(request, env, 503, "rate_limiter_unavailable");
        return error(request, env, 500, "internal_error");
      }
    }
  };
}

export default createWorker();
