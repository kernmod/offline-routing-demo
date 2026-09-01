import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  buildMvtTile,
  buildRoutingGraph,
  decodeTerrariumPng,
  decodeVarint,
  encodeVarint,
  parsePmtilesHeader,
  listFiles,
  normalizeOverpass,
  loadTerrariumDem,
  sampleTerrariumElevation,
  sha256,
  verifyFixture,
  zxyToTileId,
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixture = join(root, "fixtures/sydney");

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  return chunk;
}

function tinyTerrariumPng(options = {}) {
  const {
    width = 2,
    height = 2,
    bitDepth = 8,
    colorType = 6,
    compression = 0,
    filter = 0,
    interlace = 0,
    rowFilter = 0,
    truncateRaster = false,
  } = options;
  const channels = colorType === 2 ? 3 : 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[10] = compression;
  header[11] = filter;
  header[12] = interlace;
  const raster = Buffer.alloc((width * channels + 1) * height, 128);
  for (let row = 0; row < height; row += 1) raster[row * (width * channels + 1)] = rowFilter;
  const compressed = deflateSync(truncateRaster ? raster.subarray(1) : raster);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("PMTiles varints round-trip boundary values", () => {
  for (const value of [0, 1, 127, 128, 16_383, 16_384, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
    const encoded = encodeVarint(value);
    const decoded = decodeVarint(encoded);
    assert.equal(Number(decoded.value), value);
    assert.equal(decoded.next, encoded.length);
  }
  assert.throws(() => encodeVarint(-1), /negative/);
  assert.throws(() => decodeVarint(Buffer.from([0x80])), /truncated/);
});

test("Overpass normalization is sorted, minimal, and deterministic", () => {
  const raw = {
    elements: [
      { type: "node", id: 3, lat: -33.86, lon: 151.21, tags: { name: "ignored" } },
      { type: "node", id: 1, lat: -33.87, lon: 151.205 },
      { type: "node", id: 2, lat: -33.87, lon: 151.206 },
      { type: "way", id: 9, nodes: [2, 1], tags: { name: "Lane", highway: "path", secret: "drop" } },
    ],
  };
  assert.deepEqual(normalizeOverpass(raw, "2026-08-31T00:00:00Z"), {
    schema_version: 1,
    snapshot: "2026-08-31T00:00:00Z",
    bbox: [151.204, -33.873, 151.217, -33.862],
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    nodes: [
      { id: 1, lat: -33.87, lon: 151.205 },
      { id: 2, lat: -33.87, lon: 151.206 },
    ],
    ways: [{ id: 9, nodes: [2, 1], tags: { highway: "path", name: "Lane" } }],
  });
});

test("tile ids follow the PMTiles Hilbert ordering", () => {
  assert.equal(zxyToTileId(0, 0, 0), 0);
  assert.deepEqual(
    [[0, 0], [0, 1], [1, 1], [1, 0]].map(([x, y]) => zxyToTileId(1, x, y)),
    [1, 2, 3, 4],
  );
  assert.throws(() => zxyToTileId(-1, 0, 0), /zoom/);
  assert.throws(() => zxyToTileId(2, 4, 0), /outside/);
  assert.deepEqual(
    [
      [13, 7536, 4915],
      [14, 15073, 9831],
      [15, 30147, 19663],
      [16, 60295, 39327],
    ].map(([z, x, y]) => zxyToTileId(z, x, y)),
    [72_052_580, 288_210_323, 1_152_841_295, 4_611_365_183],
    "matches pmtiles@4.5.0 for the fixture centre",
  );
});

test("Terrarium decoder and sampler expose finite Sydney elevations", () => {
  const dem = loadTerrariumDem(join(fixture, "dem"));
  const source = JSON.parse(readFileSync(join(fixture, "dem/source.json"), "utf8"));
  assert.equal(source.provider, "Mapzen / Tilezen Terrain Tiles on AWS Open Data");
  assert.equal(source.encoding, "terrarium");
  assert.equal(source.zoom, 15);
  assert.equal(source.tiles.length, 6);
  for (const tile of source.tiles) {
    const decoded = decodeTerrariumPng(readFileSync(join(fixture, "dem", tile.path)));
    assert.equal(decoded.width, 256);
    assert.equal(decoded.height, 256);
  }
  for (const point of [
    { lat: -33.873, lng: 151.204 },
    { lat: -33.8675, lng: 151.2105 },
    { lat: -33.862, lng: 151.217 },
  ]) {
    assert.ok(Number.isFinite(sampleTerrariumElevation(dem, point)));
  }
});

test("Terrarium decoder fails closed on malformed and unsupported rasters", () => {
  assert.throws(() => decodeTerrariumPng(Buffer.alloc(0)), /signature/);
  const truncatedChunk = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from([0, 0, 0, 32, 73, 72, 68, 82, 0, 0, 0, 0]),
  ]);
  assert.throws(() => decodeTerrariumPng(truncatedChunk), /truncated.*chunk/);
  assert.throws(
    () => decodeTerrariumPng(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)])),
    /no image data/,
  );
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ bitDepth: 16 })), /unsupported/);
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ colorType: 0 })), /unsupported/);
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ compression: 1 })), /unsupported/);
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ filter: 1 })), /unsupported/);
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ interlace: 1 })), /unsupported/);
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ truncateRaster: true })), /raster length/);
  assert.throws(() => decodeTerrariumPng(tinyTerrariumPng({ rowFilter: 5 })), /row filter/);
});

