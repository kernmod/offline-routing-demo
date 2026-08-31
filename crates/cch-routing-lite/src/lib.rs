//! Deterministic, on-device Customizable Contraction Hierarchy routing.
//!
//! Pack building performs metric-independent elimination fill followed by
//! generic shortest-cost customization. Pack loading only validates serialized
//! CCH arrays; route queries run bidirectional upward searches and recursively
//! unpack shortcut witnesses to original graph arcs.

mod ch;

use std::io::Read;
use std::path::Path;
use std::time::Instant;

use ch::{
    cch::CchStructure,
    customize::CchWeights,
    ordering::spatial_ordering,
    query::query,
    unpack::{original_node_path, unpack},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zstd::stream::encode_all;

const PACK_MAGIC: &[u8; 5] = b"CCHP1";
const MAX_DECOMPRESSED_PACK_BYTES: usize = 32 * 1024 * 1024;
const PACK_COMPRESSION_LEVEL: i32 = 9;
const DEFAULT_SNAP_DISTANCE_M: f64 = 250.0;
pub const BENCHMARK_CORPUS_SIZE: usize = 1_024;
/// Largest original-arc cost accepted by pack validation.
pub const MAX_PACK_ARC_WEIGHT: u32 = u32::MAX - 1;
/// Largest possible simple-route cost in a validated pack.
///
/// A pack has at most `u32::MAX` nodes, so a simple path has at most
/// `u32::MAX - 1` arcs. All costs are positive, therefore every shortest path
/// is simple and its total is representable below the internal `u64::MAX`
/// unreachable sentinel.
pub const MAX_ROUTE_WEIGHT: u64 = (MAX_PACK_ARC_WEIGHT as u64) * (MAX_PACK_ARC_WEIGHT as u64);
const _: () = assert!(MAX_ROUTE_WEIGHT < u64::MAX);

/// Geographic coordinate in WGS84 decimal degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Coordinate {
    pub lat: f64,
    pub lng: f64,
}

impl Coordinate {
    #[must_use]
    pub const fn new(lat: f64, lng: f64) -> Self {
        Self { lat, lng }
    }
}

/// Directed original graph arc and its positive generic cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackArc {
    pub from: u32,
    pub to: u32,
    pub weight: u32,
}

impl PackArc {
    #[must_use]
    pub const fn new(from: u32, to: u32, weight: u32) -> Self {
        Self { from, to, weight }
    }
}

/// Public deterministic graph input for the pack builder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphInput {
    pub nodes: Vec<Coordinate>,
    pub arcs: Vec<PackArc>,
}

/// Advanced build input with explicit `rank[node] = contraction rank`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuildConfig {
    pub nodes: Vec<Coordinate>,
    pub arcs: Vec<PackArc>,
    pub ranks: Vec<u32>,
}

/// Build a fully precomputed CCH pack from a public graph fixture.
pub fn build_pack(graph: &GraphInput) -> Result<Vec<u8>, RouterError> {
    validate_nodes(&graph.nodes)?;
    BuildConfig {
        nodes: graph.nodes.clone(),
        arcs: graph.arcs.clone(),
        ranks: spatial_ordering(&graph.nodes),
    }
    .to_pack_bytes()
}

impl BuildConfig {
    /// Elimination-fill, customize, and serialize the complete query pack.
    pub fn to_pack_bytes(&self) -> Result<Vec<u8>, RouterError> {
        validate_nodes(&self.nodes)?;
        let mut arcs = self.arcs.clone();
        arcs.sort_unstable_by_key(|arc| (arc.from, arc.to, arc.weight));
        let cch = CchStructure::build(self.nodes.len(), &arcs, &self.ranks)?;
        let weights = CchWeights::customize(&cch, &arcs)?;
        let disk = DiskPack {
            nodes: self.nodes.clone(),
            arcs,
            cch,
            weights,
        };
        disk.validate()?;
        let body = serde_json::to_vec(&disk)
            .map_err(|error| RouterError::InvalidPack(error.to_string()))?;
        let compressed = encode_all(body.as_slice(), PACK_COMPRESSION_LEVEL)
            .map_err(|error| RouterError::InvalidPack(error.to_string()))?;
        let mut bytes = Vec::with_capacity(PACK_MAGIC.len() + body.len());
        bytes.extend_from_slice(PACK_MAGIC);
        bytes.extend_from_slice(&compressed);
        Ok(bytes)
    }
}

/// Validated immutable CCH pack.
#[derive(Debug, Clone)]
pub struct LoadedPack {
    nodes: Vec<Coordinate>,
    arcs: Vec<PackArc>,
    cch: CchStructure,
    weights: CchWeights,
}

