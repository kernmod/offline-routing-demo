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
import { inflateSync } from "node:zlib";

export const FIXTURE_BBOX = [151.204, -33.873, 151.217, -33.862];
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 16;
export const MAX_FIXTURE_BYTES = 8_500_000;

const ROAD_TAGS = new Set([
  "access", "bridge", "foot", "highway", "oneway", "surface", "tunnel",
]);
const BUILDING_TAGS = new Set([
  "building", "building:part", "building:levels", "building:min_level", "height", "min_height",
]);
const LANDUSE_KEYS = new Set(["amenity", "landuse", "leisure", "natural", "tourism"]);
const LANDUSE_VALUES = new Set([
  "campus", "garden", "grass", "greenfield", "park", "pedestrian", "pitch", "plaza",
  "recreation_ground", "reserve", "retail", "school", "sports_centre", "university",
]);

export function normalizeOverpass(raw, snapshot) {
  if (!raw || !Array.isArray(raw.elements)) throw new TypeError("invalid Overpass response");
  if (typeof snapshot !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(snapshot)) {
    throw new TypeError("invalid Overpass snapshot timestamp");
  }
  const ways = raw.elements
    .filter((element) => element.type === "way")
    .map(({ id, nodes: wayNodes, tags = {} }) => normalizeWay({ id, nodes: wayNodes, tags }))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
  const nodeIds = new Set(ways.flatMap((way) => way.nodes));
  const nodes = raw.elements
    .filter((element) => element.type === "node" && nodeIds.has(element.id))
    .map(({ id, lat, lon }) => ({ id, lat, lon }))
    .sort((a, b) => a.id - b.id);
  return {
    schema_version: 3,
    snapshot,
    bbox: FIXTURE_BBOX,
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    nodes,
    ways,
  };
}

function isClosedWay(nodes) {
  return Array.isArray(nodes) && nodes.length >= 4 && nodes[0] === nodes[nodes.length - 1];
}

function keepTags(tags, allowed) {
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([key]) => allowed.has(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function parseMeters(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(",", ".");
  const feet = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')$/);
  if (feet) return Number(feet[1]) * 0.3048;
  const meters = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:m|meter|metre|meters|metres)?$/);
  return meters ? Number(meters[1]) : null;
}

