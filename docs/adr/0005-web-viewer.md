# ADR 0005: static WebGL viewer with an explicit local/live boundary

- Status: accepted
- Date: 2026-08-31

## Context

The public demo needs a link a recruiter can open without installing a mobile
build. It must demonstrate the same shape as the mobile workflow—local map
assets, a public segment feed—but must not grow into another backend or hide a
hosted map dependency behind a client token.

## Decision

`apps/viewer` is a Vite/React/TypeScript static application. At build time Vite
copies the checked-in Sydney fixture as public assets. MapLibre GL JS registers
the PMTiles protocol and loads `map.pmtiles` through the fixture's local
`style.json`; there is no style, tile, glyph, sprite, or account request to a
third party.

The style entry URL is derived from Vite's `BASE_URL`, never hard-coded as
`/style.json`. PMTiles and glyph URLs are relative to that style document, so a
viewer hosted at `/viewer/` requests `/viewer/style.json`,
`/viewer/map.pmtiles`, and `/viewer/glyphs/...` rather than falling back to a
site root.

The viewer calls only `GET /segments?bbox=minLat,minLng,maxLat,maxLng`. Its base
URL is same-origin by default and can be supplied with `VITE_API_BASE_URL` for a
separate Worker origin. The response is structurally checked before geometry is
decoded. Invalid polyline6 rows are retained only as an anonymous count; they
are never handed to the map renderer.

The map and API have separate observable states:

- an embedded-PMTiles indicator and OSM/ODbL attribution;
- a WebGL rendered-feature count emitted only after MapLibre reaches `idle`;
- a live-public-data indicator, list, selection details, and API-down state.

The map awaits its own source-render completion after API data changes. This
avoids presenting a page as ready in the race where the fetch resolves before
the MapLibre style has finished loading.

## Consequences

- The generated `dist/` is host-agnostic and suitable for Cloudflare Pages or
  Worker static assets. It has no server-side rendering requirement.
- A recruiter can inspect actual MapLibre/PMTiles code and a real browser WebGL
  path, rather than a canvas mock or SVG approximation.
- The viewer is not itself an offline application: its basemap is static at
  build/deploy time, while the feed intentionally needs the public API. The
  offline-install success criterion belongs to `apps/mobile`.
- Viewport visual snapshots are used for WebGL. Full-page Chromium captures can
  detach a WebGL canvas and produce a false blank-image regression.
- The route list is the keyboard-equivalent map interaction; no hover-only
  operation is required.

## Rejected options

- A hosted Mapbox/Google basemap: requires credentials and weakens the public
  boundary.
- A server-rendered map: provides no advantage and adds operating state.
- An SVG-only map: would not demonstrate the MapLibre + PMTiles rendering path.
- Trusting arbitrary API geometry: allows one malformed row to break map state.
