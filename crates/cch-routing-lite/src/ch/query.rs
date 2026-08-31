use std::{cmp::Reverse, collections::BinaryHeap};

use super::{
    cch::CchStructure,
    customize::{add, CchWeights, Cost, INFINITE_COST},
};
use crate::RouterError;

#[derive(Debug, Clone, Copy)]
pub(crate) struct QueryArc {
    pub(crate) index: u32,
    pub(crate) forward: bool,
}

pub(crate) fn query(
    cch: &CchStructure,
    weights: &CchWeights,
    source_node: u32,
    target_node: u32,
) -> Result<Option<(Cost, Vec<QueryArc>)>, RouterError> {
    if source_node == target_node {
        return Ok(Some((0, Vec::new())));
    }
    let source = cch.rank[source_node as usize];
    let target = cch.rank[target_node as usize];
    let (forward_distance, forward_parent) = upward_search(cch, &weights.forward, source)?;
    let (backward_distance, backward_parent) = upward_search(cch, &weights.backward, target)?;
    let mut best = None;
    for (rank, (&forward, &backward)) in forward_distance.iter().zip(&backward_distance).enumerate()
    {
        let total = add(forward, backward)?;
        if total == INFINITE_COST {
            continue;
        }
        let candidate = (rank as u32, total);
        let replace = match best {
            None => true,
            Some((best_rank, best_cost)) => (total, rank as u32) < (best_cost, best_rank),
        };
        if replace {
            best = Some(candidate);
        }
    }
    let Some((meeting, cost)) = best else {
        return Ok(None);
    };

    let mut forward_arcs = Vec::new();
    let mut current = meeting;
    while current != source {
        let Some(arc) = forward_parent[current as usize] else {
            return Ok(None);
        };
        forward_arcs.push(QueryArc {
            index: arc,
            forward: true,
        });
        current = cch.up_tail[arc as usize];
    }
    forward_arcs.reverse();
    current = meeting;
    while current != target {
        let Some(arc) = backward_parent[current as usize] else {
            return Ok(None);
        };
        forward_arcs.push(QueryArc {
            index: arc,
            forward: false,
        });
        current = cch.up_tail[arc as usize];
    }
    Ok(Some((cost, forward_arcs)))
}

fn upward_search(
    cch: &CchStructure,
    weights: &[Cost],
    source: u32,
) -> Result<(Vec<Cost>, Vec<Option<u32>>), RouterError> {
    let mut distance = vec![INFINITE_COST; cch.rank.len()];
    let mut parent = vec![None; cch.rank.len()];
    let mut queue = BinaryHeap::new();
    distance[source as usize] = 0;
    queue.push(Reverse((0_u64, source)));
    while let Some(Reverse((cost, node))) = queue.pop() {
        if cost != distance[node as usize] {
            continue;
        }
        let start = cch.up_first_out[node as usize] as usize;
        let end = cch.up_first_out[node as usize + 1] as usize;
        for (arc, &weight) in weights.iter().enumerate().take(end).skip(start) {
            let next = add(cost, weight)?;
            let head = cch.up_head[arc] as usize;
            if next < distance[head] {
                distance[head] = next;
                parent[head] = Some(arc as u32);
                queue.push(Reverse((next, head as u32)));
            }
        }
    }
    Ok((distance, parent))
}