function parseLevels(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.trim().replace(",", ".").match(/^(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

function boundedMeters(value, fallback, { min = 0, max = 160 } = {}) {
  const next = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(next)));
}

function deriveRenderHeight(tags) {
  const explicit = parseMeters(tags.height);
  const levels = parseLevels(tags["building:levels"]);
  return boundedMeters(explicit ?? (levels ? levels * 3 : null), 10, { min: 3, max: 160 });
}

function deriveRenderMinHeight(tags) {
  const explicit = parseMeters(tags.min_height);
  const levels = parseLevels(tags["building:min_level"]);
  const height = deriveRenderHeight(tags);
  const base = boundedMeters(explicit ?? (levels ? levels * 3 : null), 0, { min: 0, max: 80 });
  return Math.min(base, height - 1);
}

function normalizeWay({ id, nodes, tags }) {
  if (!Number.isInteger(id) || !Array.isArray(nodes)) return null;
  if (tags.highway) {
    return { id, kind: "road", nodes, tags: keepTags(tags, ROAD_TAGS) };
  }
  if (isClosedWay(nodes) && (tags.building || tags["building:part"])) {
    return {
      id,
      kind: "building",
      nodes,
      tags: {
        ...keepTags(tags, BUILDING_TAGS),
        render_height: deriveRenderHeight(tags),
        render_min_height: deriveRenderMinHeight(tags),
      },
    };
  }
  if (isClosedWay(nodes) && (tags.natural === "water" || tags.water || tags.waterway === "riverbank")) {
    return { id, kind: "water", nodes, tags: { class: "water" } };
  }
  if (isClosedWay(nodes)) {
    if (tags.landuse) return { id, kind: "landuse", nodes, tags: { class: String(tags.landuse) } };
    const landuse = Object.entries(tags).find(([key, value]) => (
      LANDUSE_KEYS.has(key) && LANDUSE_VALUES.has(String(value))
    ));
    if (landuse) return { id, kind: "landuse", nodes, tags: { class: String(landuse[1]) } };
  }
  return null;
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

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Decode the pinned 8-bit RGB/RGBA Terrarium PNGs without a native image dependency. */
export function decodeTerrariumPng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < signature.length || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error("invalid Terrarium PNG signature");
  }
  let cursor = 8;
  let header = null;
  const compressed = [];
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    const type = bytes.subarray(cursor + 4, cursor + 8).toString("ascii");
    const start = cursor + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error("truncated Terrarium PNG chunk");
    if (type === "IHDR") {
      header = {
        width: bytes.readUInt32BE(start),
        height: bytes.readUInt32BE(start + 4),
        bitDepth: bytes[start + 8],
        colorType: bytes[start + 9],
        compression: bytes[start + 10],
        filter: bytes[start + 11],
        interlace: bytes[start + 12],
      };
    } else if (type === "IDAT") compressed.push(bytes.subarray(start, end));
    cursor = end + 4;
    if (type === "IEND") break;
  }
  if (!header || compressed.length === 0) throw new Error("Terrarium PNG has no image data");
  if (
    header.bitDepth !== 8 || ![2, 6].includes(header.colorType) ||
    header.compression !== 0 || header.filter !== 0 || header.interlace !== 0
  ) {
    throw new Error("unsupported Terrarium PNG encoding");
  }
  const channels = header.colorType === 2 ? 3 : 4;
  const stride = header.width * channels;
  const filtered = inflateSync(Buffer.concat(compressed));
  if (filtered.length !== (stride + 1) * header.height) {
    throw new Error("Terrarium PNG raster length mismatch");
  }
  const pixels = Buffer.alloc(stride * header.height);
  for (let row = 0; row < header.height; row += 1) {
    const filterType = filtered[row * (stride + 1)];
    if (filterType > 4) throw new Error("unsupported Terrarium PNG row filter");
    const inputOffset = row * (stride + 1) + 1;
    const outputOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = filtered[inputOffset + column];
      const left = column >= channels ? pixels[outputOffset + column - channels] : 0;
      const above = row > 0 ? pixels[outputOffset + column - stride] : 0;
      const upperLeft = row > 0 && column >= channels
        ? pixels[outputOffset + column - stride - channels]
        : 0;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paethPredictor(left, above, upperLeft)][filterType];
      pixels[outputOffset + column] = (raw + predictor) & 0xff;
    }
  }
  return { ...header, channels, pixels };
}

function terrariumPixel(tile, x, y) {
  if (x < 0 || y < 0 || x >= tile.width || y >= tile.height) {
    throw new Error("Terrarium pixel outside tile");
  }
  const index = (y * tile.width + x) * tile.channels;
  if (tile.channels === 4 && tile.pixels[index + 3] === 0) throw new Error("Terrarium no-data pixel");
  const value = tile.pixels[index] * 256 + tile.pixels[index + 1] + tile.pixels[index + 2] / 256 - 32768;
  if (!Number.isFinite(value) || value <= -32768) throw new Error("Terrarium no-data elevation");
  return value;
}

export function loadTerrariumDem(directory) {
  const sourcePath = join(directory, "source.json");
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (source.encoding !== "terrarium" || source.tileSize !== 256 || !Number.isInteger(source.zoom)) {
    throw new Error("unsupported DEM source contract");
  }
  const tiles = new Map();
  for (const descriptor of source.tiles) {
    const path = join(directory, descriptor.path);
    if (!existsSync(path) || statSync(path).size !== descriptor.bytes || sha256(path) !== descriptor.sha256) {
      throw new Error(`DEM tile integrity mismatch ${descriptor.x}/${descriptor.y}`);
    }
    const decoded = decodeTerrariumPng(readFileSync(path));
    if (decoded.width !== source.tileSize || decoded.height !== source.tileSize) {
      throw new Error(`DEM tile dimensions mismatch ${descriptor.x}/${descriptor.y}`);
    }
    tiles.set(`${source.zoom}/${descriptor.x}/${descriptor.y}`, decoded);
  }
  return { source, tiles, sample: (point) => sampleTerrariumElevation({ source, tiles }, point) };
}

