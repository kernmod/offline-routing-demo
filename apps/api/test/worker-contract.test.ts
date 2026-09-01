import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import worker, { CloudflareRateLimiter, createWorker, listNearbySegmentsQuery, type Env } from "../src/index.ts";
import { decodePolyline6 } from "@offline-routing/shared";
import { createSqliteD1 } from "./support/sqlite-d1.ts";

const apiRoot = resolve(import.meta.dirname, "..");
const migrations = [
  "0001_init.sql",
  "0002_seed_segments.sql",
  "0003_published_segments_v2.sql",
  "0004_expand_published_geometry.sql"
];
const NOW = () => new Date("2026-08-31T12:34:56.789Z");
const UUID_A = "018f9be5-4370-4a48-9f64-571f55555555";

class SharedRateLimitBinding {
  readonly keys: string[] = [];
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit = 1000) {}

  async limitForTest({ key }: { key: string }): Promise<{ success: boolean }> {
    this.keys.push(key);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { success: count <= this.limit };
  }

  asBinding(): RateLimit {
    return { limit: (options) => this.limitForTest(options) };
  }
}

class ThrowingRateLimitBinding {
  asBinding(): RateLimit {
    return {
      limit: async () => {
        throw new Error("upstream rate-limit failure");
      }
    };
  }
}

function createEnv(overrides: Partial<Env> = {}): { env: Env; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "offline-routing-d1-"));
  const databasePath = join(directory, "segments.sqlite");
  const db = createSqliteD1(databasePath);
  for (const migration of migrations) void db.exec(readFileSync(join(apiRoot, "migrations", migration), "utf8"));
  return {
    env: {
      DB: db,
      ALLOWED_ORIGINS: "https://viewer.example",
      RATE_LIMITER: new SharedRateLimitBinding().asBinding(),
      RATE_LIMIT_SALT: "test-only-rate-limit-salt",
      ...overrides
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

function request(path: string, init: RequestInit = {}, clientIp: string | null = "198.51.100.100"): Request {
  const headers = new Headers(init.headers);
  if (clientIp && !headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", clientIp);
  return new Request(`https://api.example${path}`, { ...init, headers });
}

function publish(geometry: unknown, idempotencyKey = UUID_A, origin?: string, clientIp: string | null = "198.51.100.100"): Request {
  return request("/segments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...(origin ? { origin } : {}),
      ...(clientIp ? { "cf-connecting-ip": clientIp } : {})
    },
    body: JSON.stringify({ geometry })
  }, clientIp);
}

const SYDNEY_LINE = [
  { lat: -33.8688, lng: 151.2093 },
  { lat: -33.8695, lng: 151.2102 },
  { lat: -33.8701, lng: 151.2111 }
];

const SYDNEY_LINE_V2 = [
  { lat: -33.86880004, lng: 151.20930004, elevationM: 10.04 },
  { lat: -33.86950004, lng: 151.21020004, elevationM: 15.04 },
  { lat: -33.87010004, lng: 151.21110004, elevationM: 12.04 }
];

function publishV2(
  body: unknown,
  idempotencyKey: string | null = UUID_A,
  origin?: string,
  clientIp: string | null = "198.51.100.100"
): Request {
  return request("/v2/segments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(origin ? { origin } : {}),
      ...(clientIp ? { "cf-connecting-ip": clientIp } : {})
    },
    body: JSON.stringify(body)
  }, clientIp);
}

function validV2Body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "  Cafe\u0301 harbour loop  ",
    geometry: SYDNEY_LINE_V2,
    controlPoints: [0, 2],
    ...overrides
  };
}

test("the TypeScript Worker exports a Cloudflare fetch entry point and rate limiter", () => {
  assert.equal(typeof worker.fetch, "function");
  assert.equal(typeof createWorker, "function");
  assert.equal(typeof CloudflareRateLimiter, "function");
});

