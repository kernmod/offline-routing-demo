# ADR 0007: Route Studio

- Status: accepted
- Date: 2026-09-01
- Delivery status: locally verified across domain, Rust/native, Rust/WASM,
  Worker/D1, mobile, browser, release gate, and benchmark; public live
  verification is closed on the deployed `main` baseline

## Context

The public demo must move from a two-tap route sample to a complete route editing
workflow that is still safe to publish. A recruiter should be able to inspect the
mobile app, the browser viewer, the Worker API, the fixture builder, and the Rust
routing core without needing any private service or private data.

The new surface adds user text, local draft state, elevation, multipoint routing,
and browser-side routing. Those are useful portfolio signals, but they also add
security and public-boundary risks if each client grows its own model.

## Decision

Route Studio uses one shared, public editing contract in
`packages/route-studio`. Mobile and viewer consume the same `RouteDraft` with
`schemaVersion: 2` and a monotonic `revision`, while
`packages/shared` retains only transport-neutral geometry and API metric helpers.
The domain emits the API's exact `{ name, geometry, controlPoints }` publication
body; idempotency stays in the HTTP header. The API stores immutable published
records with a server-assigned UUID and never accepts a client-derived route
identity, status, or metric.

The lifecycle is explicit:

```text
draft -> ready -> publishing -> published
                ^          |
                |          v
                +------- ready
```

`draft → ready → publishing → published` is the happy path.
`publishing → ready` is the retry path after a network or validation failure.
Published records are immutable public snapshots. Further edits create a new local
draft revision and a later publication creates a different server-assigned UUID.

## Shared domain

`RouteDraft` owns the editable state: ordered control points, routed legs, loop
state, trim range, profile samples, name, `schemaVersion`, transition state,
`revision`, and local persistence metadata. A published API record is the inert public snapshot
returned by the Worker; it is deliberately not another editable domain object.

The route is stored as adjacent legs rather than as one opaque polyline. Moving,
deleting, or reordering a control point invalidates only incident legs. Closing a
loop adds a virtual last-to-first leg; it does not duplicate the first control
point. The full geometry remains the source of truth until publication.

Mobile and viewer may present different controls, but they must not define
independent editable route models.

## Draft lifecycle

Drafts remain in local persistence until an explicit publish action. Without
authentication, anonymous server-side drafts would be enumerable public data, so
this version does not send draft records to the Worker.

Publishing requires a non-empty name, at least two control points, a complete
routed geometry, and a UUIDv4 idempotency key. The Worker hashes the idempotency
key, recomputes bbox, distance, ascentM, descentM, and profile summaries from the
submitted public geometry, and stores only the published immutable snapshot.

## Browser routing boundary

The browser uses WebAssembly to run the same Rust query code as the native app.
It loads the same byte-identical `routing.pack` used by mobile and performs all
route calculations locally in the page runtime without requiring a Web Worker.
Byte identity is enforced by the committed fixture manifest plus native/WASM
parity tests, not by a separate runtime manifest verifier in the browser.

The publish/read API never routes. There is no HTTP routing API, no server-side
fallback, and no JavaScript shortest-path replacement for the CCH query path.
Network access in the viewer is limited to static assets and segment publish/read.

## Public elevation data

Elevation comes from a public DEM contract, not from a private cost model. The
Sydney fixture pins provider licence links, attribution, acquisition date, source
SHA-256 values, a source-dependent vertical datum, and the Australian component's
CC-BY-4.0 licence for six checked-in Terrarium tiles. The builder refuses transparent
no-data and sentinel no-data samples and requires `elevationM`
on every graph node before emitting `CCHP2`; ADR 0008 records the full decision.

Route metrics expose `elevationM`, `elevationGainM`, `elevationLossM`, and D+/D-. These values are
derived from public samples after route unpacking. They do not affect CCH weights
or encode any private routing preference.

## Testing contract

The first gate is `tools/audit/route-studio-contract.test.mjs`, which starts RED
until this ADR and the Route Studio TDD matrix exist. Later gates must add tests
for the shared domain, DEM enrichment, native pack parsing, WASM parity, publish
validation, no network route behavior, and web/mobile editor flows before their
implementation.

Coverage thresholds are enforceable: Route Studio domain 95 percent lines/functions and
90 percent branches, studio UI 90/85, WASM adapter 90, and API transition 95/90.

## Consequences

The public repo gains a richer portfolio surface while keeping a narrow
publication boundary. The trade-off is that draft sync, multi-tenant ownership,
authentication, and collaborative editing are intentionally outside this ADR.

The WASM path adds build complexity and asset-path risk on GitHub Pages. That cost
is accepted because it proves the browser can route from the same public fixture
without installing the APK.
