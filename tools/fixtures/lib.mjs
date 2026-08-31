import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

export const FIXTURE_BBOX = [151.204, -33.873, 151.217, -33.862];
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 16;
export const MAX_FIXTURE_BYTES = 5_000_000;

export function normalizeOverpass(raw, snapshot) {
  const nodeIds = new Set(
    raw.elements
      .filter((element) => element.type === "way")
      .flatMap((way) => way.nodes),
  );
  const nodes = raw.elements
    .filter((element) => element.type === "node" && nodeIds.has(element.id))
    .map(({ id, lat, lon }) => ({ id, lat, lon }))
    .sort((a, b) => a.id - b.id);
  const keptTags = new Set([
    "access", "bridge", "foot", "highway", "name", "oneway", "surface", "tunnel",
  ]);
  const ways = raw.elements
    .filter((element) => element.type === "way")
    .map(({ id, nodes: wayNodes, tags = {} }) => ({
      id,
      nodes: wayNodes,
      tags: Object.fromEntries(
        Object.entries(tags)
          .filter(([key]) => keptTags.has(key))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    }))
    .sort((a, b) => a.id - b.id);
  return {
    schema_version: 1,
    snapshot,
    bbox: FIXTURE_BBOX,
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    nodes,
    ways,
  };
}

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(join(directory, entry.name), path)
      : [path];
  });
}

export function encodeVarint(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) throw new RangeError("varint cannot encode a negative value");
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

export function decodeVarint(bytes, start = 0) {
  let value = 0n;
  let shift = 0n;
  for (let index = start; index < bytes.length && index < start + 10; index += 1) {
    const byte = bytes[index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: index + 1 };
    shift += 7n;
  }
  throw new Error("invalid or truncated varint");
}

function fieldVarint(field, value) {
  return Buffer.concat([encodeVarint((field << 3) | 0), encodeVarint(value)]);
}

function fieldBytes(field, bytes) {
  return Buffer.concat([
    encodeVarint((field << 3) | 2),
    encodeVarint(bytes.length),
    bytes,
  ]);
}

function zigzag(value) {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function rotate(size, x, y, rx, ry) {
  if (ry !== 0) return [x, y];
  let nextX = x;
  let nextY = y;
  if (rx === 1) {
    nextX = size - 1 - nextX;
    nextY = size - 1 - nextY;
  }
  return [nextY, nextX];
}

export function zxyToTileId(z, initialX, initialY) {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new RangeError("invalid zoom");
  const size = 2 ** z;
  if (
    !Number.isInteger(initialX) ||
    !Number.isInteger(initialY) ||
    initialX < 0 ||
    initialY < 0 ||
    initialX >= size ||
    initialY >= size
  ) {
    throw new RangeError("tile coordinate outside zoom bounds");
  }
  let x = initialX;
  let y = initialY;
  let distance = 0;
  for (let scale = size / 2; scale >= 1; scale /= 2) {
    const rx = (Math.floor(x) & scale) > 0 ? 1 : 0;
    const ry = (Math.floor(y) & scale) > 0 ? 1 : 0;
    distance += scale * scale * ((3 * rx) ^ ry);
    [x, y] = rotate(scale, x, y, rx, ry);
  }
  return (4 ** z - 1) / 3 + distance;
}

function lonToWorldX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToWorldY(lat, zoom) {
  const radians = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom;
}

function tilesForBbox(bbox, zoom) {
  const [west, south, east, north] = bbox;
  const minX = Math.floor(lonToWorldX(west, zoom));
  const maxX = Math.floor(lonToWorldX(east, zoom));
  const minY = Math.floor(latToWorldY(north, zoom));
  const maxY = Math.floor(latToWorldY(south, zoom));
  const tiles = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) tiles.push({ z: zoom, x, y });
  }
  return tiles;
}

function clipSegment(x0, y0, x1, y1, minimum = -256, maximum = 4352) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minimum, maximum - x0, y0 - minimum, maximum - y0];
  let start = 0;
  let end = 1;
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0 && q[index] < 0) return null;
    if (p[index] === 0) continue;
    const ratio = q[index] / p[index];
    if (p[index] < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return null;
  }
  return [
    [Math.round(x0 + start * dx), Math.round(y0 + start * dy)],
    [Math.round(x0 + end * dx), Math.round(y0 + end * dy)],
  ];
}

function roadClass(highway) {
  if (["motorway", "trunk", "primary"].includes(highway)) return "major";
  if (["secondary", "tertiary", "residential", "unclassified"].includes(highway)) {
    return "street";
  }
  return "path";
}

