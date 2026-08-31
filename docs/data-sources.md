# Data sources and licences

## Sydney CBD fixture

The checked-in fixture is a real, deliberately small extract of Sydney CBD:

| Field | Value |
| --- | --- |
| Bounds | `151.204,-33.873,151.217,-33.862` |
| Snapshot | `2026-08-31T07:49:41Z` |
| Provider | © OpenStreetMap contributors |
| Database licence | ODbL 1.0 |
| Normalized source | `fixtures/sydney/source.osm.json` |

The source contains highway ways and their referenced nodes. The optional
`tools/fixtures/fetch-source.mjs` refresh command uses the public Overpass API
with the timestamp pinned in the query. It is not part of the build: the
normalized source is checked in so `make fixture` performs no data download.

The source database and its derived data (`graph.json`, `map.pmtiles`, and the
routing pack) retain the OpenStreetMap attribution and ODbL terms. The fixture
has its own attribution file, and every generated data, runtime, style, and
attribution asset has a size and SHA-256 digest in
`manifest.json`. The repository's software licence does not replace the data
licence.

## Deterministic transformation

The build performs the following local transformations:

1. normalize the pinned OSM extract by numeric object ID and a small allowlist
   of routing/map tags;
2. keep walkable highway pairs inside the declared bounds, reject private or
   explicitly non-pedestrian ways, select the largest connected component, and
   emit stable node indices plus symmetric directed arcs;
3. compute each arc weight as the rounded haversine distance in metres;
4. encode label-free `roads` vector tiles for zooms 13–16 into a PMTiles v3
   archive;
5. compile the graph with the public `cch-routing-lite build-pack` binary;
6. regenerate the manifest from the resulting bytes.

`graph.json` intentionally has the exact public builder schema, with no hidden
metadata:

```json
{
  "nodes": [{ "lat": -33.867, "lng": 151.21 }],
  "arcs": [{ "from": 0, "to": 1, "weight": 42 }]
}
```

The map style has no remote URL. It declares a local glyph URL but contains no
symbol layer, so no glyph is requested at runtime. A valid empty range is kept
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

Current checked-in runtime assets total 3,521,789 bytes. With the 760-byte
human-readable attribution notice, the manifest covers 3,522,549 bytes, below
the 5 MB budget:

| Asset | Bytes |
| --- | ---: |
| `source.osm.json` | 1,545,438 |
| `graph.json` | 840,023 |
| `map.pmtiles` | 680,630 |
| `routing.pack` | 454,271 |
| style + glyph range | 1,427 |

For an independent compatibility check, PMTiles JavaScript 4.5.0 reads the
header, metadata, and a centre tile; `@mapbox/vector-tile` 2.0.4 decodes that
tile as a `roads` layer with 702 features and extent 4096. These tools are QA
checks, not build dependencies.

The coverage metric applies to the deterministic normalization, build, and
verification library. The thin CLI wrappers contain only argument parsing and
delegation. The optional HTTP call in `fetch-source.mjs` is deliberately not
executed by the offline test suite; its normalization is pure and unit-tested,
and the checked-in snapshot is the build input.
