import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveApiVerificationError,
  normalizeLiveApiUrl,
  resolveLiveApiUrl,
  systemLookupFactory,
  verifyLiveApi
} from "./verify-api-lib.mjs";
import { runLiveApiCli } from "./verify-api.mjs";

const API_URL = "https://segments-api.example.workers.dev";
const IDEMPOTENCY_KEY = "018f9be5-4370-4a48-9f64-571f55555555";
const SEGMENT_ID = "8de15dc3-80d3-4c53-89e2-50b592076cf7";
function resolverFactory(lookup, cancel = () => {}) {
  return () => ({ lookup, cancel });
}

const PUBLIC_LOOKUP_FACTORY = resolverFactory(async () => [{ address: "1.1.1.1", family: 4 }]);

function verify(options) {
  return verifyLiveApi({ lookupFactory: PUBLIC_LOOKUP_FACTORY, ...options });
}

const record = {
  id: SEGMENT_ID,
  name: "Sydney verifier route",
  publicationState: "published",
  encodedGeometry: "vxdr_Awgal_Hfw@gw@",
  elevationsM: [10, 15, 12],
  controlPoints: [0, 2],
  pointCount: 3,
  distanceM: 221,
  elevationGainM: 5,
  elevationLossM: 3,
  metricsVersion: 2,
  bbox: {
    minLat: -33.8701,
    minLng: 151.2093,
    maxLat: -33.8688,
    maxLng: 151.2111
  },
  createdAt: "2026-08-31T12:34:00.000Z",
  expiresAt: "2026-09-01T12:34:00.000Z",
  isSeed: false
};

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function urlWithCredentials(origin, username, password = "", queryToken = "") {
  const url = new URL(origin);
  url.username = username;
  url.password = password;
  if (queryToken) url.searchParams.set("token", queryToken);
  return url.href;
}

function successfulFetch(requests) {
  let publishCount = 0;
  return async (url, init) => {
    requests.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === "/health") return jsonResponse({ ok: true });
    if (path === "/v2/segments" && init.method === "POST") {
      publishCount += 1;
      const body = JSON.parse(init.body);
      if (body.name !== "Sydney verifier route") {
        return jsonResponse({ error: "idempotency_conflict" }, { status: 409 });
      }
      return jsonResponse(record, { status: publishCount === 1 ? 201 : 200 });
    }
    if (path === "/v2/segments" && init.method === "GET") {
      return jsonResponse({ segments: [{ ...record, encodedGeometry: "different" }, record] });
    }
    throw new Error(`unexpected request path in test: ${path}`);
  };
}

function fetchWithPublishRecord(publishedRecord, { replayRecord = publishedRecord, conflictPayload = { error: "idempotency_conflict" } } = {}) {
  let publishCount = 0;
  return async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/health") return jsonResponse({ ok: true });
    if (path === "/v2/segments" && init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.name !== "Sydney verifier route") return jsonResponse(conflictPayload, { status: 409 });
      publishCount += 1;
      return jsonResponse(publishCount === 1 ? publishedRecord : replayRecord, { status: publishCount === 1 ? 201 : 200 });
    }
    return jsonResponse({ segments: [publishedRecord] });
  };
}

test("live URL policy accepts only an uncredentialed public HTTPS origin", () => {
  assert.equal(normalizeLiveApiUrl(`${API_URL}/`), API_URL);

  for (const invalid of [
    "",
    "http://segments.example",
    "https://localhost",
    urlWithCredentials("https://localhost", "localhost.example.com"),
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://100.64.0.1",
    "https://169.254.10.1",
    "https://172.16.0.1",
    "https://192.0.2.1",
    "https://192.168.0.1",
    "https://198.18.0.1",
    "https://198.51.100.1",
    "https://203.0.113.1",
    "https://224.0.0.1",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://[2001:db8::1]",
    "https://[::ffff:192.168.0.1]",
    "https://printer.local",
    "https://singlelabel",
    "https://api.example:8443",
    "https://api.example",
    "https://fc.example.com",
    "https://1.1.1.1",
    "https://[2606:4700:4700::1111]",
    "https://worker.workers.dev.evil.example",
    "https://api.example/path",
    "https://api.example?token=secret",
    urlWithCredentials("https://api.example", "fixture-user", "fixture-password")
  ]) {
    assert.throws(() => normalizeLiveApiUrl(invalid), LiveApiVerificationError, invalid);
  }
});