test("nearby SQL begins with the indexed cell table and has only server-derived bindings", () => {
  const query = listNearbySegmentsQuery({
    tileKeys: ["14/15073/9831"],
    bbox: { minLat: -33.871, minLng: 151.208, maxLat: -33.868, maxLng: 151.212 },
    nowIso: "2026-08-31T12:34:00.000Z"
  });
  assert.match(query.sql, /FROM segment_cells sc/);
  assert.match(query.sql, /sc\.tile_key IN \(\?\)/);
  assert.equal(query.bindings.includes("14/15073/9831"), true);
});

test("POST recomputes every stored derived field and persists only geometry plus metadata", async () => {
  const context = createEnv();
  try {
    const response = await createWorker({ now: NOW }).fetch(publish(SYDNEY_LINE), context.env);
    assert.equal(response.status, 201);
    const payload = (await response.json()) as { id: string; createdAt: string; expiresAt: string; encodedGeometry: string; pointCount: number; distanceM: number };
    assert.match(payload.id, /^[0-9a-f-]{36}$/i);
    assert.equal(payload.createdAt, "2026-08-31T12:34:00.000Z");
    assert.equal(payload.expiresAt, "2026-09-01T12:34:00.000Z");
    assert.equal(payload.pointCount, 3);
    assert.equal(payload.distanceM > 0, true);
    assert.deepEqual(decodePolyline6(payload.encodedGeometry), SYDNEY_LINE);
    const row = await context.env.DB.prepare("SELECT idempotency_key_hash, created_at FROM segments WHERE is_seed = 0").first<Record<string, unknown>>();
    assert.equal(typeof row?.idempotency_key_hash, "string");
    assert.notEqual(row?.idempotency_key_hash, UUID_A);
    assert.equal(row?.created_at, payload.createdAt);
  } finally {
    context.cleanup();
  }
});

test("POST is idempotent by hashed UUID", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const first = await app.fetch(publish(SYDNEY_LINE), context.env);
    const second = await app.fetch(publish([{ lat: -33.8688, lng: 151.2093 }, { lat: -33.8689, lng: 151.2094 }]), context.env);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM segments WHERE is_seed = 0").first<{ count: number }>();
    assert.equal(count?.count, 1);
  } finally {
    context.cleanup();
  }
});

test("POST rejects hostile bodies, text fields, out-of-bounds geometry, and limits without storage", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const invalids: Request[] = [
      request("/segments", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.100" }, body: "{}" }),
      request("/segments", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.100" }, body: "{" }),
      publish([{ lat: -33.8688, lng: 151.2093, text: "no" }, { lat: -33.8695, lng: 151.2102 }]),
      publish([{ lat: -34, lng: 151.2093 }, { lat: -33.8695, lng: 151.2102 }]),
      publish(Array.from({ length: 129 }, () => ({ lat: -33.8688, lng: 151.2093 }))),
      publish(SYDNEY_LINE, "not-a-uuid"),
      request("/segments", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.100" }, body: JSON.stringify({ geometry: SYDNEY_LINE, description: "no" }) })
    ];
    for (const invalid of invalids) {
      const response = await app.fetch(invalid, context.env);
      assert.equal([400, 413].includes(response.status), true);
      assert.equal("error" in (await response.json() as object), true);
    }
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM segments WHERE is_seed = 0").first<{ count: number }>();
    assert.equal(count?.count, 0);
  } finally {
    context.cleanup();
  }
});

test("GET derives cells, exact-filters results, excludes expired user rows, and retains the permanent seed", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    await app.fetch(publish(SYDNEY_LINE), context.env);
    const nearby = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212"), context.env);
    assert.equal(nearby.status, 200);
    const payload = (await nearby.json()) as { segments: Array<{ isSeed: boolean }> };
    assert.equal(payload.segments.length, 2);
    assert.equal(payload.segments.some((segment) => segment.isSeed), true);
    await context.env.DB.prepare("UPDATE segments SET expires_at = '2026-08-31T12:00:00.000Z' WHERE is_seed = 0").run();
    const afterExpiry = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212"), context.env);
    const afterPayload = (await afterExpiry.json()) as { segments: Array<{ isSeed: boolean }> };
    assert.deepEqual(afterPayload.segments.map((segment) => segment.isSeed), [true]);
  } finally {
    context.cleanup();
  }
});

