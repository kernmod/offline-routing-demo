const WEB_MERCATOR_MAX_LAT = 85.05112878;

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

export function validatePoint(point, label = "point") {
  if (typeof point !== "object" || point === null) {
    throw new TypeError(`${label} must be an object`);
  }

  const { lat, lng } = point;
  assertFiniteNumber(lat, `${label}.lat`);
  assertFiniteNumber(lng, `${label}.lng`);

  if (lat < -WEB_MERCATOR_MAX_LAT || lat > WEB_MERCATOR_MAX_LAT) {
    throw new RangeError(`${label}.lat must be within Web Mercator bounds`);
  }

  if (lng < -180 || lng > 180) {
    throw new RangeError(`${label}.lng must be within [-180, 180]`);
  }

  return { lat, lng };
}
