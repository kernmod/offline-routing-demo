import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const benchmarkDir = resolve(root, "docs/benchmarks");

test("named-device benchmark evidence is complete and matches the README summary", () => {
  const latestStem = readdirSync(benchmarkDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort()
    .at(-1);
  assert.ok(latestStem, "expected at least one benchmark JSON evidence file");

  const run = JSON.parse(readFileSync(resolve(benchmarkDir, `${latestStem}.json`), "utf8"));
  const log = readFileSync(resolve(benchmarkDir, `${latestStem}.log`), "utf8");
  const readme = readFileSync(resolve(root, "README.md"), "utf8");

  assert.equal(run.device, "redroid14_x86_64 isolated (AX102)");
  assert.equal(run.corpusSize, 1024);
  assert.equal(run.successes, 1024);
  assert.equal(run.failures, 0);
  assert.match(log, /OfflineRoutingBenchmark/);
  assert.doesNotMatch(log, /file:\/\/\/data\/user\//);
  assert.doesNotMatch(log, /http:\/\/127\.0\.0\.1:\d+/);
  assert.match(readme, /redroid14_x86_64 isolated \(AX102\)/);
  assert.match(readme, new RegExp(`${run.p50Micros.toLocaleString("en-US")} µs`));
  assert.match(readme, new RegExp(`${run.p95Micros.toLocaleString("en-US")} µs`));
  assert.match(readme, new RegExp(`${run.packLoadMicros.toLocaleString("en-US")} µs`));
});