test("GET rate-limits browser and Origin-less native reads and fails closed when unavailable", async () => {
  const app = createWorker({ now: NOW });
  const limitedContext = createEnv({
    RATE_LIMITER: new SharedRateLimitBinding(1).asBinding(),
    RATE_LIMIT_SALT: "test-only-rate-limit-salt"
  });
  const missingLimiterContext = createEnv({ RATE_LIMITER: undefined });
  const missingSaltContext = createEnv({ RATE_LIMIT_SALT: undefined });
  const missingIpContext = createEnv();
  const nativeContext = createEnv({ RATE_LIMITER: new SharedRateLimitBinding(1).asBinding() });
  try {
    const browserHeaders = { origin: "https://viewer.example", "cf-connecting-ip": "198.51.100.10" };
    const first = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", { headers: browserHeaders }), limitedContext.env);
    const second = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", { headers: browserHeaders }), limitedContext.env);
    assert.deepEqual([first.status, second.status], [200, 429]);
    assert.equal(second.headers.get("retry-after"), "60");

    const missingBinding = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", {
      headers: browserHeaders
    }), missingLimiterContext.env);
    const missingSalt = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", {
      headers: browserHeaders
    }), missingSaltContext.env);
    const missingIp = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", {
      headers: { origin: "https://viewer.example" }
    }, null), missingIpContext.env);
    for (const response of [missingBinding, missingSalt, missingIp]) {
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "rate_limiter_unavailable" });
    }

    const nativeHeaders = { "cf-connecting-ip": "198.51.100.20" };
    const nativeFirst = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", {
      headers: nativeHeaders
    }), nativeContext.env);
    const nativeSecond = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212", {
      headers: nativeHeaders
    }), nativeContext.env);
    assert.deepEqual([nativeFirst.status, nativeSecond.status], [200, 429]);
  } finally {
    limitedContext.cleanup();
    missingLimiterContext.cleanup();
    missingSaltContext.cleanup();
    missingIpContext.cleanup();
    nativeContext.cleanup();
  }
});

test("GET does not allow read-triggered purge batches", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const originalBatch = context.env.DB.batch.bind(context.env.DB);
    let batchCalls = 0;
    context.env.DB.batch = async (...args) => {
      batchCalls += 1;
      return originalBatch(...args);
    };
    await app.fetch(publish(SYDNEY_LINE), context.env);
    batchCalls = 0;
    const nearby = await app.fetch(request("/segments?bbox=-33.871,151.208,-33.868,151.212"), context.env);
    assert.equal(nearby.status, 200);
    assert.equal(batchCalls, 0);
  } finally {
    context.cleanup();
  }
});

test("property: generated Sydney lines round-trip through publication and their exact bbox lookup", async () => {
  const context = createEnv();
  try {
    let state = 0x5eed1234;
    const random = () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
    const app = createWorker({ now: NOW });
    for (let index = 0; index < 24; index += 1) {
      const lat = -33.878 + random() * 0.008;
      const lng = 151.202 + random() * 0.008;
      const line = [{ lat, lng }, { lat: lat + 0.0002 + random() * 0.0004, lng: lng + 0.0002 + random() * 0.0004 }];
      const published = await app.fetch(publish(line, `018f9be5-4370-4a48-9f64-${String(index).padStart(12, "0")}`), context.env);
      assert.equal(published.status, 201);
      const segment = (await published.json()) as { id: string; bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } };
      const { minLat, minLng, maxLat, maxLng } = segment.bbox;
      const nearby = await app.fetch(request(`/segments?bbox=${minLat},${minLng},${maxLat},${maxLng}`), context.env);
      const list = (await nearby.json()) as { segments: Array<{ id: string }> };
      assert.equal(list.segments.some((candidate) => candidate.id === segment.id), true);
    }
  } finally {
    context.cleanup();
  }
});

