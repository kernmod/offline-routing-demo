export type ElevationPoint = { lat: number; lng: number; elevationM: number };
export type ProfilePoint = ElevationPoint & { distanceM: number };

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

export function profileBars(profile: ProfilePoint[], height: number): number[] {
  if (profile.length === 0) return [];
  const values = profile.map((point) => point.elevationM);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => height / 2);
  return values.map((value) => ((value - min) / (max - min)) * height);
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
