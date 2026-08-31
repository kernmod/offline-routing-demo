# Atlas Relay viewer

An install-free, static web viewer for the public Sydney segment feed. It is
deliberately a working map first, not a landing page: MapLibre GL JS opens the
checked-in PMTiles fixture while the side rail reads public segment rows through
one bounded `GET /segments?bbox=…` request.

## What is local, what is live

The browser bundle copies the public assets from
[`fixtures/sydney`](../../fixtures/sydney) at build time:

- `map.pmtiles` — vector tiles served through the PMTiles protocol;
- `style.json` and its local glyph path;
- OSM/ODbL attribution and fixture provenance.

The map does not download a hosted basemap, token, glyph service, or analytics
script. The only live operation is the public segment read. Its base URL defaults
to the viewer origin; set `VITE_API_BASE_URL` at build time when the Worker is on
another origin. Runtime query parameters cannot change the API origin; the
deployment value is fixed in the static build.

The UI makes the boundary observable: the toolbar reports embedded PMTiles,
the number of WebGL-rendered local road features, and live public segments.
Malformed API geometry is excluded rather than passed to MapLibre, and loading,
empty, API-down, and local-asset-error states are all explicit.

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
The Playwright suite runs Chromium in desktop and mobile viewports, routes the
API deterministically, verifies real MapLibre WebGL and PMTiles-rendered feature
counts, selection, API-down resilience, and visual snapshots. Snapshots use the
viewport rather than a full-page capture because full-page browser screenshots
can detach a WebGL canvas during the capture pass.

## Static deployment

`pnpm --filter @offline-routing/viewer build` produces a host-agnostic `dist/`
directory. It can be served by Cloudflare Pages or by Worker static assets; the
API stays a separate Worker/D1 binding. Configure a deployment environment with
`VITE_API_BASE_URL=https://<your-api-domain>` if origins differ. The API's CORS
policy accepts the public viewer read path; do not add secrets or account tokens
to this static application.

For a sub-path host (for example Pages at `/viewer/`), build with
`VITE_VIEWER_BASE=/viewer/`. The fixture style URL is generated from Vite's
`BASE_URL`; its relative PMTiles and glyph references therefore remain under the
same prefix. `pnpm --filter @offline-routing/viewer test:e2e:base` verifies this
deployment form against `/viewer/style.json`, `/viewer/map.pmtiles`, and the
fixture glyph path.

A new GitHub repository needs one one-time repository-administrator step before
the workflow can deploy Pages:

```bash
gh api --method POST repos/OWNER/REPO/pages -f build_type=workflow
```

GitHub does not allow the workflow's own `GITHUB_TOKEN` to create the Pages site.
After this administrative bootstrap, the pinned workflow deploys every `main`
update using only `pages: write` and `id-token: write`; no PAT is stored in Actions.

## Accessibility and attribution

The map remains usable by keyboard users through the segment list: each row is
a semantic button with a pressed state and opens an inspection region. Focus is
high-contrast, color is not the only source-of-origin cue, controls retain text
labels, and `prefers-reduced-motion` disables decorative transitions. OSM/ODbL
attribution is visible on the map and linked in the boundary panel.