test("Cloudflare rate-limit binding isolates HMAC client keys and survives new Worker instances", async () => {
  const binding = new SharedRateLimitBinding(1);
  const context = createEnv({ RATE_LIMITER: binding.asBinding(), RATE_LIMIT_SALT: "test-only-rate-limit-salt" });
  try {
    const firstInstance = createWorker({ now: NOW });
    const secondInstance = createWorker({ now: NOW });
    const firstClient = await firstInstance.fetch(publish(SYDNEY_LINE, UUID_A, undefined, "198.51.100.10"), context.env);
    const secondClient = await secondInstance.fetch(publish(SYDNEY_LINE, "018f9be5-4370-4a48-9f64-571f55555556", undefined, "198.51.100.11"), context.env);
    const exhausted = await secondInstance.fetch(publish(SYDNEY_LINE, "018f9be5-4370-4a48-9f64-571f55555557", undefined, "198.51.100.10"), context.env);
    assert.deepEqual([firstClient.status, secondClient.status, exhausted.status], [201, 201, 429]);
    assert.equal(binding.keys.length, 3);
    assert.equal(binding.keys[0], binding.keys[2]);
    assert.notEqual(binding.keys[0], binding.keys[1]);
    assert.equal(binding.keys.some((key) => key.includes("198.51.100.")), false);
    assert.equal(binding.keys.some((key) => key.includes("test-only-rate-limit-salt")), false);
  } finally {
    context.cleanup();
  }
});

test("POST fails closed when the edge limiter, secret, or Cloudflare client IP is unavailable", async () => {
  const contexts = [
    createEnv({ RATE_LIMITER: undefined }),
    createEnv({ RATE_LIMIT_SALT: undefined }),
    createEnv()
  ];
  try {
    const [missingBindingContext, missingSaltContext, missingIpContext] = contexts;
    const app = createWorker({ now: NOW });
    const missingBinding = await app.fetch(publish(SYDNEY_LINE, UUID_A, undefined, "198.51.100.10"), missingBindingContext!.env);
    const missingSalt = await app.fetch(publish(SYDNEY_LINE, UUID_A, undefined, "198.51.100.10"), missingSaltContext!.env);
    const missingIp = await app.fetch(publish(SYDNEY_LINE, UUID_A, undefined, null), missingIpContext!.env);
    for (const response of [missingBinding, missingSalt, missingIp]) {
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "rate_limiter_unavailable" });
    }
  } finally {
    for (const context of contexts) context.cleanup();
  }
});

test("POST maps a rate-limit binding failure to a public 503 without exposing internals", async () => {
  const context = createEnv({ RATE_LIMITER: new ThrowingRateLimitBinding().asBinding() });
  try {
    const app = createWorker({ now: NOW });
    const response = await app.fetch(publish(SYDNEY_LINE, UUID_A, undefined, "198.51.100.10"), context.env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "rate_limiter_unavailable" });
  } finally {
    context.cleanup();
  }
});

test("GET rejects malformed, oversized, and non-Sydney bbox queries", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    for (const path of ["/segments", "/segments?bbox=bad", "/segments?bbox=-33.91,151.16,-33.84,151.27", "/segments?bbox=-33.871,151.212,-33.868,151.208"]) {
      const result = await app.fetch(request(path), context.env);
      assert.equal(result.status, 400);
    }
  } finally {
    context.cleanup();
  }
});

test("CORS is an allowlist while native requests without Origin remain usable", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const preflight = await app.fetch(request("/segments", { method: "OPTIONS", headers: { origin: "https://viewer.example" } }), context.env);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://viewer.example");
    const rejected = await app.fetch(request("/segments", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), context.env);
    assert.equal(rejected.status, 403);
    assert.equal((await app.fetch(request("/health"), context.env)).status, 200);
  } finally {
    context.cleanup();
  }
});

test("health, 404, database failures, and write failures never expose internals", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    assert.deepEqual(await (await app.fetch(request("/health"), context.env)).json(), { ok: true });
    assert.deepEqual(await (await app.fetch(request("/unknown"), context.env)).json(), { error: "not_found" });
    const broken = {
      DB: { prepare() { throw new Error("private database detail"); } },
      RATE_LIMITER: new SharedRateLimitBinding().asBinding(),
      RATE_LIMIT_SALT: "test-only-rate-limit-salt"
    } as unknown as Env;
    assert.deepEqual(await (await app.fetch(request("/health"), broken)).json(), { error: "internal_error" });
    assert.deepEqual(await (await app.fetch(publish(SYDNEY_LINE), broken)).json(), { error: "internal_error" });
  } finally {
    context.cleanup();
  }
});

