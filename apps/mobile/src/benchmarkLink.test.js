import assert from "node:assert/strict";
import test from "node:test";

import { benchmarkUrl, parseBenchmarkUrl } from "./benchmarkLink.ts";

test("parseBenchmarkUrl accepts the public benchmark deep link", () => {
  assert.deepEqual(
    parseBenchmarkUrl("offlineroutingdemo://benchmark?device=redroid14_x86_64%20(AX102)"),
    { device: "redroid14_x86_64 (AX102)" }
  );
});

test("parseBenchmarkUrl rejects unrelated or malformed URLs", () => {
  assert.equal(parseBenchmarkUrl("https://example.test"), null);
  assert.equal(parseBenchmarkUrl("offlineroutingdemo://benchmark"), null);
  assert.equal(parseBenchmarkUrl("offlineroutingdemo://publish?device=device"), null);
  assert.equal(
    parseBenchmarkUrl("offlineroutingdemo://benchmark?device=" + "x".repeat(81)),
    null
  );
});

test("benchmarkUrl encodes the device name with the public scheme", () => {
  assert.equal(
    benchmarkUrl("redroid14_x86_64 (AX102)"),
    "offlineroutingdemo://benchmark?device=redroid14_x86_64%20(AX102)"
  );
});