export function sampleTerrariumElevation(dem, point) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) throw new TypeError("invalid DEM coordinate");
  const size = dem.source.tileSize;
  const globalX = lonToWorldX(point.lng, dem.source.zoom) * size;
  const globalY = latToWorldY(point.lat, dem.source.zoom) * size;
  const minX = Math.floor(globalX);
  const minY = Math.floor(globalY);
  const fractionX = globalX - minX;
  const fractionY = globalY - minY;
  const read = (pixelX, pixelY) => {
    const tileX = Math.floor(pixelX / size);
    const tileY = Math.floor(pixelY / size);
    const tile = dem.tiles.get(`${dem.source.zoom}/${tileX}/${tileY}`);
    if (!tile) throw new Error(`DEM coverage missing at ${tileX}/${tileY}`);
    const localX = ((pixelX % size) + size) % size;
    const localY = ((pixelY % size) + size) % size;
    return terrariumPixel(tile, localX, localY);
  };
  const northWest = read(minX, minY);
  const northEast = read(minX + 1, minY);
  const southWest = read(minX, minY + 1);
  const southEast = read(minX + 1, minY + 1);
  const north = northWest + (northEast - northWest) * fractionX;
  const south = southWest + (southEast - southWest) * fractionX;
  return north + (south - north) * fractionY;
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
  if (typeof value === "string") return fieldBytes(1, Buffer.from(value));
  if (Number.isInteger(value) && value >= 0) return fieldVarint(4, value);
  throw new TypeError(`unsupported MVT property value ${String(value)}`);
}

function encodeLineGeometry(segments) {
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
  return Buffer.concat(geometry);
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function clipPolygonBoundary(points, inside, intersect) {
  if (points.length === 0) return points;
  const result = [];
  let previous = points[points.length - 1];
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) result.push(intersect(previous, current));
    if (currentInside) result.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return result;
}

function clipPolygon(points, minimum = -256, maximum = 4352) {
  const vertical = (boundary) => (from, to) => {
    const ratio = (boundary - from[0]) / (to[0] - from[0]);
    return [boundary, from[1] + ratio * (to[1] - from[1])];
  };
  const horizontal = (boundary) => (from, to) => {
    const ratio = (boundary - from[1]) / (to[1] - from[1]);
    return [from[0] + ratio * (to[0] - from[0]), boundary];
  };
  let clipped = points;
  clipped = clipPolygonBoundary(clipped, ([x]) => x >= minimum, vertical(minimum));
  clipped = clipPolygonBoundary(clipped, ([x]) => x <= maximum, vertical(maximum));
  clipped = clipPolygonBoundary(clipped, ([, y]) => y >= minimum, horizontal(minimum));
  clipped = clipPolygonBoundary(clipped, ([, y]) => y <= maximum, horizontal(maximum));
  const rounded = clipped.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const deduplicated = rounded.filter((point, index) => (
    index === 0 || point[0] !== rounded[index - 1][0] || point[1] !== rounded[index - 1][1]
  ));
  if (
    deduplicated.length > 1 &&
    deduplicated[0][0] === deduplicated[deduplicated.length - 1][0] &&
    deduplicated[0][1] === deduplicated[deduplicated.length - 1][1]
  ) deduplicated.pop();
  if (deduplicated.length < 3 || signedArea(deduplicated) === 0) return [];
  // MVT exterior rings are clockwise in screen coordinates (positive y points down).
  return signedArea(deduplicated) > 0 ? deduplicated : deduplicated.reverse();
}

function encodePolygonGeometry(ring) {
  const geometry = [
    encodeVarint(9),
    encodeVarint(zigzag(ring[0][0])),
    encodeVarint(zigzag(ring[0][1])),
  ];
  let cursorX = ring[0][0];
  let cursorY = ring[0][1];
  geometry.push(encodeVarint(((ring.length - 1) << 3) | 2));
  for (let index = 1; index < ring.length; index += 1) {
    geometry.push(encodeVarint(zigzag(ring[index][0] - cursorX)));
    geometry.push(encodeVarint(zigzag(ring[index][1] - cursorY)));
    cursorX = ring[index][0];
    cursorY = ring[index][1];
  }
  geometry.push(encodeVarint(15));
  return Buffer.concat(geometry);
}