test("POST returns the existing row when an idempotent write races after the row is already stored", async () => {
  const context = createEnv();
  try {
    const originalBatch = context.env.DB.batch.bind(context.env.DB);
    let batchCalls = 0;
    context.env.DB.batch = async (statements) => {
      batchCalls += 1;
      await originalBatch(statements);
      if (batchCalls === 2) {
        throw new Error("simulated D1 retry after commit");
      }
      return [];
    };

    const app = createWorker({ now: NOW });
    const response = await app.fetch(publish(SYDNEY_LINE), context.env);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { id: string; encodedGeometry: string };
    assert.match(payload.id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(decodePolyline6(payload.encodedGeometry), SYDNEY_LINE);
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM segments WHERE is_seed = 0").first<{ count: number }>();
    assert.equal(count?.count, 1);
  } finally {
    context.cleanup();
  }
});

test("v2 POST canonicalizes a complete publication and recomputes every derived field", async () => {
  const context = createEnv();
  try {
    const response = await createWorker({ now: NOW }).fetch(publishV2(validV2Body()), context.env);
    assert.equal(response.status, 201);
    const payload = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), [
      "bbox", "controlPoints", "createdAt", "distanceM", "elevationGainM", "elevationLossM",
      "elevationsM", "encodedGeometry", "expiresAt", "id", "isSeed", "metricsVersion", "name",
      "pointCount", "publicationState"
    ].sort());
    assert.equal(payload.name, "Café harbour loop");
    assert.equal(payload.publicationState, "published");
    assert.equal(payload.metricsVersion, 2);
    assert.deepEqual(payload.controlPoints, [0, 2]);
    assert.deepEqual(payload.elevationsM, [10, 15, 12]);
    assert.equal(payload.elevationGainM, 5);
    assert.equal(payload.elevationLossM, 3);
    assert.equal(payload.pointCount, 3);
    assert.equal(payload.distanceM, 221);
    assert.deepEqual(decodePolyline6(String(payload.encodedGeometry)), SYDNEY_LINE);
    assert.deepEqual(payload.bbox, {
      minLat: -33.8701,
      minLng: 151.2093,
      maxLat: -33.8688,
      maxLng: 151.2111
    });

    const row = await context.env.DB.prepare(
      "SELECT name, publication_state, elevations_json, control_points_json, elevation_gain_m, elevation_loss_m, metrics_version, idempotency_key_hash, idempotency_body_hash FROM segments WHERE metrics_version = 2"
    ).first<Record<string, unknown>>();
    assert.deepEqual(row, {
      name: "Café harbour loop",
      publication_state: "published",
      elevations_json: "[10,15,12]",
      control_points_json: "[0,2]",
      elevation_gain_m: 5,
      elevation_loss_m: 3,
      metrics_version: 2,
      idempotency_key_hash: row?.idempotency_key_hash,
      idempotency_body_hash: row?.idempotency_body_hash
    });
    assert.equal(typeof row?.idempotency_key_hash, "string");
    assert.equal(typeof row?.idempotency_body_hash, "string");
    assert.notEqual(row?.idempotency_key_hash, UUID_A);
  } finally {
    context.cleanup();
  }
});

test("v2 accepts a routed fixture geometry longer than the legacy 128-point envelope", async () => {
  const context = createEnv();
  try {
    const geometry = Array.from({ length: 207 }, (_, index) => ({
      lat: -33.8702 + index * 0.000001,
      lng: 151.209 + index * 0.000001,
      elevationM: 20 + (index % 5)
    }));
    const response = await createWorker({ now: NOW }).fetch(
      publishV2(validV2Body({ geometry, controlPoints: [0, geometry.length - 1] })),
      context.env
    );

    assert.equal(response.status, 201);
    assert.equal((await response.json() as { pointCount: number }).pointCount, 207);

    const oversized = Array.from({ length: 4_097 }, (_, index) => ({
      lat: -33.8702 + index * 0.0000001,
      lng: 151.209 + index * 0.0000001,
      elevationM: 20
    }));
    const rejected = await createWorker({ now: NOW }).fetch(
      publishV2(validV2Body({ geometry: oversized, controlPoints: [0, oversized.length - 1] })),
      context.env
    );
    assert.equal(rejected.status, 413);
  } finally {
    context.cleanup();
  }
});

