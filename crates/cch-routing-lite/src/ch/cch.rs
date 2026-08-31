use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{PackArc, RouterError};

/// Metric-independent chordal supergraph in rank space.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CchStructure {
    pub(crate) rank: Vec<u32>,
    pub(crate) order: Vec<u32>,
    pub(crate) up_first_out: Vec<u32>,
    pub(crate) up_tail: Vec<u32>,
    pub(crate) up_head: Vec<u32>,
}

impl CchStructure {
    pub(crate) fn build(
        node_count: usize,
        input_arcs: &[PackArc],
        rank: &[u32],
    ) -> Result<Self, RouterError> {
        validate_rank(node_count, rank)?;
        let mut adjacency = vec![BTreeSet::new(); node_count];
        for arc in input_arcs {
            let from = usize::try_from(arc.from).unwrap_or(usize::MAX);
            let to = usize::try_from(arc.to).unwrap_or(usize::MAX);
            if from >= node_count || to >= node_count || from == to || arc.weight == 0 {
                return Err(RouterError::InvalidPack(
                    "input arcs need distinct valid endpoints and non-zero weights".into(),
                ));
            }
            let (low, high) = sorted_pair(rank[from], rank[to]);
            adjacency[low as usize].insert(high);
        }

        // Gaussian elimination: eliminate ranks low-to-high, completing the
        // higher-neighbour clique. These fill arcs are the CCH shortcuts.
        for bottom in 0..node_count as u32 {
            let higher: Vec<u32> = adjacency[bottom as usize]
                .iter()
                .copied()
                .filter(|&head| head > bottom)
                .collect();
            for (index, &left) in higher.iter().enumerate() {
                for &right in &higher[index + 1..] {
                    let (low, high) = sorted_pair(left, right);
                    adjacency[low as usize].insert(high);
                }
            }
        }

        let mut first_out = Vec::with_capacity(node_count + 1);
        let mut tail = Vec::new();
        let mut head = Vec::new();
        for (rank_node, neighbours) in adjacency.iter().enumerate() {
            first_out.push(head.len() as u32);
            for &higher in neighbours.range((rank_node as u32 + 1)..) {
                tail.push(rank_node as u32);
                head.push(higher);
            }
        }
        first_out.push(head.len() as u32);
        let mut order = vec![0_u32; node_count];
        for (node, &node_rank) in rank.iter().enumerate() {
            order[node_rank as usize] = node as u32;
        }
        Ok(Self {
            rank: rank.to_vec(),
            order,
            up_first_out: first_out,
            up_tail: tail,
            up_head: head,
        })
    }

    pub(crate) fn arc_count(&self) -> usize {
        self.up_head.len()
    }

    pub(crate) fn find_arc(&self, tail: u32, head: u32) -> Option<u32> {
        let start = *self.up_first_out.get(tail as usize)? as usize;
        let end = *self.up_first_out.get(tail as usize + 1)? as usize;
        self.up_head[start..end]
            .binary_search(&head)
            .ok()
            .map(|offset| (start + offset) as u32)
    }

    pub(crate) fn validate(&self, node_count: usize) -> Result<(), RouterError> {
        validate_rank(node_count, &self.rank)?;
        if self.order.len() != node_count
            || self.up_first_out.len() != node_count + 1
            || self.up_first_out.first() != Some(&0)
            || self.up_first_out.last().copied() != Some(self.up_head.len() as u32)
            || self.up_tail.len() != self.up_head.len()
            || self
                .up_first_out
                .windows(2)
                .any(|window| window[0] > window[1])
        {
            return Err(RouterError::InvalidPack(
                "invalid CCH CSR dimensions".into(),
            ));
        }
        for rank_node in 0..node_count {
            if self.order[self.rank[rank_node] as usize] != rank_node as u32 {
                return Err(RouterError::InvalidPack("CCH rank/order mismatch".into()));
            }
            let start = self.up_first_out[rank_node] as usize;
            let end = self.up_first_out[rank_node + 1] as usize;
            let heads = &self.up_head[start..end];
            if heads.windows(2).any(|pair| pair[0] >= pair[1])
                || heads
                    .iter()
                    .any(|&head| head as usize >= node_count || head <= rank_node as u32)
                || self.up_tail[start..end]
                    .iter()
                    .any(|&tail| tail != rank_node as u32)
            {
                return Err(RouterError::InvalidPack("invalid upward CCH arcs".into()));
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_rank(node_count: usize, rank: &[u32]) -> Result<(), RouterError> {
    if rank.len() != node_count {
        return Err(RouterError::InvalidPack(
            "CCH rank count differs from node count".into(),
        ));
    }
    let mut seen = vec![false; node_count];
    for &value in rank {
        let Some(slot) = seen.get_mut(value as usize) else {
            return Err(RouterError::InvalidPack(
                "CCH ranks must be a permutation".into(),
            ));
        };
        if std::mem::replace(slot, true) {
            return Err(RouterError::InvalidPack("CCH ranks must be unique".into()));
        }
    }
    Ok(())
}

fn sorted_pair(left: u32, right: u32) -> (u32, u32) {
    if left < right {
        (left, right)
    } else {
        (right, left)
    }
}
