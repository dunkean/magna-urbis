//! Maintain the exact same first eligible contraction as the ordered oracle.
use super::*;

type Edge = (usize, usize, usize);
type Ends = BTreeSet<(usize, usize)>;

struct Incidence {
    incoming: Vec<Ends>,
    outgoing: Vec<Ends>,
}
impl Incidence {
    fn new(edges: &BTreeSet<Edge>, count: usize) -> Self {
        let mut index = Self {
            incoming: vec![Ends::new(); count],
            outgoing: vec![Ends::new(); count],
        };
        for &(a, b, label) in edges {
            index.insert((a, b, label));
        }
        index
    }
    fn insert(&mut self, (a, b, label): Edge) {
        self.outgoing[a].insert((b, label));
        self.incoming[b].insert((a, label));
    }
    fn remove(&mut self, (a, b, label): Edge) {
        self.outgoing[a].remove(&(b, label));
        self.incoming[b].remove(&(a, label));
    }
    fn replacements(&self, q: usize, nodes: &[Node]) -> Option<Vec<Edge>> {
        if nodes[q].native {
            return None;
        }
        let neighbors: BTreeSet<_> = self.incoming[q]
            .iter()
            .chain(&self.outgoing[q])
            .map(|&(other, _)| other)
            .collect();
        if neighbors.len() != 2 {
            return None;
        }
        let mut neighbors = neighbors.iter();
        let a = *neighbors.next().unwrap();
        let b = *neighbors.next().unwrap();
        // The oracle tests collinearity, with no extra interval restriction.
        if !cross(&nodes[q].q.sub(&nodes[a].q), &nodes[b].q.sub(&nodes[q].q)).is_zero() {
            return None;
        }
        let mut replacements = vec![];
        for &(a, label) in &self.incoming[q] {
            let mut matching = self.outgoing[q].iter().filter(|e| e.1 == label);
            let &(b, _) = matching.next()?;
            // Preserve the exact rejection of a half-turn to the incoming source.
            if matching.next().is_some() || b == a {
                return None;
            }
            replacements.push((a, b, label));
        }
        (!replacements.is_empty() && replacements.len() == self.outgoing[q].len())
            .then_some(replacements)
    }
}

