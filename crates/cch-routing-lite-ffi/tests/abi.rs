use cch_routing_lite::{BuildConfig, Coordinate, PackArc};
use cch_routing_lite_ffi::{
    routing_buffer_free, routing_router_benchmark, routing_router_free, routing_router_load,
    routing_router_route, RoutingBuffer, RoutingCoordinate, ROUTING_ERR_BAD_PACK,
    ROUTING_ERR_INVALID_ARGUMENT, ROUTING_ERR_ROUTE, ROUTING_OK,
};
use std::sync::{Arc, Barrier};

fn pack() -> Vec<u8> {
    BuildConfig {
        nodes: vec![Coordinate::new(45.0, 6.0), Coordinate::new(45.0, 6.001)],
        arcs: vec![PackArc::new(0, 1, 7)],
        ranks: vec![0, 1],
    }
    .to_pack_bytes()
    .unwrap()
}

#[test]
fn null_and_bad_packs_are_rejected() {
    assert!(unsafe { routing_router_load(std::ptr::null(), 0) }.is_null());
    let bad = b"bad";
    assert!(unsafe { routing_router_load(bad.as_ptr(), bad.len()) }.is_null());
    assert_eq!(
        cch_routing_lite_ffi::routing_last_error(),
        ROUTING_ERR_BAD_PACK
    );
}

#[test]
fn zero_length_pack_is_explicitly_rejected_before_pointer_conversion() {
    let nonnull = std::ptr::NonNull::<u8>::dangling().as_ptr();
    assert!(unsafe { routing_router_load(nonnull, 0) }.is_null());
    assert_eq!(
        cch_routing_lite_ffi::routing_last_error(),
        ROUTING_ERR_BAD_PACK
    );
}

#[test]
fn last_load_error_is_isolated_per_calling_thread() {
    let bad_load_finished = Arc::new(Barrier::new(2));
    let good_load_finished = Arc::new(Barrier::new(2));

    let bad_barrier = Arc::clone(&bad_load_finished);
    let good_barrier = Arc::clone(&good_load_finished);
    let bad_thread = std::thread::spawn(move || {
        assert!(unsafe { routing_router_load(std::ptr::null(), 0) }.is_null());
        bad_barrier.wait();
        good_barrier.wait();
        assert_eq!(
            cch_routing_lite_ffi::routing_last_error(),
            ROUTING_ERR_BAD_PACK
        );
    });

    bad_load_finished.wait();
    let valid_pack = pack();
    let router = unsafe { routing_router_load(valid_pack.as_ptr(), valid_pack.len()) };
    assert!(!router.is_null());
    assert_eq!(cch_routing_lite_ffi::routing_last_error(), ROUTING_OK);
    good_load_finished.wait();

    bad_thread.join().unwrap();
    routing_router_free(router);
}

#[test]
fn ffi_source_has_no_panicking_mutex_expectations() {
    let source = include_str!("../src/lib.rs");
    assert!(!source.contains(".lock()\n        .expect("));
    assert!(!source.contains(".lock().expect("));
}

#[test]
fn route_success_and_buffer_ownership_are_explicit() {
    let pack = pack();
    let router = unsafe { routing_router_load(pack.as_ptr(), pack.len()) };
    assert!(!router.is_null());
    let mut buffer = RoutingBuffer::default();
    let result = unsafe {
        routing_router_route(
            router,
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.0,
            },
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.001,
            },
            &mut buffer,
        )
    };
    assert_eq!(result, ROUTING_OK);
    assert!(!buffer.ptr.is_null());
    assert!(buffer.len > 0);
    let mut aliased_copy = RoutingBuffer {
        ptr: buffer.ptr,
        len: buffer.len,
        cap: buffer.cap,
    };
    unsafe { routing_buffer_free(&mut buffer) };
    assert!(buffer.ptr.is_null());
    assert_eq!(buffer.len, 0);
    unsafe { routing_buffer_free(&mut buffer) };
    // Foreign callers can accidentally copy this trivial C struct. Registry
    // ownership makes freeing that stale copy a safe no-op, not a double free.
    unsafe { routing_buffer_free(&mut aliased_copy) };
    assert!(aliased_copy.ptr.is_null());
    routing_router_free(router);
    routing_router_free(router);
}

