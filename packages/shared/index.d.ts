export type Point = { lat: number; lng: number };
export type ElevationPoint = Point & { elevationM: number };
export type Bbox = { minLat: number; minLng: number; maxLat: number; maxLng: number };
export type RouteMetrics = { bbox: Bbox; pointCount: number; distanceM: number };
export type RouteElevationMetrics = RouteMetrics & { elevationGainM: number; elevationLossM: number };

export function validatePoint(point: unknown, label?: string): Point;
export function bboxFromPoints(points: Point[]): Bbox;
export function validateBbox(bbox: unknown, label?: string): Bbox;
export function routeMetrics(points: Point[]): RouteMetrics;
export function routeElevationMetrics(points: ElevationPoint[]): RouteElevationMetrics;
export function tileKey(zoom: number, x: number, y: number): string;
export function lonLatToTilePoint(point: Point, zoom?: number): { x: number; y: number };
export function segmentCells(points: Point[], zoom?: number): string[];
export function bboxCells(bbox: Bbox, zoom?: number): string[];
export function encodePolyline6(points: Point[]): string;
export function decodePolyline6(encoded: string): Point[];
