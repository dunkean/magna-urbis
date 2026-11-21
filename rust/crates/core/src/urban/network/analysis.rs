//! Read-only street connectivity, component lengths, anchors, and dead ends.

use super::spatial::{Key, distance, key};
use super::street::protected;
use crate::urban::{Point, Street};
use std::collections::BTreeMap;

struct GraphTimer(Option<std::time::Instant>);
impl GraphTimer {
    fn start() -> Self { Self(std::env::var("URBAN_PROFILE").is_ok().then(std::time::Instant::now)) }
}
impl Drop for GraphTimer {
    fn drop(&mut self) { if let Some(t) = self.0 && t.elapsed().as_millis() >= 25 { eprintln!("  graph.new: {} ms", t.elapsed().as_millis()); } }
}
/// Map over sorted, distinct keys held in two flat vectors: the lookups and the
/// ascending iteration of a `BTreeMap`, built in one pass without a node per entry.
pub(super) struct KeyMap<V> {
    keys: Vec<Key>,
    vals: Vec<V>,
}
impl<V> KeyMap<V> {
    pub(super) fn get(&self, k: &Key) -> Option<&V> {
        self.keys.binary_search(k).ok().map(|i| &self.vals[i])
    }
}
impl<V> std::ops::Index<&Key> for KeyMap<V> {
    type Output = V;
    fn index(&self, k: &Key) -> &V {
        self.get(k).expect("key in map")
    }
}
impl<'a, V> IntoIterator for &'a KeyMap<V> {
    type Item = (&'a Key, &'a V);
    type IntoIter = std::iter::Zip<std::slice::Iter<'a, Key>, std::slice::Iter<'a, V>>;
    fn into_iter(self) -> Self::IntoIter {
        self.keys.iter().zip(self.vals.iter())
    }
}
pub(super) struct Graph {
    /// Number of distinct neighbours of each node.
    pub(super) degrees: KeyMap<usize>,
    pub(super) component: KeyMap<usize>,
    pub(super) length: Vec<f64>,
    pub(super) anchored: Vec<bool>,
}
impl Graph {
    pub(super) fn new(streets: &[Street]) -> Self {
        let _t = GraphTimer::start();
        // Directed links sorted once: node `n` (the `n`-th key in order) owns
        // `links[starts[n]..starts[n + 1]]`, its neighbours in order.
        let mut links: Vec<(Key, Key)> = vec![];
        for s in streets {
            for p in s.path.windows(2) {
                let a = key(p[0]);
                let b = key(p[1]);
                if a != b {
                    links.push((a, b));
                    links.push((b, a));
                }
            }
        }
        links.sort_unstable();
        links.dedup();
        let mut keys: Vec<Key> = vec![];
        let mut starts: Vec<usize> = vec![];
        for (n, &(a, _)) in links.iter().enumerate() {
            if keys.last() != Some(&a) {
                keys.push(a);
                starts.push(n);
            }
        }
        starts.push(links.len());
        let targets: Vec<usize> = links.iter().map(|&(_, b)| keys.binary_search(&b).expect("linked node")).collect();
        // Components numbered in key order of their first node.
        let mut labels = vec![usize::MAX; keys.len()];
        let mut count = 0;
        let mut queue = vec![];
        for root in 0..keys.len() {
            if labels[root] != usize::MAX {
                continue;
            }
            labels[root] = count;
            queue.push(root);
            while let Some(n) = queue.pop() {
                for &m in &targets[starts[n]..starts[n + 1]] {
                    if labels[m] == usize::MAX {
                        labels[m] = count;
                        queue.push(m);
                    }
                }
            }
            count += 1;
        }
        let degrees = KeyMap { keys: keys.clone(), vals: (0..keys.len()).map(|n| starts[n + 1] - starts[n]).collect() };
        let component = KeyMap { keys, vals: labels };
        let mut length = vec![0.0; count];
        let mut anchored = vec![false; count];
        for s in streets {
            if let Some(&c) = s.path.first().and_then(|&p| component.get(&key(p))) {
                length[c] += s.path.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>();
                anchored[c] |= protected(s);
            }
        }
        Self {
            degrees,
            component,
            length,
            anchored,
        }
    }
    pub(super) fn degree(&self, p: Point) -> usize {
        self.degrees.get(&key(p)).copied().unwrap_or(0)
    }
}

/// Dead ends of each street ([start, end]): an end no other street meets.
pub(in crate::urban) fn dead_ends(streets: &[Street]) -> Vec<[bool; 2]> {
    let mut degree: BTreeMap<Key, usize> = BTreeMap::new();
    for s in streets {
        for &p in &s.path {
            *degree.entry(key(p)).or_default() += 1;
        }
    }
    streets
        .iter()
        .map(|s| match (s.path.first(), s.path.last()) {
            (Some(&a), Some(&b)) if s.path.len() >= 2 => {
                [degree[&key(a)] == 1, degree[&key(b)] == 1]
            }
            _ => [false, false],
        })
        .collect()
}
