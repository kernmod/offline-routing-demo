use std::{cmp::Reverse, collections::BinaryHeap};

use cch_routing_lite::{
    build_pack, BuildConfig, Coordinate, GraphInput, PackArc, Router, RouterError,
    MAX_PACK_ARC_WEIGHT, MAX_ROUTE_WEIGHT,
};
use proptest::prelude::*;
use zstd::stream::{decode_all, encode_all};

fn chain() -> GraphInput {
    GraphInput {
        nodes: (0..5)
            .map(|i| Coordinate::new(45.0, 6.0 + f64::from(i) * 0.0001))
            .collect(),
        arcs: (0..4)
            .flat_map(|i| [PackArc::new(i, i + 1, i + 2), PackArc::new(i + 1, i, i + 2)])
            .collect(),
    }
}

fn dijkstra_reference(graph: &GraphInput, source: u32, target: u32) -> Option<u64> {
    let mut distance = vec![u64::MAX; graph.nodes.len()];
    let mut queue = BinaryHeap::new();
    distance[source as usize] = 0;
    queue.push(Reverse((0_u64, source)));
    while let Some(Reverse((cost, node))) = queue.pop() {
        if cost != distance[node as usize] {
            continue;
        }
        if node == target {
            return Some(cost);
        }
        for arc in graph.arcs.iter().filter(|arc| arc.from == node) {
            let next = cost
                .checked_add(u64::from(arc.weight))
                .expect("the validated graph cost domain must fit in u64");
            if next < distance[arc.to as usize] {
                distance[arc.to as usize] = next;
                queue.push(Reverse((next, arc.to)));
            }
        }
    }
    None
}

fn cch_cost(router: &Router, graph: &GraphInput, source: u32, target: u32) -> Option<u64> {
    router
        .route(graph.nodes[source as usize], graph.nodes[target as usize])
        .ok()
        .map(|route| route.total_weight)
}

fn assert_all_pairs(graph: &GraphInput) {
    let router = Router::from_pack_bytes(&build_pack(graph).unwrap()).unwrap();
    for source in 0..graph.nodes.len() as u32 {
        for target in 0..graph.nodes.len() as u32 {
            assert_eq!(
                cch_cost(&router, graph, source, target),
                dijkstra_reference(graph, source, target),
                "{source}->{target}"
            );
        }
    }
}

#[test]
fn cch_matches_dijkstra_on_chain_all_pairs() {
    assert_all_pairs(&chain());
}

#[test]
fn cch_matches_dijkstra_on_weighted_grid_all_pairs() {
    let width = 5_u32;
    let mut graph = GraphInput {
        nodes: Vec::new(),
        arcs: Vec::new(),
    };
    for y in 0..width {
        for x in 0..width {
            let node = y * width + x;
            graph.nodes.push(Coordinate::new(
                45.0 + f64::from(y) * 0.0001,
                6.0 + f64::from(x) * 0.0001,
            ));
            if x > 0 {
                graph.arcs.push(PackArc::new(node, node - 1, 3 + node % 7));
                graph.arcs.push(PackArc::new(node - 1, node, 2 + node % 5));
            }
            if y > 0 {
                graph
                    .arcs
                    .push(PackArc::new(node, node - width, 4 + node % 3));
                graph
                    .arcs
                    .push(PackArc::new(node - width, node, 1 + node % 11));
            }
        }
    }
    assert_all_pairs(&graph);
}

#[test]
fn shortcut_is_queried_and_unpacked_to_original_arcs() {
    let graph = GraphInput {
        nodes: vec![
            Coordinate::new(45.0, 6.0),
            Coordinate::new(45.0, 6.0001),
            Coordinate::new(45.0, 6.0002),
        ],
        arcs: vec![PackArc::new(0, 1, 4), PackArc::new(1, 2, 7)],
    };
    let bytes = BuildConfig {
        nodes: graph.nodes.clone(),
        arcs: graph.arcs,
        ranks: vec![1, 0, 2],
    }
    .to_pack_bytes()
    .unwrap();
    let router = Router::from_pack_bytes(&bytes).unwrap();
    let route = router.route(graph.nodes[0], graph.nodes[2]).unwrap();
    assert_eq!(route.total_weight, 11);
    assert_eq!(route.polyline, graph.nodes);
    assert!(router.pack_stats().shortcut_witness_count > 0);
}