test("v2 POST requires UUIDv4 idempotency and distinguishes replay from payload conflict", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const missing = await app.fetch(publishV2(validV2Body(), null), context.env);
    const malformed = await app.fetch(publishV2(validV2Body(), "not-a-uuid"), context.env);
    assert.deepEqual([missing.status, malformed.status], [400, 400]);

    const first = await app.fetch(publishV2(validV2Body()), context.env);
    const replay = await app.fetch(publishV2(validV2Body({
      name: "Café harbour loop",
      geometry: SYDNEY_LINE
        .map((point, index) => ({ ...point, elevationM: [10, 15, 12][index] }))
    })), context.env);
    const conflict = await app.fetch(publishV2(validV2Body({ name: "Different route" })), context.env);
    assert.deepEqual([first.status, replay.status, conflict.status], [201, 200, 409]);
    assert.equal((await first.clone().json() as { id: string }).id, (await replay.json() as { id: string }).id);
    assert.deepEqual(await conflict.json(), { error: "idempotency_conflict" });
  } finally {
    context.cleanup();
  }
});

test("v2 concurrent replay stores exactly one published record", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const [first, second] = await Promise.all([
      app.fetch(publishV2(validV2Body()), context.env),
      app.fetch(publishV2(validV2Body()), context.env)
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
    assert.equal((await first.json() as { id: string }).id, (await second.json() as { id: string }).id);
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM segments WHERE metrics_version = 2").first<{ count: number }>();
    assert.equal(count?.count, 1);
  } finally {
    context.cleanup();
  }
});

test("v2 rejects drafts, client totals, unsafe names, malformed profiles, and invalid controls", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const invalidBodies: unknown[] = [
      { geometry: SYDNEY_LINE_V2, controlPoints: [0, 2] },
      validV2Body({ status: "draft" }),
      validV2Body({ distanceM: 1 }),
      validV2Body({ createdAt: "2020-01-01T00:00:00.000Z" }),
      validV2Body({ name: "   " }),
      validV2Body({ name: "line\nfeed" }),
      validV2Body({ name: "unsafe\u202Ename" }),
      validV2Body({ name: "x".repeat(81) }),
      validV2Body({ geometry: SYDNEY_LINE }),
      validV2Body({ geometry: SYDNEY_LINE_V2.map((point, index) => index ? point : { ...point, lat: 99 }) }),
      validV2Body({ geometry: SYDNEY_LINE_V2.map((point, index) => index ? point : { ...point, extra: true }) }),
      validV2Body({ geometry: SYDNEY_LINE_V2.map((point, index) => index ? point : { ...point, elevationM: Infinity }) }),
      validV2Body({ geometry: SYDNEY_LINE_V2.map((point, index) => index ? point : { ...point, elevationM: 10_000 }) }),
      validV2Body({ geometry: [SYDNEY_LINE_V2[0], SYDNEY_LINE_V2[0]] }),
      validV2Body({ controlPoints: [0] }),
      validV2Body({ controlPoints: [0, 0, 2] }),
      validV2Body({ controlPoints: [1, 2] }),
      validV2Body({ controlPoints: [0, 1] }),
      validV2Body({ controlPoints: [0, 3] }),
      validV2Body({ controlPoints: [0, 1.5, 2] })
    ];
    for (const [index, body] of invalidBodies.entries()) {
      const key = `018f9be5-4370-4a48-9f64-${String(index + 100).padStart(12, "0")}`;
      const result = await app.fetch(publishV2(body, key), context.env);
      assert.equal([400, 413].includes(result.status), true, `case ${index}: ${JSON.stringify(await result.json())}`);
    }
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM segments WHERE metrics_version = 2").first<{ count: number }>();
    assert.equal(count?.count, 0);
  } finally {
    context.cleanup();
  }
});

