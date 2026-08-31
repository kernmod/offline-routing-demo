import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildFixture } from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixtureDir = join(root, "fixtures/sydney");
const manifestPath = join(fixtureDir, "manifest.json");

const loadManifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(join(directory, entry.name), relative)
      : [relative];
  });
}

test("manifest describes a bounded, attributed Sydney fixture", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.id, "sydney-cbd-walking-v1");
  assert.deepEqual(manifest.bbox, [151.204, -33.873, 151.217, -33.862]);
  assert.match(manifest.source.license, /ODbL-1\.0/);
  assert.match(manifest.source.attribution, /OpenStreetMap contributors/);
  assert.match(manifest.source.snapshot, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(manifest.build.deterministic, true);
  assert.equal(manifest.build.network_required, false);
  assert.ok(["pending", "ready"].includes(manifest.routing.status));
  assert.equal(manifest.routing.builder_contract, "cch-routing-lite build-pack");
});

test("every declared asset has the exact size and sha256 digest", () => {
  const manifest = loadManifest();
  assert.ok(manifest.assets.length >= 3);
  assert.ok(manifest.assets.some((asset) => asset.path === "ATTRIBUTION.md"));
  for (const asset of manifest.assets) {
    const path = join(fixtureDir, asset.path);
    assert.equal(statSync(path).size, asset.bytes, asset.path);
    assert.equal(sha256(path), asset.sha256, asset.path);
  }
});

test("fixture stays below the public repository asset budget", () => {
  const manifest = loadManifest();
  const actualBytes = listFiles(fixtureDir)
    .filter((path) => path !== "manifest.json")
    .reduce((sum, path) => sum + statSync(join(fixtureDir, path)).size, 0);
  assert.ok(actualBytes <= manifest.budget.max_bytes);
  assert.ok(actualBytes <= 5_000_000, `${actualBytes} exceeds the 5 MB hard limit`);
});

test("PMTiles archive is v3 MVT and covers the declared bbox", () => {
  const bytes = readFileSync(join(fixtureDir, "map.pmtiles"));
  assert.equal(bytes.subarray(0, 7).toString("ascii"), "PMTiles");
  assert.equal(bytes[7], 3, "PMTiles spec version");
  assert.equal(bytes[99], 1, "tile type must be MVT");
  assert.equal(bytes[100], 13, "minimum zoom");
  assert.equal(bytes[101], 16, "maximum zoom");
  assert.deepEqual(
    [
      bytes.readInt32LE(102) / 1e7,
      bytes.readInt32LE(106) / 1e7,
      bytes.readInt32LE(110) / 1e7,
      bytes.readInt32LE(114) / 1e7,
    ],
    [151.204, -33.873, 151.217, -33.862],
  );
  assert.ok(bytes.readBigUInt64LE(72) > 0n, "archive must address tiles");
  assert.ok(bytes.readBigUInt64LE(88) > 0n, "archive must contain tile payloads");
});

test("routing graph matches the public deterministic builder contract", () => {
  const graph = JSON.parse(readFileSync(join(fixtureDir, "graph.json"), "utf8"));
  assert.ok(graph.nodes.length > 100, "fixture must be a real, useful graph");
  assert.ok(graph.arcs.length >= graph.nodes.length, "graph must contain directed arcs");
  assert.deepEqual(Object.keys(graph).sort(), ["arcs", "nodes"]);
  for (const node of graph.nodes) {
    assert.deepEqual(Object.keys(node).sort(), ["lat", "lng"]);
    assert.ok(node.lng >= 151.204 && node.lng <= 151.217);
    assert.ok(node.lat >= -33.873 && node.lat <= -33.862);
  }
  const arcKeys = new Set();
  for (const arc of graph.arcs) {
    assert.deepEqual(Object.keys(arc).sort(), ["from", "to", "weight"]);
    assert.ok(Number.isInteger(arc.from) && arc.from >= 0 && arc.from < graph.nodes.length);
    assert.ok(Number.isInteger(arc.to) && arc.to >= 0 && arc.to < graph.nodes.length);
    assert.ok(Number.isInteger(arc.weight) && arc.weight > 0);
    const key = `${arc.from}:${arc.to}`;
    assert.ok(!arcKeys.has(key), `duplicate arc ${key}`);
    arcKeys.add(key);
  }
  for (const arc of graph.arcs) assert.ok(arcKeys.has(`${arc.to}:${arc.from}`), "walking arcs are symmetric");
});

test("style has no remote URL and uses the embedded PMTiles archive", () => {
  const styleText = readFileSync(join(fixtureDir, "style.json"), "utf8");
  const style = JSON.parse(styleText);
  assert.doesNotMatch(styleText, /https?:|syntropy|runchain/i);
  assert.equal(style.sources.offline.url, "pmtiles://map.pmtiles");
  assert.equal(style.glyphs, "./glyphs/{fontstack}/{range}.pbf");
  assert.ok(style.layers.some((layer) => layer["source-layer"] === "roads"));
});

test("licence and provenance files are explicit", () => {
  const attribution = readFileSync(join(fixtureDir, "ATTRIBUTION.md"), "utf8");
  assert.match(attribution, /OpenStreetMap contributors/);
  assert.match(attribution, /Open Data Commons Open Database License/);
  assert.match(attribution, /source\.osm\.json/);
});

test("build is deterministic and succeeds without network", () => {
  const first = mkdtempSync(join(tmpdir(), "fixture-a-"));
  const second = mkdtempSync(join(tmpdir(), "fixture-b-"));
  for (const out of [first, second]) {
    buildFixture({ root, out });
  }
  for (const name of ["graph.json", "map.pmtiles", "style.json", "manifest.json"]) {
    assert.equal(sha256(join(first, name)), sha256(join(second, name)), name);
  }
});

test("fixture contains no private endpoint or product vocabulary", () => {
  const scanned = listFiles(fixtureDir)
    .filter((path) => !path.endsWith(".pmtiles"))
    .map((path) => readFileSync(join(fixtureDir, path), "utf8"))
    .join("\n");
  assert.doesNotMatch(scanned, /syntropy\.gg|runchain|rcmap|pledge|oracle|segmentrace|local.?judge/i);
});
