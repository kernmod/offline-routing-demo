# Public Readiness

Status on 2026-09-01: local publication gates are closed; public live verification is pending the next `main` deployment.

## Local evidence closed

- `make verify-local` is rerun before publication. It covers formatting, lint,
  JavaScript and Rust tests, coverage, generated-output cleanup, and the public
  audit.
- `pnpm audit:public` is green after two explicit fixes: repo-local Kotlin
  compiler artefacts are now part of generated cleanup, and public docs no
  longer mention private map/game chunk formats.
- gitleaks `v8.28.0` reports no leak on the publication file set or reachable
  public Git history; the scan is repeated before each publication commit.
- `docs/evidence/2026-09-01T01-09-48Z-release-device.txt` records the current
  release-device gate on `localhost:5556`.
- `docs/benchmarks/2026-09-01T01-06-14Z.json` records the current Nitro/native
  benchmark on `redroid14_x86_64 isolated (AX102)`: cold pack load 136,366 µs,
  warm p50 1,212 µs, warm p95 1,674 µs across 1,024 queries.
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

- The public Worker currently still returns `404` on `POST /v2/segments`, which
  means the older API revision is still deployed at the public origin.
- The GitHub Pages and Worker workflows are in place to close this gap from
  `main`; once they succeed, the live verifier and browser smoke must be rerun
  before claiming `LIVE_VERIFIED`.