function encodeValue(value) {
  return fieldBytes(1, Buffer.from(value));
}

function encodeFeature(id, classIndex, segments) {
  const geometry = [];
  let cursorX = 0;
  let cursorY = 0;
  for (const [[x0, y0], [x1, y1]] of segments) {
    geometry.push(encodeVarint(9));
    geometry.push(encodeVarint(zigzag(x0 - cursorX)));
    geometry.push(encodeVarint(zigzag(y0 - cursorY)));
    cursorX = x0;
    cursorY = y0;
    geometry.push(encodeVarint(10));
    geometry.push(encodeVarint(zigzag(x1 - cursorX)));
    geometry.push(encodeVarint(zigzag(y1 - cursorY)));
    cursorX = x1;
    cursorY = y1;
  }
  return Buffer.concat([
    fieldVarint(1, id),
    fieldBytes(2, Buffer.concat([encodeVarint(0), encodeVarint(classIndex)])),
    fieldVarint(3, 2),
    fieldBytes(4, Buffer.concat(geometry)),
  ]);
}

export function buildMvtTile(source, tile) {
  const extent = 4096;
  const nodes = new Map(source.nodes.map((node) => [node.id, node]));
  const classes = ["major", "street", "path"];
  const features = [];
  for (const way of source.ways) {
    const segments = [];
    for (let index = 1; index < way.nodes.length; index += 1) {
      const from = nodes.get(way.nodes[index - 1]);
      const to = nodes.get(way.nodes[index]);
      if (!from || !to) continue;
      const x0 = (lonToWorldX(from.lon, tile.z) - tile.x) * extent;
      const y0 = (latToWorldY(from.lat, tile.z) - tile.y) * extent;
      const x1 = (lonToWorldX(to.lon, tile.z) - tile.x) * extent;
      const y1 = (latToWorldY(to.lat, tile.z) - tile.y) * extent;
      const clipped = clipSegment(x0, y0, x1, y1);
      if (clipped && (clipped[0][0] !== clipped[1][0] || clipped[0][1] !== clipped[1][1])) {
        segments.push(clipped);
      }
    }
    if (segments.length > 0) {
      features.push(
        encodeFeature(way.id, classes.indexOf(roadClass(way.tags.highway)), segments),
      );
    }
  }
  const layer = Buffer.concat([
    fieldBytes(1, Buffer.from("roads")),
    ...features.map((feature) => fieldBytes(2, feature)),
    fieldBytes(3, Buffer.from("class")),
    ...classes.map((value) => fieldBytes(4, encodeValue(value))),
    fieldVarint(5, extent),
    fieldVarint(15, 2),
  ]);
  return fieldBytes(3, layer);
}

function encodeDirectory(entries) {
  const parts = [encodeVarint(entries.length)];
  let previousId = 0;
  for (const entry of entries) {
    parts.push(encodeVarint(entry.tileId - previousId));
    previousId = entry.tileId;
  }
  for (const entry of entries) parts.push(encodeVarint(entry.runLength));
  for (const entry of entries) parts.push(encodeVarint(entry.length));
  let previousOffset = 0;
  let previousLength = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const contiguous = index > 0 && entry.offset === previousOffset + previousLength;
    parts.push(encodeVarint(contiguous ? 0 : entry.offset + 1));
    previousOffset = entry.offset;
    previousLength = entry.length;
  }
  return Buffer.concat(parts);
}

function writeUInt64(header, offset, value) {
  header.writeBigUInt64LE(BigInt(value), offset);
}

