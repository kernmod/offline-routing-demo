const coordinatePattern = /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,3}(?:\.\d{1,6})?$/;

function parseCoordinate(value: string | null) {
  if (!value || !coordinatePattern.test(value)) {
    return null;
  }
  const [latText, lngText] = value.split(",");
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

export function parseRouteUrl(url: string): { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "offlineroutingdemo:" || parsed.hostname !== "route") {
    return null;
  }
  const origin = parseCoordinate(parsed.searchParams.get("origin"));
  const destination = parseCoordinate(parsed.searchParams.get("destination"));
  if (!origin || !destination) {
    return null;
  }
  return { origin, destination };
}

export function routeUrl(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  const originText = `${origin.lat},${origin.lng}`;
  const destinationText = `${destination.lat},${destination.lng}`;
  if (!parseCoordinate(originText) || !parseCoordinate(destinationText)) {
    throw new Error("invalid_route_coordinates");
  }
  return `offlineroutingdemo://route?origin=${encodeURIComponent(originText)}&destination=${encodeURIComponent(destinationText)}`;
}