function encodeFeature({ id, type, geometry, tags }) {
  return Buffer.concat([
    fieldVarint(1, id),
    ...(tags.length > 0 ? [fieldBytes(2, Buffer.concat(tags.map(encodeVarint)))] : []),
    fieldVarint(3, type),
    fieldBytes(4, geometry),
  ]);
}

function encodeLayer(name, keys, rawFeatures, extent) {
  const values = [];
  const valueIndexes = new Map();
  const features = rawFeatures.map((feature) => {
    const tags = [];
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const value = feature.properties[keys[keyIndex]];
      if (value === undefined) continue;
      const identity = `${typeof value}:${String(value)}`;
      if (!valueIndexes.has(identity)) {
        valueIndexes.set(identity, values.length);
        values.push(value);
      }
      tags.push(keyIndex, valueIndexes.get(identity));
    }
    return encodeFeature({ ...feature, tags });
  });
  const layer = Buffer.concat([
    fieldBytes(1, Buffer.from(name)),
    ...features.map((feature) => fieldBytes(2, feature)),
    ...keys.map((key) => fieldBytes(3, Buffer.from(key))),
    ...values.map((value) => fieldBytes(4, encodeValue(value))),
    fieldVarint(5, extent),
    fieldVarint(15, 2),
  ]);
  return fieldBytes(3, layer);
}

export function buildMvtTile(source, tile) {
  const extent = 4096;
  const nodes = new Map(source.nodes.map((node) => [node.id, node]));
  const roadFeatures = [];
  const polygonFeatures = { buildings: [], water: [], landuse: [] };
  for (const way of source.ways) {
    const kind = way.kind ?? (way.tags.highway ? "road" : null);
    if (kind !== "road") {
      const layerName = kind === "building" ? "buildings" : kind;
      if (!(layerName in polygonFeatures)) continue;
      const projected = way.nodes
        .map((nodeId) => nodes.get(nodeId))
        .filter(Boolean)
        .map((node) => [
          (lonToWorldX(node.lon, tile.z) - tile.x) * extent,
          (latToWorldY(node.lat, tile.z) - tile.y) * extent,
        ]);
      if (
        projected.length > 1 &&
        projected[0][0] === projected[projected.length - 1][0] &&
        projected[0][1] === projected[projected.length - 1][1]
      ) projected.pop();
      const ring = clipPolygon(projected);
      if (ring.length === 0) continue;
      polygonFeatures[layerName].push({
        id: way.id,
        type: 3,
        geometry: encodePolygonGeometry(ring),
        properties: layerName === "buildings"
          ? { render_height: way.tags.render_height, render_min_height: way.tags.render_min_height }
          : { class: way.tags.class },
      });
      continue;
    }
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
      roadFeatures.push({
        id: way.id,
        type: 2,
        geometry: encodeLineGeometry(segments),
        properties: { class: roadClass(way.tags.highway) },
      });
    }
  }
  return Buffer.concat([
    encodeLayer("landuse", ["class"], polygonFeatures.landuse, extent),
    encodeLayer("water", ["class"], polygonFeatures.water, extent),
    encodeLayer("roads", ["class"], roadFeatures, extent),
    encodeLayer("buildings", ["render_height", "render_min_height"], polygonFeatures.buildings, extent),
  ]);
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
      description: "Small label-free Sydney CBD multi-layer cartography fixture",
      name: "Sydney CBD offline fixture",
      type: "baselayer",
      vector_layers: [
        { id: "roads", fields: { class: "String" }, minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM },
        {
          id: "buildings",
          fields: { render_height: "Number", render_min_height: "Number" },
          minzoom: MIN_ZOOM,
          maxzoom: MAX_ZOOM,
        },
        { id: "water", fields: { class: "String" }, minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM },
        { id: "landuse", fields: { class: "String" }, minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM },
      ],
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
        id: "landuse", type: "fill", source: "offline", "source-layer": "landuse",
        paint: { "fill-color": "#465044", "fill-opacity": 0.62, "fill-outline-color": "#66725d" },
      },
      {
        id: "water", type: "fill", source: "offline", "source-layer": "water",
        paint: { "fill-color": "#526d73", "fill-opacity": 0.86, "fill-outline-color": "#789096" },
      },
      {
        id: "building-footprints", type: "fill", source: "offline", "source-layer": "buildings",
        paint: { "fill-color": "#86735f", "fill-opacity": 0.38, "fill-outline-color": "#aa9274" },
      },
      {
        id: "buildings-3d", type: "fill-extrusion", source: "offline", "source-layer": "buildings",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#9b8267",
          "fill-extrusion-height": ["get", "render_height"],
          "fill-extrusion-base": ["get", "render_min_height"],
          "fill-extrusion-opacity": 0.82,
          "fill-extrusion-vertical-gradient": true,
        },
      },
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

