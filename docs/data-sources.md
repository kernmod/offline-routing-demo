# Data sources and licences

## Sydney CBD fixture

The checked-in fixture is a real, deliberately small extract of Sydney CBD:

| Field | Value |
| --- | --- |
| Bounds | `151.204,-33.873,151.217,-33.862` |
| Snapshot | `2026-09-01T03:49:29Z` |
| Provider | © OpenStreetMap contributors |
| Database licence | ODbL 1.0 |
| Normalized source | `fixtures/sydney/source.osm.json` |
| Nodes | `18,954` |
| Roads | `3,008` |
| Buildings | `932` |
| Water features | `33` |
| Landuse features | `244` |

The source contains closed ways only. The public cartography fixture deliberately
omits multipolygon relations, holes, labels, and POI layers so the public repo
stays compact and easy to audit. The optional `tools/fixtures/fetch-source.mjs`
refresh command uses the public Overpass API and records the source timestamp
returned by Overpass. It is not part of the build: the normalized source is
checked in so `make fixture` performs no data download.

The source database and its derived data (`graph.json`, `map.pmtiles`, and the
routing pack) retain the OpenStreetMap attribution and ODbL terms. The fixture
has its own attribution file, and every generated data, runtime, style, and
attribution asset has a size and SHA-256 digest in `manifest.json`. The current
public PMTiles archive is 4 layers, 26 tiles, and `1,005,723` bytes; the full
fixture totals `6,565,610` bytes, which stays under the 8.5 MB budget. The
repository's software licence does not replace the data licence.

## Public elevation snapshot

Elevation is derived from six checked-in Mapzen Terrain Tiles covering the
fixture bounds at zoom 15. The tiles are distributed through the AWS Open Data
Registry dataset `elevation-tiles-prod`; for Australia the upstream attribution
is `© Commonwealth of Australia (Geoscience Australia) 2017`. Exact source
URLs, byte sizes, SHA-256 digests, capture date, and attribution links are
pinned in `fixtures/sydney/dem/source.json`.

Tilezen identifies Geoscience Australia as the Australian component. The
corresponding GA SRTM 1-second DEM metadata publishes that component under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and provides the
recommended citation; both are pinned beside the Tilezen composite attribution.

The source PNGs use the documented Terrarium encoding:

```text
elevation metres = red × 256 + green + blue ÷ 256 − 32768
```

The fixture builder decodes the PNGs locally, bilinearly samples the DEM at
each graph node, and rounds elevations to integer metres. The vertical datum is
source-dependent, so this demo treats the values as terrain-profile estimates,
not survey-grade heights. Elevation does not alter routing weights or introduce
a private cost profile; it is only attached to route geometry for display and
for deterministic D+/D− arithmetic. The web and mobile map renderers consume
the same elevation-aware fixture bytes, but terrain rendering itself remains
off; the 3D view uses building extrusion only.

`make fixture` never uses the network. Maintainers may deliberately refresh the
pinned elevation inputs with `node tools/fixtures/fetch-dem.mjs`; that command
refuses any response whose size or digest differs from `source.json`, so a
source update requires an explicit review of the provenance lock first.

## Deterministic transformation

The build performs the following local transformations:

1. normalize the pinned OSM extract by numeric object ID and a small allowlist
   of routing/map tags;
2. keep walkable highway pairs inside the declared bounds, reject private or
   explicitly non-pedestrian ways, select the largest connected component, and
   emit stable node indices plus symmetric directed arcs;
3. sample the checked-in Terrarium DEM and attach integer `elevationM` values
   to nodes without changing arc weights;
4. compute each arc weight as the rounded haversine distance in metres;
5. encode label-free `roads`, `buildings`, `water`, and `landuse` vector tiles
   for zooms 13–16 into a PMTiles v3 archive;
6. compile the graph with the public `cch-routing-lite build-pack` binary into
   the versioned `CCHP2` format;
7. regenerate the manifest from the resulting bytes.

`graph.json` intentionally has the exact public builder schema, with no hidden
metadata:

```json
{
  "nodes": [{ "lat": -33.867, "lng": 151.21, "elevationM": 18 }],
  "arcs": [{ "from": 0, "to": 1, "weight": 42 }]
}
```

The map style has no remote URL. It declares a local glyph URL but contains no
symbol layer, so no glyph is requested at runtime. The 3D style is derived from
the same public fixture and uses only local assets. A valid empty range is kept
with the fixture to make the local-only contract explicit.

## Reproduction and verification

After installing the pinned Node and Cargo dependencies:

```sh
make fixture
make verify-fixture
```

`make fixture` runs the data transformation with Cargo in offline mode. The
verification command builds two independent temporary copies, including two
independent routing packs, and compares every file byte-for-byte. It also
checks bounds, checksums, archive offsets, metadata, tile type, zooms, licence,
asset budget, and routing status.

The current byte sizes and digests are generated in `manifest.json`; verification
enforces the explicit 8.5 MB total fixture budget, including the multi-layer
PMTiles archive, the DEM snapshot, and human-readable attribution. This avoids
duplicating numbers that can become stale after a deliberate source refresh.

For an independent compatibility check, PMTiles JavaScript 4.5.0 reads the
header, metadata, and a centre tile; `@mapbox/vector-tile` 2.0.4 decodes that
tile and confirms the `roads`, `buildings`, `water`, and `landuse` layer
contract plus public building-height properties at extent 4096. These tools are
QA checks, not build dependencies.

The coverage metric applies to the deterministic normalization, build, and
verification library. The thin CLI wrappers contain only argument parsing and
delegation. The optional HTTP call in `fetch-source.mjs` is deliberately not
executed by the offline test suite; its normalization is pure and unit-tested,
and the checked-in snapshot is the build input.
