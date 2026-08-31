import { bboxFromPoints } from "./bbox.js";
import { validatePoint } from "./point.js";

const EARTH_RADIUS_M = 6_378_137;

export function routeMetrics(points) {
  const validated = points.map((point, index) => validatePoint(point, `points[${index}]`));
  const bbox = bboxFromPoints(validated);
  let distanceM = 0;

  for (let index = 0; index < validated.length - 1; index += 1) {
    const from = validated[index];
    const to = validated[index + 1];
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    distanceM += 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
  }

  return {
    bbox,
    pointCount: validated.length,
    distanceM: Math.round(distanceM)
  };
}
