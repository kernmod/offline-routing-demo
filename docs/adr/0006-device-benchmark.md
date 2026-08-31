# ADR 0006: fixed-corpus benchmark through the production bridge

- Status: accepted
- Date: 2026-08-31

## Context

A desktop microbenchmark would not establish the latency seen by the Android
application. A single best-case query would also hide distribution shape,
failed routes, and pack-load cost.

## Decision

Benchmark the same Nitro/C++/Rust path used by the UI on an explicitly named
ADB target. The fixture owns a deterministic corpus of 1,024 origin/destination
pairs generated from a fixed seed. Every report records:

- device name, Android version, CPU ABI, airplane-mode state, and fixture hash;
- successful and failed query counts;
- warm `min`, `p50`, `p95`, `p99`, and `max` latency in microseconds;
- pack-load latency separately from warm routing;
- raw JSON and log output, not only a README summary.

Cold-load evidence consists of 20 fresh application runs. The public summary
uses medians across those runs and labels the target as an emulator when it is
one. Device memory is a separate `dumpsys meminfo` snapshot and is not folded
into routing latency.

## Consequences

- Results are reproducible and regressions can compare the same corpus.
- Failures cannot disappear from a percentile summary.
- Final evidence characterizes `redroid14_x86_64 isolated (AX102)` in a fresh
  container with ADB bound to loopback, not all Android phones and not an arm64
  production device.
- A later physical-device report can be added without rewriting or deleting
  the emulator evidence.
