# Offline Routing Demo

This repository is a public Route Studio built to show end-to-end engineering
without exposing product-specific logic. It packages one reproducible Sydney
fixture, one Rust CCH routing engine, one shared editing state machine, an
offline-first Android client, an install-free web client, and a bounded
publish/read API.

The recruiter flow is simple:

1. open the web viewer or install the APK;
2. create a route with start, finish, and via points;
3. inspect the local route, elevation profile, and trim selection;
4. confirm publication of a named snapshot;
5. read the same published segment back through the live API.

The public boundary is strict. There is no account system, no hosted routing
endpoint, no private drafts on the server, no private infrastructure dependency,
and no business vocabulary or artifacts from the product repo.

## Try the complete flow

- Browser viewer: <https://kernmod.github.io/offline-routing-demo/>
- Segment API health: <https://offline-routing-segments.yaktrak.workers.dev/health>
- Android APK: <https://github.com/kernmod/offline-routing-demo/releases/download/v0.2.0/offline-routing-demo-route-studio.apk>

## What this demonstrates

- deterministic fixture production from pinned public OpenStreetMap and DEM inputs;
- a real Rust CCH engine with preprocessing, shortcut unpacking, and multipoint routing;
- the same router compiled to Nitro/native on Android and to WASM in the browser;
- one shared `packages/route-studio` domain for multipoint editing, invalidated-leg
  reroute, undo/redo, loop, trim, elevation metrics, draft persistence, and explicit
  `draft -> ready -> publishing -> published` transitions;
- a Cloudflare Worker + D1 API with exact input validation, idempotency, server-derived
  metrics, z14 spatial cells, TTL, and fail-closed rate limiting;
- TDD with unit, integration, E2E, device, coverage, and public-boundary checks.

## Architecture

```text
public Sydney OSM + DEM
         │
         ├── reproducible builders ──> PMTiles + style + manifest
         └── graph builder ──> CCHP2 routing.pack + SHA-256
                                      │
                 ┌────────────────────┴────────────────────┐
                 v                                         v
        React Native + Nitro                    React + WASM + MapLibre GL JS
                 │                                         │
                 └──── packages/route-studio draft state ─┘
                                      │
                             explicit publish only
                                      │
                                      v
                          Worker API + D1 + z14 cells
```

Everything above the publish step is local. The mobile app embeds the map,
style, DEM-enriched pack, and native engine. The viewer loads the same pack
bytes and routes locally with WASM. There is no `/route` API and no JavaScript
graph fallback.

## Workspace

| Path | Responsibility |
| --- | --- |
| `fixtures/sydney` | public source manifests, DEM crop, attribution, expected outputs |
| `crates/cch-routing-lite` | CCH pack build/load/query, `routeMany`, elevation-aware unpack |
| `crates/cch-routing-lite-wasm` | browser WASM boundary for the same pack |
| `crates/cch-routing-lite-ffi` | ownership-safe C ABI |
| `crates/tile-server-lite` | loopback-only PMTiles/style serving for Android |
| `packages/offline-router` | Nitro/C++ mobile bridge |
| `packages/shared` | geometry, bbox, metric, and API contracts |
| `packages/route-studio` | shared route draft, trim, profile, publish contracts |
| `apps/mobile` | Expo 54 / React Native 0.81 Route Studio |
| `apps/viewer` | React/Vite/MapLibre GL JS Route Studio |
| `apps/api` | Cloudflare Worker + D1 publish/read API |

## Public experiences

- Browser viewer: <https://kernmod.github.io/offline-routing-demo/>
- Segment API health: <https://offline-routing-segments.yaktrak.workers.dev/health>
- GitHub releases: <https://github.com/kernmod/offline-routing-demo/releases>

The viewer and API deploy from `main`. The pages workflow publishes the static
viewer under `/offline-routing-demo/`; the API workflow applies remote D1
migrations, deploys the Worker, then reruns the live `POST /v2/segments` and
`GET /v2/segments?bbox=...` contract verifier.

## Reproduce it

### Local verification

Prerequisites: Node `22.23.2`, pnpm `10.24.0`, Rust `1.94.1`,
`cargo-llvm-cov 0.9.0`, Android SDK 36 for the release APK. The Rust coverage
gate excludes the browser-only `cch-routing-lite-wasm` crate because its tests
are already covered by `pnpm build:wasm` plus viewer parity and E2E checks
rather than a native host runner.

