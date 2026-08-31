use serde::{Deserialize, Serialize};

use crate::{ch::cch::CchStructure, PackArc, RouterError, MAX_ROUTE_WEIGHT};

pub(crate) type Cost = u64;
pub(crate) const INFINITE_COST: Cost = u64::MAX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum Witness {
    None,
    Original { arc: u32 },
    Triangle { bottom_arc: u32, mid_arc: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CchWeights {
    pub(crate) forward: Vec<Cost>,
    pub(crate) backward: Vec<Cost>,
    pub(crate) forward_witness: Vec<Witness>,
    pub(crate) backward_witness: Vec<Witness>,
}

impl CchWeights {
    pub(crate) fn customize(cch: &CchStructure, arcs: &[PackArc]) -> Result<Self, RouterError> {
        let count = cch.arc_count();
        let mut weights = Self {
            forward: vec![INFINITE_COST; count],
            backward: vec![INFINITE_COST; count],
            forward_witness: vec![Witness::None; count],
            backward_witness: vec![Witness::None; count],
        };

        for (input_index, arc) in arcs.iter().enumerate() {
            let from_rank = cch.rank[arc.from as usize];
            let to_rank = cch.rank[arc.to as usize];
            let (tail, head, forward) = if from_rank < to_rank {
                (from_rank, to_rank, true)
            } else {
                (to_rank, from_rank, false)
            };
            let cch_arc = cch.find_arc(tail, head).ok_or_else(|| {
                RouterError::InvalidPack("input arc missing from CCH topology".into())
            })? as usize;
            let witness = Witness::Original {
                arc: input_index as u32,
            };
            if forward && Cost::from(arc.weight) < weights.forward[cch_arc] {
                weights.forward[cch_arc] = Cost::from(arc.weight);
                weights.forward_witness[cch_arc] = witness;
            } else if !forward && Cost::from(arc.weight) < weights.backward[cch_arc] {
                weights.backward[cch_arc] = Cost::from(arc.weight);
                weights.backward_witness[cch_arc] = witness;
            }
        }

        // Basic CCH customization over lower triangles. Processing bottoms in
        // ascending rank ensures every child arc is final before it is used.
        for bottom in 0..cch.rank.len() as u32 {
            let start = cch.up_first_out[bottom as usize] as usize;
            let end = cch.up_first_out[bottom as usize + 1] as usize;
            for left_index in start..end {
                let left = cch.up_head[left_index];
                for right_index in left_index + 1..end {
                    let right = cch.up_head[right_index];
                    let Some(target_arc) = cch.find_arc(left, right).map(|arc| arc as usize) else {
                        continue;
                    };
                    let forward = add(weights.backward[left_index], weights.forward[right_index])?;
                    if forward < weights.forward[target_arc] {
                        weights.forward[target_arc] = forward;
                        weights.forward_witness[target_arc] = Witness::Triangle {
                            bottom_arc: left_index as u32,
                            mid_arc: right_index as u32,
                        };
                    }
                    let backward = add(weights.backward[right_index], weights.forward[left_index])?;
                    if backward < weights.backward[target_arc] {
                        weights.backward[target_arc] = backward;
                        weights.backward_witness[target_arc] = Witness::Triangle {
                            bottom_arc: left_index as u32,
                            mid_arc: right_index as u32,
                        };
                    }
                }
            }
        }
        Ok(weights)
    }

    pub(crate) fn shortcut_witness_count(&self) -> usize {
        self.forward_witness
            .iter()
            .chain(&self.backward_witness)
            .filter(|witness| matches!(witness, Witness::Triangle { .. }))
            .count()
    }

    pub(crate) fn validate(&self, cch: &CchStructure, arcs: &[PackArc]) -> Result<(), RouterError> {
        let count = cch.arc_count();
        if self.forward.len() != count
            || self.backward.len() != count
            || self.forward_witness.len() != count
            || self.backward_witness.len() != count
        {
            return Err(RouterError::InvalidPack(
                "CCH weights/witness dimensions differ".into(),
            ));
        }
        if self
            .forward
            .iter()
            .chain(&self.backward)
            .any(|&weight| weight != INFINITE_COST && weight > MAX_ROUTE_WEIGHT)
        {
            return Err(RouterError::CostOverflow);
        }
        for index in 0..count {
            self.validate_witness(cch, arcs, index, true)?;
            self.validate_witness(cch, arcs, index, false)?;
        }
        Ok(())
    }

    fn validate_witness(
        &self,
        cch: &CchStructure,
        arcs: &[PackArc],
        index: usize,
        forward: bool,
    ) -> Result<(), RouterError> {
        let weight = if forward {
            self.forward[index]
        } else {
            self.backward[index]
        };
        let witness = if forward {
            &self.forward_witness[index]
        } else {
            &self.backward_witness[index]
        };
        match witness {
            Witness::None if weight == INFINITE_COST => Ok(()),
            Witness::Original { arc } => {
                let original = arcs.get(*arc as usize).ok_or_else(|| {
                    RouterError::InvalidPack("CCH witness references missing input arc".into())
                })?;
                let tail_rank = cch.up_tail[index];
                let head_rank = cch.up_head[index];
                let (expected_from, expected_to) = if forward {
                    (cch.order[tail_rank as usize], cch.order[head_rank as usize])
                } else {
                    (cch.order[head_rank as usize], cch.order[tail_rank as usize])
                };
                if original.from != expected_from
                    || original.to != expected_to
                    || Cost::from(original.weight) != weight
                {
                    return Err(RouterError::InvalidPack(
                        "CCH original witness does not realize its arc".into(),
                    ));
                }
                Ok(())
            }
            Witness::Triangle {
                bottom_arc,
                mid_arc,
            } => {
                if weight == INFINITE_COST {
                    return Err(RouterError::InvalidPack(
                        "unreachable CCH weight must not have a witness".into(),
                    ));
                }
                let bottom = *bottom_arc as usize;
                let mid = *mid_arc as usize;
                if bottom >= index
                    || mid >= index
                    || bottom >= cch.arc_count()
                    || mid >= cch.arc_count()
                {
                    return Err(RouterError::InvalidPack(
                        "CCH triangle witness is not lower-ranked".into(),
                    ));
                }
                let tail = cch.up_tail[index];
                let head = cch.up_head[index];
                if cch.up_tail[bottom] != cch.up_tail[mid]
                    || cch.up_head[bottom] != tail
                    || cch.up_head[mid] != head
                {
                    return Err(RouterError::InvalidPack(
                        "CCH triangle witness endpoints mismatch".into(),
                    ));
                }
                let expected = if forward {
                    add(self.backward[bottom], self.forward[mid])?
                } else {
                    add(self.backward[mid], self.forward[bottom])?
                };
                if expected != weight {
                    return Err(RouterError::InvalidPack(
                        "CCH triangle witness weight mismatch".into(),
                    ));
                }
                Ok(())
            }
            _ => Err(RouterError::InvalidPack(
                "finite CCH weight needs a witness".into(),
            )),
        }
    }
}

pub(crate) fn add(left: Cost, right: Cost) -> Result<Cost, RouterError> {
    if left == INFINITE_COST || right == INFINITE_COST {
        Ok(INFINITE_COST)
    } else {
        left.checked_add(right)
            .filter(|&sum| sum != INFINITE_COST)
            .ok_or(RouterError::CostOverflow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lower_triangle_customization_records_directional_weight_invariants() {
        // Node 1 is contracted first. The missing 0↔2 arc must be customized
        // through the lower triangle 0↔1↔2 in both directions.
        let arcs = vec![
            PackArc::new(0, 1, 3),
            PackArc::new(1, 0, 9),
            PackArc::new(1, 2, 4),
            PackArc::new(2, 1, 8),
        ];
        let cch = CchStructure::build(3, &arcs, &[1, 0, 2]).unwrap();
        let weights = CchWeights::customize(&cch, &arcs).unwrap();
        let target = cch.find_arc(1, 2).unwrap() as usize;
        let bottom = cch.find_arc(0, 1).unwrap();
        let mid = cch.find_arc(0, 2).unwrap();

        assert_eq!(weights.forward[target], 7);
        assert_eq!(weights.backward[target], 17);
        assert_eq!(
            weights.forward_witness[target],
            Witness::Triangle {
                bottom_arc: bottom,
                mid_arc: mid,
            }
        );
        assert_eq!(
            weights.backward_witness[target],
            Witness::Triangle {
                bottom_arc: bottom,
                mid_arc: mid,
            }
        );
        weights.validate(&cch, &arcs).unwrap();
    }

    #[test]
    fn unreachable_children_do_not_create_a_finite_triangle() {
        assert_eq!(add(INFINITE_COST, 1).unwrap(), INFINITE_COST);
        assert_eq!(add(1, INFINITE_COST).unwrap(), INFINITE_COST);
    }

    #[test]
    fn finite_cost_representability_limit_is_checked() {
        assert_eq!(add(u64::MAX - 2, 1).unwrap(), u64::MAX - 1);
        assert!(matches!(
            add(u64::MAX - 1, 1),
            Err(RouterError::CostOverflow)
        ));
    }
}
