import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const benchmarkDir = resolve(root, "docs/benchmarks");

test("named-device benchmark evidence is complete and matches the README summary", () => {
  const run = JSON.parse(
    readFileSync(resolve(benchmarkDir, "2026-09-01T01-06-14Z.json"), "utf8")
  );
  const log = readFileSync(resolve(benchmarkDir, "2026-09-01T01-06-14Z.log"), "utf8");
  const readme = readFileSync(resolve(root, "README.md"), "utf8");

  assert.equal(run.device, "redroid14_x86_64 isolated (AX102)");
  assert.equal(run.corpusSize, 1024);
  assert.equal(run.successes, 1024);
  assert.equal(run.failures, 0);
  assert.equal(run.p50Micros, 1212);
  assert.equal(run.p95Micros, 1674);
  assert.equal(run.packLoadMicros, 136366);
  assert.match(log, /OfflineRoutingBenchmark/);
  assert.doesNotMatch(log, /file:\/\/\/data\/user\//);
  assert.doesNotMatch(log, /http:\/\/127\.0\.0\.1:\d+/);
  assert.match(readme, /redroid14_x86_64 isolated \(AX102\)/);
  assert.match(readme, /1,212 µs/);
  assert.match(readme, /1,674 µs/);
  assert.match(readme, /136,366 µs/);
});
