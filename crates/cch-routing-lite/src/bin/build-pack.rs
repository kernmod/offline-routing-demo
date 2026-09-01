//! Deterministic public graph.json → offline CCH pack builder.

use std::{io::Read, path::PathBuf};

use cch_routing_lite::{build_pack, GraphInput};

/// Eight MiB leaves room for the public Sydney fixture to grow while bounding
/// memory used to read an untrusted graph before JSON deserialization.
const MAX_GRAPH_INPUT_BYTES: usize = 8 * 1024 * 1024;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args_os();
    let program = arguments.next().unwrap_or_default();
    let Some(input) = arguments.next().map(PathBuf::from) else {
        return Err(format!(
            "usage: {} <graph.json> <routing.pack>",
            program.to_string_lossy()
        )
        .into());
    };
    let Some(output) = arguments.next().map(PathBuf::from) else {
        return Err(format!(
            "usage: {} <graph.json> <routing.pack>",
            program.to_string_lossy()
        )
        .into());
    };
    if arguments.next().is_some() {
        return Err("build-pack accepts exactly two paths".into());
    }

    let mut input_bytes = Vec::new();
    std::fs::File::open(input)?
        .take((MAX_GRAPH_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut input_bytes)?;
    if input_bytes.len() > MAX_GRAPH_INPUT_BYTES {
        return Err("graph input exceeds 8 MiB limit".into());
    }
    let graph: GraphInput = serde_json::from_slice(&input_bytes)?;
    let pack = build_pack(&graph)?;
    std::fs::write(output, pack)?;
    Ok(())
}
