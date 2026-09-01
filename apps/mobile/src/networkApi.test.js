import assert from "node:assert/strict";
import test from "node:test";

const point = (lat, lng, elevationM) => ({ lat, lng, elevationM });
const payload = {
  name: "Harbour route",
  geometry: [point(-33.87, 151.20, 10), point(-33.869, 151.21, 20)],
  controlPoints: [0, 1]
};

test("publishSegment calls v2 with exact JSON and UUID idempotency", async () => {
  process.env.EXPO_PUBLIC_SEGMENTS_API_URL = "https://segments.example.test/";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    return { ok: true, async json() { return { id: "segment-1", publicationState: "published" }; } };
  };
  const { publishSegment } = await import(`./networkApi.ts?publish=${Date.now()}`);
  const key = "00000000-0000-4000-8000-000000000001";
  assert.equal((await publishSegment(payload, key)).id, "segment-1");
  assert.equal(calls[0][0], "https://segments.example.test/v2/segments");
  assert.equal(calls[0][1].headers["idempotency-key"], key);
  assert.deepEqual(JSON.parse(calls[0][1].body), payload);
});

test("publishSegment rejects invalid UUIDs and malformed responses before state changes", async () => {
  process.env.EXPO_PUBLIC_SEGMENTS_API_URL = "https://segments.example.test";
  globalThis.fetch = async () => ({ ok: true, async json() { return { id: 42 }; } });
  const { publishSegment } = await import(`./networkApi.ts?invalid-publish=${Date.now()}`);
  await assert.rejects(publishSegment(payload, "wrong"), /idempotency/i);
  await assert.rejects(publishSegment(payload, "00000000-0000-4000-8000-000000000001"), /publish_invalid_response/);
});

test("listSegments calls v2 with the exact bbox contract and validates published rows", async () => {
  process.env.EXPO_PUBLIC_SEGMENTS_API_URL = "https://segments.example.test/";
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, async json() { return { segments: [{ id: "seed", name: "Seed", publicationState: "published" }] }; } };
  };
  const { listSegments } = await import(`./networkApi.ts?list=${Date.now()}`);
  const rows = await listSegments({ minLat: -33.873, minLng: 151.204, maxLat: -33.862, maxLng: 151.217 });
  assert.deepEqual(calls, ["https://segments.example.test/v2/segments?bbox=-33.873%2C151.204%2C-33.862%2C151.217"]);
  assert.deepEqual(rows, [{ id: "seed", name: "Seed", publicationState: "published" }]);
});

test("network API rejects HTTP failures and invalid envelopes", async () => {
  process.env.EXPO_PUBLIC_SEGMENTS_API_URL = "https://segments.example.test";
  globalThis.fetch = async () => ({ ok: false, status: 503, async json() { return {}; } });
  const failed = await import(`./networkApi.ts?http=${Date.now()}`);
  await assert.rejects(failed.listSegments({ minLat: -33.873, minLng: 151.204, maxLat: -33.862, maxLng: 151.217 }), /nearby_http_503/);
  await assert.rejects(failed.publishSegment(payload, "00000000-0000-4000-8000-000000000001"), /publish_http_503/);

  globalThis.fetch = async () => ({ ok: true, async json() { return { segments: [{ id: "x", publicationState: "draft" }] }; } });
  const malformed = await import(`./networkApi.ts?malformed=${Date.now()}`);
  await assert.rejects(malformed.listSegments({ minLat: -33.873, minLng: 151.204, maxLat: -33.862, maxLng: 151.217 }), /nearby_invalid_response/);
});
