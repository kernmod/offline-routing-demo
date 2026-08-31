# Public Readiness

Status on 2026-08-31: `LOCAL_READY`, not `LIVE_VERIFIED`.

## Local evidence closed

- `make verify-local` is green. It runs formatting, lint, all JavaScript and Rust
  tests, coverage collection, generated-output cleanup, and the public audit.
- `make audit-public` is green. The structure, license, and denylist checks pass
  on the clean-history working tree.
- gitleaks `v8.28.0` reports no leak on the publication file set; the scan is
  repeated against reachable Git history after the final root commit is formed.
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

## Remaining blockers before publication

- Cloudflare Wrangler is installed but not authenticated, so no live Worker or
  viewer deployment URL exists yet.
- No public GitHub remote or release exists yet, so the APK and URLs cannot be
  verified from outside the local machine.
- The post-publication clean-clone proof still has to be rerun against the final
  public remote state.

Until those three items are closed, SC3, SC4, and the publication half of SC8
remain open by design.
