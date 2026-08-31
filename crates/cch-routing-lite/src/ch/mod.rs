//! Metric-independent CCH construction, customization, query, and unpacking.
//!
//! The implementation follows the elimination-fill CCH pipeline used by the
//! audited MIT kernels in `rust_road_router`/RoutingKit. Build-time code lives
//! in `cch` and `customize`; the mobile query path only uses `query` and
//! `unpack` over serialized arrays.

pub(crate) mod cch;
pub(crate) mod customize;
pub(crate) mod ordering;
pub(crate) mod query;
pub(crate) mod unpack;
