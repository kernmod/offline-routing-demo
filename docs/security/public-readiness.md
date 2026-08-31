# Public Readiness

Status on 2026-08-31: `LIVE_VERIFIED`.

## Local evidence closed

- `make verify-local` is green. It runs formatting, lint, all JavaScript and Rust
  tests, coverage collection, generated-output cleanup, and the public audit.
- `make audit-public` is green. The structure, license, and denylist checks pass
  on the clean-history working tree.
- gitleaks `v8.28.0` reports no leak on the publication file set or reachable
  public Git history; the scan is repeated before each publication commit.
- `docs/evidence/2026-08-31-redroid14-airplane.md` records the device-local
  airplane-mode route proof and links the underlying screenshot, UI dump, logcat,
  and process-scoped `strace -e connect` capture.
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

- The Worker/D1 API passed external health, publish, and bbox-read checks at its
  public HTTPS origin.
- GitHub Pages serves the viewer and embedded PMTiles with HTTPS and byte ranges;
  a headless external browser rendered the WebGL canvas with no failed request.
- The final APK embeds only the public API origin. A fresh Android 14 emulator
  published and reloaded a segment online, then passed the release gate again in
  airplane mode with a native local route.
- The public URLs, release hash, device logs, and screenshots are consolidated in
  `docs/evidence/2026-08-31T20-11-00Z-live-delivery.md`.