test("v2 GET returns published v2 and compatible legacy rows only through the indexed cell query", async () => {
  const context = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const created = await app.fetch(publishV2(validV2Body()), context.env);
    assert.equal(created.status, 201);
    const nearby = await app.fetch(request("/v2/segments?bbox=-33.871,151.208,-33.868,151.212"), context.env);
    assert.equal(nearby.status, 200);
    const payload = await nearby.json() as { segments: Array<Record<string, unknown>> };
    const legacy = payload.segments.find((segment) => segment.metricsVersion === 1);
    const current = payload.segments.find((segment) => segment.metricsVersion === 2);
    assert.ok(legacy);
    assert.equal(legacy.publicationState, "published");
    assert.equal(legacy.elevationsM, null);
    assert.equal(legacy.elevationGainM, null);
    assert.equal(legacy.elevationLossM, null);
    assert.deepEqual(legacy.controlPoints, [0, 1]);
    assert.ok(current);
    assert.equal(current.name, "Café harbour loop");
  } finally {
    context.cleanup();
  }
});

test("v2 preserves CORS, rate-limit, TTL, and generic-error boundaries", async () => {
  const limited = createEnv({ RATE_LIMITER: new SharedRateLimitBinding(1).asBinding() });
  const expired = createEnv();
  try {
    const app = createWorker({ now: NOW });
    const first = await app.fetch(publishV2(validV2Body(), UUID_A, "https://viewer.example", "198.51.100.8"), limited.env);
    const second = await app.fetch(publishV2(validV2Body(), "018f9be5-4370-4a48-9f64-571f55555556", "https://viewer.example", "198.51.100.8"), limited.env);
    assert.deepEqual([first.status, second.status], [201, 429]);
    assert.equal(first.headers.get("access-control-allow-origin"), "https://viewer.example");

    await app.fetch(publishV2(validV2Body()), expired.env);
    await expired.env.DB.prepare("UPDATE segments SET expires_at = '2026-08-31T12:00:00.000Z' WHERE metrics_version = 2").run();
    const nearby = await app.fetch(request("/v2/segments?bbox=-33.871,151.208,-33.868,151.212"), expired.env);
    const listed = await nearby.json() as { segments: Array<{ metricsVersion: number }> };
    assert.equal(listed.segments.some((segment) => segment.metricsVersion === 2), false);

    const broken = { ...expired.env, DB: { prepare() { throw new Error("private detail"); } } } as unknown as Env;
    const failure = await app.fetch(publishV2(validV2Body()), broken);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: "internal_error" });
  } finally {
    limited.cleanup();
    expired.cleanup();
  }
});

test("v2 resolves post-commit retries and keeps write failures generic", async () => {
  const retry = createEnv();
  const conflict = createEnv();
  const failed = createEnv();
  try {
    const app = createWorker({ now: NOW });
    for (const [context, mode, expectedStatus] of [
      [retry, "retry", 200],
      [conflict, "conflict", 409],
      [failed, "failed", 500]
    ] as const) {
      const originalBatch = context.env.DB.batch.bind(context.env.DB);
      let calls = 0;
      context.env.DB.batch = async (statements) => {
        calls += 1;
        if (calls !== 2) return originalBatch(statements);
        if (mode === "failed") throw new Error("simulated pre-commit failure");
        await originalBatch(statements);
        if (mode === "conflict") {
          await context.env.DB.prepare("UPDATE segments SET idempotency_body_hash = ? WHERE metrics_version = 2")
            .bind("0".repeat(64)).run();
        }
        throw new Error("simulated D1 retry after commit");
      };
      const result = await app.fetch(publishV2(validV2Body()), context.env);
      assert.equal(result.status, expectedStatus);
      if (expectedStatus === 409) assert.deepEqual(await result.json(), { error: "idempotency_conflict" });
      if (expectedStatus === 500) assert.deepEqual(await result.json(), { error: "internal_error" });
    }
  } finally {
    retry.cleanup();
    conflict.cleanup();
    failed.cleanup();
  }
});
