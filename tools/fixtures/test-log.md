# Fixture TDD log

This file records the P1 red/green commands. It is intentionally limited to
fixture tooling; the repository-wide journal lives in the parent engineering
TODO.

## RED

Command (run before fixture implementation):

```sh
node --test tools/fixture/*.test.mjs
```

Expected reason: the manifest, archive, attribution and build/verify scripts do
not exist yet.

Observed on 2026-08-31: 9 tests, 1 passed and 8 failed. Failures were the
expected missing `manifest.json`, `map.pmtiles`, `style.json`,
`ATTRIBUTION.md`, `build.mjs`, and `verify.mjs` errors.

During bootstrap, a concurrent placeholder generator briefly replaced the
source with metadata-only JSON and emitted a 256-byte mock archive. P1
ownership was re-established and those placeholders were discarded before the
green phase. No claim or checksum below refers to the mock artifact.

## GREEN

Fixture-only test command:

```sh
node --test tools/fixtures/*.test.mjs
```

Observed after independent-review remediations: 22 passed, 0 failed, 0 skipped.

Repository root test command:

```sh
pnpm test:root
```

Observed after review remediation: 39 passed, 0 failed, 0 skipped (fixture and
publication-boundary tests combined).

Coverage command:

```sh
node --experimental-test-coverage --test tools/fixtures/*.test.mjs
```

Observed aggregate loaded fixture-tooling coverage after review remediation:
99.14% lines, 92.14% branches, 99.07% functions. The deterministic library, including Overpass
normalization, is covered. Thin CLI argument/delegation wrappers and the
optional HTTP transport used only to refresh the pinned source are outside the
offline coverage process; this boundary is documented in `docs/data-sources.md`.

Full offline reproduction gate:

```sh
make fixture && make verify-fixture
```

Observed:

```text
FIXTURE_BUILT ... assets=7 bytes=3522549 routing=ready
FIXTURE_OK ... assets=7 bytes=3522549 tiles=26 routing=ready
FIXTURE_REPRODUCIBLE files=8
```

The reproduction gate builds two routing packs independently with
`CARGO_NET_OFFLINE=true` and compares all eight emitted files byte-for-byte.

## Independent format compatibility

The archive was also read with `pmtiles@4.5.0` outside the project dependency
tree. It reported PMTiles v3, MVT tile type, zooms 13–16, the exact fixture
bounds, 26 addressed tiles, and returned a 26,275-byte centre tile. That tile
was decoded with `@mapbox/vector-tile@2.0.4`: layer `roads`, 702 features,
extent 4096.

## Independent code review remediation

The first independent review returned `FAIL` with one high, three medium, and
one low finding. Tests were added red before remediation. The final verifier:

- parses style JSON before validating every glyph, sprite, source, and tile URL,
  so JSON escapes cannot hide a remote endpoint;
- compares manifest provenance to the canonical source;
- includes `ATTRIBUTION.md` in manifest integrity checks;
- runs two independent Rust pack builds in the default fixture test suite;
- anchors the optional refresh output path to the repository, not caller cwd.

The reviewer's second pass returned `PASS` with no remaining P1 finding.

The publication audit passed for P1 before the concurrent mobile build. A later
repository-wide invocation correctly rejected generated Android `.o`, `.so`,
`.class`, and `.apk` outputs created by another workstream; no P1 path was
flagged. Those outputs are left to the mobile owner/final repository gate.