test("URL resolution requires an explicit CLI flag or environment value", () => {
  assert.equal(resolveLiveApiUrl(["--url", `${API_URL}/`], {}), API_URL);
  assert.equal(resolveLiveApiUrl([`--url=${API_URL}`], {}), API_URL);
  assert.equal(resolveLiveApiUrl([], { SEGMENTS_API_URL: API_URL }), API_URL);
  assert.equal(resolveLiveApiUrl(["--url", API_URL], { SEGMENTS_API_URL: "https://ignored.example" }), API_URL);
  assert.throws(() => resolveLiveApiUrl([], {}), /--url.*SEGMENTS_API_URL/);
  assert.throws(() => resolveLiveApiUrl(["--wat"], {}), /unknown argument/);
  assert.throws(() => resolveLiveApiUrl(["--url"], {}), /requires a value/);
  assert.throws(() => resolveLiveApiUrl(["--url", API_URL, "--url", API_URL], {}), /only be provided once/);
  assert.throws(() => resolveLiveApiUrl([`--url=${API_URL}`, `--url=${API_URL}`], {}), /only be provided once/);
});

test("verifier completes v2 publish, replay, conflict, and bbox read with bounded honest requests", async () => {
  const requests = [];
  const result = await verify({
    apiUrl: API_URL,
    fetchImpl: successfulFetch(requests),
    randomUUID: () => IDEMPOTENCY_KEY
  });

  assert.deepEqual(result, {
    apiOrigin: API_URL,
    segmentId: SEGMENT_ID,
    statuses: { health: 200, publish: 201, replay: 200, conflict: 409, nearby: 200 }
  });
  assert.equal(requests.length, 5);
  assert.equal(new URL(requests[0].url).pathname, "/health");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[1].init.headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.equal(requests[1].init.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    name: "Sydney verifier route",
    geometry: [
      { lat: -33.8688, lng: 151.2093, elevationM: 10 },
      { lat: -33.8695, lng: 151.2102, elevationM: 15 },
      { lat: -33.8701, lng: 151.2111, elevationM: 12 }
    ],
    controlPoints: [0, 2]
  });
  assert.equal(requests[2].init.headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.equal(requests[3].init.headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.equal(JSON.parse(requests[3].init.body).name, "Sydney verifier route conflict probe");
  const nearbyUrl = new URL(requests[4].url);
  assert.equal(nearbyUrl.pathname, "/v2/segments");
  assert.equal(nearbyUrl.searchParams.get("bbox"), "-33.871,151.208,-33.868,151.212");
  for (const { init } of requests) {
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.signal instanceof AbortSignal, true);
  }
});

test("verifier accepts idempotent publish replay status 200", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const response = await successfulFetch(requests)(url, init);
    if (new URL(url).pathname === "/v2/segments" && init.method === "POST" && JSON.parse(init.body).name === "Sydney verifier route") {
      return jsonResponse(record, { status: 200 });
    }
    return response;
  };
  const result = await verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY });
  assert.equal(result.statuses.publish, 200);
  assert.equal(result.statuses.replay, 200);
});

test("verifier rejects dishonest content and cache headers", async () => {
  for (const headers of [
    { "content-type": "text/html" },
    { "cache-control": "public, max-age=3600" },
    { "access-control-allow-origin": "*" },
    { "access-control-allow-credentials": "true" }
  ]) {
    const fetchImpl = async () => jsonResponse({ ok: true }, { headers });
    await assert.rejects(
      verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY }),
      LiveApiVerificationError
    );
  }
});

test("verifier validates health and segment response contracts", async () => {
  const invalidPayloads = [
    { ok: false },
    { ok: true, internal: "leak" },
    null,
    "not-json"
  ];
  for (const payload of invalidPayloads) {
    const fetchImpl = async () => jsonResponse(payload);
    await assert.rejects(
      verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY }),
      /health response contract/
    );
  }

  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/health") return jsonResponse({ ok: true });
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.name !== "Sydney verifier route") return jsonResponse({ error: "idempotency_conflict" }, { status: 409 });
      return jsonResponse({ ...record, pointCount: 2 }, { status: 201 });
    }
    return jsonResponse({ segments: [record] });
  };
  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY }),
    /publish response contract/
  );
});

test("verifier rejects malformed v2 record fields at the publication boundary", async () => {
  const invalidRecords = [
    { ...record, internal: "leak" },
    { ...record, id: "not-a-uuid" },
    { ...record, encodedGeometry: "" },
    { ...record, name: "" },
    { ...record, publicationState: "draft" },
    { ...record, metricsVersion: 3 },
    { ...record, controlPoints: [0] },
    { ...record, metricsVersion: 1, elevationsM: [10, 15, 12], elevationGainM: 5, elevationLossM: 3 },
    { ...record, elevationsM: [10, 15] },
    { ...record, bbox: null },
    { ...record, bbox: { ...record.bbox, minLat: "south" } },
    { ...record, bbox: { ...record.bbox, minLat: -33.86, maxLat: -33.87 } },
    { ...record, createdAt: "yesterday" },
    { ...record, isSeed: "false" },
    { ...record, expiresAt: null },
    { ...record, expiresAt: record.createdAt },
    { ...record, isSeed: true, expiresAt: null },
    { ...record, distanceM: 222 },
    { ...record, bbox: { ...record.bbox, maxLng: 151.2112 } }
  ];

  for (const candidate of invalidRecords) {
    await assert.rejects(
      verify({
        apiUrl: API_URL,
        fetchImpl: fetchWithPublishRecord(candidate),
        randomUUID: () => IDEMPOTENCY_KEY
      }),
      /publish response contract/
    );
  }
});