impl LoadedPack {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RouterError> {
        let body = bytes
            .strip_prefix(PACK_MAGIC)
            .ok_or_else(|| RouterError::InvalidPack("missing CCHP1 header".into()))?;
        let decompressed = decode_pack_body(body)?;
        let disk: DiskPack = serde_json::from_slice(&decompressed)
            .map_err(|error| RouterError::InvalidPack(error.to_string()))?;
        disk.validate()?;
        Ok(Self {
            nodes: disk.nodes,
            arcs: disk.arcs,
            cch: disk.cch,
            weights: disk.weights,
        })
    }

    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, RouterError> {
        Self::from_bytes(&std::fs::read(path).map_err(RouterError::Io)?)
    }

    #[must_use]
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    #[must_use]
    pub fn cch_arc_count(&self) -> usize {
        self.cch.arc_count()
    }

    #[must_use]
    pub fn stats(&self) -> PackStats {
        PackStats {
            node_count: self.nodes.len(),
            original_arc_count: self.arcs.len(),
            cch_arc_count: self.cch.arc_count(),
            shortcut_witness_count: self.weights.shortcut_witness_count(),
        }
    }
}

fn decode_pack_body(body: &[u8]) -> Result<Vec<u8>, RouterError> {
    let decoder = zstd::stream::read::Decoder::new(body)
        .map_err(|error| RouterError::InvalidPack(error.to_string()))?;
    let mut decompressed = Vec::new();
    decoder
        .take((MAX_DECOMPRESSED_PACK_BYTES + 1) as u64)
        .read_to_end(&mut decompressed)
        .map_err(|error| RouterError::InvalidPack(error.to_string()))?;
    if decompressed.len() > MAX_DECOMPRESSED_PACK_BYTES {
        return Err(RouterError::InvalidPack(format!(
            "pack exceeds the {MAX_DECOMPRESSED_PACK_BYTES}-byte decompressed safety limit"
        )));
    }
    Ok(decompressed)
}

/// Immutable router. It contains no graph builder or runtime customization.
#[derive(Debug, Clone)]
pub struct Router {
    pack: LoadedPack,
    max_snap_distance_m: f64,
}

impl Router {
    #[must_use]
    pub fn new(pack: LoadedPack) -> Self {
        Self {
            pack,
            max_snap_distance_m: DEFAULT_SNAP_DISTANCE_M,
        }
    }

    pub fn from_pack_bytes(bytes: &[u8]) -> Result<Self, RouterError> {
        Ok(Self::new(LoadedPack::from_bytes(bytes)?))
    }

    pub fn with_max_snap_distance_m(mut self, distance: f64) -> Result<Self, RouterError> {
        if !distance.is_finite() || distance <= 0.0 {
            return Err(RouterError::InvalidSnapDistance);
        }
        self.max_snap_distance_m = distance;
        Ok(self)
    }

    #[must_use]
    pub fn pack_stats(&self) -> PackStats {
        self.pack.stats()
    }

    /// Run the same deterministic 1,024-request corpus through the complete
    /// snap → upward CCH query → shortcut unpack path used by `route`.
    ///
    /// This intentionally reports no device name: the embedding application
    /// owns that provenance and records it next to the returned measurements.
    #[must_use]
    pub fn benchmark_1024(&self) -> BenchmarkReport {
        let node_count = self.pack.nodes.len();
        let mut durations_ns = Vec::with_capacity(BENCHMARK_CORPUS_SIZE);
        let mut successes = 0_usize;
        for sample in 0..BENCHMARK_CORPUS_SIZE {
            // Two coprime integer sequences make this corpus deterministic and
            // spread requests across the complete serialized node array.
            let source = sample.wrapping_mul(2_654_435_761) % node_count;
            let mut target = sample.wrapping_mul(2_246_822_519).wrapping_add(1) % node_count;
            if node_count > 1 && target == source {
                target = (target + 1) % node_count;
            }
            let started = Instant::now();
            let result =
                std::hint::black_box(self.route(self.pack.nodes[source], self.pack.nodes[target]));
            let elapsed = started.elapsed().as_nanos();
            durations_ns.push(u64::try_from(elapsed).unwrap_or(u64::MAX));
            successes += usize::from(result.is_ok());
        }
        durations_ns.sort_unstable();

        BenchmarkReport {
            corpus_size: BENCHMARK_CORPUS_SIZE,
            successes,
            failures: BENCHMARK_CORPUS_SIZE - successes,
            min_micros: nanos_to_ceil_micros(durations_ns.first().copied().unwrap_or(0)),
            p50_micros: nanos_to_ceil_micros(nearest_rank(&durations_ns, 50)),
            p95_micros: nanos_to_ceil_micros(nearest_rank(&durations_ns, 95)),
            p99_micros: nanos_to_ceil_micros(nearest_rank(&durations_ns, 99)),
            max_micros: nanos_to_ceil_micros(durations_ns.last().copied().unwrap_or(0)),
        }
    }

