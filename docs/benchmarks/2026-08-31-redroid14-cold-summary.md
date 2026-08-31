# Redroid Android 14 native CCH benchmark

This initial run is retained as historical evidence. The release verdict uses
the later [fresh isolated-device run](2026-08-31-redroid14-isolated-cold-summary.md).

Device: `redroid14_x86_64 (AX102)`; Android 14; x86_64; airplane mode on.

Twenty cold application loads ran the native Nitro benchmark. Each raw JSON
file named `2026-08-31T09-45-09Z-cold-01.json` through `-cold-20.json`
contains one complete 1024-query corpus result. Every run reports 1024
successes and 0 failures.

| Metric across the 20 raw runs | min | median | max |
| --- | ---: | ---: | ---: |
| Per-run query p50 (microseconds) | 1092 | 1108 | 1153 |
| Per-run query p95 (microseconds) | 1447 | 1481 | 1566 |
| Pack load (microseconds) | 95134 | 98734 | 111614 |

The separate single-run raw result is
`2026-08-31T09-44-49Z.json`. These are device observations, not a universal
performance claim.
