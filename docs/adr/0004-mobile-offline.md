# ADR 0004 — the mobile client owns its offline read path

## Status

Accepted.

## Context

The demonstration must still open a useful map and calculate a route after
installation with airplane mode enabled. A route API, a hosted style, or a
JavaScript shortest-path fallback would make that claim ambiguous.

## Decision

The Android application bundles a fixed public Sydney fixture:

- `tiles.pmtiles`, exposed only by `tile-server-lite` on `127.0.0.1`;
- `style.json`, whose source is the loopback tile endpoint;
- `routing.pack`, loaded by a routing-only Nitro object into the Rust CCH ABI.

The app materializes bundled Expo assets in its cache directory, starts the
loopback PMTiles server, loads the routing pack, and only then renders
MapLibre. Two map taps cross the Nitro boundary to CCH; the returned geometry
updates a reactive GeoJSON `GeoJSONSource`/`Layer`.

The only JavaScript distance calculation is presentation of an already-routed
polyline. There is no graph, Dijkstra, A*, or route fallback in the JavaScript
bundle.

`POST /segments` and `GET /segments` live in a separate explicit action
module. With no `EXPO_PUBLIC_SEGMENTS_API_URL`, that module is disabled before
it can call `fetch`. The boot, map, and routing code import no network client;
the in-app counter remains at zero in the airplane-mode test flow.

## Consequences

- The fixture increases APK size, intentionally: it is the evidence for the
  offline claim and is checksummed by the fixture manifest.
- The local server accepts only fixed paths, parses HTTP byte ranges, and is
  hard-bound to loopback. It has no proxy or CDN mode.
- A demo release uses a generated debug keystore outside the repository. No
  private signing material is committed.
- Device benchmark records are emitted only after a named ADB device has run
  the fixed 1,024-query corpus in airplane mode; no benchmark number is
  fabricated for an emulator or a phone.