#[test]
fn stale_handles_route_errors_and_nonempty_outputs_have_stable_status_codes() {
    let pack = pack();
    let router = unsafe { routing_router_load(pack.as_ptr(), pack.len()) };
    assert_eq!(cch_routing_lite_ffi::routing_last_error(), ROUTING_OK);

    let mut output = RoutingBuffer::default();
    let route_error = unsafe {
        routing_router_route(
            router,
            RoutingCoordinate { lat: 0.0, lng: 0.0 },
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.001,
            },
            &mut output,
        )
    };
    assert_eq!(route_error, ROUTING_ERR_ROUTE);
    assert!(output.ptr.is_null());

    let mut nonempty = RoutingBuffer {
        ptr: std::ptr::dangling_mut::<u8>(),
        len: 1,
        cap: 1,
    };
    assert_eq!(
        unsafe {
            routing_router_route(
                router,
                RoutingCoordinate {
                    lat: 45.0,
                    lng: 6.0,
                },
                RoutingCoordinate {
                    lat: 45.0,
                    lng: 6.001,
                },
                &mut nonempty,
            )
        },
        ROUTING_ERR_INVALID_ARGUMENT,
    );
    // Do not pass the deliberately foreign pointer to the ownership API.
    nonempty = RoutingBuffer::default();
    assert!(nonempty.ptr.is_null());

    routing_router_free(router);
    assert_eq!(
        unsafe {
            routing_router_route(
                router,
                RoutingCoordinate {
                    lat: 45.0,
                    lng: 6.0,
                },
                RoutingCoordinate {
                    lat: 45.0,
                    lng: 6.001,
                },
                &mut output,
            )
        },
        ROUTING_ERR_INVALID_ARGUMENT,
    );
}

#[test]
fn null_output_buffer_is_rejected() {
    let pack = pack();
    let router = unsafe { routing_router_load(pack.as_ptr(), pack.len()) };
    let result = unsafe {
        routing_router_route(
            router,
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.0,
            },
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.001,
            },
            std::ptr::null_mut(),
        )
    };
    assert_eq!(result, ROUTING_ERR_INVALID_ARGUMENT);
    routing_router_free(router);
}

#[test]
fn null_handles_and_buffers_are_noops_or_rejected() {
    let mut buffer = RoutingBuffer::default();
    let route_status = unsafe {
        routing_router_route(
            std::ptr::null(),
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.0,
            },
            RoutingCoordinate {
                lat: 45.0,
                lng: 6.001,
            },
            &mut buffer,
        )
    };
    assert_eq!(route_status, ROUTING_ERR_INVALID_ARGUMENT);
    routing_router_free(std::ptr::null_mut());
    unsafe { routing_buffer_free(std::ptr::null_mut()) };
}

#[test]
fn benchmark_uses_the_real_router_and_returns_a_fixed_1024_request_corpus() {
    let pack = pack();
    let router = unsafe { routing_router_load(pack.as_ptr(), pack.len()) };
    let mut buffer = RoutingBuffer::default();

    let result = unsafe { routing_router_benchmark(router, &mut buffer) };

    assert_eq!(result, ROUTING_OK);
    let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len) };
    let report: serde_json::Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(report["corpusSize"], 1024);
    assert_eq!(
        report["successes"].as_u64().unwrap() + report["failures"].as_u64().unwrap(),
        1024
    );
    for field in [
        "packLoadMicros",
        "minMicros",
        "p50Micros",
        "p95Micros",
        "p99Micros",
        "maxMicros",
    ] {
        assert!(
            report[field].is_u64(),
            "missing integer latency field {field}"
        );
    }
    assert!(report["minMicros"].as_u64() <= report["p50Micros"].as_u64());
    assert!(report["p50Micros"].as_u64() <= report["p95Micros"].as_u64());
    assert!(report["p95Micros"].as_u64() <= report["p99Micros"].as_u64());
    assert!(report["p99Micros"].as_u64() <= report["maxMicros"].as_u64());
    unsafe { routing_buffer_free(&mut buffer) };
    routing_router_free(router);
}

#[test]
fn benchmark_rejects_null_stale_and_null_output_handles() {
    let mut buffer = RoutingBuffer::default();
    assert_eq!(
        unsafe { routing_router_benchmark(std::ptr::null(), &mut buffer) },
        ROUTING_ERR_INVALID_ARGUMENT,
    );

    let stale = 777_777usize as *mut cch_routing_lite_ffi::RoutingHandle;
    assert_eq!(
        unsafe { routing_router_benchmark(stale, &mut buffer) },
        ROUTING_ERR_INVALID_ARGUMENT,
    );

    let pack = pack();
    let router = unsafe { routing_router_load(pack.as_ptr(), pack.len()) };
    assert_eq!(
        unsafe { routing_router_benchmark(router, std::ptr::null_mut()) },
        ROUTING_ERR_INVALID_ARGUMENT,
    );
    routing_router_free(router);
}
