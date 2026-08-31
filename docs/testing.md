# Testing Strategy

This repository follows strict TDD: each behavior begins with a focused failing test,
the smallest implementation makes it pass, and refactoring happens only while the
suite remains green. Pull requests must show the RED and GREEN commands in their
description; coverage is evidence, not a replacement for meaningful assertions.

## Coverage contract

| Surface | Lines/functions | Branches | Additional gate |
| --- | ---: | ---: | --- |
| Whole repository | 80% | 80% | no package may silently opt out |
| `packages/shared` | 95% | 90% | geometry limits and codecs |
| `apps/api` | 95% | 90% | 100% of rejection, limit, idempotency, and database-error paths |
| `apps/mobile` | 85% | 80% | offline state machine and route presentation |
| `apps/viewer` | 85% | 80% | loading, empty, failure, and map interaction states |
| Rust workspace | 80% | measured where supported | 90% for public APIs, pack parsing, errors, and FFI ownership |

Generated bindings, platform-generated projects, and static public fixtures may be
excluded only when the owning package documents the path and reason. Exclusions may
not contain handwritten business logic. CI publishes JavaScript and Rust LCOV output.

no .skip, no .only, no test.todo, and no #[ignore] are accepted. A flaky test is fixed or
the gate stays red; it is never hidden with retries as the sole remedy.

## Test pyramid

- Unit tests cover pure geometry, validation, state machines, and error mapping.
- Property tests cover coordinate bounds, polyline round-trips, serialization, and
  routing invariants over generated graphs.
- Integration tests exercise public fixture → pack → route, ABI allocation/free,
  and Worker API → D1 migrations → spatial queries.
- End-to-end (E2E) browser tests cover the viewer with deterministic seeded data.
- Device E2E tests install a release APK, enable airplane mode, boot the embedded
  map, tap two points, and verify a route without network traffic.
- Non-functional tests cover deterministic builds, public-boundary auditing,
  rate/size limits, and named-device p50/p95 measurements.

## Commands

```bash
pnpm test                       # root and JavaScript package tests
pnpm test:coverage              # Node coverage plus package coverage gates
cargo test --workspace          # Rust unit/property/integration tests
cargo llvm-cov --workspace --all-targets --fail-under-lines 80
make audit-public               # tree, history, remote, endpoint, artifact, secret gates
pnpm verify:live-api --url https://your-worker.workers.dev     # state-changing live publish/read proof
```

The live verifier has no default endpoint and is intentionally outside `verify-local`.
It accepts only a public HTTPS `*.workers.dev` origin, bounds DNS resolution and
fails closed if it returns any non-public address, uses an ephemeral UUIDv4
idempotency key, and bounds each request to 8 seconds and each JSON response to
64 KiB. It checks `/health`, publishes the
documented three-point Sydney geometry, then requires the same record to be
returned by the `minLat,minLng,maxLat,maxLng` bbox query. It emits statuses only:
no URL, key, request body, response body, or credential is printed.

## Phase evidence

| Phase | RED evidence | GREEN evidence | Coverage artifact | Status |
| --- | --- | --- | --- | --- |
| P0 | `node --test tools/audit/*.test.mjs` — missing docs/audit library | `make verify-local` now reruns bootstrap, test policy, coverage collection, Rust coverage, cleanup, and public audit in one gate, ending with `LOCAL_READY` | root coverage 88.34% lines, 86.64% branches, 91.83% funcs | green local |
| P1 | `pnpm test` failed until `fixtures/sydney` manifest, assets and deterministic builder existed | `pnpm test`, `make fixture`, and `make verify-fixture` pass locally | root coverage includes fixture builders/verifiers | green local |
| P2 | `cargo test --workspace --no-run` failed before the public versioned FFI/router surface was completed | `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo llvm-cov --workspace --all-targets --fail-under-lines 80` pass locally | Rust workspace 93.67% lines, 93.33% functions | green local |
| P3 | bridge ownership and mobile offline tests | `ANDROID_SERIAL=localhost:5556 ./scripts/device/smoke-route.sh` plus `./scripts/device/verify-release.sh` and direct two-tap `adb input tap` evidence | mobile coverage 91.01% lines, 83.07% branches, 88.46% funcs; final device evidence under `docs/evidence/2026-08-31T20-11-16Z-release-device.*` | green device-local |
| P4 | `pnpm --filter @offline-routing/api test` failed before Worker exports, migrations, and D1 query helpers existed; the deploy workflow test then caught Wrangler 4 rejecting `--yes` | Worker contract, migrations, TTL, idempotency and query plan pass locally; production migrations plus `LIVE_API_OK health=200 publish=201 nearby=200` pass externally | API coverage 99.21% lines, 92.68% branches, 100% funcs | green live |
| P5 | `pnpm --filter @offline-routing/viewer test` failed before the static shell and viewer client existed | unit tests plus Playwright desktop/mobile, API-down, and `/offline-routing-demo/` sub-path checks pass locally; GitHub Pages serves the live viewer with document `200`, `map.pmtiles` byte range `206`, and external Chromium WebGL proof | viewer coverage 98.50% lines, 88.15% branches, 88.00% funcs | green live |
| P6 | named-device harness assertions | `ANDROID_SERIAL=localhost:5556 BENCHMARK_DEVICE_NAME='redroid14_x86_64 isolated (AX102)' ./scripts/device/benchmark.sh` plus 20 cold runs summarized in `docs/benchmarks/2026-08-31-redroid14-isolated-cold-summary.md` | 20,480/20,480 routes; raw benchmark JSON/log pairs under `docs/benchmarks/` | green isolated device-local |
| P7–P8 | deterministic rebuild and hostile audit fixtures | `make verify-local`, `make audit-public`, gitleaks, public `git push`, GitHub Release `v0.1.0`, fresh public clone replay, Pages deploy `33436205596`, CI on `main` `33436205561`, and CI on tag `v0.1.0` `33436223268` all pass | consolidated reports under `coverage/`, `docs/evidence/`, `docs/security/`, and the release asset URL | green public |
