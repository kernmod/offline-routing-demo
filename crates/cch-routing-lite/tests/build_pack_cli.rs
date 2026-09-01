use std::process::Command;

use cch_routing_lite::{GraphInput, GraphNode, PackArc, Router};

fn fixture() -> GraphInput {
    GraphInput {
        nodes: vec![
            GraphNode::new(-33.87, 151.20, 12),
            GraphNode::new(-33.8701, 151.2001, 18),
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

#[test]
fn cli_rejects_oversized_input_without_overwriting_output() {
    const MAX_GRAPH_INPUT_BYTES: u64 = 8 * 1024 * 1024;

    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("oversized.json");
    let output = directory.path().join("routing.pack");
    let input_file = std::fs::File::create(&input).unwrap();
    input_file.set_len(MAX_GRAPH_INPUT_BYTES + 1).unwrap();
    std::fs::write(&output, b"preserve me").unwrap();

    let result = Command::new(env!("CARGO_BIN_EXE_build-pack"))
        .arg(&input)
        .arg(&output)
        .output()
        .unwrap();

    assert!(!result.status.success());
    assert!(
        String::from_utf8_lossy(&result.stderr).contains("graph input exceeds 8 MiB limit"),
        "unexpected stderr: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(std::fs::read(output).unwrap(), b"preserve me");
}