#[test]
fn multi_edge_route_above_the_u32_finite_domain_is_not_no_route() {
    let graph = GraphInput {
        nodes: vec![
            Coordinate::new(45.0, 6.0),
            Coordinate::new(45.0, 6.0001),
            Coordinate::new(45.0, 6.0002),
        ],
        arcs: vec![
            PackArc::new(0, 1, MAX_PACK_ARC_WEIGHT),
            PackArc::new(1, 2, 17),
        ],
    };
    let bytes = BuildConfig {
        nodes: graph.nodes.clone(),
        arcs: graph.arcs,
        ranks: vec![1, 0, 2],
    }
    .to_pack_bytes()
    .unwrap();
    let router = Router::from_pack_bytes(&bytes).unwrap();

    let route = router
        .route(graph.nodes[0], graph.nodes[2])
        .expect("a representable finite path must not be reported as NoRoute");

    assert_eq!(route.total_weight, u64::from(MAX_PACK_ARC_WEIGHT) + 17);
    assert_eq!(route.polyline, graph.nodes);
}

#[test]
fn pack_is_byte_identical_and_serializes_precomputed_cch() {
    let first = build_pack(&chain()).unwrap();
    assert_eq!(first, build_pack(&chain()).unwrap());
    assert_eq!(&first[..5], b"CCHP1");
    let inflated = decode_all(&first[5..]).unwrap();
    let text = std::str::from_utf8(&inflated).unwrap();
    assert!(text.contains("up_first_out") && text.contains("forward_witness"));
    assert!(first.len() < inflated.len());
}

#[test]
fn corrupt_or_missing_cch_entries_are_rejected() {
    let bytes = build_pack(&chain()).unwrap();
    assert!(matches!(
        Router::from_pack_bytes(&bytes[..bytes.len() / 2]),
        Err(RouterError::InvalidPack(_))
    ));
    let inflated = decode_all(&bytes[5..]).unwrap();
    let mut value: serde_json::Value = serde_json::from_slice(&inflated).unwrap();
    value["cch"].as_object_mut().unwrap().remove("up_head");
    let encoded = encode_all(serde_json::to_vec(&value).unwrap().as_slice(), 19).unwrap();
    let mut missing = b"CCHP1".to_vec();
    missing.extend(encoded);
    assert!(matches!(
        Router::from_pack_bytes(&missing),
        Err(RouterError::InvalidPack(_))
    ));
}

#[test]
fn compressed_pack_expansion_is_bounded_before_json_parsing() {
    const LIMIT_PLUS_ONE: usize = 32 * 1024 * 1024 + 1;
    let compressed = encode_all(vec![b' '; LIMIT_PLUS_ONE].as_slice(), 1).unwrap();
    let mut pack = b"CCHP1".to_vec();
    pack.extend(compressed);

    let error = Router::from_pack_bytes(&pack).unwrap_err();
    assert!(
        error.to_string().contains("decompressed safety limit"),
        "unexpected error: {error}"
    );
}

#[test]
fn golden_route_disconnected_and_bounds_contracts() {
    let graph = GraphInput {
        nodes: vec![
            Coordinate::new(45.0, 6.0),
            Coordinate::new(45.0, 6.0001),
            Coordinate::new(45.0, 6.0002),
            Coordinate::new(45.01, 6.01),
        ],
        arcs: vec![
            PackArc::new(0, 1, 10),
            PackArc::new(1, 2, 10),
            PackArc::new(0, 2, 90),
        ],
    };
    let router = Router::from_pack_bytes(&build_pack(&graph).unwrap()).unwrap();
    let route = router.route(graph.nodes[0], graph.nodes[2]).unwrap();
    assert_eq!(
        (route.polyline, route.total_weight),
        (graph.nodes[..3].to_vec(), 20)
    );
    assert!(matches!(
        router.route(graph.nodes[0], graph.nodes[3]),
        Err(RouterError::NoRoute)
    ));
    assert!(matches!(
        router.route(Coordinate::new(0.0, 0.0), graph.nodes[0]),
        Err(RouterError::SnapOutOfRange { .. })
    ));
    assert!(matches!(
        router.route(Coordinate::new(91.0, 0.0), graph.nodes[0]),
        Err(RouterError::InvalidCoordinate)
    ));
}

#[test]
fn sydney_public_fixture_subset_matches_dijkstra() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/sydney/graph.json"
    );
    let full: GraphInput = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let mut selected = vec![0_u32];
    let mut cursor = 0;
    while cursor < selected.len() && selected.len() < 32 {
        let node = selected[cursor];
        for arc in &full.arcs {
            let candidate = if arc.from == node {
                Some(arc.to)
            } else if arc.to == node {
                Some(arc.from)
            } else {
                None
            };
            if let Some(candidate) = candidate {
                if !selected.contains(&candidate) {
                    selected.push(candidate);
                }
                if selected.len() == 32 {
                    break;
                }
            }
        }
        cursor += 1;
    }
    selected.sort_unstable();
    let remap: std::collections::HashMap<_, _> = selected
        .iter()
        .copied()
        .enumerate()
        .map(|(new, old)| (old, new as u32))
        .collect();
    let graph = GraphInput {
        nodes: selected
            .iter()
            .map(|&old| full.nodes[old as usize])
            .collect(),
        arcs: full
            .arcs
            .iter()
            .filter_map(|arc| {
                Some(PackArc::new(
                    *remap.get(&arc.from)?,
                    *remap.get(&arc.to)?,
                    arc.weight,
                ))
            })
            .collect(),
    };
    assert_all_pairs(&graph);
}

