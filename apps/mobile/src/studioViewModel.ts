export type ElevationPoint = { lat: number; lng: number; elevationM: number };
export type ProfilePoint = ElevationPoint & { distanceM: number };
export type TrimHandle = "start" | "end";
export type TrimSelection = { startM: number; endM: number };

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function lineFeature(geometry: ElevationPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: geometry.length < 2 ? [] : [{
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: geometry.map((point) => [point.lng, point.lat, point.elevationM]) }
    }]
  };
}

export function pointFeature(points: ElevationPoint[], kind: string) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point, index) => ({
      type: "Feature" as const,
      id: index,
      properties: { kind, index },
      geometry: { type: "Point" as const, coordinates: [point.lng, point.lat, point.elevationM] }
    }))
  };
}

export function profilePath(
  profile: readonly ProfilePoint[],
  width = 600,
  top = 10,
  bottom = 132
): string {
  if (profile.length < 2) return "";
  const total = Math.max(1, finiteOr(profile.at(-1)?.distanceM ?? 0, 0));
  const elevations = profile.map((point) => finiteOr(point.elevationM, 0));
  const minimum = Math.min(...elevations);
  const span = Math.max(1, Math.max(...elevations) - minimum);
  return profile.map((point, index) => {
    const x = clamp(finiteOr(point.distanceM, 0) / total, 0, 1) * width;
    const y = bottom - ((finiteOr(point.elevationM, minimum) - minimum) / span) * (bottom - top);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function stepTrimRange(totalDistanceM: number, selection: { startM: number; endM: number } | null, handle: "start" | "end", direction: number) {
  if (totalDistanceM <= 0) return { startM: 0, endM: 0 };
  const step = Math.max(1, totalDistanceM * 0.05) * Math.sign(direction);
  const current = selection ?? { startM: 0, endM: totalDistanceM };
  if (handle === "start") {
    return { startM: Math.min(Math.max(0, current.startM + step), current.endM - Math.min(1, totalDistanceM)), endM: current.endM };
  }
  return { startM: current.startM, endM: Math.max(Math.min(totalDistanceM, current.endM + step), current.startM + Math.min(1, totalDistanceM)) };
}

export function xToProfileDistance(locationX: number, width: number, totalDistanceM: number): number {
  const safeTotal = Math.max(0, finiteOr(totalDistanceM, 0));
  const safeWidth = finiteOr(width, 0);
  if (safeTotal <= 0 || safeWidth <= 0) return 0;
  return clamp(finiteOr(locationX, 0) / safeWidth, 0, 1) * safeTotal;
}

export function selectionFromProfileGesture(
  totalDistanceM: number,
  selection: TrimSelection | null,
  handle: TrimHandle,
  distanceM: number
): TrimSelection {
  const total = Math.max(0, finiteOr(totalDistanceM, 0));
  if (total <= 0) return { startM: 0, endM: 0 };
  const minimumSpan = Math.min(1, total);
  const current = selection ?? { startM: 0, endM: total };
  const distance = clamp(finiteOr(distanceM, 0), 0, total);
  if (handle === "start") {
    return { startM: clamp(distance, 0, current.endM - minimumSpan), endM: current.endM };
  }
  return { startM: current.startM, endM: clamp(distance, current.startM + minimumSpan, total) };
}

export function profileRangeViewModel(totalDistanceM: number, selection: TrimSelection | null, cursorDistanceM: number | null) {
  const total = Math.max(0, finiteOr(totalDistanceM, 0));
  const current = total > 0 ? selection ?? { startM: 0, endM: total } : { startM: 0, endM: 0 };
  const startPct = total > 0 ? (clamp(current.startM, 0, total) / total) * 100 : 0;
  const endPct = total > 0 ? (clamp(current.endM, 0, total) / total) * 100 : 100;
  const cursorPct = total > 0 && cursorDistanceM !== null ? (clamp(finiteOr(cursorDistanceM, 0), 0, total) / total) * 100 : null;
  return {
    startPct,
    endPct,
    selectedLeftPct: startPct,
    selectedWidthPct: Math.max(0, endPct - startPct),
    beforeWidthPct: startPct,
    afterLeftPct: endPct,
    cursorPct
  };
}
