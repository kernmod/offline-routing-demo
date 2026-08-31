# ADR 0003: materialized z14 cells for nearby segments

Status: accepted

## Context

The public demo needs an honest nearby-segment query that works in D1. A
four-column min/max B-tree is not a spatial index: SQLite can generally exploit
only a prefix of a composite range index, which obscures the real access path.

## Decision

`segments` stores only an encoded polyline and server-derived metadata. Every
z14 Web Mercator tile crossed by the polyline is materialized in
`segment_cells(tile_key, segment_id)`. The composite primary key is the index
for the first query stage. `segment_id` is foreign-keyed to `segments` and has
its own reverse lookup index.

Reads derive z14 keys from the requested bbox, search `segment_cells` first,
join candidates to `segments`, then apply exact min/max intersection and TTL.
`SELECT DISTINCT` removes a segment that crosses several requested cells.

## Constraints

- Geometry and query bboxes are limited to the public Sydney fixture.
- A request is at most 16 KiB, 128 points, 64 stored cells, and 64 query cells.
- User rows expire after 24 hours. The fixture seed is permanent and marked
  `is_seed = 1`.
- The API stores a SHA-256 idempotency-key digest, never the caller's key. It
  accepts only UUIDv4 idempotency keys.

## Evidence

`pnpm --filter @offline-routing/api test` invokes Wrangler against a temporary
real local D1 database, applies both migrations, and asserts that
`EXPLAIN QUERY PLAN` reports `SEARCH sc USING ... segment_cells`. The same
query is available for manual inspection through `pnpm --filter
@offline-routing/api d1:explain:local`.

## Consequences

- Writes fan out by a bounded number of cells; the bound is explicit instead of
  pretending that a generic B-tree is spatial.
- A coordinate is only a prefilter key; exact bbox predicates remain mandatory.
- This is deliberately not an RTree claim, nor a geographic-database claim.
