# Public Readiness

Status on 2026-09-01: local publication gates are closed and the public live
verification is closed on the deployed `main` baseline.

## Local evidence closed

- `make verify-local` is rerun before publication. It covers formatting, lint,
  JavaScript and Rust tests, coverage, generated-output cleanup, and the public
  audit.
- `pnpm audit:public` is green after two explicit fixes: repo-local Kotlin
  compiler artefacts are now part of generated cleanup, and public docs no
  longer mention private map/game chunk formats.
- gitleaks `v8.28.0` reports no leak on the publication file set or reachable
  public Git history; the scan is repeated before each publication commit.
- `docs/evidence/2026-09-01T01-53-00Z-release-device.txt` records the published
  `v0.2.0` APK gate on `redroid14_x86_64` in airplane mode; its digest matches
  the GitHub Release asset. The release checksum contains only the APK basename
  and verifies from a fresh download directory.
- `docs/evidence/2026-09-01T01-51-18Z-release-multipoint-airplane.txt` records
  three control points, local loop recalculation, undo/redo, and zero network
  attempts against that same published APK digest.
- `docs/benchmarks/2026-09-01T01-42-17Z.json` records the current Nitro/native
  benchmark on `redroid14_x86_64 isolated (AX102)`: cold pack load 98,827 µs,
  warm p50 1,182 µs, warm p95 1,624 µs across 1,024 queries.
- `docs/testing.md` records the TDD contract and the latest local coverage values.
- `pnpm audit:dependencies` blocks every critical/high advisory except two
  exact upstream `image-size` advisories with no patched release
  (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`). The allowlist is path-bound
  to Expo/Metro's build-time parser. It never processes API or runtime user
  input; fixture assets are checked in and checksummed. Any patched release or
  different dependency path invalidates the exception and fails the gate.

## Boundary enforced locally

- No private remote is configured in the repository.
- The public denylist rejects sensitive product vocabulary, internal endpoints,
  signing material, environment files, native binaries in source paths, and
  application/database artifacts.
- The only committed fixture is the public Sydney pack and its attributed sources.
- Android build/cache directories are ignored, and `.kotlin` artifacts are also
  rejected if they ever enter the tree or reachable history. The packaging path
  removes repo-local `.cxx`, demo keystore, sourcemap, dex, and Rust JNI
  transients while preserving the signed APK outside the repository.

## Live delivery evidence

- `https://offline-routing-segments.yaktrak.workers.dev/health` returns
  `200 {"ok":true}` on the live Worker.
- `node tools/live/verify-api.mjs --url https://offline-routing-segments.yaktrak.workers.dev`
  returned `LIVE_API_OK health=200 publish=201 replay=200 conflict=409 nearby=200`
  on 2026-09-01 after the `deploy-api` workflow rerun completed.
- The first deployment run verified too early and briefly observed `404` on
  `POST /v2/segments`; rerunning the same workflow after edge propagation
  closed the contract without code changes.
- The GitHub Pages deployment for the same `main` baseline also completed, so
  the public browser and the public Worker now expose the same Route Studio
  `v1.1` contract.
