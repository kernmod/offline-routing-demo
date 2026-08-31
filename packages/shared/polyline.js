import { validatePoint } from "./point.js";

function encodeCoordinate(value) {
  let current = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (current >= 0x20) {
    output += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
    current >>= 5;
  }
  output += String.fromCharCode(current + 63);
  return output;
}

export function encodePolyline6(points) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new TypeError("points must be a non-empty array");
  }

  let previousLat = 0;
  let previousLng = 0;
  let encoded = "";

  for (const [index, point] of points.entries()) {
    const { lat, lng } = validatePoint(point, `points[${index}]`);
    const nextLat = Math.round(lat * 1e6);
    const nextLng = Math.round(lng * 1e6);
    encoded += encodeCoordinate(nextLat - previousLat);
    encoded += encodeCoordinate(nextLng - previousLng);
    previousLat = nextLat;
    previousLng = nextLng;
  }

  return encoded;
}

export function decodePolyline6(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new TypeError("encoded polyline must be a non-empty string");
  }

  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const decodeCoordinate = () => {
    let shift = 0;
    let result = 0;

    while (true) {
      if (index >= encoded.length) throw new TypeError("encoded polyline is truncated");
      const byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }

    return (result & 1) === 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += decodeCoordinate();
    lng += decodeCoordinate();
    points.push(validatePoint({ lat: lat / 1e6, lng: lng / 1e6 }, `points[${points.length}]`));
  }

  return points;
}