```bash
pnpm install --frozen-lockfile

make fixture
make verify-fixture

pnpm build:wasm
pnpm test:coverage
cargo test --workspace
cargo llvm-cov --workspace --all-targets --exclude cch-routing-lite-wasm --fail-under-lines 80
pnpm audit:public
```

`make fixture` is offline after checkout. The current public routing pack is
`CCHP2` and the committed fixture manifest records provenance, sizes, checksums,
DEM source licensing, and the routing-pack SHA-256. `make build`, CI, and Pages
also regenerate the pinned Rust/WASM output and fail if it differs from the
committed browser module.

### Local app and viewer

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787 pnpm --filter @offline-routing/viewer dev
pnpm --filter @offline-routing/mobile build
```

The browser viewer uses the same `routing.pack` bytes as mobile. The E2E suite
fails if a `/route` request appears on the network.

### Android release and device gate

```bash
EXPO_PUBLIC_SEGMENTS_API_URL=https://offline-routing-segments.yaktrak.workers.dev \
  ./scripts/build-apk.sh

ANDROID_SERIAL=localhost:5556 \
  ./scripts/device/verify-release.sh \
  "$HOME/.offline-routing-demo/releases/offline-routing-demo-route-studio.apk"
```

The build generates a demo keystore under `$HOME` only. No signing material is
committed. The published `v0.2.0` asset has SHA-256
`ad121007ab699974609103faf5ec3fd37192b9347da464cb5ec8c8eec3f9661f`;
its airplane-mode device gate is recorded in
[`docs/evidence/2026-09-01T01-53-00Z-release-device.txt`](docs/evidence/2026-09-01T01-53-00Z-release-device.txt),
with the three-control-point loop and undo/redo replay in
[`docs/evidence/2026-09-01T01-51-18Z-release-multipoint-airplane.txt`](docs/evidence/2026-09-01T01-51-18Z-release-multipoint-airplane.txt).
The adjacent checksum asset uses the APK basename, so `sha256sum -c` works
after downloading both files into any directory.

### Benchmarks

```bash
ANDROID_SERIAL=localhost:5556 \
BENCHMARK_DEVICE_NAME='redroid14_x86_64 isolated (AX102)' \
./scripts/device/benchmark.sh
```

The benchmark exercises the production Nitro/C++/Rust path with a fixed
1,024-query corpus and records cold-load plus warm-query p50/p95 on the named
device only.

Named-device benchmark run on 2026-09-01T01:42:17Z:

- device: `redroid14_x86_64 isolated (AX102)`
- warm-query p50: `1,182 µs`
- warm-query p95: `1,624 µs`
- cold pack-load: `98,827 µs`

Retained 20-run named-device baseline from 2026-08-31:

- device: `redroid14_x86_64 isolated (AX102)`
- warm-query p50 median: `1,177 µs`
- warm-query p95 median: `1,613 µs`
- cold pack-load median: `98,508 µs`

## Test posture

The repository follows strict TDD. Route Studio was built in this order:

1. public contract and documentation boundary;
2. shared multipoint domain;
3. DEM and `CCHP2` fixture;
4. native `routeMany` and mobile bridge;
5. WASM parity;
6. Worker/D1 `v2` publication;
7. mobile and browser Route Studio flows;
8. release, audit, and live verification.

Evidence lives in:

- [docs/testing.md](docs/testing.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/adr](docs/adr)
- [docs/evidence](docs/evidence)
- [docs/benchmarks](docs/benchmarks)

For the live API contract, rerun:

```bash
pnpm verify:live-api --url https://<worker-origin>
```

## Limits

- The fixture covers Sydney CBD only.
- Drafts stay local in `v1.1`; the server stores published snapshots only.
- The API stores generic geometry and metrics, not identities or product logic.
- The benchmark evidence is honest about the named emulator until an arm64 phone
  run is added.

## Data and licensing

Code is dual-licensed MIT or Apache-2.0. The fixture derives from OpenStreetMap
under ODbL 1.0 and from a documented public DEM source. Attribution and
provenance are recorded in [NOTICE.md](NOTICE.md),
[docs/data-sources.md](docs/data-sources.md), and
[`fixtures/sydney/ATTRIBUTION.md`](fixtures/sydney/ATTRIBUTION.md).