export function buildPmtiles(source) {
  const tiles = [];
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
    for (const tile of tilesForBbox(FIXTURE_BBOX, zoom)) {
      tiles.push({ ...tile, tileId: zxyToTileId(tile.z, tile.x, tile.y) });
    }
  }
  tiles.sort((a, b) => a.tileId - b.tileId);
  const payloads = tiles.map((tile) => buildMvtTile(source, tile));
  let dataOffset = 0;
  const entries = tiles.map((tile, index) => {
    const entry = {
      tileId: tile.tileId,
      offset: dataOffset,
      length: payloads[index].length,
      runLength: 1,
    };
    dataOffset += entry.length;
    return entry;
  });
  const rootDirectory = encodeDirectory(entries);
  const metadata = Buffer.from(
    JSON.stringify({
      attribution: "© OpenStreetMap contributors (ODbL)",
      description: "Small label-free Sydney CBD walking basemap fixture",
      name: "Sydney CBD offline fixture",
      type: "baselayer",
      vector_layers: [{ id: "roads", fields: { class: "String" }, minzoom: 13, maxzoom: 16 }],
    }),
  );
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header[7] = 3;
  const rootOffset = header.length;
  const metadataOffset = rootOffset + rootDirectory.length;
  const tileDataOffset = metadataOffset + metadata.length;
  writeUInt64(header, 8, rootOffset);
  writeUInt64(header, 16, rootDirectory.length);
  writeUInt64(header, 24, metadataOffset);
  writeUInt64(header, 32, metadata.length);
  writeUInt64(header, 40, tileDataOffset);
  writeUInt64(header, 48, 0);
  writeUInt64(header, 56, tileDataOffset);
  writeUInt64(header, 64, dataOffset);
  writeUInt64(header, 72, entries.length);
  writeUInt64(header, 80, entries.length);
  writeUInt64(header, 88, entries.length);
  header[96] = 1;
  header[97] = 1;
  header[98] = 1;
  header[99] = 1;
  header[100] = MIN_ZOOM;
  header[101] = MAX_ZOOM;
  FIXTURE_BBOX.forEach((coordinate, index) => {
    header.writeInt32LE(Math.round(coordinate * 1e7), 102 + index * 4);
  });
  header[118] = 15;
  header.writeInt32LE(Math.round(((FIXTURE_BBOX[0] + FIXTURE_BBOX[2]) / 2) * 1e7), 119);
  header.writeInt32LE(Math.round(((FIXTURE_BBOX[1] + FIXTURE_BBOX[3]) / 2) * 1e7), 123);
  return Buffer.concat([header, rootDirectory, metadata, ...payloads]);
}

function buildStyle() {
  return {
    version: 8,
    name: "Sydney field notes",
    glyphs: "./glyphs/{fontstack}/{range}.pbf",
    sources: {
      offline: {
        type: "vector",
        url: "pmtiles://map.pmtiles",
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "paper", type: "background", paint: { "background-color": "#1a1d1a" } },
      {
        id: "paths", type: "line", source: "offline", "source-layer": "roads",
        filter: ["==", ["get", "class"], "path"],
        paint: { "line-color": "#7a8a6b", "line-width": 1.3, "line-opacity": 0.8 },
      },
      {
        id: "streets", type: "line", source: "offline", "source-layer": "roads",
        filter: ["==", ["get", "class"], "street"],
        paint: { "line-color": "#e8e2d3", "line-width": 2, "line-opacity": 0.82 },
      },
      {
        id: "major-roads", type: "line", source: "offline", "source-layer": "roads",
        filter: ["==", ["get", "class"], "major"],
        paint: { "line-color": "#c89b6b", "line-width": 2.8, "line-opacity": 0.9 },
      },
    ],
  };
}

function attributionText(source) {
  return `# Sydney fixture attribution

The road data in \`source.osm.json\` is © OpenStreetMap contributors and is
available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

- Geographic extent: Sydney CBD, Australia (\`${source.bbox.join(", ")}\`)
- Snapshot: \`${source.snapshot}\`
- Extract: highway ways and their referenced nodes
- Canonical source: OpenStreetMap, queried through the public Overpass API

The normalized source is checked into the repository. Building the runtime
assets from that file performs no network request. The basemap intentionally
contains no labels, so the local glyph template is never requested by the
style; an empty font range is included to keep all style URLs local.
`;
}

function assetRecord(output, path) {
  const absolute = join(output, path);
  return { path, bytes: statSync(absolute).size, sha256: sha256(absolute) };
}