#[test]
fn full_sydney_actual_cch_pack_fits_the_public_fixture_budget() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/sydney/graph.json"
    );
    let graph: GraphInput = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let pack = build_pack(&graph).unwrap();

    assert!(
        pack.len() <= 5_000_000,
        "actual CCH pack is {} bytes",
        pack.len()
    );
    let router = Router::from_pack_bytes(&pack).unwrap();
    assert_eq!(router.pack_stats().node_count, graph.nodes.len());
    assert!(router.pack_stats().shortcut_witness_count > 0);
}

#[test]
fn pack_arc_cost_representability_limit_is_enforced() {
    let accepted = GraphInput {
        nodes: vec![Coordinate::new(45.0, 6.0), Coordinate::new(45.0, 6.0001)],
        arcs: vec![PackArc::new(0, 1, MAX_PACK_ARC_WEIGHT)],
    };
    let rejected = GraphInput {
        nodes: vec![Coordinate::new(45.0, 6.0), Coordinate::new(45.0, 6.0001)],
        arcs: vec![PackArc::new(0, 1, u32::MAX)],
    };

    assert!(build_pack(&accepted).is_ok());
    assert!(matches!(
        build_pack(&rejected),
        Err(RouterError::CostOverflow)
    ));
    assert_eq!(
        MAX_ROUTE_WEIGHT,
        u64::from(MAX_PACK_ARC_WEIGHT) * u64::from(MAX_PACK_ARC_WEIGHT)
    );
}

#[test]
fn serialized_cch_cost_above_the_route_domain_is_rejected() {
    let bytes = build_pack(&chain()).unwrap();
    let inflated = decode_all(&bytes[5..]).unwrap();
    let mut value: serde_json::Value = serde_json::from_slice(&inflated).unwrap();
    value["weights"]["forward"][0] = serde_json::json!(MAX_ROUTE_WEIGHT + 1);
    let encoded = encode_all(serde_json::to_vec(&value).unwrap().as_slice(), 19).unwrap();
    let mut corrupted = b"CCHP1".to_vec();
    corrupted.extend(encoded);

    assert!(matches!(
        Router::from_pack_bytes(&corrupted),
        Err(RouterError::CostOverflow)
    ));
}

#[test]
fn public_route_json_contains_geometry_and_cost_but_no_graph_identifiers() {
    let graph = chain();
    let router = Router::from_pack_bytes(&build_pack(&graph).unwrap()).unwrap();
    let route = router.route(graph.nodes[0], graph.nodes[4]).unwrap();
    let json = serde_json::to_value(route).unwrap();

    assert!(json.get("polyline").is_some());
    assert!(json.get("total_weight").is_some());
    assert!(json.get("node_ids").is_none());
    assert!(json.get("cch_arc_count").is_none());
    assert!(json.get("original_arc_count").is_none());
}

#[test]
fn public_api_rejects_invalid_nodes_arcs_ranks_and_snap_configuration() {
    for coordinate in [
        Coordinate::new(f64::NAN, 0.0),
        Coordinate::new(91.0, 0.0),
        Coordinate::new(0.0, -181.0),
    ] {
        assert!(matches!(
            build_pack(&GraphInput {
                nodes: vec![coordinate],
                arcs: vec![]
            }),
            Err(RouterError::InvalidPack(_))
        ));
    }
    assert!(matches!(
        build_pack(&GraphInput {
            nodes: vec![],
            arcs: vec![]
        }),
        Err(RouterError::InvalidPack(_))
    ));

    let nodes = vec![Coordinate::new(45.0, 6.0), Coordinate::new(45.0, 6.0001)];
    for arc in [
        PackArc::new(0, 0, 1),
        PackArc::new(0, 1, 0),
        PackArc::new(0, 2, 1),
    ] {
        assert!(matches!(
            build_pack(&GraphInput {
                nodes: nodes.clone(),
                arcs: vec![arc]
            }),
            Err(RouterError::InvalidPack(_))
        ));
    }
    for ranks in [vec![0], vec![0, 0], vec![0, 2]] {
        assert!(matches!(
            BuildConfig {
                nodes: nodes.clone(),
                arcs: vec![PackArc::new(0, 1, 1)],
                ranks
            }
            .to_pack_bytes(),
            Err(RouterError::InvalidPack(_))
        ));
    }

    let router = Router::from_pack_bytes(&build_pack(&chain()).unwrap()).unwrap();
    for distance in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(matches!(
            router.clone().with_max_snap_distance_m(distance),
            Err(RouterError::InvalidSnapDistance)
        ));
    }
}

