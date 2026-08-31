import { validateBbox } from "./bbox.js";
import { validatePoint } from "./point.js";

const DEFAULT_ZOOM = 14;
const GRID_EPSILON = 1e-9;

export function tileKey(zoom, x, y) {
  if (!Number.isInteger(zoom) || zoom < 0) throw new TypeError("zoom must be a non-negative integer");
  if (!Number.isInteger(x) || x < 0) throw new TypeError("x must be a non-negative integer");
  if (!Number.isInteger(y) || y < 0) throw new TypeError("y must be a non-negative integer");
  return `${zoom}/${x}/${y}`;
}

export function lonLatToTilePoint(point, zoom = DEFAULT_ZOOM) {
  const { lat, lng } = validatePoint(point);
  const scale = 2 ** zoom;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y =
    (0.5 -
      Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
    scale;
  return { x, y };
}

function clampTileIndex(value, zoom) {
  const maxIndex = 2 ** zoom - 1;
  return Math.min(maxIndex, Math.max(0, value));
}

function isGridBoundary(value) {
  return Math.abs(value - Math.round(value)) <= GRID_EPSILON;
}

function segmentIntersectsClosedTile(start, end, tileX, tileY) {
  const minX = tileX;
  const maxX = tileX + 1;
  const minY = tileY;
  const maxY = tileY + 1;

  let t0 = 0;
  let t1 = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return false;
      if (ratio > t0) t0 = ratio;
      return true;
    }
    if (ratio < t0) return false;
    if (ratio < t1) t1 = ratio;
    return true;
  };

  return (
    clip(-dx, start.x - minX) &&
    clip(dx, maxX - start.x) &&
    clip(-dy, start.y - minY) &&
    clip(dy, maxY - start.y) &&
    t0 <= t1
  );
}

export function segmentCells(points, zoom = DEFAULT_ZOOM) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError("points must contain at least two points");
  }

  const cells = new Set();
  const tilePoints = points.map((point, index) =>
    lonLatToTilePoint(validatePoint(point, `points[${index}]`), zoom)
  );

  for (let index = 0; index < tilePoints.length - 1; index += 1) {
    const start = tilePoints[index];
    const end = tilePoints[index + 1];
    const rawMinX = Math.min(start.x, end.x);
    const rawMaxX = Math.max(start.x, end.x);
    const rawMinY = Math.min(start.y, end.y);
    const rawMaxY = Math.max(start.y, end.y);
    const minX = Math.floor(rawMinX) - (isGridBoundary(rawMinX) ? 1 : 0);
    const maxX = Math.floor(rawMaxX);
    const minY = Math.floor(rawMinY) - (isGridBoundary(rawMinY) ? 1 : 0);
    const maxY = Math.floor(rawMaxY);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const tileX = clampTileIndex(x, zoom);
        const tileY = clampTileIndex(y, zoom);
        if (segmentIntersectsClosedTile(start, end, tileX, tileY)) {
          cells.add(tileKey(zoom, tileX, tileY));
        }
      }
    }
  }

  return [...cells].sort();
}

export function bboxCells(bbox, zoom = DEFAULT_ZOOM) {
  const normalized = validateBbox(bbox);
  const northWest = lonLatToTilePoint({ lat: normalized.maxLat, lng: normalized.minLng }, zoom);
  const southEast = lonLatToTilePoint({ lat: normalized.minLat, lng: normalized.maxLng }, zoom);
  const minX = clampTileIndex(Math.floor(Math.min(northWest.x, southEast.x)), zoom);
  const maxX = clampTileIndex(Math.floor(Math.max(northWest.x, southEast.x)), zoom);
  const minY = clampTileIndex(Math.floor(Math.min(northWest.y, southEast.y)), zoom);
  const maxY = clampTileIndex(Math.floor(Math.max(northWest.y, southEast.y)), zoom);
  const cells = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      cells.push(tileKey(zoom, x, y));
    }
  }

  return cells;
}
