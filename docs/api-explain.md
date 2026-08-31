# Segment API contract

Status: `LOCAL_READY` on 2026-08-31. The Worker builds, is covered, and runs
against real local D1 through Wrangler. It is **not yet deployed**; no URL or
live-API claim belongs in this document until the deploy evidence is recorded.

## Endpoints

`GET /health` returns `200 {"ok":true}` after a bound D1 query.

`POST /segments` accepts exactly this JSON shape:

```json
{
  "geometry": [
    { "lat": -33.8688, "lng": 151.2093 },
    { "lat": -33.8695, "lng": 151.2102 }
  ]
}
```

The content type must be `application/json`. The optional `Idempotency-Key`
header is a UUIDv4. The Worker hashes it before storage, then returns `201` for
the first request and the saved `200` representation for a repeat. It never
accepts a title, description, client timestamp, elevation, distance, or any
other free-form field.

Successful publish response:

```json
{
  "id": "8de15dc3-80d3-4c53-89e2-50b592076cf7",
  "encodedGeometry": "vxdr_Awgal_Hfw@gw@",
  "pointCount": 2,
  "distanceM": 130,
  "bbox": { "minLat": -33.8696, "minLng": 151.2091, "maxLat": -33.8687, "maxLng": 151.21 },
  "createdAt": "2026-08-31T12:34:00.000Z",
  "expiresAt": "2026-09-01T12:34:00.000Z",
  "isSeed": false
}
```

`GET /segments?bbox=minLat,minLng,maxLat,maxLng` returns:

```json
{ "segments": [/* SegmentRecord values above */] }
```

All failure payloads are generic `{ "error": "…" }`. Valid errors are
`invalid_request`, `payload_too_large`, `rate_limited`, `origin_not_allowed`,
`rate_limiter_unavailable`, `not_found`, and `internal_error`; no database
detail is returned.

## CORS and abuse boundaries

`ALLOWED_ORIGINS` is a comma-separated allowlist supplied by Worker vars. The
repository only permits local development origins. A browser origin outside the
allowlist receives `403`; a native client has no `Origin` header and is not
blocked by CORS.

Every publish and nearby read passes through Cloudflare's native `RATE_LIMITER`
binding (30 requests per 60 seconds). The Worker derives its key as
`HMAC-SHA-256(RATE_LIMIT_SALT, "offline-routing-segments:v1:" +
CF-Connecting-IP)`, then immediately discards the IP, HMAC result, and secret.
None are logged or persisted. A missing binding, secret, or Cloudflare client
IP fails closed with `503 rate_limiter_unavailable`, including native requests
without an `Origin` header; local tests provide an
explicit fake binding and salt. Cloudflare's rate limiting is still local to an
edge location and eventually consistent, so it is an abuse guard—not accounting
or an authentication claim.

The Worker neither logs nor stores free text, IP, User-Agent, request bodies,
or raw idempotency keys. It stores encoded geometry, derived spatial metadata,
timestamps, a seed flag, and a SHA-256 idempotency digest only.

## Query plan

The nearby query is intentionally two-stage:

```sql
SELECT DISTINCT s.id, s.encoded_geometry, s.point_count, s.distance_m,
  s.min_lat, s.min_lng, s.max_lat, s.max_lng, s.created_at, s.expires_at, s.is_seed
FROM segment_cells sc
JOIN segments s ON s.id = sc.segment_id
WHERE sc.tile_key IN (?, ?, ...)
  AND s.max_lat >= ? AND s.min_lat <= ?
  AND s.max_lng >= ? AND s.min_lng <= ?
  AND (s.is_seed = 1 OR s.expires_at > ?)
ORDER BY s.created_at DESC
LIMIT ?
```

The key list is derived server-side from the requested bbox. Exact bbox checks
after the cell prefilter make the result correct for lines that only touch a
cell boundary. Run the local evidence yourself:

```bash
pnpm --filter @offline-routing/api d1:migrate:local
pnpm --filter @offline-routing/api d1:explain:local
```

The second command reports `SEARCH sc USING ... segment_cells` on actual local
D1. See [ADR 0003](adr/0003-spatial-index.md) for the model and limits.

## Deployment handoff

Create a new D1 database in the target Cloudflare account, replace only the
placeholder `database_id` in `apps/api/wrangler.toml`, then configure the GitHub
variable `VIEWER_ORIGIN` with the final public HTTPS Pages origin. The deployment
workflow requires `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a random
`RATE_LIMIT_SALT` of at least 32 characters as GitHub secrets. It validates the
production origin and salt, creates a mode-0600 secrets file under the ephemeral
runner directory before any remote mutation, applies migrations, and passes the
file to `wrangler deploy` via `--secrets-file`. This makes initial Worker creation
and secret provisioning one operation; it does not depend on a Worker already
existing. An `always()` cleanup removes the temporary file after the deploy step.

After Wrangler returns the Worker URL, configure the public repository variable
`SEGMENTS_API_URL` for the Pages build. Credentials remain in GitHub or the
caller's environment; they are never committed.
Record the resulting URL, remote migration output, and a publish/read smoke test
before changing this status from `LOCAL_READY`.
