# Atlas Relay Route Studio

An install-free route editor and public segment viewer for the Sydney fixture.
It is deliberately a working map first, not a landing page: MapLibre GL JS opens
the checked-in PMTiles, the same Rust routing engine used by the mobile demo runs
as WebAssembly, and the side rail reads and publishes public segment rows.

## Product flow

1. Click the map to create a start, finish, and optional via points. Drag points
   on the map or use the keyboard-accessible move/delete controls in the list.
2. Each invalidated leg is recalculated in the browser by the injected
   `LocalRouter`. Undo, redo, reorder, and optional loop closure use the shared
   `@offline-routing/route-studio` state machine.
3. Scrub the elevation profile, move the selection handles, inspect selected
   distance and D+/D−, or reset to the full route. Trimming never mutates the
   full calculated geometry.
4. Name and save the private draft locally, review the final snapshot, then
   publish it. A successful publication is inserted and selected immediately in
   the nearby list.

The browser does not contain a JavaScript routing fallback and never calls a
`/route` endpoint. If the routing pack or WebAssembly engine cannot load, the UI
states that routing is unavailable and does not draw an invented straight line.

## Architecture

```text
map click / drag / keyboard edit
              |
              v
@offline-routing/route-studio  (canonical draft + history + trim lifecycle)
              |
              v
LocalRouter -> cch-routing-lite WASM -> embedded routing.pack (CCHP2)
              |
              v
final {name, geometry, controlPoints}
              |
              v
POST /v2/segments -> Worker/D1 -> GET /v2/segments?bbox=...
```

`src/lib/router.ts` is the only routing adapter used by the editor.
`src/lib/wasm-router.ts` owns WebAssembly and pack loading. This keeps the UI
injectable in component tests without creating a second routing algorithm.

## What is local, what is live

The browser bundle copies the public assets from
[`fixtures/sydney`](../../fixtures/sydney) at build time:

- `map.pmtiles` — vector tiles served through the PMTiles protocol;
- `routing.pack` — graph, CCH order/shortcuts, weights, and elevation samples;
- `style.json` and its local glyph path;
- OSM/ODbL attribution and fixture provenance.

The map does not download a hosted basemap, token, glyph service, routing
service, or analytics script. The only live operations are bounded public reads
and an explicit publication. The API base URL defaults to the viewer origin;
set `VITE_API_BASE_URL` at build time when the Worker is on another origin.
Runtime query parameters cannot change the API origin.

Publication sends exactly `{name, geometry, controlPoints}` to
`POST /v2/segments` with a UUIDv4 `idempotency-key`. The shared lifecycle is
explicit: `draft -> ready -> publishing -> published`. A failed request returns
to `ready`, retains the draft, and retries with the same key. Legacy v1 reads are
kept as a compatibility fallback when a server does not yet return v2 rows.

The UI makes the boundary observable: the toolbar reports embedded PMTiles,
local features, local routing, and public segments. Malformed API geometry is
excluded rather than passed to MapLibre, and loading, empty, API-down, routing,
publication, and local-asset-error states are explicit.

## Run it

```bash
pnpm install
pnpm --filter @offline-routing/viewer dev

# Production-equivalent static output in apps/viewer/dist
pnpm --filter @offline-routing/viewer build
pnpm --filter @offline-routing/viewer preview
```

To point a local viewer at a local Worker, run the Worker separately and build
or start Vite with `VITE_API_BASE_URL=http://127.0.0.1:8787`. No secret is
needed by the viewer.

## Verification

```bash
pnpm --filter @offline-routing/viewer lint
pnpm --filter @offline-routing/viewer test:coverage
pnpm --filter @offline-routing/viewer test:e2e
```

The unit/component suite enforces at least 85% lines/functions and 80% branches.
It covers draft history, incremental leg invalidation, loop closure, trim and
profile synchronization, lifecycle transitions, exact API requests, failures,
and MapLibre click/drag behavior.

The real adapter integration test initializes the generated WebAssembly module
with `fixtures/sydney/routing.pack`, verifies its pinned SHA-256, routes a native
multipoint golden, and compares geometry, distance, D+/D−. Its fetch spy proves
that routing reads only the static pack and never requests `/route`.

The Playwright suite runs Chromium at desktop and Pixel 5 viewports. It covers
real MapLibre/PMTiles rendering, multipoint WASM routing, loop and trim controls,
the v2 publication round trip, API-down resilience, accessible mobile targets,
sub-path assets, and visual snapshots.

## Static deployment

`pnpm --filter @offline-routing/viewer build` produces a host-agnostic `dist/`
directory. It can be served by Cloudflare Pages or by Worker static assets; the
API stays a separate Worker/D1 binding. Configure a deployment environment with
`VITE_API_BASE_URL=https://<your-api-domain>` if origins differ. Do not add
secrets or account tokens to this static application.

For a sub-path host (for example Pages at `/viewer/`), build with
`VITE_VIEWER_BASE=/viewer/`. Fixture asset URLs are generated from Vite's
`BASE_URL`; PMTiles, the routing pack, styles, glyphs, and WASM stay under the
same prefix. `pnpm --filter @offline-routing/viewer test:e2e:base` verifies this
deployment form.

A new GitHub repository needs one one-time repository-administrator step before
the workflow can deploy Pages:

```bash
gh api --method POST repos/OWNER/REPO/pages -f build_type=workflow
```

GitHub does not allow the workflow's own `GITHUB_TOKEN` to create the Pages site.
After this bootstrap, the pinned workflow deploys every `main` update using only
`pages: write` and `id-token: write`; no PAT is stored in Actions.

## Accessibility and attribution

The map remains operable without pointer dragging: every control point has
semantic move-up, move-down, and delete buttons; undo/redo, loop, trim, naming,
review, and publication are keyboard controls. Public rows are pressed-state
buttons and open an inspection region. Focus is high-contrast, color is not the
only origin cue, mobile targets remain at least 36 px, and reduced-motion
preferences disable decorative transitions. OSM/ODbL attribution stays visible.
