use cch_routing_lite::{
    build_pack, Coordinate, GraphInput, GraphNode, PackArc, Router, RouterError,
};

fn node(lat: f64, lng: f64, elevation_m: i32) -> GraphNode {
    GraphNode::new(lat, lng, elevation_m)
}

fn multipoint_graph() -> GraphInput {
    GraphInput {
        nodes: vec![
            node(-33.8700, 151.2000, 10),
            node(-33.8700, 151.2005, 25),
            node(-33.8700, 151.2010, 18),
            node(-33.8700, 151.2015, 31),
        ],
        arcs: (0..3)
            .flat_map(|index| {
                [
                    PackArc::new(index, index + 1, 10 + index),
                    PackArc::new(index + 1, index, 20 + index),
                ]
            })
            .collect(),
    }
}

#[test]
fn cchp2_serializes_integer_elevation_without_changing_costs() {
    let graph = multipoint_graph();
    let bytes = build_pack(&graph).unwrap();
    assert_eq!(&bytes[..5], b"CCHP2");

    let router = Router::from_pack_bytes(&bytes).unwrap();
    let route = router
        .route(
            Coordinate::new(-33.8700, 151.2000),
            Coordinate::new(-33.8700, 151.2010),
        )
        .unwrap();

    assert_eq!(route.total_weight, 21);
    assert_eq!(
        route
            .geometry
            .iter()
            .map(|point| point.elevation_m)
            .collect::<Vec<_>>(),
        vec![10, 25, 18]
    );
    assert!(route.distance_m > 0);
    assert_eq!(route.elevation_gain_m, 15);
    assert_eq!(route.elevation_loss_m, 7);
    assert_eq!(
        route.elevation_gain_m as i64 - route.elevation_loss_m as i64,
        i64::from(route.geometry.last().unwrap().elevation_m)
            - i64::from(route.geometry.first().unwrap().elevation_m)
    );
}

#[test]
fn cchp1_and_missing_elevation_are_rejected_explicitly() {
    let mut legacy = build_pack(&multipoint_graph()).unwrap();
    legacy[..5].copy_from_slice(b"CCHP1");
    assert!(matches!(
        Router::from_pack_bytes(&legacy),
        Err(RouterError::InvalidPack(message)) if message.contains("CCHP2")
    ));

    let missing_elevation = serde_json::json!({
        "nodes": [{"lat": -33.87, "lng": 151.2}],
        "arcs": []
    });
    assert!(serde_json::from_value::<GraphInput>(missing_elevation).is_err());
}

#[test]
fn route_many_combines_adjacent_legs_without_duplicate_joints() {
    let graph = multipoint_graph();
    let router = Router::from_pack_bytes(&build_pack(&graph).unwrap()).unwrap();
    let controls = [
        Coordinate::new(-33.8700, 151.2000),
        Coordinate::new(-33.8700, 151.2010),
        Coordinate::new(-33.8700, 151.2015),
    ];

    let route = router.route_many(&controls, false).unwrap();

    assert_eq!(route.legs.len(), 2);
    assert_eq!(
        route.legs[0].geometry.last(),
        route.legs[1].geometry.first()
    );
    assert_eq!(route.geometry.len(), 4);
    assert_eq!(route.total_weight, 33);
    assert_eq!(
        route.distance_m,
        route.legs.iter().map(|leg| leg.distance_m).sum::<u64>()
    );
    assert_eq!(
        route.elevation_gain_m,
        route
            .legs
            .iter()
            .map(|leg| leg.elevation_gain_m)
            .sum::<u64>()
    );
    assert_eq!(
        route.elevation_loss_m,
        route
            .legs
            .iter()
            .map(|leg| leg.elevation_loss_m)
            .sum::<u64>()
    );
}

#[test]
fn route_many_closes_the_last_to_first_leg_without_duplicating_controls() {
    let graph = multipoint_graph();
    let router = Router::from_pack_bytes(&build_pack(&graph).unwrap()).unwrap();
    let controls = [
        Coordinate::new(-33.8700, 151.2000),
        Coordinate::new(-33.8700, 151.2010),
        Coordinate::new(-33.8700, 151.2015),
    ];

    let route = router.route_many(&controls, true).unwrap();

    assert!(route.closed_loop);
    assert_eq!(route.control_count, 3);
    assert_eq!(route.legs.len(), 3);
    assert_eq!(route.geometry.first(), route.geometry.last());
    assert_eq!(route.total_weight, 33 + 20 + 21 + 22);
    assert_eq!(route.elevation_gain_m, route.elevation_loss_m);
}

#[test]
fn route_many_enforces_control_bounds_and_fails_as_one_operation() {
    let graph = multipoint_graph();
    let router = Router::from_pack_bytes(&build_pack(&graph).unwrap()).unwrap();
    let valid = Coordinate::new(-33.8700, 151.2000);
    for controls in [vec![], vec![valid], vec![valid; 17]] {
        assert!(matches!(
            router.route_many(&controls, false),
            Err(RouterError::InvalidControlCount { .. })
        ));
    }

    let controls = [valid, Coordinate::new(0.0, 0.0), valid];
    assert!(matches!(
        router.route_many(&controls, false),
        Err(RouterError::SnapOutOfRange { .. })
    ));
}