    /// Snap, run a bidirectional upward CCH query, and unpack shortcuts.
    pub fn route(&self, origin: Coordinate, destination: Coordinate) -> Result<Route, RouterError> {
        let source = self.snap(origin)?;
        let target = self.snap(destination)?;
        let (total_weight, cch_path) = query(&self.pack.cch, &self.pack.weights, source, target)?
            .ok_or(RouterError::NoRoute)?;
        let edge_ids = unpack(&self.pack.cch, &self.pack.weights, &cch_path)?;
        let node_ids = original_node_path(&self.pack.arcs, source, &edge_ids)?;
        if node_ids.last().copied() != Some(target) {
            return Err(RouterError::InvalidPack(
                "unpacked route does not reach target".into(),
            ));
        }
        let polyline = node_ids
            .iter()
            .map(|&node| self.pack.nodes[node as usize])
            .collect();
        Ok(Route {
            total_weight,
            polyline,
        })
    }

    fn snap(&self, coordinate: Coordinate) -> Result<u32, RouterError> {
        if !valid_coordinate(coordinate) {
            return Err(RouterError::InvalidCoordinate);
        }
        let (node, distance_m) = self
            .pack
            .nodes
            .iter()
            .enumerate()
            .map(|(index, &candidate)| (index as u32, haversine_m(coordinate, candidate)))
            .min_by(|left, right| left.1.total_cmp(&right.1))
            .ok_or_else(|| RouterError::InvalidPack("pack has no nodes".into()))?;
        if distance_m > self.max_snap_distance_m {
            return Err(RouterError::SnapOutOfRange {
                distance_m,
                max_distance_m: self.max_snap_distance_m,
            });
        }
        Ok(node)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PackStats {
    pub node_count: usize,
    pub original_arc_count: usize,
    pub cch_arc_count: usize,
    pub shortcut_witness_count: usize,
}

/// Latency distribution for the built-in deterministic query corpus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkReport {
    pub corpus_size: usize,
    pub successes: usize,
    pub failures: usize,
    pub min_micros: u64,
    pub p50_micros: u64,
    pub p95_micros: u64,
    pub p99_micros: u64,
    pub max_micros: u64,
}

/// Route result without any stable identity or application-specific metadata.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Route {
    pub total_weight: u64,
    pub polyline: Vec<Coordinate>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BenchCorpus {
    pub routes: Vec<Route>,
}

impl BenchCorpus {
    pub fn from_routes(
        router: &Router,
        requests: &[(Coordinate, Coordinate)],
    ) -> Result<Self, RouterError> {
        Ok(Self {
            routes: requests
                .iter()
                .map(|&(origin, destination)| router.route(origin, destination))
                .collect::<Result<_, _>>()?,
        })
    }

