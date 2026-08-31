# Sydney fixture attribution

The road data in `source.osm.json` is © OpenStreetMap contributors and is
available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

- Geographic extent: Sydney CBD, Australia (`151.204, -33.873, 151.217, -33.862`)
- Snapshot: `2026-08-31T07:49:41Z`
- Extract: highway ways and their referenced nodes
- Canonical source: OpenStreetMap, queried through the public Overpass API

The normalized source is checked into the repository. Building the runtime
assets from that file performs no network request. The basemap intentionally
contains no labels, so the local glyph template is never requested by the
style; an empty font range is included to keep all style URLs local.
