# Test Fixtures

## mini.osm.pbf

Small (~550 bytes) PBF test fixture for routing_graph extraction tests.
Hand-crafted from `mini.osm` XML source.

### Regenerate PBF from XML

```bash
osmium cat mini.osm -o mini.osm.pbf --overwrite
```

Requires: [osmium-tool](https://osmcode.org/osmium-tool/)

### Contents

**20 nodes, 5 ways** within bbox 45.000-45.010 N, 6.500-6.510 E

| Way ID | highway    | Nodes   | Length | Special tags                          |
|--------|------------|---------|--------|---------------------------------------|
| 101    | path       | 1-5     | ~625m  | oneway:foot=yes, sac_scale=hiking, surface=dirt |
| 102    | track      | 5-9     | ~434m  | surface=gravel                        |
| 103    | residential| 10-14   | ~319m  | surface=asphalt, name=Rue du Village  |
| 104    | cycleway   | 10,15-17| ~280m  | foot=yes, surface=asphalt             |
| 105    | service    | 18-20   | ~130m  | access=private, foot=designated       |

### Test features

- **2 intersections**: node 5 (Way 101 + 102), node 10 (Way 103 + 104)
- **1 way >500m**: Way 101 (path, ~625m) — tests edge splitting at TARGET_M=500
- **1 ford node**: node 8 (ford=yes) — tests OSM hazard tag extraction
- **1 oneway:foot**: Way 101 (oneway:foot=yes) — tests pedestrian oneway handling
- **cycleway with foot=yes**: Way 104 — tests foot access override on cycleway
- **service with access=private + foot=designated**: Way 105 — tests 2-level access resolution
