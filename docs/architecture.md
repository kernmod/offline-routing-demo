# Architecture

Status on 2026-09-01: Route Studio `v1.1` is verified across the shared
domain, Rust/native, Rust/WASM, Worker/D1, mobile, browser, and live public
deployment surfaces. The public production URLs now serve the `v1.1` contract
from the deployed `main` baseline. The same public fixture also now supports a
neutral 2D/3D cartography mode with building extrusion in both clients.

## System shape

```text
public Sydney OSM + DEM
         │
         ├── fixture builder ──> PMTiles + neutral 2D/3D style + manifest
         └── graph builder ──> CCHP2 routing.pack + SHA-256
                                      │
                 ┌────────────────────┴────────────────────┐
                 v                                         v
        mobile Route Studio                       web Route Studio
     React Native + Nitro/C++                 React + WASM + MapLibre GL JS
                 │                                         │
                 └──── packages/route-studio domain ──────┘
                                      │
                             explicit publish only
                                      │
                                      v
                          Worker API + D1 + z14 cells
```

The repository has two boundaries only:

- local routing/editing: fixture assets, map rendering, route editing, elevation
  profile, trim, and draft persistence;
- online publication: bounded `POST /v2/segments` and `GET /v2/segments`.

There is no HTTP routing API, no JS shortest-path fallback, no account system,
and no server-side draft store.

## Shared editing model

`packages/route-studio` is the public source of truth for both clients:

- control points are distinct from routed geometry;
- edits invalidate only adjacent legs and reroute them locally;
- loop closure adds the last-to-first leg explicitly;
- undo/redo uses bounded snapshots and excludes drag previews;
- trim is non-destructive and keeps the full route as source of truth;
- publication is explicit: `draft -> ready -> publishing -> published`, with
  retry returning to `ready` and resume-edit returning to `draft`.

This package has no React, DOM, or native dependency.

## Routing and elevation

`fixtures/sydney` carries:

- pinned OSM extract metadata;
- a pinned public DEM crop with source URL, sizes, SHA-256, licence, and attribution;
- a `CCHP2` graph and `routing.pack` with integer node elevation;
- a public PMTiles archive with 2D/3D styling support and extruded buildings;
- a manifest that records every asset and its digest.

`crates/cch-routing-lite` builds and loads the pack, answers `route` and
`routeMany`, and unpacks shortcuts into final geometry. Elevation changes only
profile and D+/D- reporting after unpack. It never changes routing cost.

The same pack is consumed by:

- `packages/offline-router` through Nitro/native on Android;
- `crates/cch-routing-lite-wasm` in the browser.

Golden tests enforce parity on the same fixture and pack.

## Mobile path

`apps/mobile` embeds the PMTiles map, style, and `routing.pack`. On boot it:

1. starts the loopback tile server;
2. loads the embedded pack through the Nitro bridge to Rust CCH;
3. restores one local private draft if present;
4. routes every edit locally;
5. only touches the network for explicit publish or nearby refresh actions.

The Android build removes location and legacy storage permissions. Release
verification checks airplane mode, app startup, back handling, and a local route
deep-link without network dependency.

## Web path

`apps/viewer` loads the same pack and a WASM router at runtime. The map is
editable immediately:

- click to add controls;
- drag to move them;
- reorder/delete from the side rail;
- use undo/redo and loop toggle;
- inspect the elevation profile and trim selection;
- publish a confirmed named snapshot.

Both clients expose a visible 2D/3D toggle. The 3D mode uses public fixture
data only: MapLibre fill-extrusion layers for buildings, a stylized neutral
palette, and local PMTiles assets. Terrain is intentionally not activated; the
elevation profile remains a route metric, not a terrain renderer.

Playwright asserts that these flows work on both desktop and mobile viewport and
that no `/route` request is sent over the network.

## API and storage

`apps/api` exposes two public operations:

- `POST /v2/segments`
- `GET /v2/segments?bbox=minLat,minLng,maxLat,maxLng`

The accepted write body is exactly:

```json
{
  "name": "string",
  "geometry": [{"lat": 0, "lng": 0, "elevationM": 0}],
  "controlPoints": [0, 4, 9]
}
```

The client sends idempotency in the `idempotency-key` UUIDv4 header. The server:

- normalizes and validates the name;
- validates geometry and control anchors;
- recomputes distance, ascent, descent, bbox, encoded geometry, and z14 cells;
- stores only immutable published snapshots;
- applies TTL to anonymous rows;
- rate-limits reads and writes at the edge.

The database query path always starts from indexed `segment_cells`, then applies
the exact bbox filter.

## Public exclusions

The repo intentionally excludes:

- private product vocabulary and assets;
- multi-tenant auth;
- ranking, competition, oracle, anti-cheat, or economy logic;
- private map/game layers and proprietary runtime formats;
- METIS in the runtime path.

METIS remains an optional preprocessing experiment for a different future scope,
not a dependency of this public Route Studio.
