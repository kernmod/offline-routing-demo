//! Single-link-unit facade for the public mobile routing engine.
//!
//! iOS consumes one Rust static library. Keeping the routing and loopback tile
//! server ABIs behind this crate prevents the application from linking two
//! independent Rust runtimes while preserving their small C interfaces.

/// Keeps both public C ABIs reachable from the single iOS static library.
///
/// The native bridge calls the routing and tile symbols directly. This anchor
/// makes the dependency intentional and gives the packaging script one stable
/// symbol to verify before it creates the XCFramework.
#[no_mangle]
pub extern "C" fn offline_routing_mobile_core_symbol_anchor() -> usize {
    let routing = cch_routing_lite_ffi::routing_router_load as *const ();
    let tiles = tile_server_lite::offline_tiles_start as *const ();
    routing as usize ^ tiles as usize
}

#[cfg(test)]
mod tests {
    use super::offline_routing_mobile_core_symbol_anchor;

    #[test]
    fn anchor_keeps_both_public_abis_in_the_link_unit() {
        let routing = cch_routing_lite_ffi::routing_router_load as *const ();
        let tiles = tile_server_lite::offline_tiles_start as *const ();

        assert_ne!(routing, tiles);
        assert_eq!(
            offline_routing_mobile_core_symbol_anchor(),
            routing as usize ^ tiles as usize
        );
    }
}