#[test]
fn path_loader_stats_and_benchmark_corpus_have_stable_contracts() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("routing.pack");
    let bytes = build_pack(&chain()).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    let loaded = cch_routing_lite::LoadedPack::from_path(&path).unwrap();
    assert_eq!(loaded.node_count(), 5);
    assert!(loaded.cch_arc_count() >= 4);
    let stats = loaded.stats();
    assert_eq!(stats.node_count, 5);
    assert_eq!(stats.original_arc_count, 8);

    let router = Router::new(loaded).with_max_snap_distance_m(500.0).unwrap();
    let report = router.benchmark_1024();
    assert_eq!(report.corpus_size, 1024);
    assert_eq!(report.successes + report.failures, report.corpus_size);
    assert!(report.min_micros <= report.p50_micros);
    assert!(report.p50_micros <= report.p95_micros);
    assert!(report.p95_micros <= report.p99_micros);
    assert!(report.p99_micros <= report.max_micros);

    let requests = [(chain().nodes[0], chain().nodes[4])];
    let corpus = cch_routing_lite::BenchCorpus::from_routes(&router, &requests).unwrap();
    assert_eq!(corpus.routes.len(), 1);
    assert!(corpus.to_json().unwrap().is_object());

    let missing = directory.path().join("missing.pack");
    assert!(matches!(
        cch_routing_lite::LoadedPack::from_path(missing),
        Err(RouterError::Io(_))
    ));
}

#[test]
fn semantically_corrupt_weights_and_witnesses_are_rejected() {
    let bytes = build_pack(&chain()).unwrap();
    let inflated = decode_all(&bytes[5..]).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&inflated).unwrap();

    type Corruption = fn(&mut serde_json::Value);
    let corruptions: Vec<Corruption> = vec![
        |value| {
            value["weights"]["forward"]
                .as_array_mut()
                .unwrap()
                .pop()
                .map(drop)
                .unwrap()
        },
        |value| value["cch"]["rank"][0] = serde_json::json!(99),
        |value| value["weights"]["forward_witness"][0] = serde_json::json!({"kind":"none"}),
        |value| {
            value["weights"]["forward_witness"][0] =
                serde_json::json!({"kind":"original","arc":99999})
        },
    ];

    for corrupt in corruptions {
        let mut changed = value.clone();
        corrupt(&mut changed);
        let encoded = encode_all(serde_json::to_vec(&changed).unwrap().as_slice(), 19).unwrap();
        let mut pack = b"CCHP1".to_vec();
        pack.extend(encoded);
        assert!(matches!(
            Router::from_pack_bytes(&pack),
            Err(RouterError::InvalidPack(_))
        ));
    }
}

proptest! {
    #[test]
    fn cch_matches_dijkstra_on_generated_connected_directed_graphs(
        node_count in 2_usize..11,
        extra_edges in prop::collection::vec((0_u16..100, 0_u16..100, 1_u16..500), 0..36),
    ) {
        let mut graph = GraphInput {
            nodes: (0..node_count)
                .map(|node| Coordinate::new(-33.87 + node as f64 * 0.0001, 151.20 + node as f64 * 0.00007))
                .collect(),
            arcs: Vec::new(),
        };

        // A directed ring in both directions guarantees that all pairs exist;
        // arbitrary additional directed arcs exercise asymmetric customization.
        for node in 0..node_count as u32 {
            let next = (node + 1) % node_count as u32;
            graph.arcs.push(PackArc::new(node, next, 10 + node));
            graph.arcs.push(PackArc::new(next, node, 20 + node));
        }
        for (raw_from, raw_to, weight) in extra_edges {
            let from = u32::from(raw_from) % node_count as u32;
            let to = u32::from(raw_to) % node_count as u32;
            if from != to {
                graph.arcs.push(PackArc::new(from, to, u32::from(weight)));
            }
        }

        let router = Router::from_pack_bytes(&build_pack(&graph).unwrap()).unwrap();
        for source in 0..node_count as u32 {
            for target in 0..node_count as u32 {
                prop_assert_eq!(
                    cch_cost(&router, &graph, source, target),
                    dijkstra_reference(&graph, source, target),
                    "generated pair {}->{}", source, target,
                );
            }
        }
    }
}