test("verifier rejects changed replays and malformed idempotency conflicts", async () => {
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: fetchWithPublishRecord(record, {
        replayRecord: { ...record, createdAt: "2026-08-31T12:35:00.000Z" }
      }),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /replay did not return.*unchanged/
  );

  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: fetchWithPublishRecord(record, { conflictPayload: { error: "internal_error" } }),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /conflict response contract/
  );
});

test("verifier requires the exact published record in the bbox read", async () => {
  let publishes = 0;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/health") return jsonResponse({ ok: true });
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.name !== "Sydney verifier route") return jsonResponse({ error: "idempotency_conflict" }, { status: 409 });
      publishes += 1;
      return jsonResponse(record, { status: publishes === 1 ? 201 : 200 });
    }
    return jsonResponse({ segments: [{ ...record, encodedGeometry: "tampered" }] });
  };
  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY }),
    /published segment was not returned unchanged/
  );
});

test("verifier resolves hostnames and refuses any non-public address before fetch", async () => {
  let fetched = false;
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => { fetched = true; },
      lookupFactory: resolverFactory(async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "192.168.1.10", family: 4 }
      ]),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /hostname resolves to a non-public address/
  );
  assert.equal(fetched, false);

  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => { fetched = true; },
      lookupFactory: resolverFactory(async () => { throw new Error("resolver details"); }),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /hostname could not be resolved/
  );
  assert.equal(fetched, false);

  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => { fetched = true; },
      lookupFactory: resolverFactory(async () => []),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /hostname could not be resolved/
  );
  assert.equal(fetched, false);

  let resolverCancelled = false;
  const resolverHandle = setInterval(() => {}, 1_000);
  const startedAt = Date.now();
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => { fetched = true; },
      lookupFactory: resolverFactory(
        async () => new Promise(() => {}),
        () => {
          resolverCancelled = true;
          clearInterval(resolverHandle);
        }
      ),
      randomUUID: () => IDEMPOTENCY_KEY,
      timeoutMs: 10
    }),
    /DNS lookup timed out after 10ms/
  );
  assert.ok(Date.now() - startedAt < 500, "DNS timeout must bound the verifier");
  assert.equal(resolverCancelled, true);
  assert.equal(fetched, false);

  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => { fetched = true; },
      lookupFactory: resolverFactory(async () => new Promise(() => {}), () => { throw new Error("cancel failed"); }),
      randomUUID: () => IDEMPOTENCY_KEY,
      timeoutMs: 10
    }),
    /DNS lookup timed out after 10ms/
  );
  assert.equal(fetched, false);
});

test("system DNS session merges successful families and exposes real cancellation", async () => {
  let cancelled = false;
  class FakeResolver {
    async resolve4() { return ["1.1.1.1"]; }
    async resolve6() { throw new Error("no IPv6"); }
    cancel() { cancelled = true; }
  }
  const session = systemLookupFactory(FakeResolver);
  assert.deepEqual(await session.lookup("worker.example.workers.dev"), [
    { address: "1.1.1.1", family: 4 }
  ]);
  session.cancel();
  assert.equal(cancelled, true);

  class Ipv6Resolver {
    async resolve4() { throw new Error("no IPv4"); }
    async resolve6() { return ["2606:4700:4700::1111"]; }
    cancel() {}
  }
  assert.deepEqual(await systemLookupFactory(Ipv6Resolver).lookup("worker.example.workers.dev"), [
    { address: "2606:4700:4700::1111", family: 6 }
  ]);

  class EmptyResolver {
    async resolve4() { throw new Error("no IPv4"); }
    async resolve6() { throw new Error("no IPv6"); }
    cancel() {}
  }
  await assert.rejects(
    systemLookupFactory(EmptyResolver).lookup("worker.example.workers.dev"),
    /no address records/
  );
});

test("verifier enforces status, timeout, and response-size boundaries", async () => {
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => jsonResponse({ error: "internal_error" }, { status: 503 }),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /health returned HTTP 503/
  );

  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => jsonResponse({ ok: true }, { headers: { "content-length": "100000" } }),
      maxResponseBytes: 1024,
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /health response exceeds 1024 bytes/
  );

  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => new Response("x".repeat(1025), {
        headers: { "cache-control": "no-store", "content-type": "application/json" }
      }),
      maxResponseBytes: 1024,
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /health response exceeds 1024 bytes/
  );

  const hangingFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: hangingFetch,
      timeoutMs: 10,
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /health request timed out after 10ms/
  );
});

