# Sydney fixture attribution

The road and cartographic polygon data in `source.osm.json` is © OpenStreetMap contributors and is
available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

- Geographic extent: Sydney CBD, Australia (`151.204, -33.873, 151.217, -33.862`)
- Snapshot: `2026-09-01T03:49:29Z`
- Extract: highway ways plus closed building, water and selected land-use ways, with their referenced nodes
- Canonical source: OpenStreetMap, queried through the public Overpass API

The normalized source is checked into the repository. Building the runtime
assets from that file performs no network request. The basemap intentionally
contains no labels, so the local glyph template is never requested by the
style; an empty font range is included to keep all style URLs local.

This bounded fixture deliberately supports closed OSM ways only. Relation-based
multipolygons and holes are outside its public demo scope; they are neither
silently flattened nor imported. Building extrusion heights are derived from
public `height`, `building:levels`, `min_height` and
`building:min_level` tags, then bounded to conservative display values.

## Elevation

Elevation is derived from the public **Terrain Tiles** dataset managed by
Mapzen/Tilezen and distributed through the AWS Open Data bucket
`elevation-tiles-prod`. The six checked-in zoom-15 PNGs use the documented
Terrarium encoding. Their URLs, byte sizes and SHA-256 digests are pinned in
`dem/source.json`, so the regular fixture build makes no network request.

Terrain data processed by Mapzen/Tilezen; Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017.

The Australian elevation component is published under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Product metadata and the
recommended citation are pinned in `dem/source.json`; the Tilezen composite
attribution remains mandatory.

The upstream mosaic combines public terrain sources and does not expose one
survey-grade vertical datum for every output pixel. This demo therefore labels
the profile as derived terrain elevation and does not use it to alter routing
costs. See the [Terrarium format](https://github.com/tilezen/joerd/blob/master/docs/formats.md) and
[upstream attribution requirements](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
