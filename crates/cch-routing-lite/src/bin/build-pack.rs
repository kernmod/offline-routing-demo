//! Deterministic public graph.json → offline CCH pack builder.

use std::path::PathBuf;

use cch_routing_lite::{build_pack, GraphInput};

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

    let input_bytes = std::fs::read(input)?;
    let graph: GraphInput = serde_json::from_slice(&input_bytes)?;
    let pack = build_pack(&graph)?;
    std::fs::write(output, pack)?;
    Ok(())
}
