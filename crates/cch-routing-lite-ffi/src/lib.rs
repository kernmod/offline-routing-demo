//! C ABI for an immutable offline router.
//!
//! Handles are registry-backed: foreign pointers are never dereferenced, so
//! repeated frees and stale handles are harmless no-ops. Returned bytes belong
//! to the caller until passed to `routing_buffer_free`.

use std::cell::Cell;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, LazyLock, Mutex, MutexGuard,
};
use std::time::Instant;

use cch_routing_lite::{Coordinate, Router};

pub const ROUTING_OK: i32 = 0;
pub const ROUTING_ERR_INVALID_ARGUMENT: i32 = 1;
pub const ROUTING_ERR_BAD_PACK: i32 = 2;
pub const ROUTING_ERR_ROUTE: i32 = 3;
pub const ROUTING_ERR_INTERNAL: i32 = 4;

#[derive(Debug)]
struct RouterEntry {
    router: Router,
    pack_load_micros: u64,
}

#[derive(Debug)]
struct BufferEntry {
    token: usize,
    _payload: Box<[u8]>,
}

static ROUTERS: LazyLock<Mutex<HashMap<usize, Arc<RouterEntry>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static BUFFERS: LazyLock<Mutex<HashMap<usize, BufferEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_HANDLE: AtomicUsize = AtomicUsize::new(1);
static NEXT_BUFFER_TOKEN: AtomicUsize = AtomicUsize::new(1);

thread_local! {
    static LAST_ERROR: Cell<i32> = const { Cell::new(ROUTING_OK) };
}

/// Opaque, registry-backed C router handle.
#[repr(C)]
pub struct RoutingHandle {
    _private: [u8; 0],
}

/// Coordinate accepted by the C ABI.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RoutingCoordinate {
    pub lat: f64,
    pub lng: f64,
}

/// A byte allocation returned by `routing_router_route`.
///
/// The caller owns a successful buffer and must eventually call
/// `routing_buffer_free`. Calling that function more than once is safe.
#[repr(C)]
#[derive(Debug)]
pub struct RoutingBuffer {
    pub ptr: *mut u8,
    pub len: usize,
    /// Opaque generation token used by `routing_buffer_free`.
    /// Foreign code must not interpret this field as an allocation capacity.
    pub cap: usize,
}

impl Default for RoutingBuffer {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
            cap: 0,
        }
    }
}

/// Returns the status from the last load attempt on the calling thread.
#[must_use]
#[no_mangle]
pub extern "C" fn routing_last_error() -> i32 {
    LAST_ERROR.with(Cell::get)
}

/// Loads a router from immutable pack bytes.
///
/// # Safety
///
/// When `pack_len > 0`, `pack_ptr` must designate a readable allocation of
/// exactly at least `pack_len` bytes for this call. Null pointers and
/// zero-length inputs are rejected with `ROUTING_ERR_BAD_PACK` before slice
/// creation.
#[no_mangle]
pub unsafe extern "C" fn routing_router_load(
    pack_ptr: *const u8,
    pack_len: usize,
) -> *mut RoutingHandle {
    catch_pointer(|| {
        // SAFETY: the extern contract is unchanged; this wrapper only adds a panic barrier.
        unsafe { routing_router_load_impl(pack_ptr, pack_len) }
    })
}

unsafe fn routing_router_load_impl(pack_ptr: *const u8, pack_len: usize) -> *mut RoutingHandle {
    if pack_ptr.is_null() || pack_len == 0 {
        set_last_error(ROUTING_ERR_BAD_PACK);
        return std::ptr::null_mut();
    }
    // SAFETY: the C caller contract above guarantees this region is readable.
    let bytes = unsafe { std::slice::from_raw_parts(pack_ptr, pack_len) };
    let started = Instant::now();
    let Ok(router) = Router::from_pack_bytes(bytes) else {
        set_last_error(ROUTING_ERR_BAD_PACK);
        return std::ptr::null_mut();
    };
    let pack_load_micros = duration_to_ceil_micros(started.elapsed());
    let address = next_handle();
    let mut registry = lock_or_recover(&ROUTERS);
    registry.insert(
        address,
        Arc::new(RouterEntry {
            router,
            pack_load_micros,
        }),
    );
    set_last_error(ROUTING_OK);
    address as *mut RoutingHandle
}

