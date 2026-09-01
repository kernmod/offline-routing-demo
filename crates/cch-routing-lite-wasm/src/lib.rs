use cch_routing_lite::{Coordinate, Router, RouterError};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
struct Control {
    lat: f64,
    lng: f64,
}

impl From<Control> for Coordinate {
    fn from(control: Control) -> Self {
        Self::new(control.lat, control.lng)
    }
}

#[wasm_bindgen]
pub struct WasmRouter {
    router: Router,
}

#[wasm_bindgen]
impl WasmRouter {
    #[wasm_bindgen(constructor)]
    pub fn new(pack: &[u8]) -> Result<WasmRouter, JsValue> {
        router_from_pack(pack)
            .map(|router| WasmRouter { router })
            .map_err(error_to_js)
    }

    #[wasm_bindgen(js_name = statsJson)]
    pub fn stats_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.router.pack_stats()).map_err(error_to_js)
    }

    pub fn route(
        &self,
        origin_lat: f64,
        origin_lng: f64,
        destination_lat: f64,
        destination_lng: f64,
    ) -> Result<String, JsValue> {
        route_json(
            &self.router,
            Coordinate::new(origin_lat, origin_lng),
            Coordinate::new(destination_lat, destination_lng),
        )
        .map_err(error_to_js)
    }

    #[wasm_bindgen(js_name = routeManyJson)]
    pub fn route_many_json(
        &self,
        controls_json: &str,
        closed_loop: bool,
    ) -> Result<String, JsValue> {
        route_many_json(&self.router, controls_json, closed_loop).map_err(error_to_js)
    }
}

pub fn router_from_pack(pack: &[u8]) -> Result<Router, RouterError> {
    Router::from_pack_bytes(pack)
}

pub fn route_json(
    router: &Router,
    origin: Coordinate,
    destination: Coordinate,
) -> Result<String, RouterError> {
    let route = router.route(origin, destination)?;
    serde_json::to_string(&route).map_err(|error| RouterError::InvalidPack(error.to_string()))
}

pub fn route_many_json(
    router: &Router,
    controls_json: &str,
    closed_loop: bool,
) -> Result<String, RouterError> {
    let controls: Vec<Control> = serde_json::from_str(controls_json)
        .map_err(|error| RouterError::InvalidPack(error.to_string()))?;
    let coordinates = controls
        .into_iter()
        .map(Coordinate::from)
        .collect::<Vec<_>>();
    let route = router.route_many(&coordinates, closed_loop)?;
    serde_json::to_string(&route).map_err(|error| RouterError::InvalidPack(error.to_string()))
}

fn error_to_js(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use cch_routing_lite::{build_pack, GraphInput, GraphNode, PackArc};

    fn pack() -> Vec<u8> {
        build_pack(&GraphInput {
            nodes: vec![
                GraphNode::new(-33.87, 151.20, 10),
                GraphNode::new(-33.87, 151.201, 18),
                GraphNode::new(-33.87, 151.202, 14),
            ],
            arcs: vec![PackArc::new(0, 1, 5), PackArc::new(1, 2, 7)],
        })
        .unwrap()
    }

    #[test]
    fn wasm_boundary_loads_same_pack_and_returns_route_json() {
        let router = router_from_pack(&pack()).unwrap();
        let json = route_json(
            &router,
            Coordinate::new(-33.87, 151.20),
            Coordinate::new(-33.87, 151.202),
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["totalWeight"], 12);
        assert_eq!(value["geometry"].as_array().unwrap().len(), 3);
        assert_eq!(value["polyline"].as_array().unwrap().len(), 3);
        assert_eq!(value["elevationGainM"], 8);
        assert_eq!(value["elevationLossM"], 4);
    }

    #[test]
    fn wasm_boundary_routes_many_controls_atomically() {
        let router = router_from_pack(&pack()).unwrap();
        let json = route_many_json(
            &router,
            r#"[{"lat":-33.87,"lng":151.20},{"lat":-33.87,"lng":151.201},{"lat":-33.87,"lng":151.202}]"#,
            false,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["controlCount"], 3);
        assert_eq!(value["legs"].as_array().unwrap().len(), 2);
        assert_eq!(value["geometry"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn wasm_boundary_rejects_bad_json_and_bad_control_counts() {
        let router = router_from_pack(&pack()).unwrap();

        assert!(route_many_json(&router, "not json", false).is_err());
        assert!(route_many_json(&router, r#"[{"lat":-33.87,"lng":151.20}]"#, false).is_err());
    }
}
