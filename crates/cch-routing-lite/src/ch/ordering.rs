use std::cmp::Ordering;

use crate::Coordinate;

/// Deterministic spatial nested-dissection-style ordering.
///
/// Median separators are emitted after both partitions. CCH correctness does
/// not depend on ordering quality, while the stable coordinate/id tie-breaks
/// make public fixture builds byte reproducible.
pub(crate) fn spatial_ordering(nodes: &[Coordinate]) -> Vec<u32> {
    fn recurse(nodes: &[Coordinate], ids: &mut [u32], order: &mut Vec<u32>) {
        if ids.is_empty() {
            return;
        }
        if ids.len() == 1 {
            order.push(ids[0]);
            return;
        }
        let (min_lat, max_lat, min_lng, max_lng) = ids.iter().fold(
            (
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
            ),
            |(min_lat, max_lat, min_lng, max_lng), &id| {
                let point = nodes[id as usize];
                (
                    min_lat.min(point.lat),
                    max_lat.max(point.lat),
                    min_lng.min(point.lng),
                    max_lng.max(point.lng),
                )
            },
        );
        let by_lng = max_lng - min_lng >= max_lat - min_lat;
        ids.sort_unstable_by(|&left, &right| {
            let left_point = nodes[left as usize];
            let right_point = nodes[right as usize];
            let primary = if by_lng {
                left_point.lng.total_cmp(&right_point.lng)
            } else {
                left_point.lat.total_cmp(&right_point.lat)
            };
            if primary == Ordering::Equal {
                left.cmp(&right)
            } else {
                primary
            }
        });
        let middle = ids.len() / 2;
        let separator = ids[middle];
        let (left, rest) = ids.split_at_mut(middle);
        let (_, right) = rest.split_at_mut(1);
        recurse(nodes, left, order);
        recurse(nodes, right, order);
        order.push(separator);
    }

    let mut ids: Vec<u32> = (0..nodes.len() as u32).collect();
    let mut order = Vec::with_capacity(ids.len());
    recurse(nodes, &mut ids, &mut order);
    let mut rank = vec![0; order.len()];
    for (value, node) in order.into_iter().enumerate() {
        rank[node as usize] = value as u32;
    }
    rank
}
