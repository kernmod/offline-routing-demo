import {
  bboxCells,
  encodePolyline6,
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

const SYDNEY_BOUNDS: Bbox = {
  minLat: -33.91,
  minLng: 151.16,
  maxLat: -33.84,
  maxLng: 151.27
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function rateLimiterUnavailable(): Error {
  return Object.assign(new Error("rate limiter unavailable"), { status: 503, code: "rate_limiter_unavailable" });
}

async function readPublishBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw bodyError();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > LIMITS.bodyBytes) throw bodyError(413);
  try {
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
        return error(request, env, 404, "not_found");
      } catch (caught) {
        const status = typeof caught === "object" && caught !== null && "status" in caught ? (caught as { status?: unknown }).status : 500;
        if (status === 400 || status === 413) return error(request, env, status, status === 413 ? "payload_too_large" : "invalid_request");
        if (status === 503) return error(request, env, 503, "rate_limiter_unavailable");
        return error(request, env, 500, "internal_error");
      }
    }
  };
}

export default createWorker();