test("Terrarium sampler rejects missing coverage, transparent no-data, and invalid coordinates", () => {
  const source = { zoom: 0, tileSize: 2 };
  const opaquePixels = Buffer.from([
    128, 0, 0, 255, 128, 1, 0, 255,
    128, 2, 0, 255, 128, 3, 0, 255,
  ]);
  const tile = { width: 2, height: 2, channels: 4, pixels: opaquePixels };
  const dem = { source, tiles: new Map([["0/0/0", tile]]) };

  assert.ok(Number.isFinite(sampleTerrariumElevation(dem, { lat: 66, lng: -90 })));
  assert.throws(
    () => sampleTerrariumElevation({ source, tiles: new Map() }, { lat: 66, lng: -90 }),
    /coverage missing/,
  );
  assert.throws(() => sampleTerrariumElevation(dem, { lat: Number.NaN, lng: 0 }), /invalid DEM coordinate/);

  const transparent = { ...tile, pixels: Buffer.from(opaquePixels) };
  transparent.pixels[3] = 0;
  assert.throws(
    () => sampleTerrariumElevation({ source, tiles: new Map([["0/0/0", transparent]]) }, { lat: 66, lng: -90 }),
    /no-data pixel/,
  );
});

test("DEM loader enforces its pinned source contract and tile integrity", () => {
  const temporary = mkdtempSync(join(tmpdir(), "route-dem-contract-"));
  try {
    writeFileSync(join(temporary, "source.json"), JSON.stringify({ encoding: "raw", tileSize: 256, zoom: 15, tiles: [] }));
    assert.throws(() => loadTerrariumDem(temporary), /unsupported DEM source contract/);

    writeFileSync(join(temporary, "source.json"), JSON.stringify({
      encoding: "terrarium",
      tileSize: 256,
      zoom: 15,
      tiles: [{ x: 1, y: 2, path: "missing.png", bytes: 4, sha256: "deadbeef" }],
    }));
    assert.throws(() => loadTerrariumDem(temporary), /integrity mismatch/);

    const smallTilePath = join(temporary, "small.png");
    writeFileSync(smallTilePath, tinyTerrariumPng({ width: 2, height: 256 }));
    writeFileSync(join(temporary, "source.json"), JSON.stringify({
      encoding: "terrarium",
      tileSize: 256,
      zoom: 15,
      tiles: [{
        x: 1,
        y: 2,
        path: "small.png",
        bytes: readFileSync(smallTilePath).length,
        sha256: sha256(smallTilePath),
      }],
    }));
    assert.throws(() => loadTerrariumDem(temporary), /dimensions mismatch/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("walking graph filters forbidden ways and keeps its largest component", () => {
  const source = {
    nodes: [
      { id: 1, lat: -33.867, lon: 151.205 },
      { id: 2, lat: -33.867, lon: 151.206 },
      { id: 3, lat: -33.867, lon: 151.207 },
      { id: 4, lat: -33.868, lon: 151.205 },
      { id: 5, lat: -33.868, lon: 151.206 },
      { id: 6, lat: -33.868, lon: 151.207 },
      { id: 7, lat: -33.869, lon: 151.205 },
      { id: 8, lat: -33.869, lon: 151.206 },
      { id: 9, lat: -33.869, lon: 151.207 },
      { id: 20, lat: -33.866, lon: 151.216 },
      { id: 21, lat: -33.866, lon: 151.2165 },
    ],
    ways: [
      { id: 1, nodes: [1, 2, 3, 6, 9, 8, 7, 4, 1], tags: { highway: "footway" } },
      { id: 2, nodes: [20, 21], tags: { highway: "residential" } },
      { id: 3, nodes: [3, 2], tags: { highway: "motorway" } },
      { id: 4, nodes: [4, 5], tags: { highway: "path", access: "private" } },
    ],
  };
  const graph = buildRoutingGraph(source, { sample: ({ lat, lng }) => Math.round((lat + lng) * 10) });
  assert.equal(graph.nodes.length, 8);
  assert.equal(graph.arcs.length, 16);
  assert.ok(graph.nodes.every((node) => Number.isInteger(node.elevationM)));
  assert.ok(graph.arcs.every((arc) => arc.weight > 0));
});

test("MVT builder emits a roads layer protobuf", () => {
  const source = {
    nodes: [
      { id: 1, lat: -33.8675, lon: 151.21 },
      { id: 2, lat: -33.8676, lon: 151.211 },
    ],
    ways: [{ id: 42, nodes: [1, 2], tags: { highway: "residential" } }],
  };
  const tile = buildMvtTile(source, { z: 16, x: 60295, y: 39327 });
  assert.ok(tile.length > 20);
  assert.ok(tile.includes(Buffer.from("roads")));
  assert.ok(tile.includes(Buffer.from("street")));
});

test("PMTiles header parser rejects malformed archives", () => {
  assert.throws(() => parsePmtilesHeader(Buffer.alloc(10)), /magic|truncated/);
  const archive = Buffer.from(readFileSync(join(fixture, "map.pmtiles")));
  archive[7] = 2;
  assert.throws(() => parsePmtilesHeader(archive), /unsupported/);
});

test("fixture verifier returns independently parsed archive facts", () => {
  const result = verifyFixture(fixture);
  assert.equal(result.manifest.id, "sydney-cbd-walking-v2");
  assert.equal(result.header.addressedTiles, 26);
  assert.ok(result.declaredBytes < 5_000_000);
});

test("file inventory recurses into the local glyph directory", () => {
  const files = listFiles(fixture);
  assert.ok(files.includes("glyphs/Offline Sans/0-255.pbf"));
  assert.ok(files.includes("map.pmtiles"));
});

test("fixture verifier rejects budget and PMTiles structural drift", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fixture-negative-"));
  const candidate = join(temporaryRoot, "sydney");
  cpSync(fixture, candidate, { recursive: true });
  try {
    const manifestPath = join(candidate, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.budget.max_bytes = 1;
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(() => verifyFixture(candidate), /budget/);

    manifest.budget.max_bytes = 5_000_000;
    const archivePath = join(candidate, "map.pmtiles");
    const archive = Buffer.from(readFileSync(archivePath));
    archive[99] = 2;
    writeFileSync(archivePath, archive);
    const archiveAsset = manifest.assets.find((asset) => asset.path === "map.pmtiles");
    archiveAsset.sha256 = sha256(archivePath);
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(() => verifyFixture(candidate), /tile type/);

    archive[99] = 1;
    archive.writeBigUInt64LE(BigInt(archive.length + 1), 56);
    writeFileSync(archivePath, archive);
    archiveAsset.sha256 = sha256(archivePath);
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(() => verifyFixture(candidate), /outside archive/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("fixture verifier rejects provenance drift", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fixture-provenance-"));
  const candidate = join(temporaryRoot, "sydney");
  cpSync(fixture, candidate, { recursive: true });
  try {
    const manifestPath = join(candidate, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.source.snapshot = "1999-01-01T00:00:00Z";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(() => verifyFixture(candidate), /provenance/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("fixture verifier rejects DEM datum and derived elevation range drift", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fixture-elevation-contract-"));
  const candidate = join(temporaryRoot, "sydney");
  cpSync(fixture, candidate, { recursive: true });
  try {
    const manifestPath = join(candidate, "manifest.json");
    const original = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const [field, value] of [
      ["vertical_datum", "unknown"],
      ["min_m", original.elevation.min_m - 1],
      ["max_m", original.elevation.max_m + 1],
    ]) {
      const manifest = structuredClone(original);
      manifest.elevation[field] = value;
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      assert.throws(() => verifyFixture(candidate), /DEM provenance|elevation range/);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("fixture verifier rejects JSON-escaped remote style URLs", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fixture-style-"));
  const candidate = join(temporaryRoot, "sydney");
  cpSync(fixture, candidate, { recursive: true });
  try {
    const stylePath = join(candidate, "style.json");
    const escaped = readFileSync(stylePath, "utf8").replace(
      "./glyphs/{fontstack}/{range}.pbf",
      "h\\u0074tps://example.test/{fontstack}/{range}.pbf",
    );
    writeFileSync(stylePath, escaped);
    const manifestPath = join(candidate, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const styleAsset = manifest.assets.find((asset) => asset.path === "style.json");
    styleAsset.bytes = Buffer.byteLength(escaped);
    styleAsset.sha256 = sha256(stylePath);
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(() => verifyFixture(candidate), /local|remote/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
