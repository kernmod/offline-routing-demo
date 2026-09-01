# Public iOS parity and route visibility

Status: in progress
Opened: 2026-09-01
Owner: Codex

## Goal

Close the public portfolio gap between Android, web, and iOS while keeping the
same public boundary: one local Rust router, one public Sydney fixture, no
private infrastructure, no business artifacts.

## Success criteria

- [ ] Route overlays stay readable above the stylized 3D PMTiles map on mobile
      and web.
- [ ] The public native package exposes one iOS XCFramework built from one Rust
      static library only.
- [ ] iOS packaging is reproducible from public sources and documented in CI.
- [ ] The iOS simulator proof exercises the local route flow without a routing
      network call and without Apple signing secrets.
- [ ] Tests cover the new contracts: overlay stack, iOS packaging, simulator
      verification, public-boundary posture.
- [ ] README explains the cross-platform story clearly for a recruiter.

## Task breakdown

- [ ] Audit current mobile/viewer overlay contrast against 3D buildings.
- [ ] Audit Nitro + Rust iOS packaging surface and CI contract.
- [ ] Strengthen overlay stack where visibility is still weak.
- [ ] Fill any iOS packaging or simulator-proof gaps.
- [ ] Run targeted tests, then full relevant verification.
- [ ] Update README with iOS parity and 3D route visibility evidence.

## Journal

- 2026-09-01 04:10Z: Resumed on `feature/ios-route-visibility` in
  `/root/offline-routing-demo`.
- 2026-09-01 04:14Z: Confirmed the repo already contains the main iOS packaging
  scaffolding: `offline-routing-mobile-core`, XCFramework builder, simulator
  verifier, and workflow skeleton.
- 2026-09-01 04:18Z: Confirmed the web viewer now supports direct point
  creation from the map; earlier “viewer cannot trace” feedback is no longer a
  product gap in the current branch.
- 2026-09-01 04:22Z: Remaining work narrowed to two concrete deliverables:
  improve route legibility over 3D cartography and close the doc/test loop for
  public iOS parity.
- 2026-09-01 05:18Z: Linux rechecks passed after the doc refresh:
  `node --test packages/offline-router/build-contract.test.js
  tools/audit/ios-workflow.test.mjs` passed 5/5,
  `node --import tsx --test apps/mobile/offline-contract.test.js` passed 20/20,
  `pnpm --filter @offline-routing/viewer test` passed 45/45,
  `pnpm --filter @offline-routing/mobile build` passed, and
  `cargo test --workspace` passed. The remaining closure gate is the real macOS
  simulator workflow run.