test("verifier rejects malformed bodies, transport failures, and unsafe runtime configuration", async () => {
  const cases = [
    {
      fetchImpl: async () => new Response("{", {
        headers: { "cache-control": "no-store", "content-type": "application/json" }
      }),
      expected: /health response is not valid JSON/
    },
    {
      fetchImpl: async () => new Response(null, {
        headers: { "cache-control": "no-store", "content-type": "application/json" }
      }),
      expected: /health response body is missing/
    },
    {
      fetchImpl: async () => jsonResponse({ ok: true }, { headers: { "content-length": "nope" } }),
      expected: /invalid content-length/
    },
    {
      fetchImpl: async () => { throw new Error("transport-secret"); },
      expected: /health request failed/
    },
    {
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) { controller.error(new Error("stream-secret")); }
      }), {
        headers: { "cache-control": "no-store", "content-type": "application/json" }
      }),
      expected: /health response body could not be read/
    }
  ];
  for (const { fetchImpl, expected } of cases) {
    await assert.rejects(
      verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY }),
      expected
    );
  }

  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl: null, randomUUID: () => IDEMPOTENCY_KEY }),
    /Fetch API is unavailable/
  );
  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl: async () => jsonResponse({ ok: true }), lookupFactory: null }),
    /DNS lookup is unavailable/
  );
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => jsonResponse({ ok: true }),
      lookupFactory: () => { throw new Error("factory-secret"); },
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /DNS lookup is unavailable/
  );
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => jsonResponse({ ok: true }),
      lookupFactory: () => ({ lookup: null, cancel() {} }),
      randomUUID: () => IDEMPOTENCY_KEY
    }),
    /DNS lookup is unavailable/
  );
  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl: async () => jsonResponse({ ok: true }), randomUUID: null }),
    /UUID generation is unavailable/
  );
  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl: async () => jsonResponse({ ok: true }), randomUUID: () => "bad" }),
    /invalid UUIDv4/
  );
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => jsonResponse({ ok: true }),
      randomUUID: () => IDEMPOTENCY_KEY,
      timeoutMs: 0
    }),
    /configuration response contract is invalid/
  );
  await assert.rejects(
    verify({
      apiUrl: API_URL,
      fetchImpl: async () => jsonResponse({ ok: true }),
      randomUUID: () => IDEMPOTENCY_KEY,
      maxResponseBytes: 0
    }),
    /configuration response contract is invalid/
  );
});

test("verifier rejects a malformed nearby envelope", async () => {
  let publishes = 0;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/health") return jsonResponse({ ok: true });
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.name !== "Sydney verifier route") return jsonResponse({ error: "idempotency_conflict" }, { status: 409 });
      publishes += 1;
      return jsonResponse(record, { status: publishes === 1 ? 201 : 200 });
    }
    return jsonResponse({ segments: "not-an-array" });
  };
  await assert.rejects(
    verify({ apiUrl: API_URL, fetchImpl, randomUUID: () => IDEMPOTENCY_KEY }),
    /nearby response contract/
  );
});

test("errors never echo URL credentials, query secrets, idempotency keys, or response bodies", async () => {
  const secrets = ["username", "password", "query-secret", IDEMPOTENCY_KEY, "body-secret"];
  let message = "";
  try {
    await verify({
      apiUrl: urlWithCredentials("https://api.example", "username", "password", "query-secret"),
      fetchImpl: async () => jsonResponse({ error: "body-secret" }, { status: 500 }),
      randomUUID: () => IDEMPOTENCY_KEY
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.notEqual(message, "");
  for (const secret of secrets) assert.equal(message.includes(secret), false, secret);
});

test("CLI reports only public status evidence and never request material", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await runLiveApiCli({
    argv: ["--url", API_URL],
    env: {},
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    fetchImpl: successfulFetch([]),
    lookupFactory: PUBLIC_LOOKUP_FACTORY,
    uuid: () => IDEMPOTENCY_KEY
  });
  assert.equal(exitCode, 0);
  assert.equal(stdout, "LIVE_API_OK health=200 publish=201 replay=200 conflict=409 nearby=200\n");
  assert.equal(stderr, "");
  for (const hidden of [API_URL, IDEMPOTENCY_KEY, SEGMENT_ID]) assert.equal(stdout.includes(hidden), false);
});

test("CLI failure output is generic and credential-free", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await runLiveApiCli({
    argv: ["--url", urlWithCredentials("https://api.example", "user", "password", "secret")],
    env: {},
    lookupFactory: PUBLIC_LOOKUP_FACTORY,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^LIVE_API_FAILED /);
  for (const hidden of ["user", "password", "secret"]) assert.equal(stderr.includes(hidden), false);
});