function haversineMeters(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = radians(from.lat);
  const lat2 = radians(to.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(to.lon - from.lon);
  const halfLat = Math.sin(deltaLat / 2);
  const halfLon = Math.sin(deltaLon / 2);
  const a = halfLat * halfLat + Math.cos(lat1) * Math.cos(lat2) * halfLon * halfLon;
  return Math.max(1, Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
}

function withinBbox(node) {
  return (
    node.lon >= FIXTURE_BBOX[0] && node.lon <= FIXTURE_BBOX[2] &&
    node.lat >= FIXTURE_BBOX[1] && node.lat <= FIXTURE_BBOX[3]
  );
}

export function buildRoutingGraph(source) {
  const excludedHighways = new Set(["construction", "motorway", "motorway_link", "proposed", "raceway"]);
  const nodes = new Map(source.nodes.filter(withinBbox).map((node) => [node.id, node]));
  const rawEdges = [];
  const adjacency = new Map();
  const connect = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  for (const way of source.ways) {
    if (
      excludedHighways.has(way.tags.highway) ||
      ["no", "private"].includes(way.tags.access) ||
      ["no", "private"].includes(way.tags.foot)
    ) continue;
    for (let index = 1; index < way.nodes.length; index += 1) {
      const from = nodes.get(way.nodes[index - 1]);
      const to = nodes.get(way.nodes[index]);
      if (!from || !to || from.id === to.id) continue;
      rawEdges.push([from.id, to.id, haversineMeters(from, to)]);
      connect(from.id, to.id);
      connect(to.id, from.id);
    }
  }
  const visited = new Set();
  let largest = [];
  for (const start of [...adjacency.keys()].sort((a, b) => a - b)) {
    if (visited.has(start)) continue;
    const component = [];
    const queue = [start];
    visited.add(start);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    component.sort((a, b) => a - b);
    if (
      component.length > largest.length ||
      (component.length === largest.length && component[0] < (largest[0] ?? Infinity))
    ) largest = component;
  }
  if (largest.length < 2) throw new Error("walking graph has no connected component");
  const selected = new Set(largest);
  const indexes = new Map(largest.map((id, index) => [id, index]));
  const arcs = new Map();
  for (const [fromId, toId, weight] of rawEdges) {
    if (!selected.has(fromId) || !selected.has(toId)) continue;
    for (const [from, to] of [[indexes.get(fromId), indexes.get(toId)], [indexes.get(toId), indexes.get(fromId)]]) {
      const key = `${from}:${to}`;
      arcs.set(key, Math.min(arcs.get(key) ?? Infinity, weight));
    }
  }
  const sortedArcs = [...arcs.entries()]
    .map(([key, weight]) => {
      const [from, to] = key.split(":").map(Number);
      return { from, to, weight };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to || a.weight - b.weight);
  return {
    nodes: largest.map((id) => {
      const node = nodes.get(id);
      return { lat: node.lat, lng: node.lon };
    }),
    arcs: sortedArcs,
  };
}

export function buildFixture({ root, out, includeExistingRouting = true }) {
  const fixture = join(root, "fixtures/sydney");
  const output = resolve(out);
  mkdirSync(join(output, "glyphs/Offline Sans"), { recursive: true });
  const sourcePath = join(fixture, "source.osm.json");
  if (!existsSync(sourcePath)) throw new Error(`missing canonical source: ${sourcePath}`);
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (resolve(sourcePath) !== resolve(join(output, "source.osm.json"))) {
    copyFileSync(sourcePath, join(output, "source.osm.json"));
  }
  const graph = buildRoutingGraph(source);
  writeFileSync(join(output, "graph.json"), `${JSON.stringify(graph)}\n`);
  writeFileSync(join(output, "map.pmtiles"), buildPmtiles(source));
  writeFileSync(join(output, "style.json"), `${JSON.stringify(buildStyle(), null, 2)}\n`);
  writeFileSync(join(output, "glyphs/Offline Sans/0-255.pbf"), Buffer.alloc(0));
  writeFileSync(join(output, "ATTRIBUTION.md"), attributionText(source));

  const routingPath = join(fixture, "routing.pack");
  if (
    includeExistingRouting && existsSync(routingPath) &&
    resolve(routingPath) !== resolve(join(output, "routing.pack"))
  ) {
    copyFileSync(routingPath, join(output, "routing.pack"));
  }
  const routingReady = existsSync(join(output, "routing.pack"));
  const assetPaths = [
    "source.osm.json", "graph.json", "map.pmtiles", "style.json",
    "glyphs/Offline Sans/0-255.pbf", "ATTRIBUTION.md",
    ...(routingReady ? ["routing.pack"] : []),
  ];
  const manifest = {
    schema_version: 1,
    id: "sydney-cbd-walking-v1",
    bbox: FIXTURE_BBOX,
    source: {
      file: "source.osm.json", snapshot: source.snapshot,
      attribution: "© OpenStreetMap contributors", license: "ODbL-1.0",
    },
    build: { command: "make fixture", deterministic: true, network_required: false },
    routing: {
      status: routingReady ? "ready" : "pending", path: "routing.pack", source: "graph.json",
      builder_contract: "cch-routing-lite build-pack",
      command: "cargo run --release -p cch-routing-lite --bin build-pack -- fixtures/sydney/graph.json fixtures/sydney/routing.pack",
    },
    budget: { max_bytes: MAX_FIXTURE_BYTES },
    assets: assetPaths.map((path) => assetRecord(output, path)),
  };
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function parsePmtilesHeader(bytes) {
  if (bytes.length < 127 || bytes.subarray(0, 7).toString("ascii") !== "PMTiles") {
    throw new Error("invalid PMTiles magic or truncated header");
  }
  if (bytes[7] !== 3) throw new Error(`unsupported PMTiles version ${bytes[7]}`);
  return {
    rootOffset: Number(bytes.readBigUInt64LE(8)), rootLength: Number(bytes.readBigUInt64LE(16)),
    metadataOffset: Number(bytes.readBigUInt64LE(24)), metadataLength: Number(bytes.readBigUInt64LE(32)),
    tileDataOffset: Number(bytes.readBigUInt64LE(56)), tileDataLength: Number(bytes.readBigUInt64LE(64)),
    addressedTiles: Number(bytes.readBigUInt64LE(72)), tileType: bytes[99],
    minZoom: bytes[100], maxZoom: bytes[101],
    bbox: [102, 106, 110, 114].map((offset) => bytes.readInt32LE(offset) / 1e7),
  };
}

export function verifyFixture(fixtureDir) {
  const manifest = JSON.parse(readFileSync(join(fixtureDir, "manifest.json"), "utf8"));
  if (manifest.schema_version !== 1) throw new Error("unsupported manifest schema");
  if (JSON.stringify(manifest.bbox) !== JSON.stringify(FIXTURE_BBOX)) throw new Error("manifest bbox drift");
  let declaredBytes = 0;
  for (const asset of manifest.assets) {
    const path = resolve(fixtureDir, asset.path);
    if (relative(resolve(fixtureDir), path).startsWith("..")) throw new Error("asset escapes fixture");
    if (!existsSync(path)) throw new Error(`missing asset ${asset.path}`);
    if (statSync(path).size !== asset.bytes) throw new Error(`size mismatch ${asset.path}`);
    if (sha256(path) !== asset.sha256) throw new Error(`checksum mismatch ${asset.path}`);
    declaredBytes += asset.bytes;
  }
  if (declaredBytes > manifest.budget.max_bytes || declaredBytes > MAX_FIXTURE_BYTES) {
    throw new Error("fixture exceeds asset budget");
  }
  const source = JSON.parse(readFileSync(join(fixtureDir, "source.osm.json"), "utf8"));
  if (source.nodes.length === 0 || source.ways.length === 0) throw new Error("empty OSM source");
  if (source.license !== "ODbL-1.0") throw new Error("source licence drift");
  if (
    manifest.source.file !== "source.osm.json" ||
    manifest.source.snapshot !== source.snapshot ||
    manifest.source.attribution !== source.attribution ||
    manifest.source.license !== source.license
  ) {
    throw new Error("manifest/source provenance mismatch");
  }
  const style = JSON.parse(readFileSync(join(fixtureDir, "style.json"), "utf8"));
  const assertRelative = (value, field) => {
    if (
      typeof value !== "string" ||
      !value.startsWith("./") ||
      value.startsWith("//") ||
      /^[a-z][a-z0-9+.-]*:/i.test(value)
    ) throw new Error(`${field} must be a local relative URL`);
  };
  assertRelative(style.glyphs, "style.glyphs");
  if (style.sprite) {
    if (typeof style.sprite === "string") assertRelative(style.sprite, "style.sprite");
    else for (const sprite of style.sprite) assertRelative(sprite.url, "style.sprite.url");
  }
  for (const [name, definition] of Object.entries(style.sources ?? {})) {
    if (definition.url !== undefined && definition.url !== "pmtiles://map.pmtiles") {
      throw new Error(`style source ${name} has a remote or unexpected URL`);
    }
    for (const tile of definition.tiles ?? []) assertRelative(tile, `style source ${name} tile`);
  }
  const archive = readFileSync(join(fixtureDir, "map.pmtiles"));
  const header = parsePmtilesHeader(archive);
  if (header.tileType !== 1 || header.minZoom !== MIN_ZOOM || header.maxZoom !== MAX_ZOOM) {
    throw new Error("unexpected PMTiles tile type or zoom range");
  }
  if (JSON.stringify(header.bbox) !== JSON.stringify(FIXTURE_BBOX)) throw new Error("PMTiles bbox drift");
  if (header.addressedTiles === 0) throw new Error("PMTiles has no addressed tiles");
  for (const [offset, length, name] of [
    [header.rootOffset, header.rootLength, "root directory"],
    [header.metadataOffset, header.metadataLength, "metadata"],
    [header.tileDataOffset, header.tileDataLength, "tile data"],
  ]) {
    if (offset < 127 || length < 0 || offset + length > archive.length) {
      throw new Error(`PMTiles ${name} outside archive`);
    }
  }
  JSON.parse(archive.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength).toString("utf8"));
  return { manifest, header, declaredBytes };
}
