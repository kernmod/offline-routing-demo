# Offline Routing Demo

This repository is a public Route Studio built to show end-to-end engineering
without exposing product-specific logic. It packages one reproducible Sydney
fixture, one Rust CCH routing engine, one shared editing state machine, an
offline-first Android client, a public iOS build path, an install-free web
client, and a bounded publish/read API. The public cartography includes a
neutral 3D/stylized map based on regenerated public fixture bytes, not on any
private map artifact.

The recruiter flow is simple:

1. open the web viewer, install the APK, or inspect the iOS simulator build;
2. create a route with start, finish, and via points;
3. inspect the local route, elevation profile, trim selection, and 2D/3D map mode;
4. confirm publication of a named snapshot;
5. read the same published segment back through the live API.

The public boundary is strict. There is no account system, no hosted routing
endpoint, no private drafts on the server, no private infrastructure dependency,
and no business vocabulary or artifacts from the product repo.

## Try the complete flow

- Browser viewer: <https://kernmod.github.io/offline-routing-demo/>
- Segment API health: <https://offline-routing-segments.yaktrak.workers.dev/health>
- Android APK: <https://github.com/kernmod/offline-routing-demo/releases/latest/download/offline-routing-demo-route-studio.apk>
- iOS Simulator app: <https://github.com/kernmod/offline-routing-demo/releases/latest/download/offline-routing-demo-ios-simulator-app.zip>
- iOS Rust XCFramework: <https://github.com/kernmod/offline-routing-demo/releases/latest/download/offline-routing-demo-ios-rust-xcframework.zip>
- iOS runtime evidence: <https://github.com/kernmod/offline-routing-demo/releases/latest/download/offline-routing-demo-ios-simulator-evidence.zip>
- Reproducible macOS run: [GitHub Actions workflow `ios`](https://github.com/kernmod/offline-routing-demo/actions/workflows/ios.yml)
- Physical iOS EAS rail: [GitHub Actions workflow `ios-distribution`](https://github.com/kernmod/offline-routing-demo/actions/workflows/ios-distribution.yml)

## What this demonstrates

- deterministic fixture production from pinned public OpenStreetMap and DEM inputs;
- a regenerated public PMTiles map with 3D building extrusion and a neutral style;
- a real Rust CCH engine with preprocessing, shortcut unpacking, and multipoint routing;
- the same router compiled to Nitro/native on Android and iOS, and to WASM in the browser;
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
         ├── reproducible builders ──> PMTiles + neutral 2D/3D style + manifest
         └── graph builder ──> CCHP2 routing.pack + SHA-256
                                      │
                 ┌────────────────────┴────────────────────┐
                 v                                         v
     React Native + Nitro/C++                     React + WASM + MapLibre GL JS
   Android .so + iOS XCFramework                           │
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
| `fixtures/sydney` | public source manifests, DEM crop, attribution, expected outputs, regenerated 2D/3D PMTiles |
| `crates/cch-routing-lite` | CCH pack build/load/query, `routeMany`, elevation-aware unpack |
| `crates/cch-routing-lite-wasm` | browser WASM boundary for the same pack |
| `crates/cch-routing-lite-ffi` | ownership-safe C ABI |
| `crates/offline-routing-mobile-core` | single iOS `staticlib` aggregator for the public routing and loopback tile ABIs |
| `crates/tile-server-lite` | loopback-only PMTiles/style serving for Android and iOS |
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
`GET /v2/segments?bbox=...` contract verifier. The iOS workflow runs on
GitHub-hosted macOS, builds the XCFramework from public Rust crates only,
compiles the unsigned simulator app, boots a named simulator, injects a route
scenario at launch, and archives the runtime evidence.

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

If your shell is still pinned to Node 20, the repository scripts will emit an
engine warning. CI and the reproducible local contract target Node 22.23.2.

`make fixture` is offline after checkout. The current public routing pack is
`CCHP2` and the committed fixture manifest records provenance, sizes, checksums,
DEM source licensing, and the routing-pack SHA-256. `make build`, CI, and Pages
also regenerate the pinned Rust/WASM output with path remapping and fail if it
differs from the committed browser module. The WASM build jobs run on pinned
Ubuntu 22.04 builders as well: `zstd-sys` compiles native C, so the compiler
image is part of the reproducible toolchain alongside Rust and wasm-bindgen.
Before deserialization, the public pack builder caps `graph.json` at 8 MiB and
the WASM multipoint boundary caps its 2–16-control JSON at 16 KiB.

### Local app and viewer

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787 pnpm --filter @offline-routing/viewer dev
pnpm --filter @offline-routing/mobile build
```

The browser viewer uses the same `routing.pack` bytes as mobile. The E2E suite
fails if a `/route` request appears on the network. The map starts in 3D and
can be switched to 2D without breaking route overlays. In both clients, the
active route uses a three-layer stack: dark shadow, paper casing, and ochre
core. Selected trims and profile cursors use their own halo so the route stays
visible over 3D building extrusion.

### iOS simulator path

```bash
pnpm --filter react-native-offline-router exec nitrogen
pnpm --filter @offline-routing/mobile prepare:assets
packages/offline-router/scripts/build-ios-rust-xcframework.sh
cd apps/mobile/ios && pod install
xcodebuild \
  -workspace mobile.xcworkspace \
  -scheme mobile \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro,OS=latest' \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

The iOS packaging path is intentionally public and narrow:

- `OfflineRouter.podspec` is the monorepo's local-path integration, not a
  CocoaPods registry package: clone the repository and build the XCFramework
  before `pod install`, in the order shown above;
- one Rust `staticlib` crate, `offline-routing-mobile-core`, retains both the routing
  and loopback tile-server C ABIs in a single link unit;
- one `OfflineRouterCore.xcframework` is required by the CocoaPods spec and checked
  fail-loud before compilation;
- one simulator smoke script injects the same deterministic route URL as a
  simulator-only launch property, avoiding the iOS 26 system confirmation
  dialog, and requires the `OfflineRoutingRoute` log to report
  `routeSource:"local_native"` and `networkAttempts":0`;
- the public `offlineroutingdemo://route?...` deep link remains available for
  normal manual use.

Physical iPhone installation uses EAS remote credentials only. Nothing Apple is
committed here: the repo expects `EXPO_TOKEN`, and for CI-based ad hoc/TestFlight
distribution it can also consume `EXPO_ASC_API_KEY_PATH` or a temporary file
derived from `EXPO_ASC_API_KEY_BASE64`, plus `EXPO_ASC_KEY_ID` and
`EXPO_ASC_ISSUER_ID`. If the Expo project already stores its App Store Connect
key remotely, `EXPO_TOKEN` alone is sufficient for the public workflow and
`ios-distribution.yml` skips local key material injection.

For this demo, there are two physical-device rails:

- `ios-internal`: ad hoc internal distribution for enrolled devices only;
- `ios-testflight`: store-signed build for App Store Connect upload and TestFlight
  processing.

The manual GitHub workflow is
[`ios-distribution.yml`](.github/workflows/ios-distribution.yml). It runs on
Linux because EAS Build and EAS Submit handle iOS cloud signing and App Store
Connect upload remotely.

Local commands are the same:

```bash
pnpm install --frozen-lockfile

cd apps/mobile
../../node_modules/.bin/eas whoami
../../node_modules/.bin/eas build --platform ios --profile ios-internal --non-interactive
../../node_modules/.bin/eas build --platform ios --profile ios-testflight --non-interactive
../../node_modules/.bin/eas submit --platform ios --profile production --latest --non-interactive
```

Package scripts mirror those commands:

- `pnpm --dir apps/mobile run build:ios-internal`
- `pnpm --dir apps/mobile run build:ios-internal:refresh`
- `pnpm --dir apps/mobile run build:ios-testflight`
- `pnpm --dir apps/mobile run submit:ios-testflight`

The signed packaging evidence is
[`docs/evidence/2026-09-01T08-44-36Z-ios-eas-signed-build.md`](docs/evidence/2026-09-01T08-44-36Z-ios-eas-signed-build.md):
EAS completed a real `arm64` ad hoc build for `dev.offlinerouting.demo` from the
public commit, using its own App ID/profile and one enrolled test device. The
earlier credential-bootstrap attempt remains recorded in
[`docs/evidence/2026-09-01T07-51-19Z-ios-eas-attempt.md`](docs/evidence/2026-09-01T07-51-19Z-ios-eas-attempt.md).

The ad hoc IPA stays in EAS instead of becoming a public GitHub release asset:
an embedded ad hoc profile enumerates provisioned device identifiers. GitHub
stores the non-identifying build facts and checksum; the physical-device smoke
remains a separate evidence gate. When devices change, rerun
`pnpm --dir apps/mobile run build:ios-internal:refresh`, which expands to
`eas build --platform ios --profile ios-internal --non-interactive --refresh-ad-hoc-provisioning-profile`,
to refresh the Expo-managed ad hoc profile non-interactively.

### Android release and device gate

```bash
EXPO_PUBLIC_SEGMENTS_API_URL=https://offline-routing-segments.yaktrak.workers.dev \
  ./scripts/build-apk.sh

ANDROID_SERIAL=localhost:5556 \
  ./scripts/device/verify-release.sh \
  "$HOME/.offline-routing-demo/releases/offline-routing-demo-route-studio.apk"
```

The build generates a demo keystore under `$HOME` only. No signing material is
committed. The published `v0.3.0` asset has SHA-256
`d4a4e6b1f10f74c0a63f614e1c5d57400e9b7037c9ab6b4bfdb443d2e36d6b1a`.
Its cartography-3D release gate was run in airplane mode and is recorded in
[`docs/evidence/2026-09-01T03-59-40Z-release-device.txt`](docs/evidence/2026-09-01T03-59-40Z-release-device.txt).
The route-visibility build for `v0.4.0` was also verified in airplane mode on
`redroid14_x86_64` / Android 14 with `route=local_native`; its APK SHA-256 is
`bed72cc37e2dfc84f2d6920e66f33731be234f616ed93c6c49c60072e0186bcc` and
the gate is recorded in
[`docs/evidence/2026-09-01T06-23-00Z-release-device.txt`](docs/evidence/2026-09-01T06-23-00Z-release-device.txt).
The earlier three-control-point loop and undo/redo replay remains documented in
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
- Signed physical iOS packaging is complete. The remaining device gate is an
  install plus airplane-mode route smoke on the enrolled iPad. TestFlight still
  requires an App Store Connect app and submission credentials.

## Data and licensing

Code is dual-licensed MIT or Apache-2.0. The fixture derives from OpenStreetMap
under ODbL 1.0 and from a documented public DEM source. Attribution and
provenance are recorded in [NOTICE.md](NOTICE.md),
[docs/data-sources.md](docs/data-sources.md), and
[`fixtures/sydney/ATTRIBUTION.md`](fixtures/sydney/ATTRIBUTION.md).
