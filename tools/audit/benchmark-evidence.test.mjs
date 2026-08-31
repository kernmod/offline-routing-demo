import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const benchmarkDir = resolve(root, "docs/benchmarks");

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round((sorted[9] + sorted[10]) / 2);
}

test("final isolated-device benchmark retains twenty complete native corpora", () => {
  const files = readdirSync(benchmarkDir)
    .filter((name) => /^2026-08-31T20-(?:40|41|42)-.*Z\.json$/.test(name))
    .sort();
  const runs = files.map((name) => JSON.parse(readFileSync(resolve(benchmarkDir, name), "utf8")));
  const logs = files.map((name) => readFileSync(resolve(benchmarkDir, name.replace(/\.json$/, ".log")), "utf8"));

  assert.equal(runs.length, 20);
  for (const run of runs) {
    assert.equal(run.device, "redroid14_x86_64 isolated (AX102)");
    assert.equal(run.corpusSize, 1024);
    assert.equal(run.successes, 1024);
    assert.equal(run.failures, 0);
  }
  assert.equal(median(runs.map((run) => run.p50Micros)), 1177);
  assert.equal(median(runs.map((run) => run.p95Micros)), 1613);
  assert.equal(median(runs.map((run) => run.packLoadMicros)), 98508);
  for (const log of logs) {
    assert.match(log, /OfflineRoutingBenchmark/);
    assert.doesNotMatch(log, /file:\/\/\/data\/user\//);
    assert.doesNotMatch(log, /http:\/\/127\.0\.0\.1:\d+/);
  }

  const summary = readFileSync(resolve(benchmarkDir, "2026-08-31-redroid14-isolated-cold-summary.md"), "utf8");
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(summary, /20,480 \/ 20,480/);
  assert.doesNotMatch(summary, /(?:localhost|127\.0\.0\.1):\d+/);
  assert.match(readme, /redroid14_x86_64 isolated \(AX102\)/);
  assert.match(readme, /1,177 µs/);
  assert.match(readme, /1,613 µs/);
});