pub(super) fn reduce(
    edges: Vec<Directed>,
    nodes: &[Node],
    mut visit: impl FnMut(usize, &[Edge]),
) -> (Vec<Directed>, usize) {
    let mut all: BTreeSet<_> = edges.into_iter().map(|e| (e.a, e.b, e.left)).collect();
    let mut index = Incidence::new(&all, nodes.len());
    let mut ready: BTreeSet<_> = (0..nodes.len())
        .filter(|&q| index.replacements(q, nodes).is_some())
        .collect();
    let mut contracted = 0;
    while let Some(q) = ready.pop_first() {
        let replacements = index.replacements(q, nodes).unwrap();
        visit(q, &replacements);
        let removed: BTreeSet<_> = index.incoming[q]
            .iter()
            .map(|&(a, label)| (a, q, label))
            .chain(index.outgoing[q].iter().map(|&(b, label)| (q, b, label)))
            .collect();
        let affected: BTreeSet<_> = removed
            .iter()
            .chain(&replacements)
            .flat_map(|&(a, b, _)| [a, b])
            .collect();
        for edge in removed {
            if all.remove(&edge) {
                index.remove(edge);
            }
        }
        for edge in replacements {
            // The global set and both local indexes deduplicate identically.
            if all.insert(edge) {
                index.insert(edge);
            }
        }
        // Only endpoints of modified triples can change the local predicate.
        for q in affected {
            ready.remove(&q);
            if index.replacements(q, nodes).is_some() {
                ready.insert(q);
            }
        }
        contracted += 1;
    }
    (
        all.into_iter()
            .map(|(a, b, left)| Directed { a, b, left })
            .collect(),
        contracted,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    type Journal = Vec<(usize, Vec<Edge>)>;

    // Kept verbatim from the original ordered reconstruction, plus a journal.
    fn oracle(edges: Vec<Directed>, nodes: &[Node]) -> (Vec<Edge>, Journal) {
        let mut all: BTreeSet<_> = edges.into_iter().map(|e| (e.a, e.b, e.left)).collect();
        let mut journal = vec![];
        loop {
            let mut neighbors = BTreeMap::<usize, BTreeSet<usize>>::new();
            for &(a, b, _) in &all {
                neighbors.entry(a).or_default().insert(b);
                neighbors.entry(b).or_default().insert(a);
            }
            let mut change = None;
            for (&q, adjacent) in &neighbors {
                if nodes[q].native || adjacent.len() != 2 {
                    continue;
                }
                let mut adjacent = adjacent.iter();
                let a = *adjacent.next().unwrap();
                let b = *adjacent.next().unwrap();
                if !cross(&nodes[q].q.sub(&nodes[a].q), &nodes[b].q.sub(&nodes[q].q)).is_zero() {
                    continue;
                }
                let incoming: Vec<_> = all.iter().copied().filter(|e| e.1 == q).collect();
                let outgoing: Vec<_> = all.iter().copied().filter(|e| e.0 == q).collect();
                let mut replacements = vec![];
                for &(a, _, label) in &incoming {
                    let matching: Vec<_> = outgoing.iter().filter(|e| e.2 == label).collect();
                    if matching.len() != 1 || matching[0].1 == a {
                        replacements.clear();
                        break;
                    }
                    replacements.push((a, matching[0].1, label));
                }
                if !replacements.is_empty() && replacements.len() == outgoing.len() {
                    change = Some((q, replacements));
                    break;
                }
            }
            let Some((q, replacements)) = change else {
                break;
            };
            journal.push((q, replacements.clone()));
            all.retain(|e| e.0 != q && e.1 != q);
            all.extend(replacements);
        }
        (all.into_iter().collect(), journal)
    }
    fn nodes(points: Vec<Q>, native: &[usize]) -> Vec<Node> {
        points
            .into_iter()
            .enumerate()
            .map(|(id, q)| Node {
                point: q.point().unwrap(),
                q,
                supports: BTreeSet::new(),
                native: native.contains(&id),
            })
            .collect()
    }
    fn line(count: usize, native: &[usize]) -> Vec<Node> {
        nodes(
            (0..count)
                .map(|id| {
                    Q::from(Point {
                        x: id as f64,
                        y: 0.0,
                    })
                })
                .collect(),
            native,
        )
    }
    fn compare(edges: Vec<Edge>, nodes: &[Node]) -> Journal {
        let input = || {
            edges
                .iter()
                .map(|&(a, b, left)| Directed { a, b, left })
                .collect()
        };
        let (expected, wanted) = oracle(input(), nodes);
        let mut journal = vec![];
        let (actual, count) = reduce(input(), nodes, |q, r| journal.push((q, r.to_vec())));
        assert_eq!(journal, wanted);
        assert_eq!(count, wanted.len());
        assert_eq!(
            actual
                .iter()
                .map(|e| (e.a, e.b, e.left))
                .collect::<Vec<_>>(),
            expected
        );
        journal
    }
    #[test]
    fn ordered_long_chain_and_duplicate_replacements_match_oracle() {
        let mut edges = vec![];
        for i in 0..127 {
            edges.extend([(i, i + 1, 0), (i + 1, i, 1)]);
        }
        let journal = compare(edges, &line(128, &[0, 127]));
        assert_eq!(
            journal.iter().map(|e| e.0).collect::<Vec<_>>(),
            (1..127).collect::<Vec<_>>()
        );
        let duplicate = compare(
            vec![(0, 1, 0), (1, 2, 0), (0, 2, 0), (0, 1, 1), (1, 2, 1)],
            &line(3, &[]),
        );
        assert_eq!(duplicate, vec![(1, vec![(0, 2, 0), (0, 2, 1)])]);
    }
    #[test]
    fn exact_corners_half_turns_branches_and_native_nodes_match_oracle() {
        assert!(
            compare(
                vec![(0, 1, 0), (1, 0, 0), (2, 1, 1), (1, 2, 1)],
                &line(3, &[])
            )
            .is_empty()
        );
        assert!(compare(vec![(0, 1, 0), (1, 2, 0)], &line(3, &[1])).is_empty());
        assert!(compare(vec![(0, 1, 0), (1, 2, 0), (1, 3, 0)], &line(4, &[0, 2, 3])).is_empty());
        let mut points = line(3, &[]);
        points[1].q.y = R::new(1.into(), num_bigint::BigInt::from(10u8).pow(80));
        points[1].point = points[1].q.point().unwrap();
        assert!(compare(vec![(0, 1, 0), (1, 2, 0)], &points).is_empty());
        assert_eq!(
            compare(vec![(0, 2, 0), (2, 1, 0)], &line(3, &[])),
            vec![(2, vec![(0, 1, 0)])]
        );
    }
    #[test]
    fn fixed_sparse_graphs_preserve_every_contraction_and_sorted_triple() {
        let mut state = 351936u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for _ in 0..2000 {
            let mut points = line(12, &[]);
            for node in &mut points {
                node.q.y = rational((next() % 4 == 0) as u8 as f64);
                node.point = node.q.point().unwrap();
                node.native = next() % 6 == 0;
            }
            let mut edges = vec![];
            for _ in 0..4 + next() % 36 {
                let (a, b, label) = (
                    (next() % 12) as usize,
                    (next() % 12) as usize,
                    (next() % 3) as usize,
                );
                if a != b {
                    edges.push((a, b, label));
                }
            }
            compare(edges, &points);
        }
    }
}
