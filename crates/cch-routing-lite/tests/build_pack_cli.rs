use std::process::Command;

use cch_routing_lite::{Coordinate, GraphInput, PackArc, Router};

fn fixture() -> GraphInput {
    GraphInput {
        nodes: vec![
            Coordinate::new(-33.87, 151.20),
            Coordinate::new(-33.8701, 151.2001),
        ],
        arcs: vec![PackArc::new(0, 1, 42), PackArc::new(1, 0, 43)],
    }
}

#[test]
fn cli_build_is_reproducible_and_loadable() {
    let directory = tempfile::tempdir().unwrap();
    let graph_path = directory.path().join("graph.json");
    let first_path = directory.path().join("first.pack");
    let second_path = directory.path().join("second.pack");
    std::fs::write(&graph_path, serde_json::to_vec(&fixture()).unwrap()).unwrap();

    for output in [&first_path, &second_path] {
        let status = Command::new(env!("CARGO_BIN_EXE_build-pack"))
            .arg(&graph_path)
            .arg(output)
            .status()
            .unwrap();
        assert!(status.success());
    }

    let first = std::fs::read(&first_path).unwrap();
    assert_eq!(first, std::fs::read(&second_path).unwrap());
    assert!(Router::from_pack_bytes(&first).is_ok());
}

#[test]
fn cli_rejects_missing_extra_and_invalid_inputs_without_overwriting_output() {
    let binary = env!("CARGO_BIN_EXE_build-pack");
    assert!(!Command::new(binary).status().unwrap().success());
    assert!(!Command::new(binary)
        .args(["one", "two", "three"])
        .status()
        .unwrap()
        .success());

    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("bad.json");
    let output = directory.path().join("routing.pack");
    std::fs::write(&input, b"not json").unwrap();
    std::fs::write(&output, b"preserve me").unwrap();
    assert!(!Command::new(binary)
        .arg(&input)
        .arg(&output)
        .status()
        .unwrap()
        .success());
    assert_eq!(std::fs::read(output).unwrap(), b"preserve me");
}
