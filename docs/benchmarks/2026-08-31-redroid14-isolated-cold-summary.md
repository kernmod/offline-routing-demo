# Isolated Redroid Android 14 native CCH benchmark

Device: `redroid14_x86_64 isolated (AX102)`; Android 14; x86_64; airplane mode
on. The final release APK ran in the fresh `offline-routing-redroid` container,
with ADB exposed on loopback only.

Twenty cold application starts exercised the production Nitro/C++/Rust path.
The raw JSON/log pairs range from `2026-08-31T20-40-45Z` through
`2026-08-31T20-42-25Z`. Every run completed its fixed 1,024-query corpus:
20,480 / 20,480 routes succeeded and none failed.

| Metric across the 20 raw runs | min | median | max |
| --- | ---: | ---: | ---: |
| Per-run query p50 (microseconds) | 1,158 | 1,177 | 1,207 |
| Per-run query p95 (microseconds) | 1,572 | 1,613 | 1,667 |
| Pack load (microseconds) | 92,363 | 98,508 | 111,232 |

The app was force-stopped before each launch. The benchmark ran with airplane
mode enabled and reports device observations, not universal Android latency.
