# Architecture

Status on 2026-08-31: locally verified for the public fixture, routing core,
API contract, browser viewer, Android release build, airplane-mode route, and
named-device benchmark. Public deployment evidence remains open.

## System shape

```text
public Sydney inputs ──> reproducible fixture builder ──> PMTiles + style + glyphs + CCHP1
                                                                     │
                                                                     v
tap A/B ──> React Native UI ──> Nitro bridge ──> C++ wrapper ──> Rust CCH query
   │             │                                            │
   │             └──────── embedded MapLibre assets ───────────┘
   │
   └── when online ──> Worker API ──> D1 segments + z14 spatial cells
                              ^                    │
                              └── MapLibre GL JS viewer <──────────┘
```

The offline boundary contains every asset needed to boot the map and calculate a
route: PMTiles, style JSON, glyph ranges, sprites, and a versioned routing pack.
The mobile UI needs no location permission; two explicit map taps make
demonstrations deterministic and avoid collecting personal coordinates.

The route flow is intentionally explicit across the bridge: JS handles user
input and screen state, Nitro moves the call into C++, C++ owns the native
object boundary, and Rust performs CCH packing, upward query, and unpacking.
The result comes back as GeoJSON and updates a reactive `GeoJSONSource` on the
map.

The online boundary is intentionally smaller. It accepts bounded encoded
geometry, recomputes derived metadata, writes one segment plus fixed Web
Mercator cell keys, and exposes bbox reads. Seed rows remain available for the
viewer; anonymous writes expire. The viewer and API share schemas from
`packages/shared`.

## Workspace responsibilities

| Path | Responsibility |
| --- | --- |
| `fixtures/sydney` | source manifest, checksums, attribution, expected outputs |
| `crates/cch-routing-lite` | public fixture builder, `CCHP1` pack loader, CCH query, recursive unpack |
| `crates/cch-routing-lite-ffi` | narrow ownership-safe C ABI |
| `crates/tile-server-lite` | bounded PMTiles v3 leaf lookup and loopback-only HTTP range serving |
| `packages/offline-router` | typed mobile-facing Nitro contract and benchmark bridge |
| `apps/mobile` | offline map, tap-to-route, publish/read UI, benchmark launcher |
| `apps/api` | validated Worker endpoints, D1 migrations, privacy rules, z14 cells |
| `apps/viewer` | install-free MapLibre GL JS segment map |

Architecture decisions that affect reproducibility, security, or public API shape are
recorded as ADRs. Operational progress belongs in issue/PR evidence, not architecture.
