# ADR 0009: public 3D cartography without private map artifacts

- Status: accepted
- Date: 2026-09-01

## Context

The original public fixture proved offline routing, but its roads-only basemap
left too much of the cartography stack invisible. The public repo needs a map
that is easier for a recruiter to inspect and evaluate while remaining fully
offline, reproducible from checked-in public inputs, and cleanly separated from
any private product tiles, style, or infrastructure.

## Decision

The Sydney CBD fixture now regenerates a bounded PMTiles v3 archive from the
checked-in public `source.osm.json` snapshot. The normalized source keeps only:

- walkable road ways for routing and line rendering;
- closed building/building:part ways;
- closed water ways;
- closed landuse or selected area-class ways.

The builder emits four public vector layers: `roads`, `buildings`, `water`, and
`landuse`. The style remains local-only and uses standard MapLibre
`fill-extrusion` for buildings. Heights are derived only from public OSM tags
`height`, `min_height`, `building:levels`, and `building:min_level`, then
bounded to conservative render values through `render_height` and
`render_min_height`.

Both clients use the same public cartography contract:

- web: MapLibre GL JS + PMTiles protocol;
- mobile: MapLibre Native + loopback tile server;
- both expose a visible 2D/3D toggle with the same pitched camera defaults.

Terrain rendering is intentionally excluded. The DEM remains a route-profile
input, not a live 3D terrain surface, because this scope is about public-safe
cartography and shared offline packaging rather than terrain shaders or private
cost logic.

## Consequences

- The repo shows a fuller offline map stack without importing private PMTiles or
  style assets.
- The fixture budget increases from the original 5 MB cap to an explicit 8.5 MB
  cap, because the public PMTiles archive now carries buildings, water, and
  landuse in addition to roads.
- The fixture remains byte-reproducible because `make fixture` rebuilds from
  checked-in public inputs only.
- The public boundary stays auditable: no labels, no POI layer, no remote style
  URL, no terrain endpoint, and no private vocabulary in the cartography
  assets.
- Multipolygon relations and polygon holes remain outside this demo contract to
  keep the builder deterministic, compact, and easy to inspect.

## Sources

- PMTiles specification: <https://github.com/protomaps/PMTiles>
- MapLibre Style Specification: <https://maplibre.org/maplibre-style-spec/>
- OpenStreetMap contributors / ODbL 1.0: <https://www.openstreetmap.org/copyright>
