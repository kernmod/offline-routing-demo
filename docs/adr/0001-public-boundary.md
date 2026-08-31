# ADR 0001: a narrow public routing demonstration

- Status: accepted
- Date: 2026-08-31

## Context

The repository must be useful on its own and safe to inspect publicly. Reusing
an existing product tree would carry unrelated history, infrastructure names,
credentials, domain concepts, and operational assumptions into a portfolio
sample.

## Decision

Build a new monorepo with a new Git history around one neutral use case:
embedded public map data, an on-device shortest-path query, and anonymous
publish/read endpoints for the resulting geometry.

The public surface contains only:

- a bounded OpenStreetMap-derived Sydney fixture;
- generic CCH preprocessing, customization, query, and path unpacking;
- a routing-only C ABI and Nitro bridge;
- a loopback PMTiles server;
- anonymous geometry validation, storage, and bbox reads;
- an install-free viewer of those public records.

The audit rejects private endpoints, product-specific symbols, signing
material, environment files, generated native binaries, and unexpected Git
remotes in both the working tree and reachable history. A separate gitleaks
scan runs before publication and in CI.

## Consequences

- The demo can be evaluated without access to another repository or service.
- A checksum is used only for fixture integrity; segment identity is a UUID.
- No account, sensor, location permission, free-form text, analytics, or
  long-term user history belongs in scope.
- Useful generic corrections are implemented here first and can be consumed by
  another system later through normal package/version boundaries.

## Rejected options

- Publish a filtered branch of an existing product: hidden history and
  accidental coupling remain difficult to prove absent.
- Replace the native engine with a JavaScript approximation: it would not
  demonstrate the intended systems boundary.
- Depend on a private tile or routing endpoint: it would make the offline claim
  non-reproducible.
