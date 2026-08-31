import assert from "node:assert/strict";
import test from "node:test";

test("listSegments calls the public API with the exact bbox contract", async () => {
  process.env.EXPO_PUBLIC_SEGMENTS_API_URL = "https://segments.example.test/";
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return { segments: [{ id: "seed-sydney-cbd-001" }] };
      }
    };
  };

  const { listSegments } = await import(`./networkApi.ts?test=${Date.now()}`);
  const rows = await listSegments({ minLat: -33.873, minLng: 151.204, maxLat: -33.862, maxLng: 151.217 });

  assert.deepEqual(calls, [
    "https://segments.example.test/segments?bbox=-33.873%2C151.204%2C-33.862%2C151.217"
  ]);
  assert.deepEqual(rows, [{ id: "seed-sydney-cbd-001" }]);
});

test("listSegments rejects a response that does not match the Worker envelope", async () => {
  process.env.EXPO_PUBLIC_SEGMENTS_API_URL = "https://segments.example.test";
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return [{ id: "wrong-envelope" }]; }
  });

  const { listSegments } = await import(`./networkApi.ts?invalid=${Date.now()}`);
  await assert.rejects(
    listSegments({ minLat: -33.873, minLng: 151.204, maxLat: -33.862, maxLng: 151.217 }),
    /nearby_invalid_response/
  );
});
