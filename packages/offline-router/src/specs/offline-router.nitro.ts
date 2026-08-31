import type { HybridObject } from "react-native-nitro-modules";

/** Coordinates are decimal degrees; this bridge requests no platform permission. */
export type Coordinate = { lat: number; lng: number };

/**
 * A deliberately narrow local-only bridge. The string payloads are JSON from
 * the C ABI and are decoded by the TypeScript facade into data-only objects.
 */
export interface OfflineRouterNative extends HybridObject<{ ios: "c++"; android: "c++" }> {
  loadPack(pack: ArrayBuffer): string;
  route(origin: Coordinate, destination: Coordinate): string;
  benchmark(device: string): string;
  startTileServer(assetDirectory: string, port: number): number;
  stopTileServer(): void;
}