/// Routes between two coordinates and writes an owned UTF-8 JSON payload.
///
/// # Safety
///
/// `out_buffer` must be null or point to writable `RoutingBuffer` storage.
/// A null output is rejected without dereference. `router` is treated as an
/// opaque address and is never dereferenced by this function.
#[no_mangle]
pub unsafe extern "C" fn routing_router_route(
    router: *const RoutingHandle,
    origin: RoutingCoordinate,
    destination: RoutingCoordinate,
    out_buffer: *mut RoutingBuffer,
) -> i32 {
    catch_status(|| {
        // SAFETY: the extern contract is unchanged; this wrapper only adds a panic barrier.
        unsafe { routing_router_route_impl(router, origin, destination, out_buffer) }
    })
}

unsafe fn routing_router_route_impl(
    router: *const RoutingHandle,
    origin: RoutingCoordinate,
    destination: RoutingCoordinate,
    out_buffer: *mut RoutingBuffer,
) -> i32 {
    if router.is_null() || out_buffer.is_null() {
        return ROUTING_ERR_INVALID_ARGUMENT;
    }
    let entry = {
        let registry = lock_or_recover(&ROUTERS);
        let Some(entry) = registry.get(&(router as usize)) else {
            return ROUTING_ERR_INVALID_ARGUMENT;
        };
        Arc::clone(entry)
    };
    let route = match entry.router.route(
        Coordinate::new(origin.lat, origin.lng),
        Coordinate::new(destination.lat, destination.lng),
    ) {
        Ok(route) => route,
        Err(_) => return ROUTING_ERR_ROUTE,
    };
    let Ok(payload) = serde_json::to_vec(&route) else {
        return ROUTING_ERR_INTERNAL;
    };
    // SAFETY: checked non-null above; caller guarantees writable output storage.
    unsafe { write_owned_buffer(payload, out_buffer) }
}

/// Benchmarks the complete route path over a deterministic 1,024-request
/// corpus. Pack loading is timed separately and returned as `packLoadMicros`.
///
/// The JSON payload contains only measurements; the embedding application is
/// responsible for attaching an honest device name and build provenance.
///
/// # Safety
///
/// `out_buffer` must be null or point to writable `RoutingBuffer` storage.
/// A null output is rejected without dereference. `router` is treated as an
/// opaque address and is never dereferenced by this function.
#[no_mangle]
pub unsafe extern "C" fn routing_router_benchmark(
    router: *const RoutingHandle,
    out_buffer: *mut RoutingBuffer,
) -> i32 {
    catch_status(|| {
        // SAFETY: the extern contract is unchanged; this wrapper only adds a panic barrier.
        unsafe { routing_router_benchmark_impl(router, out_buffer) }
    })
}

unsafe fn routing_router_benchmark_impl(
    router: *const RoutingHandle,
    out_buffer: *mut RoutingBuffer,
) -> i32 {
    if router.is_null() || out_buffer.is_null() {
        return ROUTING_ERR_INVALID_ARGUMENT;
    }
    let entry = {
        let registry = lock_or_recover(&ROUTERS);
        let Some(entry) = registry.get(&(router as usize)) else {
            return ROUTING_ERR_INVALID_ARGUMENT;
        };
        Arc::clone(entry)
    };
    let report = entry.router.benchmark_1024();
    let Ok(mut value) = serde_json::to_value(report) else {
        return ROUTING_ERR_INTERNAL;
    };
    let Some(object) = value.as_object_mut() else {
        return ROUTING_ERR_INTERNAL;
    };
    object.insert("packLoadMicros".into(), entry.pack_load_micros.into());
    let Ok(payload) = serde_json::to_vec(&value) else {
        return ROUTING_ERR_INTERNAL;
    };
    // SAFETY: checked non-null above; caller guarantees writable output storage.
    unsafe { write_owned_buffer(payload, out_buffer) }
}

/// Releases a router handle. Null, unknown, and repeated handles are no-ops.
///
/// The pointer is never dereferenced; it is only used as a registry key.
#[no_mangle]
pub extern "C" fn routing_router_free(router: *mut RoutingHandle) {
    catch_void(|| {
        if !router.is_null() {
            let mut registry = lock_or_recover(&ROUTERS);
            drop(registry.remove(&(router as usize)));
        }
    });
}

/// Releases a buffer returned by `routing_router_route`.
///
/// # Safety
///
/// `buffer` must be null or point to a `RoutingBuffer` initialized by this
/// crate. The function nulls it before returning, making repeated frees safe.
#[no_mangle]
pub unsafe extern "C" fn routing_buffer_free(buffer: *mut RoutingBuffer) {
    catch_void(|| unsafe { buffer_free_impl(buffer) });
}

