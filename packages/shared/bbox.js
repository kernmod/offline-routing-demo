import { validatePoint } from "./point.js";

export function bboxFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new TypeError("points must be a non-empty array");
  }

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const [index, point] of points.entries()) {
    const validated = validatePoint(point, `points[${index}]`);
    minLat = Math.min(minLat, validated.lat);
    minLng = Math.min(minLng, validated.lng);
    maxLat = Math.max(maxLat, validated.lat);
    maxLng = Math.max(maxLng, validated.lng);
  }

  return { minLat, minLng, maxLat, maxLng };
}

export function validateBbox(bbox, label = "bbox") {
  if (typeof bbox !== "object" || bbox === null) {
    throw new TypeError(`${label} must be an object`);
  }

  const normalized = {
    minLat: Number(bbox.minLat),
    minLng: Number(bbox.minLng),
    maxLat: Number(bbox.maxLat),
    maxLng: Number(bbox.maxLng)
  };

  validatePoint({ lat: normalized.minLat, lng: normalized.minLng }, `${label}.min`);
  validatePoint({ lat: normalized.maxLat, lng: normalized.maxLng }, `${label}.max`);

  if (normalized.minLat > normalized.maxLat || normalized.minLng > normalized.maxLng) {
    throw new RangeError(`${label} minimums must be <= maximums`);
  }

  return normalized;
}