function attributionText(source, demSource) {
  return `# Sydney fixture attribution

The road and cartographic polygon data in \`source.osm.json\` is © OpenStreetMap contributors and is
available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

- Geographic extent: Sydney CBD, Australia (\`${source.bbox.join(", ")}\`)
- Snapshot: \`${source.snapshot}\`
- Extract: highway ways plus closed building, water and selected land-use ways, with their referenced nodes
- Canonical source: OpenStreetMap, queried through the public Overpass API

The normalized source is checked into the repository. Building the runtime
assets from that file performs no network request. The basemap intentionally
contains no labels, so the local glyph template is never requested by the
style; an empty font range is included to keep all style URLs local.

This bounded fixture deliberately supports closed OSM ways only. Relation-based
multipolygons and holes are outside its public demo scope; they are neither
silently flattened nor imported. Building extrusion heights are derived from
public \`height\`, \`building:levels\`, \`min_height\` and
\`building:min_level\` tags, then bounded to conservative display values.

## Elevation

Elevation is derived from the public **Terrain Tiles** dataset managed by
Mapzen/Tilezen and distributed through the AWS Open Data bucket
\`elevation-tiles-prod\`. The six checked-in zoom-15 PNGs use the documented
Terrarium encoding. Their URLs, byte sizes and SHA-256 digests are pinned in
\`dem/source.json\`, so the regular fixture build makes no network request.

${demSource.attribution}.

The Australian elevation component is published under
[${demSource.license}](${demSource.licenseUrl}). Product metadata and the
recommended citation are pinned in \`dem/source.json\`; the Tilezen composite
attribution remains mandatory.

The upstream mosaic combines public terrain sources and does not expose one
survey-grade vertical datum for every output pixel. This demo therefore labels
the profile as derived terrain elevation and does not use it to alter routing
costs. See the [Terrarium format](${demSource.formatDocumentation}) and
[upstream attribution requirements](${demSource.attributionDocumentation}).
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

export function buildRoutingGraph(source, dem) {
  if (!dem || typeof dem.sample !== "function") throw new Error("routing graph requires a DEM sampler");
  const excludedHighways = new Set(["construction", "motorway", "motorway_link", "proposed", "raceway"]);
  const nodes = new Map(source.nodes.filter(withinBbox).map((node) => [node.id, node]));
  const rawEdges = [];
  const adjacency = new Map();
  const connect = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  for (const way of source.ways) {
    if (!way.tags.highway || (way.kind && way.kind !== "road")) continue;
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
      const elevationM = Math.round(dem.sample({ lat: node.lat, lng: node.lon }));
      if (!Number.isInteger(elevationM)) throw new Error(`missing elevation for OSM node ${id}`);
      return { lat: node.lat, lng: node.lon, elevationM };
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
  const demRoot = join(fixture, "dem");
  const dem = loadTerrariumDem(demRoot);
  if (resolve(demRoot) !== resolve(join(output, "dem"))) {
    mkdirSync(join(output, "dem/tiles"), { recursive: true });
    copyFileSync(join(demRoot, "source.json"), join(output, "dem/source.json"));
    for (const tile of dem.source.tiles) {
      copyFileSync(join(demRoot, tile.path), join(output, "dem", tile.path));
    }
  }
  const graph = buildRoutingGraph(source, dem);
  writeFileSync(join(output, "graph.json"), `${JSON.stringify(graph)}\n`);
  writeFileSync(join(output, "map.pmtiles"), buildPmtiles(source));
  writeFileSync(join(output, "style.json"), `${JSON.stringify(buildStyle(), null, 2)}\n`);
  writeFileSync(join(output, "glyphs/Offline Sans/0-255.pbf"), Buffer.alloc(0));
  writeFileSync(join(output, "ATTRIBUTION.md"), attributionText(source, dem.source));

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
    "dem/source.json", ...dem.source.tiles.map((tile) => `dem/${tile.path}`),
    ...(routingReady ? ["routing.pack"] : []),
  ];
  const manifest = {
    schema_version: 2,
    id: "sydney-cbd-cartography-v3",
    bbox: FIXTURE_BBOX,
    source: {
      file: "source.osm.json", snapshot: source.snapshot,
      attribution: "© OpenStreetMap contributors", license: "ODbL-1.0",
    },
    build: { command: "make fixture", deterministic: true, network_required: false },
    cartography: {
      layers: ["roads", "buildings", "water", "landuse"],
      geometry: "closed OSM ways",
      excluded_geometry: ["relation multipolygons", "polygon holes"],
      labels: false,
      building_heights: "bounded values derived from public OSM tags",
    },
    routing: {
      status: routingReady ? "ready" : "pending", path: "routing.pack", source: "graph.json",
      builder_contract: "cch-routing-lite build-pack",
      pack_schema: "CCHP2",
      command: "cargo run --release -p cch-routing-lite --bin build-pack -- fixtures/sydney/graph.json fixtures/sydney/routing.pack",
    },
    elevation: {
      provider: dem.source.provider,
      encoding: dem.source.encoding,
      zoom: dem.source.zoom,
      attribution: dem.source.attribution,
      license: dem.source.license,
      license_url: dem.source.licenseUrl,
      vertical_datum: dem.source.verticalDatum,
      covered_nodes: graph.nodes.length,
      min_m: Math.min(...graph.nodes.map((node) => node.elevationM)),
      max_m: Math.max(...graph.nodes.map((node) => node.elevationM)),
    },
    budget: {
      max_bytes: MAX_FIXTURE_BYTES,
      reason: "Bounded 8.5 MB allowance for a public multi-layer 3D cartography fixture, routing pack and DEM evidence",
    },
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
  if (manifest.schema_version !== 2) throw new Error("unsupported manifest schema");
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
  const dem = loadTerrariumDem(join(fixtureDir, "dem"));
  if (
    manifest.elevation.provider !== dem.source.provider ||
    manifest.elevation.encoding !== dem.source.encoding ||
    manifest.elevation.zoom !== dem.source.zoom ||
    manifest.elevation.attribution !== dem.source.attribution ||
    manifest.elevation.license !== dem.source.license ||
    manifest.elevation.license_url !== dem.source.licenseUrl ||
    manifest.elevation.vertical_datum !== dem.source.verticalDatum
  ) throw new Error("manifest/DEM provenance mismatch");
  const graph = JSON.parse(readFileSync(join(fixtureDir, "graph.json"), "utf8"));
  if (graph.nodes.length !== manifest.elevation.covered_nodes) throw new Error("DEM node coverage mismatch");
  if (graph.nodes.some((node) => !Number.isInteger(node.elevationM))) throw new Error("graph node elevation missing");
  const elevations = graph.nodes.map((node) => node.elevationM);
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  if (
    manifest.elevation.min_m !== minElevation ||
    manifest.elevation.max_m !== maxElevation
  ) {
    throw new Error("manifest elevation range mismatch");
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
  const metadata = JSON.parse(
    archive.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength).toString("utf8"),
  );
  const layers = (metadata.vector_layers ?? []).map((layer) => layer.id);
  if (JSON.stringify([...layers].sort()) !== JSON.stringify(["buildings", "landuse", "roads", "water"])) {
    throw new Error("PMTiles layer contract drift");
  }
  return { manifest, header, declaredBytes, layers };
}