unsafe fn buffer_free_impl(buffer: *mut RoutingBuffer) {
    if buffer.is_null() {
        return;
    }
    // SAFETY: caller contract above guarantees writable RoutingBuffer storage.
    let buffer = unsafe { &mut *buffer };
    if !buffer.ptr.is_null() {
        let mut registry = lock_or_recover(&BUFFERS);
        let key = buffer.ptr as usize;
        let owns_current_generation = registry
            .get(&key)
            .is_some_and(|entry| entry.token == buffer.cap);
        if owns_current_generation {
            drop(registry.remove(&key));
        }
    }
    *buffer = RoutingBuffer::default();
}

unsafe fn write_owned_buffer(payload: Vec<u8>, out_buffer: *mut RoutingBuffer) -> i32 {
    // SAFETY: every caller checks the pointer and documents writable storage.
    let output = unsafe { &mut *out_buffer };
    if !output.ptr.is_null() || output.len != 0 || output.cap != 0 {
        return ROUTING_ERR_INVALID_ARGUMENT;
    }
    let mut payload = payload.into_boxed_slice();
    let ptr = payload.as_mut_ptr();
    let len = payload.len();
    let token = next_nonzero(&NEXT_BUFFER_TOKEN);
    let mut registry = lock_or_recover(&BUFFERS);
    if registry.contains_key(&(ptr as usize)) {
        return ROUTING_ERR_INTERNAL;
    }
    registry.insert(
        ptr as usize,
        BufferEntry {
            token,
            _payload: payload,
        },
    );
    *output = RoutingBuffer {
        ptr,
        len,
        cap: token,
    };
    ROUTING_OK
}

fn duration_to_ceil_micros(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_nanos())
        .unwrap_or(u64::MAX)
        .saturating_add(999)
        / 1_000
}

fn catch_status(callback: impl FnOnce() -> i32) -> i32 {
    match catch_unwind(AssertUnwindSafe(callback)) {
        Ok(status) => status,
        Err(_) => {
            set_last_error(ROUTING_ERR_INTERNAL);
            ROUTING_ERR_INTERNAL
        }
    }
}

fn catch_pointer<T>(callback: impl FnOnce() -> *mut T) -> *mut T {
    match catch_unwind(AssertUnwindSafe(callback)) {
        Ok(pointer) => pointer,
        Err(_) => {
            set_last_error(ROUTING_ERR_INTERNAL);
            std::ptr::null_mut()
        }
    }
}

fn catch_void(callback: impl FnOnce()) {
    if catch_unwind(AssertUnwindSafe(callback)).is_err() {
        set_last_error(ROUTING_ERR_INTERNAL);
    }
}

fn set_last_error(code: i32) {
    LAST_ERROR.set(code);
}

fn next_handle() -> usize {
    next_nonzero(&NEXT_HANDLE)
}

fn next_nonzero(counter: &AtomicUsize) -> usize {
    loop {
        let value = counter.fetch_add(1, Ordering::Relaxed);
        if value != 0 {
            return value;
        }
    }
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod panic_barrier_tests {
    use super::*;

    #[test]
    fn panic_barriers_map_unexpected_panics_to_abi_safe_results() {
        assert_eq!(catch_status(|| panic!("test panic")), ROUTING_ERR_INTERNAL);
        assert!(catch_pointer::<RoutingHandle>(|| panic!("test panic")).is_null());
        catch_void(|| panic!("test panic"));
    }

    #[test]
    fn stale_buffer_generation_cannot_release_a_reused_pointer() {
        let key = 0x00c0_ffee_usize;
        let current_token = 42_usize;
        lock_or_recover(&BUFFERS).insert(
            key,
            BufferEntry {
                token: current_token,
                _payload: vec![1_u8].into_boxed_slice(),
            },
        );
        let mut stale = RoutingBuffer {
            ptr: key as *mut u8,
            len: 1,
            cap: current_token - 1,
        };

        // SAFETY: `stale` itself is valid writable storage. Its data pointer is
        // registry metadata only and is deliberately never dereferenced.
        unsafe { buffer_free_impl(&mut stale) };
        assert!(lock_or_recover(&BUFFERS).contains_key(&key));

        let mut current = RoutingBuffer {
            ptr: key as *mut u8,
            len: 1,
            cap: current_token,
        };
        // SAFETY: same valid local storage and registry-backed token contract.
        unsafe { buffer_free_impl(&mut current) };
        assert!(!lock_or_recover(&BUFFERS).contains_key(&key));
    }
}
