# Signed iOS ad hoc build - 2026-09-01T08:44:36Z

EAS Build produced a real device archive from public commit
`c8ec3588c4162b249662b33cb6bb5ce22d9b3321` after the public app received its
own Apple App ID and ad hoc provisioning profile.

## Build result

- EAS build: `8771861c-7cc0-491f-9db3-b59eea9bc42b`
- status: `FINISHED`
- platform: `IOS`
- distribution: `INTERNAL`
- profile: `ios-internal`
- bundle: `dev.offlinerouting.demo`
- version/build: `1.0` / `2`
- archive size: `12,112,394` bytes
- archive SHA-256:
  `879f973bd04c950cfd794c0f7443f7a70f2a5e644d41beacb65449950cf3b325`

## Independent archive inspection

- ZIP integrity check: green;
- application executable: Mach-O 64-bit, architecture: `arm64`;
- native bundle identifier: `dev.offlinerouting.demo`;
- embedded `routing.pack`: `1,135,727` bytes;
- embedded `tiles.pmtiles`: `1,005,723` bytes;
- native executable contains the checked public `CCHP2` routing-pack contract;
- embedded signing profile is active, matches the public bundle, and contains
  exactly one enrolled test device.

The ad hoc IPA is intentionally not published as a GitHub release asset because
an embedded ad hoc profile enumerates enrolled device identifiers. It remains a
remote EAS artifact for the account owner. Public GitHub evidence records only
non-identifying build facts and the checksum.

Physical installation and airplane-mode route smoke are tracked separately;
this document proves signed packaging and archive contents, not that final
device-runtime gate.

