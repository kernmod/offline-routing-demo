# Testing Strategy

This repository uses strict TDD. Each Route Studio surface started with a
focused failing test, then moved through the smallest green implementation,
refactor, coverage gate, and independent audit/review pass.
The test pyramid combines unit, property, integration, E2E, and device checks.

## Coverage contract

| Surface | Lines/functions | Branches |
| --- | ---: | ---: |
| Whole repository | 80% | 80% |
| `packages/shared` | 95% | 90% |
| `packages/route-studio` | 95% | 90% |
| `apps/api` | 95% | 90% |
| `apps/viewer` | 85% | 80% |
| `apps/mobile` | 80% | 80% |
| Rust workspace | 80% | measured where supported |

The policy is strict: no .skip, no #[ignore], no .only, and no test.todo.

## Route Studio TDD contract

`tools/audit/route-studio-contract.test.mjs` was the first RED gate.
RED was recorded first with `node --test tools/audit/route-studio-contract.test.mjs`.
The required chain remains: RED contract -> shared domain -> public DEM ->
native/WASM pack parity -> publish/read API -> mobile/browser E2E -> release/live.
RED first covered the missing shared domain, public DEM provenance, pack parity,
publish/read API, and no network route fallback.

Enforceable Route Studio thresholds:

- shared domain: 95% lines/functions, 90% branches
- studio UI: 90% lines/functions, 85% branches
- WASM adapter: 90% lines/functions, 90% branches
- API transition: 95% lines/functions, 90% branches
- DEM builder and verifier: 95% lines/functions, 90% branches

The contract forbids any network route fallback. The publish/read API never
routes; all route calculation happens locally before publication.

## Route Studio proof chain

The Route Studio build order is enforced by tests:

1. public contract and boundary docs;
2. shared domain state machine;
3. DEM provenance and deterministic `CCHP2` fixture;
4. native `routeMany`, ABI ownership, and Nitro bridge;
5. WASM parity on the same pack;
6. Worker/D1 `v2` publish/read contract;
7. browser and mobile editing flows;
8. release, benchmark, audit, and live verification.

## Current evidence

| Phase | Command or evidence | Result on 2026-09-01 | Status |
| --- | --- | --- | --- |
| P0 contract | `node --test tools/audit/route-studio-contract.test.mjs` | 6/6 pass | green |
| P1 shared domain | `pnpm --filter @offline-routing/route-studio test:coverage` | 36 tests, 99.84% lines, 91.20% branches, 100% funcs | green |
| P2 fixture + DEM | `make fixture && make verify-fixture` | deterministic rebuild, manifest/schema `CCHP2`, DEM provenance pinned | green |
| P2 fixture coverage | `node --test tools/fixtures/*.test.mjs` via root gate | hostile fixture coverage retained in root gate | green |
| P3 Rust native/FFI | `cargo test --workspace` | Rust core, FFI, WASM, tile server all pass | green |
| P4 WASM build | `pnpm build:wasm` + committed-output diff gate | pinned Rust 1.94.1, wasm-bindgen 0.2.127, isolated cold target, stable path remapping, and Ubuntu 22.04 build image regenerate byte-identical browser output in local build, CI, and Pages | green |
| P4 viewer parity | `pnpm --filter @offline-routing/viewer test:coverage` | 43 tests, 95.48% lines, 84.23% branches, 92.64% funcs, including real generated-WASM parity and strict publication-response validation | green |
| P5 API | `pnpm --filter @offline-routing/api test:coverage` | 29 tests, 99.29% lines, 90.63% branches, 100% funcs | green |
| P6 mobile package | `pnpm coverage:mobile` | 48 tests, 95.55% lines, 83.93% branches, 90.76% funcs | green |
| P7 browser E2E | `pnpm --filter @offline-routing/viewer test:e2e` | 6/6 pass desktop + mobile viewport | green |
| P8 root coverage | `pnpm test:coverage` | LCOV_OK for root, mobile, offline-router, api, viewer, and shared | green |
| P8 Rust coverage | `cargo llvm-cov --workspace --all-targets --exclude cch-routing-lite-wasm --fail-under-lines 80` | `coverage/rust.lcov` regenerated; the browser-only WASM crate stays covered by `pnpm build:wasm` and viewer parity/E2E gates | green |
| P8 live `v2` | `pnpm verify:live-api --url <worker>` | `LIVE_API_OK health=200 publish=201 replay=200 conflict=409 nearby=200` against the public Worker | green |

## Command reference

```bash
pnpm test
pnpm test:coverage

pnpm build:wasm
pnpm --filter @offline-routing/viewer test:e2e
pnpm coverage:mobile
pnpm --filter @offline-routing/api test:coverage
pnpm --filter @offline-routing/route-studio test:coverage

cargo test --workspace
cargo llvm-cov --workspace --all-targets --exclude cch-routing-lite-wasm --fail-under-lines 80

make fixture
make verify-fixture
pnpm audit:public
pnpm verify:live-api --url https://your-worker.workers.dev
```

## What is covered

- unit tests for the shared draft lifecycle, trim, profile, metrics, serialization,
  and publish payload;
- hostile fixture tests for DEM provenance, checksum drift, no-data, and rebuild
  determinism;
- Rust tests for `routeMany`, pack versioning, shortcut unpacking, ownership,
  bounded builder/WASM inputs, and browser/native boundary errors;
- D1 integration tests for migrations, idempotency, conflict, TTL, rate-limit,
  bounded streaming request reads, the 10-record response cap, indexed cell query
  path, and exact bbox reads;
- browser tests for WASM routing, editing, trimming, confirmation, publish, and
  mobile viewport accessibility;
- mobile controller tests for offline editing, retry, persistence, and network
  quarantine;
- device scripts for airplane-mode boot, local route, and benchmark logging.
