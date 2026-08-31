# cch-routing-lite

This crate is the offline routing kernel used by the demo. It implements a
Customizable Contraction Hierarchy (CCH), rather than running Dijkstra over the
original graph at request time.

The public build pipeline is intentionally split from the mobile runtime:

1. `build-pack` reads the neutral `graph.json` fixture.
2. A deterministic coordinate-median separator ordering assigns one rank to
   each node. CCH correctness is independent of ordering quality.
3. Gaussian elimination completes the upward chordal graph with fill arcs.
4. Basic lower-triangle customization writes directional weights and explicit
   shortcut witnesses.
5. The graph, CCH topology, customized weights, and unpack provenance are
   serialized together and compressed into the versioned `CCHP1` artifact.
6. `Router::from_pack_bytes` validates those arrays but never orders,
   eliminates, or customizes the graph.
7. A query snaps its endpoints, runs two upward CCH searches, selects their
   best meeting rank, and recursively expands every shortcut back to original
   coordinates.

The route returned across the public boundary contains geometry and generic
cost only. Original node identifiers, stable route identifiers, application
profiles, and product metadata are deliberately absent.

## Correctness gates

The tests compare all pairs against a test-only Dijkstra reference on chains,
weighted grids, generated asymmetric graphs, and a connected Sydney fixture
subset. A dedicated case proves that a one-arc CCH query expands to two
original arcs. Other tests cover deterministic pack bytes, malformed packs,
cost-domain bounds, bounded decompression, the five-megabyte fixture budget,
snapping, CLI behavior, and the complete C ABI ownership contract.

Production code contains no original-graph Dijkstra fallback. Its priority
queue is constrained to serialized upward CCH arcs; the unrestricted reference
algorithm exists only in `tests/router.rs`.

## Algorithm provenance

The implementation follows the elimination-fill, lower-triangle
customization, upward-query, and recursive-unpack techniques described by the
MIT-licensed RoutingKit and rust-road-router projects. This repository's code
is provided under `MIT OR Apache-2.0`; see the root license files.
