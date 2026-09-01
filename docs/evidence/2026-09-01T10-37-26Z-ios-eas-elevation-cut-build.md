# Signed iOS elevation-cut build - 2026-09-01T10:37:26Z

EAS Build produced a signed physical-device archive from public commit
`102c16a6a7de7a793364d38f9fd207ffb16aef5f`. This revision contains the same
React Native SVG elevation-cut selector and direct handle interaction validated
by the Android device smoke.

## Build result

- EAS build: `42ddb411-3a83-49eb-98ae-90f1811fd774`
- status: `FINISHED`
- platform: `IOS`
- distribution: `INTERNAL`
- profile: `ios-internal`
- Expo SDK: `54.0.0`
- bundle: `dev.offlinerouting.demo`
- version/build: `1.0` / `2`
- archive size: `12,440,210` bytes
- archive SHA-256:
  `a739f047c3dd15d4a5b8531e22059a44cbce8da4d548b22f5e12c338a0057af6`

## Independent archive inspection

- ZIP integrity check: green;
- application executable: Mach-O 64-bit, architecture: `arm64`;
- native bundle identifier: `dev.offlinerouting.demo`;
- embedded `routing.pack`: `1,135,727` bytes;
- embedded `tiles.pmtiles`: `1,005,723` bytes;
- native executable contains the checked public `CCHP2` routing-pack contract;
- embedded signing profile is active until 2027-08-13, matches the public
  bundle, and contains exactly one enrolled test device.

The ad hoc IPA stays in EAS because its provisioning profile enumerates enrolled
device identifiers. This public record intentionally contains only
non-identifying build facts and the archive checksum.

This evidence closes signed iOS packaging for the shared selector. Installation,
direct-handle interaction, and airplane-mode routing on the enrolled iPad remain
a separate physical-runtime gate.
