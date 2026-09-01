# ADR 0008: checked-in public DEM for route elevation

- Status: accepted
- Date: 2026-09-01

## Context

Route Studio needs an elevation profile and local ascent/descent while keeping
the public fixture reproducible, usable offline, and independent of any private
infrastructure or route-cost rules.

## Decision

The Sydney fixture pins the six zoom-15 Terrarium PNGs listed in
`fixtures/sydney/dem/source.json`. They come from the Mapzen Terrain Tiles
dataset in the AWS Open Data Registry. The public fixture builder implements
the documented Terrarium formula and bilinear sampling itself, validates every
input by size and SHA-256, and writes integer `elevationM` values to graph
nodes. `cch-routing-lite` serializes those values in the versioned `CCHP2`
pack. Native and WASM consumers therefore receive the same geometry and
elevation from the same bytes.

D+/D− is the sum of positive/negative consecutive elevation differences over
the selected geometry. Elevation does not participate in routing weight or
customization. Heights are source-dependent terrain estimates, not
survey-grade claims.

## Consequences

- Normal builds and tests need no network and reproduce byte-for-byte.
- The source snapshot adds roughly half a megabyte and, together with the
  multi-layer cartography fixture, remains within the explicit 8.5 MB budget.
- Attribution and provenance travel with the fixture.
- A refresh is explicit: update the provenance lock, fetch the pinned tiles,
  rebuild, and review resulting checksums and profile changes.
- This repository demonstrates public elevation plumbing without exposing or
  approximating any private cost profile or business rule.

## Sources

- AWS Open Data Registry: <https://registry.opendata.aws/terrain-tiles/>
- Terrarium format: <https://github.com/tilezen/joerd/blob/master/docs/formats.md>
- Dataset attribution: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