    pub fn to_json(&self) -> Result<serde_json::Value, RouterError> {
        serde_json::to_value(self).map_err(|error| RouterError::InvalidPack(error.to_string()))
    }
}

#[derive(Debug, Error)]
pub enum RouterError {
    #[error("invalid routing pack: {0}")]
    InvalidPack(String),
    #[error("invalid coordinate")]
    InvalidCoordinate,
    #[error("snap distance must be finite and positive")]
    InvalidSnapDistance,
    #[error("closest node is {distance_m:.1}m away, beyond the {max_distance_m:.1}m limit")]
    SnapOutOfRange {
        distance_m: f64,
        max_distance_m: f64,
    },
    #[error("no route between snapped nodes")]
    NoRoute,
    #[error("routing cost exceeds the representable pack cost domain")]
    CostOverflow,
    #[error("could not read routing pack: {0}")]
    Io(#[source] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiskPack {
    nodes: Vec<Coordinate>,
    arcs: Vec<PackArc>,
    cch: CchStructure,
    weights: CchWeights,
}

impl DiskPack {
    fn validate(&self) -> Result<(), RouterError> {
        validate_nodes(&self.nodes)?;
        if self.arcs.iter().any(|arc| {
            arc.from as usize >= self.nodes.len()
                || arc.to as usize >= self.nodes.len()
                || arc.from == arc.to
                || arc.weight == 0
        }) {
            return Err(RouterError::InvalidPack(
                "invalid original graph arcs".into(),
            ));
        }
        if self.arcs.iter().any(|arc| arc.weight > MAX_PACK_ARC_WEIGHT) {
            return Err(RouterError::CostOverflow);
        }
        self.cch.validate(self.nodes.len())?;
        self.weights.validate(&self.cch, &self.arcs)
    }
}

fn validate_nodes(nodes: &[Coordinate]) -> Result<(), RouterError> {
    if nodes.is_empty()
        || nodes
            .iter()
            .copied()
            .any(|coordinate| !valid_coordinate(coordinate))
    {
        return Err(RouterError::InvalidPack(
            "nodes must be non-empty finite WGS84 coordinates".into(),
        ));
    }
    if nodes.len() > u32::MAX as usize {
        return Err(RouterError::InvalidPack("graph has too many nodes".into()));
    }
    Ok(())
}

fn valid_coordinate(coordinate: Coordinate) -> bool {
    coordinate.lat.is_finite()
        && coordinate.lng.is_finite()
        && (-90.0..=90.0).contains(&coordinate.lat)
        && (-180.0..=180.0).contains(&coordinate.lng)
}

fn haversine_m(left: Coordinate, right: Coordinate) -> f64 {
    let dlat = (right.lat - left.lat).to_radians();
    let dlng = (right.lng - left.lng).to_radians();
    let lat1 = left.lat.to_radians();
    let lat2 = right.lat.to_radians();
    let a = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlng / 2.0).sin().powi(2);
    6_371_000.0 * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

fn nearest_rank(sorted: &[u64], percentile: usize) -> u64 {
    let rank = sorted.len().saturating_mul(percentile).div_ceil(100);
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn nanos_to_ceil_micros(nanos: u64) -> u64 {
    nanos.saturating_add(999) / 1_000
}

#[cfg(test)]
mod tests {
    use super::*;
    use zstd::stream::decode_all;

    #[test]
    fn loading_does_not_rebuild_or_customize() {
        let config = BuildConfig {
            nodes: vec![Coordinate::new(0.0, 0.0), Coordinate::new(0.0, 0.001)],
            arcs: vec![PackArc::new(0, 1, 1)],
            ranks: vec![0, 1],
        };
        let bytes = config.to_pack_bytes().unwrap();
        assert_eq!(&bytes[..PACK_MAGIC.len()], PACK_MAGIC);
        let pack = LoadedPack::from_bytes(&bytes).unwrap();
        assert_eq!(pack.cch.up_head, vec![1]);
        assert_eq!(pack.weights.forward, vec![1]);
    }

    #[test]
    fn cch_query_traverses_one_shortcut_then_unpack_restores_original_geometry() {
        let config = BuildConfig {
            nodes: vec![
                Coordinate::new(45.0, 6.0),
                Coordinate::new(45.0, 6.0001),
                Coordinate::new(45.0, 6.0002),
            ],
            arcs: vec![PackArc::new(0, 1, 4), PackArc::new(1, 2, 7)],
            ranks: vec![1, 0, 2],
        };
        let pack = LoadedPack::from_bytes(&config.to_pack_bytes().unwrap()).unwrap();
        let (cost, cch_path) = query(&pack.cch, &pack.weights, 0, 2).unwrap().unwrap();
        assert_eq!(cost, 11);
        assert_eq!(
            cch_path.len(),
            1,
            "the runtime query must traverse the fill shortcut"
        );
        let unpacked = unpack(&pack.cch, &pack.weights, &cch_path).unwrap();
        assert_eq!(
            unpacked.len(),
            2,
            "the shortcut must unpack to original arcs"
        );
        assert_eq!(
            original_node_path(&pack.arcs, 0, &unpacked).unwrap(),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn packs_use_a_compressed_stable_wire_format() {
        let bytes = build_pack(&GraphInput {
            nodes: vec![
                Coordinate::new(45.0, 6.0),
                Coordinate::new(45.0, 6.0001),
                Coordinate::new(45.0, 6.0002),
            ],
            arcs: vec![
                PackArc::new(0, 1, 4),
                PackArc::new(1, 0, 4),
                PackArc::new(1, 2, 7),
                PackArc::new(2, 1, 7),
            ],
        })
        .unwrap();
        let compressed = &bytes[PACK_MAGIC.len()..];
        let inflated = decode_all(compressed).unwrap();
        let text = std::str::from_utf8(&inflated).unwrap();
        assert!(text.contains("\"up_first_out\""));
        assert!(text.contains("\"forward_witness\""));
        assert!(compressed.len() < inflated.len());
    }

    #[test]
    fn runtime_and_benchmark_source_avoid_assumed_nonempty_panics() {
        let source = include_str!("lib.rs");
        let runtime_source = source.split("#[cfg(test)]").next().unwrap_or(source);
        assert!(!runtime_source.contains("fixed corpus is non-empty"));
        assert!(!runtime_source.contains(".last().expect("));
    }
}
