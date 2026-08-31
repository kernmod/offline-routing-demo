use crate::{
    ch::{
        cch::CchStructure,
        customize::{CchWeights, Witness},
        query::QueryArc,
    },
    PackArc, RouterError,
};

pub(crate) fn unpack(
    cch: &CchStructure,
    weights: &CchWeights,
    path: &[QueryArc],
) -> Result<Vec<u32>, RouterError> {
    let mut result = Vec::new();
    for &arc in path {
        unpack_arc(cch, weights, arc.index, arc.forward, &mut result, 0)?;
    }
    Ok(result)
}

fn unpack_arc(
    cch: &CchStructure,
    weights: &CchWeights,
    index: u32,
    forward: bool,
    result: &mut Vec<u32>,
    depth: usize,
) -> Result<(), RouterError> {
    if depth > cch.rank.len() {
        return Err(RouterError::InvalidPack("cyclic CCH unpack witness".into()));
    }
    let witness = if forward {
        &weights.forward_witness[index as usize]
    } else {
        &weights.backward_witness[index as usize]
    };
    match witness {
        Witness::Original { arc } => result.push(*arc),
        Witness::Triangle {
            bottom_arc,
            mid_arc,
        } if forward => {
            unpack_arc(cch, weights, *bottom_arc, false, result, depth + 1)?;
            unpack_arc(cch, weights, *mid_arc, true, result, depth + 1)?;
        }
        Witness::Triangle {
            bottom_arc,
            mid_arc,
        } => {
            unpack_arc(cch, weights, *mid_arc, false, result, depth + 1)?;
            unpack_arc(cch, weights, *bottom_arc, true, result, depth + 1)?;
        }
        Witness::None => return Err(RouterError::NoRoute),
    }
    Ok(())
}

pub(crate) fn original_node_path(
    arcs: &[PackArc],
    source: u32,
    edge_ids: &[u32],
) -> Result<Vec<u32>, RouterError> {
    let mut nodes = vec![source];
    let mut current = source;
    for &edge_id in edge_ids {
        let edge = arcs.get(edge_id as usize).ok_or_else(|| {
            RouterError::InvalidPack("unpack references missing input arc".into())
        })?;
        if edge.from != current {
            return Err(RouterError::InvalidPack(
                "unpacked CCH arcs are not connected".into(),
            ));
        }
        current = edge.to;
        nodes.push(current);
    }
    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ch::{customize::CchWeights, query::query};

    #[test]
    fn original_witness_is_the_unpack_base_case() {
        let arcs = vec![PackArc::new(0, 1, 5)];
        let cch = CchStructure::build(2, &arcs, &[0, 1]).unwrap();
        let weights = CchWeights::customize(&cch, &arcs).unwrap();
        let cch_arc = cch.find_arc(0, 1).unwrap();

        assert_eq!(
            unpack(
                &cch,
                &weights,
                &[QueryArc {
                    index: cch_arc,
                    forward: true,
                }],
            )
            .unwrap(),
            vec![0]
        );
    }

    #[test]
    fn nested_triangle_witnesses_recursively_restore_three_original_arcs() {
        let arcs = vec![
            PackArc::new(0, 1, 2),
            PackArc::new(1, 2, 3),
            PackArc::new(2, 3, 5),
        ];
        // Contract 1, then 2; the 0→3 query becomes one top-level shortcut
        // whose first child is itself a shortcut through node 1.
        let cch = CchStructure::build(4, &arcs, &[2, 0, 1, 3]).unwrap();
        let weights = CchWeights::customize(&cch, &arcs).unwrap();
        let (cost, path) = query(&cch, &weights, 0, 3).unwrap().unwrap();

        assert_eq!(cost, 10);
        assert_eq!(path.len(), 1);
        let original = unpack(&cch, &weights, &path).unwrap();
        assert_eq!(original, vec![0, 1, 2]);
        assert_eq!(
            original_node_path(&arcs, 0, &original).unwrap(),
            vec![0, 1, 2, 3]
        );
    }

    #[test]
    fn missing_directional_witness_is_reported_as_no_route() {
        let arcs = vec![PackArc::new(1, 0, 5)];
        let cch = CchStructure::build(2, &arcs, &[0, 1]).unwrap();
        let weights = CchWeights::customize(&cch, &arcs).unwrap();
        let cch_arc = cch.find_arc(0, 1).unwrap();

        assert!(matches!(
            unpack(
                &cch,
                &weights,
                &[QueryArc {
                    index: cch_arc,
                    forward: true,
                }],
            ),
            Err(RouterError::NoRoute)
        ));
    }
}
