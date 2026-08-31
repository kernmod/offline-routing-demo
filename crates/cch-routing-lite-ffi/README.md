# cch-routing-lite-ffi

This crate exposes the immutable offline router through a small C ABI suitable
for a Nitro module:

- `routing_router_load` validates a complete precomputed pack;
- `routing_router_route` returns owned JSON `{total_weight, polyline}` bytes;
- `routing_router_benchmark` executes the fixed 1,024-request real routing
  corpus and reports raw latency quantiles plus pack-load time;
- `routing_router_free` and `routing_buffer_free` are repeat-safe.

The stable declarations live in `include/cch_routing_lite.h` and compile as
both C11 and C++17.

Handles and buffers use registries, so stale or duplicated foreign handles are
never dereferenced. Mutex poison is recovered without `expect`, and every
exported entry point has an unwind barrier so a Rust panic never crosses the C
ABI. Every allocation returned by Rust has one explicit release function. The
embedding app attaches device and build provenance to benchmark output; the
native kernel never invents it.
