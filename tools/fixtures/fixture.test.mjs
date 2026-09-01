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
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.id, "sydney-cbd-cartography-v3");
  assert.deepEqual(manifest.bbox, [151.204, -33.873, 151.217, -33.862]);
  assert.match(manifest.source.license, /ODbL-1\.0/);
  assert.match(manifest.source.attribution, /OpenStreetMap contributors/);
  assert.match(manifest.source.snapshot, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(manifest.build.deterministic, true);
  assert.equal(manifest.build.network_required, false);
  assert.ok(["pending", "ready"].includes(manifest.routing.status));
  assert.equal(manifest.routing.builder_contract, "cch-routing-lite build-pack");
  assert.equal(manifest.routing.pack_schema, "CCHP2");
  assert.equal(manifest.elevation.provider, "Mapzen / Tilezen Terrain Tiles on AWS Open Data");
  assert.equal(manifest.elevation.encoding, "terrarium");
  assert.equal(manifest.elevation.zoom, 15);
  assert.equal(manifest.elevation.license, "CC-BY-4.0");
  assert.match(manifest.elevation.license_url, /creativecommons\.org\/licenses\/by\/4\.0/);
  assert.equal(manifest.elevation.covered_nodes, 7023);
  assert.match(manifest.elevation.attribution, /Geoscience Australia/);
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
  assert.ok(actualBytes <= 8_500_000, `${actualBytes} exceeds the 3D fixture budget`);
  assert.match(manifest.budget.reason, /3D|multi-layer|cartography/i);
});

test("normalized source includes public cartographic polygons without private layers", () => {
  const source = JSON.parse(readFileSync(join(fixtureDir, "source.osm.json"), "utf8"));
  assert.equal(source.schema_version, 3);
  assert.ok(source.nodes.length > 9_000, "roads plus polygons should require more nodes than the routing-only source");
  assert.ok(source.ways.some((way) => way.kind === "building"), "fixture must include building footprints");
  assert.ok(source.ways.some((way) => way.kind === "water"), "fixture must include water polygons");
  assert.ok(source.ways.some((way) => way.kind === "landuse"), "fixture must include landuse polygons");
  for (const way of source.ways) {
    assert.ok(["road", "building", "water", "landuse"].includes(way.kind), `unexpected public kind ${way.kind}`);
    assert.equal(way.tags.name, undefined, "label text must not enter the public fixture");
    assert.doesNotMatch(JSON.stringify(way.tags), /syntropy|runchain|pledge|oracle|segmentrace|rcmap/i);
  }
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

test("PMTiles metadata advertises the full public basemap layer contract", () => {
  const bytes = readFileSync(join(fixtureDir, "map.pmtiles"));
  const header = {
    metadataOffset: Number(bytes.readBigUInt64LE(24)),
    metadataLength: Number(bytes.readBigUInt64LE(32)),
  };
  const metadata = JSON.parse(
    bytes.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength).toString("utf8")
  );
  const layers = Object.fromEntries(metadata.vector_layers.map((layer) => [layer.id, layer]));
  assert.deepEqual(Object.keys(layers).sort(), ["buildings", "landuse", "roads", "water"]);
  assert.deepEqual(layers.buildings.fields, { render_height: "Number", render_min_height: "Number" });
  assert.deepEqual(layers.roads.fields, { class: "String" });
});

test("routing graph matches the public deterministic builder contract", () => {
  const graph = JSON.parse(readFileSync(join(fixtureDir, "graph.json"), "utf8"));
  assert.ok(graph.nodes.length > 100, "fixture must be a real, useful graph");
  assert.ok(graph.arcs.length >= graph.nodes.length, "graph must contain directed arcs");
  assert.deepEqual(Object.keys(graph).sort(), ["arcs", "nodes"]);
  for (const node of graph.nodes) {
    assert.deepEqual(Object.keys(node).sort(), ["elevationM", "lat", "lng"]);
    assert.ok(Number.isInteger(node.elevationM));
    assert.ok(node.elevationM > -100 && node.elevationM < 500);
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
  assert.ok(style.layers.some((layer) => layer["source-layer"] === "water" && layer.type === "fill"));
  assert.ok(style.layers.some((layer) => layer["source-layer"] === "landuse" && layer.type === "fill"));
  const extrusion = style.layers.find((layer) => layer.id === "buildings-3d");
  assert.equal(extrusion?.type, "fill-extrusion");
  assert.equal(extrusion?.["source-layer"], "buildings");
  assert.match(JSON.stringify(extrusion.paint), /render_height/);
  assert.match(JSON.stringify(extrusion.paint), /render_min_height/);
  assert.ok(extrusion.paint["fill-extrusion-opacity"] <= 0.58, "3D buildings must not hide route overlays");
});

test("licence and provenance files are explicit", () => {
  const attribution = readFileSync(join(fixtureDir, "ATTRIBUTION.md"), "utf8");
  assert.match(attribution, /OpenStreetMap contributors/);
  assert.match(attribution, /Open Data Commons Open Database License/);
  assert.match(attribution, /source\.osm\.json/);
  assert.match(attribution, /Mapzen|Tilezen/);
  assert.match(attribution, /Geoscience Australia/);
  assert.match(attribution, /Terrarium/);
  const dataSources = readFileSync(join(root, "docs/data-sources.md"), "utf8");
  assert.match(dataSources, /AWS Open Data/);
  assert.match(dataSources, /elevation-tiles-prod/);
  assert.match(dataSources, /Terrarium/);
  assert.match(dataSources, /Geoscience Australia/);
  assert.equal(statSync(join(root, "docs/adr/0008-elevation-fixture.md")).isFile(), true);
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
