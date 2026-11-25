//! Streets as a graph inside the network clean (`network::clean_terrain`).
//!
//! One node per junction or street end, never one per sample: an edge holds
//! the samples drawn between two nodes with a width at each of them, and a
//! chain lists, in drawn order, the edges that came from one input street.
//! The graph is loaded once from the incoming streets: every same-level
//! crossing or touch gets a shared node, and a run that two streets share
//! belongs to the more important one (the other is split around it). It then
//! seats the admissible loose ends on their hosts, splitting each host at the
//! seat, and exports its chains back to streets once.
//!
//! A bridge deck (level 1) and the ground below it (level 0) share a node only
//! where the deck lands.

use super::network::{EPS, Key, Segment, candidates, crossings, key, private, protected, width};
use super::{Point, Street};
use std::collections::{BTreeMap, HashMap};

#[cfg(feature = "street-topology")]
mod snapshot;
#[cfg(feature = "street-topology")]
pub use snapshot::{street_topology, StreetTopology};

type Id = u32;
/// Two positions closer than this are one sample when a seat is placed (m).
const SNAP: f64 = 1e-3;
/// Grid cell of the end and host searches (m).
const CELL: f64 = 16.0;
/// Below this sine an end runs along its host: whether it meets it is
/// ambiguous, so it stays as drawn.
const MIN_SIN: f64 = 0.35;

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
fn cell(p: Point) -> (i64, i64) {
    ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64)
}
/// Nearest point of segment `a`-`b` to `p`: (distance, parameter, point).
fn foot(p: Point, a: Point, b: Point) -> (f64, f64, Point) {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    let q = lerp(a, b, t);
    (distance(p, q), t, q)
}
fn level(s: &Street) -> u8 {
    u8::from(s.role == "bridge")
}
/// Water supports first, then protected roads, then the others.
fn support(s: &Street) -> u8 {
    match s.role.as_str() {
        "bridge" => 0,
        "quay" => 1,
        "ford" | "causeway" => 2,
        _ if protected(s) => 3,
        _ => 4,
    }
}

struct Node {
    /// Canonical position: the least of the drawn positions merged here.
    p: Point,
    /// Incident edges (a loop appears twice).
    arms: Vec<Id>,
}
struct Edge {
    /// Start and end node, in the drawn direction of its chain.
    ends: [Id; 2],
    /// Samples strictly between the two nodes, as drawn.
    shape: Vec<Point>,
    /// One width per sample, nodes included (`shape.len() + 2`).
    widths: Vec<f64>,
    chain: Id,
    live: bool,
}
struct Chain {
    /// Export order: support class, rank, input street, piece within it (the
    /// order `planarize` gave, which the later passes break their ties on).
    support: u8,
    source: u32,
    piece: u32,
    rank: usize,
    role: String,
    level: u8,
    /// Its loose ends may be seated (not a protected road nor a private way).
    movable: bool,
    /// Edges in drawn order; empty once removed.
    edges: Vec<Id>,
}

/// How many ends the seating moved, by case.
#[derive(Default, Debug, Clone, Copy, PartialEq)]
pub(super) struct Seats {
    /// Ends of streets that met a removed copy, carried onto its survivor.
    pub(super) carried: usize,
    /// Pairs of close loose ends joined.
    pub(super) joined: usize,
    /// Loose ends short of a host's axis, extended along their own line onto it.
    pub(super) extended: usize,
    /// Loose ends past a host's axis, cut back to where their line meets it.
    pub(super) retracted: usize,
}

/// A seat on edge `edge`, on its segment `seg`, at `p`. A node of that edge
/// within `reuse` of `p` takes the seat instead of a new one (a crossing has 0).
struct Request {
    edge: Id,
    seg: usize,
    p: Point,
    reuse: f64,
}
/// Two runs between the same two nodes closer than this everywhere are one run (m).
const DOUBLE: f64 = 0.1;
/// Farthest a seat moves along its host to reuse a junction already there (m):
/// two junctions closer than this would be one mouth drawn twice.
const REUSE: f64 = 4.0;
enum Target {
    Node(Id),
    Request(usize),
}
/// Extends chain `chain` at its start or end through the nodes of `through`
/// (crossings on the way, outward) onto `to`.
struct Joint {
    chain: Id,
    at_end: bool,
    through: Vec<usize>,
    to: Target,
}
/// Cuts chain `chain` back at its start or end to the seat `to`, at `m` on its last segment.
struct Retract {
    chain: Id,
    at_end: bool,
    to: usize,
    m: Point,
}

pub(super) struct StreetGraph {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    chains: Vec<Chain>,
}

impl StreetGraph {
    /// Bulk load: the crossings found through the segment bins of `planarize`
    /// become nodes, and runs shared by two streets go to the more important
    /// one (water supports, then protected roads, then rank, width, and the
    /// drawn geometry, so the result does not depend on the input order).
    pub(super) fn load(streets: &[Street], radius: f64) -> Self {
        let segments: Vec<Segment> = streets
            .iter()
            .enumerate()
            .flat_map(|(street, s)| {
                s.path.windows(2).enumerate().filter_map(move |(offset, p)| {
                    (distance(p[0], p[1]) > EPS).then_some(Segment { street, offset, a: p[0], b: p[1] })
                })
            })
            .collect();
        let levels: Vec<u8> = streets.iter().map(level).collect();
        let lands = |s: &Street, p: Point| key(p) == key(s.path[0]) || key(p) == key(s.path[s.path.len() - 1]);
        // (parameter, point, junction) per segment.
        let mut cuts: Vec<Vec<(f64, Point, bool)>> = segments.iter().map(|s| vec![(0.0, s.a, false), (1.0, s.b, false)]).collect();
        for (i, j) in candidates(&segments, (radius / 8.0).clamp(12.0, 60.0)) {
            let (si, sj) = (segments[i].street, segments[j].street);
            let deck = match levels[si].cmp(&levels[sj]) {
                std::cmp::Ordering::Equal => None,
                std::cmp::Ordering::Greater => Some(si),
                std::cmp::Ordering::Less => Some(sj),
            };
            for (t, u, p) in crossings(segments[i], segments[j]) {
                if deck.is_some_and(|d| !lands(&streets[d], p)) {
                    continue;
                }
                cuts[i].push((t, p, true));
                cuts[j].push((u, p, true));
            }
        }
        // Samples of each street with their width and whether a node sits there.
        let mut samples: Vec<Vec<(Point, f64, bool)>> = vec![vec![]; streets.len()];
        for (segment, cut) in segments.iter().zip(&mut cuts) {
            cut.sort_by(|a, b| a.0.total_cmp(&b.0));
            cut.dedup_by(|next, kept| {
                let same = (next.0 - kept.0).abs() < 1e-9;
                kept.2 |= same && next.2;
                same
            });
            let s = &streets[segment.street];
            let (wa, wb) = (width(s, segment.offset), width(s, segment.offset + 1));
            let v = &mut samples[segment.street];
            for &(t, p, junction) in cut.iter() {
                match v.last_mut() {
                    Some(last) if key(last.0) == key(p) => last.2 |= junction,
                    _ => v.push((p, wa + (wb - wa) * t, junction)),
                }
            }
        }
        for v in &mut samples {
            if v.len() >= 2 {
                v[0].2 = true;
                v.last_mut().expect("two samples").2 = true;
            }
        }
        let mut order: Vec<usize> = (0..streets.len()).filter(|&i| samples[i].len() >= 2).collect();
        order.sort_by_cached_key(|&i| {
            let s = &streets[i];
            let wide = (s.widths.iter().copied().fold(0.0, f64::max) * 1000.0).round() as i64;
            (support(s), s.rank, std::cmp::Reverse(wide), s.role.clone(), key(s.path[0]), key(s.path[s.path.len() - 1]), s.path.len(), i)
        });
        let mut graph = Self { nodes: vec![], edges: vec![], chains: vec![] };
        let mut index: HashMap<Key, Id> = HashMap::new();
        for i in order {
            let s = &streets[i];
            let v = &samples[i];
            let mut chain: Option<Id> = None;
            let mut piece = 0;
            let mut a = graph.node_at(&mut index, v[0].0);
            let mut shape = vec![];
            let mut widths = vec![v[0].1];
            for &(p, w, junction) in &v[1..] {
                widths.push(w);
                if !junction {
                    shape.push(p);
                    continue;
                }
                let b = graph.node_at(&mut index, p);
                // A run already loaded (exactly, or within `DOUBLE`) belongs to
                // the more important street: this one is split around it.
                if graph.doubles(a, b, &shape) {
                    chain = None;
                    shape.clear();
                } else {
                    let c = *chain.get_or_insert_with(|| {
                        graph.chains.push(Chain {
                            support: support(s),
                            source: i as u32,
                            piece,
                            rank: s.rank,
                            role: s.role.clone(),
                            level: level(s),
                            movable: !protected(s) && !private(s),
                            edges: vec![],
                        });
                        piece += 1;
                        (graph.chains.len() - 1) as Id
                    });
                    let e = graph.add_edge([a, b], std::mem::take(&mut shape), std::mem::take(&mut widths), c);
                    graph.chains[c as usize].edges.push(e);
                }
                widths = vec![w];
                a = b;
            }
        }
        graph
    }

    fn node_at(&mut self, index: &mut HashMap<Key, Id>, p: Point) -> Id {
        let nodes = &mut self.nodes;
        let id = *index.entry(key(p)).or_insert_with(|| {
            nodes.push(Node { p, arms: vec![] });
            (nodes.len() - 1) as Id
        });
        let n = &mut nodes[id as usize];
        if (p.x, p.y) < (n.p.x, n.p.y) {
            n.p = p;
        }
        id
    }

    /// Whether a run from node `a` through `shape` to node `b` doubles an edge
    /// already loaded between the same nodes: every sample of each lies within
    /// `DOUBLE` of the other. Two streets crossing at a shallow angle meet at
    /// both ends of such a run; drawn twice, the copies would cross again and
    /// again a few centimetres apart.
    fn doubles(&self, a: Id, b: Id, shape: &[Point]) -> bool {
        let (pa, pb) = (self.nodes[a as usize].p, self.nodes[b as usize].p);
        let run: Vec<Point> = std::iter::once(pa).chain(shape.iter().copied()).chain(std::iter::once(pb)).collect();
        let near = |points: &[Point], line: &[Point]| {
            points.iter().all(|&p| line.windows(2).any(|w| foot(p, w[0], w[1]).0 <= DOUBLE))
        };
        self.nodes[a as usize].arms.iter().any(|&e| {
            let edge = &self.edges[e as usize];
            if !(edge.ends == [a, b] || edge.ends == [b, a]) {
                return false;
            }
            let other: Vec<Point> = (0..edge.shape.len() + 2).map(|k| self.point(edge, k)).collect();
            near(&run, &other) && near(&other, &run)
        })
    }

    fn add_edge(&mut self, ends: [Id; 2], shape: Vec<Point>, widths: Vec<f64>, chain: Id) -> Id {
        let e = self.edges.len() as Id;
        for n in ends {
            self.nodes[n as usize].arms.push(e);
        }
        self.edges.push(Edge { ends, shape, widths, chain, live: true });
        e
    }

    fn kill_edge(&mut self, e: Id) {
        let edge = &mut self.edges[e as usize];
        edge.live = false;
        for n in edge.ends {
            self.nodes[n as usize].arms.retain(|&a| a != e);
        }
    }

    /// Sample `k` of edge `e`, nodes included.
    fn point(&self, e: &Edge, k: usize) -> Point {
        if k == 0 {
            self.nodes[e.ends[0] as usize].p
        } else if k == e.shape.len() + 1 {
            self.nodes[e.ends[1] as usize].p
        } else {
            e.shape[k - 1]
        }
    }

    /// Live chains in export order.
    fn order(&self) -> Vec<Id> {
        let mut order: Vec<Id> = (0..self.chains.len() as Id).filter(|&c| !self.chains[c as usize].edges.is_empty()).collect();
        order.sort_by_key(|&c| {
            let c = &self.chains[c as usize];
            (c.support, c.rank, c.source, c.piece)
        });
        order
    }

    /// One street per live chain: its samples and widths in drawn order.
    pub(super) fn export(&self) -> Vec<Street> {
        self.order()
            .into_iter()
            .map(|c| {
                let chain = &self.chains[c as usize];
                let first = &self.edges[chain.edges[0] as usize];
                let mut path = vec![self.nodes[first.ends[0] as usize].p];
                let mut widths = vec![first.widths[0]];
                for &e in &chain.edges {
                    let e = &self.edges[e as usize];
                    path.extend_from_slice(&e.shape);
                    path.push(self.nodes[e.ends[1] as usize].p);
                    widths.extend_from_slice(&e.widths[1..]);
                }
                Street { path, widths, rank: chain.rank, role: chain.role.clone() }
            })
            .collect()
    }

    /// End node of chain `c` at its start or end, the edge holding it and the
    /// sample before it.
    fn end(&self, c: Id, at_end: bool) -> (Id, Id, Point) {
        let chain = &self.chains[c as usize];
        let e = if at_end { *chain.edges.last().expect("live chain") } else { chain.edges[0] };
        let edge = &self.edges[e as usize];
        let n = edge.shape.len() + 2;
        if at_end { (edge.ends[1], e, self.point(edge, n - 2)) } else { (edge.ends[0], e, self.point(edge, 1)) }
    }

    /// Where the end `p` of chain `c` (coming from `prev`) seats on one of
    /// `hosts` (edge, segment) within `reach(host width)` of it: the station
    /// nearest to where its own line meets the host's axis, ahead of the end
    /// or back along its last segment. With `foot`, an end running along its
    /// host seats at the nearest point instead. Returns (edge, segment, seat,
    /// signed distance along the end's line).
    fn target(&self, c: Id, p: Point, prev: Point, hosts: &[(Id, usize)], reach: &dyn Fn(f64) -> f64, foot_ok: bool) -> Option<(Id, usize, Point, f64)> {
        let back = distance(prev, p);
        if back <= EPS {
            return None;
        }
        let d = Point { x: (p.x - prev.x) / back, y: (p.y - prev.y) / back };
        let level = self.chains[c as usize].level;
        let mut meet: Option<((f64, f64, Key, Key), (Id, usize, Point, f64))> = None;
        let mut near: Option<((f64, Key, Key), (Id, usize, Point, f64))> = None;
        for &(e, k) in hosts {
            let edge = &self.edges[e as usize];
            if !edge.live || edge.chain == c || self.chains[edge.chain as usize].level != level {
                continue;
            }
            let (a, b) = (self.point(edge, k), self.point(edge, k + 1));
            let r = Point { x: b.x - a.x, y: b.y - a.y };
            let l = r.x.hypot(r.y);
            if l <= EPS {
                continue;
            }
            let reach = reach(edge.widths[k].max(edge.widths[k + 1]));
            let (df, _, q) = foot(p, a, b);
            if df <= EPS || df > reach {
                continue;
            }
            let tie = (key(a), key(b));
            let cross = d.x * r.y - d.y * r.x;
            if (cross / l).abs() >= MIN_SIN {
                let ap = Point { x: a.x - p.x, y: a.y - p.y };
                let s = (ap.x * r.y - ap.y * r.x) / cross;
                let u = (ap.x * d.y - ap.y * d.x) / cross;
                if (-1e-9..=1.0 + 1e-9).contains(&u) && s >= -back - 1e-9 && (s * cross / l).abs() <= reach + 1e-9 {
                    let m = Point { x: p.x + d.x * s, y: p.y + d.y * s };
                    let rank = (s.abs(), df, tie.0, tie.1);
                    if meet.as_ref().is_none_or(|(best, _)| rank.partial_cmp(best) == Some(std::cmp::Ordering::Less)) {
                        meet = Some((rank, (e, k, m, s)));
                    }
                }
            }
            if foot_ok {
                let rank = (df, tie.0, tie.1);
                if near.as_ref().is_none_or(|(best, _)| rank.partial_cmp(best) == Some(std::cmp::Ordering::Less)) {
                    near = Some((rank, (e, k, q, df)));
                }
            }
        }
        // A foot seat is reached ahead of the end: its distance counts as positive.
        meet.map(|(_, t)| t).or(near.map(|(_, t)| t))
    }

    /// Seats the network's loose ends, in the cases the clean admits:
    ///
    /// 1. The streets `copies` (export indices, each with its survivor) leave;
    ///    a street that ended on a copy is carried onto its survivor's axis
    ///    (within the survivor's half width plus its own width).
    /// 2. Two loose ends of different streets closer than the wider one's
    ///    width plus 2 m are joined, nearest pairs first.
    /// 3. A loose end within another street's half width plus 0.5 m, short of
    ///    its axis or past it, is seated where its own line meets that axis.
    ///
    /// Each seat splits its host there in the same operation (curve kept,
    /// width interpolated), and the joints are noded where they cross other
    /// streets. Protected roads and private ways keep their ends; an end that
    /// runs along its host (cases 2 and 3) or whose ground differs
    /// (`same_ground`) stays as drawn.
    pub(super) fn seat(&mut self, copies: &[(usize, usize)], same_ground: &dyn Fn(Point, Point) -> bool) -> Seats {
        let mut seats = Seats::default();
        let order = self.order();
        let mut survivor: Vec<Option<usize>> = vec![None; order.len()];
        for &(i, j) in copies {
            survivor[i] = Some(j);
        }
        // Nodes of each copy not on its (live) survivor, before the copies go.
        let mut carry: Vec<(Id, Vec<Id>)> = vec![];
        for &(i, _) in copies {
            let mut j = survivor[i].expect("copy");
            while let Some(k) = survivor[j] {
                j = k;
            }
            let host = order[j];
            let on_host: std::collections::HashSet<Id> = self.chain_nodes(host).collect();
            let mut nodes: Vec<Id> = self.chain_nodes(order[i]).filter(|n| !on_host.contains(n)).collect();
            nodes.sort_unstable();
            nodes.dedup();
            carry.push((host, nodes));
        }
        for &(i, _) in copies {
            let c = order[i];
            for e in std::mem::take(&mut self.chains[c as usize].edges) {
                self.kill_edge(e);
            }
        }
        let mut requests: Vec<Request> = vec![];
        let mut joints: Vec<Joint> = vec![];
        let mut retracts: Vec<Retract> = vec![];
        let mut settled: std::collections::HashSet<(Id, bool)> = Default::default();
        // Segment bins of the live edges, padded by their half width.
        let mut grid: HashMap<(i64, i64), Vec<(Id, usize)>> = HashMap::new();
        for (e, edge) in self.edges.iter().enumerate().filter(|(_, e)| e.live) {
            for k in 0..edge.shape.len() + 1 {
                let (a, b) = (self.point(edge, k), self.point(edge, k + 1));
                let pad = 0.5 * edge.widths[k].max(edge.widths[k + 1]) + 1.0;
                let (lo, hi) = (cell(Point { x: a.x.min(b.x) - pad, y: a.y.min(b.y) - pad }), cell(Point { x: a.x.max(b.x) + pad, y: a.y.max(b.y) + pad }));
                for bx in lo.0..=hi.0 {
                    for by in lo.1..=hi.1 {
                        grid.entry((bx, by)).or_default().push((e as Id, k));
                    }
                }
            }
        }
        // 1. Ends that met a removed copy.
        for (host, nodes) in carry {
            let hosts: Vec<(Id, usize)> =
                self.chains[host as usize].edges.iter().flat_map(|&e| (0..self.edges[e as usize].shape.len() + 1).map(move |k| (e, k))).collect();
            for n in nodes {
                let mut ends: Vec<(Id, bool)> = vec![];
                for &e in &self.nodes[n as usize].arms {
                    let u = self.edges[e as usize].chain;
                    for at_end in [false, true] {
                        if u != host && self.end(u, at_end).0 == n && !ends.contains(&(u, at_end)) {
                            ends.push((u, at_end));
                        }
                    }
                }
                ends.sort_unstable_by_key(|&(u, at_end)| (self.chains[u as usize].source, self.chains[u as usize].piece, at_end));
                for (u, at_end) in ends {
                    if settled.contains(&(u, at_end)) {
                        continue;
                    }
                    let (_, e, prev) = self.end(u, at_end);
                    let p = self.nodes[n as usize].p;
                    let edge = &self.edges[e as usize];
                    let own = if at_end { *edge.widths.last().expect("widths") } else { edge.widths[0] };
                    if let Some(seat) = self.target(u, p, prev, &hosts, &|w| 0.5 * w + own, true)
                        && same_ground(p, seat.2)
                        && self.plan(u, at_end, p, seat, &grid, &mut requests, &mut joints, &mut retracts)
                    {
                        settled.insert((u, at_end));
                        seats.carried += 1;
                    }
                }
            }
        }
        // Loose ends, sorted by position.
        let mut ends: Vec<(Key, Point, Id, bool, f64)> = vec![];
        for (c, chain) in self.chains.iter().enumerate() {
            if !chain.movable || chain.edges.is_empty() {
                continue;
            }
            for at_end in [false, true] {
                let c = c as Id;
                let (n, e, _) = self.end(c, at_end);
                if self.nodes[n as usize].arms.len() == 1 && !settled.contains(&(c, at_end)) {
                    let edge = &self.edges[e as usize];
                    let w = if at_end { *edge.widths.last().expect("widths") } else { edge.widths[0] };
                    let p = self.nodes[n as usize].p;
                    ends.push((key(p), p, c, at_end, w));
                }
            }
        }
        ends.sort_by_key(|e| (e.0, e.3));
        // 2. Close pairs, nearest first.
        let mut bins: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (e, end) in ends.iter().enumerate() {
            bins.entry(cell(end.1)).or_default().push(e);
        }
        let mut pairs: Vec<(f64, usize, usize)> = vec![];
        for (e, &(_, p, i, _, w)) in ends.iter().enumerate() {
            let (cx, cy) = cell(p);
            for bx in cx - 1..=cx + 1 {
                for by in cy - 1..=cy + 1 {
                    for &f in bins.get(&(bx, by)).into_iter().flatten() {
                        let (_, q, j, _, v) = ends[f];
                        let d = distance(p, q);
                        if f > e
                            && j != i
                            && d > EPS
                            && d <= w.max(v) + 2.0
                            && self.chains[i as usize].level == self.chains[j as usize].level
                            && same_ground(p, q)
                        {
                            pairs.push((d, e, f));
                        }
                    }
                }
            }
        }
        pairs.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut used = vec![false; ends.len()];
        for (_, e, f) in pairs {
            if used[e] || used[f] {
                continue;
            }
            used[e] = true;
            used[f] = true;
            let (_, p, c, at_end, _) = ends[e];
            let (_, q, other, other_end, _) = ends[f];
            let through = self.crossings_on(c, p, q, &grid, &mut requests);
            joints.push(Joint { chain: c, at_end, through, to: Target::Node(self.end(other, other_end).0) });
            seats.joined += 1;
        }
        // 3. Ends inside a host's ribbon.
        for (e, &(_, p, c, at_end, _)) in ends.iter().enumerate() {
            if used[e] {
                continue;
            }
            let (_, _, prev) = self.end(c, at_end);
            let Some(hosts) = grid.get(&cell(p)) else { continue };
            if let Some(seat) = self.target(c, p, prev, hosts, &|w| 0.5 * w + 0.5, false)
                && same_ground(p, seat.2)
                && self.plan(c, at_end, p, seat, &grid, &mut requests, &mut joints, &mut retracts)
            {
                if seat.3 < 0.0 {
                    seats.retracted += 1;
                } else {
                    seats.extended += 1;
                }
            }
        }
        // A retraction never reshapes an edge that is also split.
        let split: std::collections::HashSet<Id> = requests.iter().map(|r| r.edge).collect();
        retracts.retain(|r| {
            let keep = !split.contains(&self.end(r.chain, r.at_end).1);
            if !keep {
                seats.retracted -= 1;
            }
            keep
        });
        let at = self.split(&requests);
        for r in retracts {
            self.retract(&r, at[r.to]);
        }
        for j in joints {
            let to = match j.to {
                Target::Node(n) => n,
                Target::Request(r) => at[r],
            };
            let (start, e, _) = self.end(j.chain, j.at_end);
            let edge = &self.edges[e as usize];
            let w = if j.at_end { *edge.widths.last().expect("widths") } else { edge.widths[0] };
            let mut seq = vec![start];
            seq.extend(j.through.iter().map(|&r| at[r]));
            seq.push(to);
            seq.dedup();
            if !j.at_end {
                seq.reverse();
            }
            let mut added = vec![];
            for pair in seq.windows(2) {
                // An identical straight joint already there (two streets
                // carried from one node) is shared, not doubled.
                let doubled = self.nodes[pair[0] as usize].arms.iter().any(|&a| {
                    let a = &self.edges[a as usize];
                    a.shape.is_empty() && (a.ends == [pair[0], pair[1]] || a.ends == [pair[1], pair[0]])
                });
                if doubled {
                    if j.at_end {
                        break;
                    }
                    added.clear();
                    continue;
                }
                added.push(self.add_edge([pair[0], pair[1]], vec![], vec![w, w], j.chain));
            }
            let edges = &mut self.chains[j.chain as usize].edges;
            if j.at_end {
                edges.extend(added);
            } else {
                edges.splice(0..0, added);
            }
        }
        seats
    }

    /// Plans the seat of end `p` of chain `c` found by `target`: a joint onto
    /// the host ahead of the end, or a cut back along its last segment.
    #[allow(clippy::too_many_arguments)]
    fn plan(
        &self, c: Id, at_end: bool, p: Point, (e, k, m, s): (Id, usize, Point, f64), grid: &HashMap<(i64, i64), Vec<(Id, usize)>>,
        requests: &mut Vec<Request>, joints: &mut Vec<Joint>, retracts: &mut Vec<Retract>,
    ) -> bool {
        if distance(p, m) <= EPS {
            return false;
        }
        // A junction of the host closer than the wider street's width plus
        // 2 m (at most `REUSE`) takes the seat, as two close ends were joined.
        let host = &self.edges[e as usize];
        let (_, own_edge, _) = self.end(c, at_end);
        let own = &self.edges[own_edge as usize].widths;
        let own = if at_end { *own.last().expect("widths") } else { own[0] };
        let reuse = (own.max(host.widths[k]).max(host.widths[k + 1]) + 2.0).min(REUSE);
        if s < 0.0 {
            let (_, own, prev) = self.end(c, at_end);
            let edge = &self.edges[own as usize];
            // Cutting back the whole of a street's only edge would remove it.
            if self.chains[c as usize].edges.len() == 1 && edge.shape.is_empty() && distance(m, prev) < SNAP {
                return false;
            }
            requests.push(Request { edge: e, seg: k, p: m, reuse });
            retracts.push(Retract { chain: c, at_end, to: requests.len() - 1, m });
        } else {
            let through = self.crossings_on(c, p, m, grid, requests);
            requests.push(Request { edge: e, seg: k, p: m, reuse });
            joints.push(Joint { chain: c, at_end, through, to: Target::Request(requests.len() - 1) });
        }
        true
    }

    /// Seats where the joint `p`-`q` of chain `c` crosses other same-level
    /// edges strictly between its ends, ordered from `p`.
    fn crossings_on(&self, c: Id, p: Point, q: Point, grid: &HashMap<(i64, i64), Vec<(Id, usize)>>, requests: &mut Vec<Request>) -> Vec<usize> {
        let level = self.chains[c as usize].level;
        let joint = Segment { street: 0, offset: 0, a: p, b: q };
        let (lo, hi) = (cell(Point { x: p.x.min(q.x), y: p.y.min(q.y) }), cell(Point { x: p.x.max(q.x), y: p.y.max(q.y) }));
        let mut hits: BTreeMap<Key, (f64, Id, usize, Point)> = BTreeMap::new();
        for bx in lo.0..=hi.0 {
            for by in lo.1..=hi.1 {
                for &(e, k) in grid.get(&(bx, by)).into_iter().flatten() {
                    let edge = &self.edges[e as usize];
                    if !edge.live || self.chains[edge.chain as usize].level != level {
                        continue;
                    }
                    let host = Segment { street: 1, offset: 0, a: self.point(edge, k), b: self.point(edge, k + 1) };
                    for (t, _, x) in crossings(joint, host) {
                        if t > 1e-6 && t < 1.0 - 1e-6 {
                            hits.entry(key(x)).or_insert((t, e, k, x));
                        }
                    }
                }
            }
        }
        let mut hits: Vec<_> = hits.into_values().collect();
        hits.sort_by(|a, b| a.0.total_cmp(&b.0));
        hits.into_iter()
            .map(|(_, edge, seg, p)| {
                requests.push(Request { edge, seg, p, reuse: 0.0 });
                requests.len() - 1
            })
            .collect()
    }

    /// Splits each requested edge at its seats in one pass; returns the node of every request.
    fn split(&mut self, requests: &[Request]) -> Vec<Id> {
        let mut at = vec![Id::MAX; requests.len()];
        let mut by_edge: BTreeMap<Id, Vec<usize>> = BTreeMap::new();
        for (r, q) in requests.iter().enumerate() {
            by_edge.entry(q.edge).or_default().push(r);
        }
        for (e, rs) in by_edge {
            let edge = &self.edges[e as usize];
            let n = edge.shape.len() + 2;
            let samples: Vec<Point> = (0..n).map(|k| self.point(edge, k)).collect();
            let widths = edge.widths.clone();
            let [start, end] = edge.ends;
            // Seats near a node of the edge reuse it.
            for &r in &rs {
                let q = &requests[r];
                let (d0, d1) = (distance(q.p, samples[0]), distance(q.p, samples[n - 1]));
                if d0.min(d1) <= q.reuse {
                    at[r] = if d0 <= d1 { start } else { end };
                }
            }
            // Stations (sample, parameter in the segment after it, point, request).
            let mut stations: Vec<(usize, f64, Point, usize)> = rs
                .iter()
                .filter(|&&r| at[r] == Id::MAX)
                .map(|&r| {
                    let k = requests[r].seg;
                    let (a, b) = (samples[k], samples[k + 1]);
                    let p = requests[r].p;
                    if distance(p, a) < SNAP {
                        (k, 0.0, a, r)
                    } else if distance(p, b) < SNAP {
                        (k + 1, 0.0, b, r)
                    } else {
                        let (_, t, q) = foot(p, a, b);
                        (k, t, q, r)
                    }
                })
                .collect();
            stations.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
            let chain = edge.chain;
            // Cuts strictly inside the edge, each with its node.
            let mut cuts: Vec<(usize, f64, Point, Id)> = vec![];
            for (k, t, p, r) in stations {
                at[r] = if k == 0 && t == 0.0 {
                    start
                } else if k == n - 1 {
                    end
                } else if let Some(&(.., node)) = cuts.last().filter(|c| key(c.2) == key(p)) {
                    node
                } else {
                    // A new node of this edge only: a seat never merges levels.
                    self.nodes.push(Node { p, arms: vec![] });
                    let node = (self.nodes.len() - 1) as Id;
                    cuts.push((k, t, p, node));
                    node
                };
            }
            if cuts.is_empty() {
                continue;
            }
            self.kill_edge(e);
            let mut pieces: Vec<Id> = vec![];
            let mut a = start;
            let mut shape = vec![];
            let mut ws = vec![widths[0]];
            let mut cut = cuts.into_iter().peekable();
            for k in 0..n - 1 {
                while let Some(&(_, t, _, node)) = cut.peek().filter(|c| c.0 == k && c.1 > 0.0) {
                    let w = widths[k] + (widths[k + 1] - widths[k]) * t;
                    ws.push(w);
                    pieces.push(self.add_edge([a, node], std::mem::take(&mut shape), std::mem::take(&mut ws), chain));
                    a = node;
                    ws = vec![w];
                    cut.next();
                }
                ws.push(widths[k + 1]);
                if k + 1 == n - 1 {
                    pieces.push(self.add_edge([a, end], std::mem::take(&mut shape), std::mem::take(&mut ws), chain));
                } else if let Some(&(_, _, _, node)) = cut.peek().filter(|c| c.0 == k + 1 && c.1 == 0.0) {
                    pieces.push(self.add_edge([a, node], std::mem::take(&mut shape), std::mem::take(&mut ws), chain));
                    a = node;
                    ws = vec![widths[k + 1]];
                    cut.next();
                } else {
                    shape.push(samples[k + 1]);
                }
            }
            let edges = &mut self.chains[chain as usize].edges;
            let i = edges.iter().position(|&x| x == e).expect("edge in its chain");
            edges.splice(i..=i, pieces);
        }
        at
    }

    /// Cuts the end edge of `r.chain` back to `r.m`, which becomes node `to`.
    fn retract(&mut self, r: &Retract, to: Id) {
        let (old, e, prev) = self.end(r.chain, r.at_end);
        let edge = &mut self.edges[e as usize];
        let side = usize::from(r.at_end);
        if distance(r.m, prev) < SNAP {
            if edge.shape.is_empty() {
                // The previous sample is the edge's other node: the edge goes.
                self.kill_edge(e);
                let edges = &mut self.chains[r.chain as usize].edges;
                if r.at_end {
                    edges.pop();
                } else {
                    edges.remove(0);
                }
                return;
            }
            // The previous sample becomes the end.
            if r.at_end {
                edge.shape.pop();
                edge.widths.pop();
            } else {
                edge.shape.remove(0);
                edge.widths.remove(0);
            }
        }
        edge.ends[side] = to;
        self.nodes[old as usize].arms.retain(|&a| a != e);
        self.nodes[to as usize].arms.push(e);
    }

    /// Nodes along chain `c`, samples between nodes excluded.
    fn chain_nodes(&self, c: Id) -> impl Iterator<Item = Id> + '_ {
        self.chains[c as usize].edges.iter().flat_map(|&e| self.edges[e as usize].ends)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn street(points: &[(f64, f64)], w: f64, rank: usize, role: &str) -> Street {
        Street { path: points.iter().map(|&(x, y)| Point { x, y }).collect(), widths: vec![w; points.len()], rank, role: role.into() }
    }
    fn run(streets: &[Street]) -> (Vec<Street>, Seats) {
        let mut g = StreetGraph::load(streets, 200.0);
        let seats = g.seat(&[], &|_, _| true);
        (g.export(), seats)
    }
    fn on_axis(p: Point, s: &Street) -> bool {
        s.path.iter().any(|&q| distance(p, q) < 1e-9)
    }
    fn sorted(streets: &[Street]) -> Vec<String> {
        let mut v: Vec<String> = streets.iter().map(|s| format!("{:?} {:?} {} {}", s.path, s.widths, s.rank, s.role)).collect();
        v.sort();
        v
    }

    /// An untouched network, given in `planarize` order (support, rank, input), exports as given.
    #[test]
    fn untouched_network_exports_its_input() {
        let mut input = vec![
            street(&[(0.0, 50.0), (30.0, 52.0)], 6.0, 1, "main"),
            street(&[(0.0, 0.0), (10.0, 1.0), (20.0, 0.5)], 4.0, 2, "street"),
            street(&[(100.0, 0.0), (100.0, 40.0), (120.0, 60.0)], 3.0, 3, "lane"),
            street(&[(200.0, 0.0), (200.0, 40.0)], 3.0, 3, "lane"),
        ];
        input[1].widths = vec![4.0, 5.0, 3.5];
        let (out, seats) = run(&input);
        assert_eq!(seats, Seats::default());
        assert_eq!(out.len(), input.len());
        for (a, b) in out.iter().zip(&input) {
            assert_eq!(a.path, b.path);
            assert_eq!(a.widths, b.widths);
            assert_eq!((a.rank, &a.role), (b.rank, &b.role));
        }
    }

    #[test]
    fn crossings_share_a_node_and_streets_stay_whole() {
        let input = vec![street(&[(0.0, 0.0), (20.0, 0.0)], 4.0, 2, "street"), street(&[(10.0, -10.0), (10.0, 10.0)], 4.0, 2, "street")];
        let (out, _) = run(&input);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|s| on_axis(Point { x: 10.0, y: 0.0 }, s) && s.path.len() == 3));
    }

    #[cfg(feature = "street-topology")]
    #[test]
    fn topology_snapshot_keeps_junction_arms_widths_and_deck_landings() {
        use magna_urbis_graph::Level;

        let mut roads = [
            street(&[(0.0, 0.0), (40.0, 0.0)], 4.0, 2, "street"),
            street(&[(20.0, -20.0), (20.0, 20.0)], 4.0, 2, "street"),
            street(&[(0.0, -10.0), (40.0, 10.0)], 6.0, 1, "bridge"),
            street(&[(40.0, 10.0), (50.0, 20.0)], 4.0, 3, "lane"),
        ];
        roads[0].widths = vec![2.0, 6.0];
        let graph = street_topology(&roads, 200.0);
        assert_eq!(graph.chains().len(), 4);
        let host = graph.chains().iter().find(|c| c.source == 0).unwrap();
        assert_eq!(host.edges.len(), 2);
        let first = &graph.edges()[host.edges[0].ix()];
        let second = &graph.edges()[host.edges[1].ix()];
        assert_eq!(first.ends[1], second.ends[0]);
        assert_eq!(first.widths, vec![2.0, 4.0]);
        assert_eq!(second.widths, vec![4.0, 6.0]);
        let cross = &graph.nodes()[first.ends[1].ix()];
        assert_eq!(cross.point, Point { x: 20.0, y: 0.0 });
        assert_eq!(cross.arms.len(), 4);
        let arm_point = |arm: magna_urbis_graph::HalfId| {
            let edge = &graph.edges()[arm.edge().ix()];
            graph.nodes()[edge.ends[usize::from(arm.is_forward())].ix()].point
        };
        assert_eq!(cross.arms.iter().map(|&arm| arm_point(arm)).collect::<Vec<_>>(), [
            Point { x: 20.0, y: -20.0 },
            Point { x: 40.0, y: 0.0 },
            Point { x: 20.0, y: 20.0 },
            Point { x: 0.0, y: 0.0 },
        ]);
        let bridge = graph.chains().iter().find(|c| c.source == 2).unwrap();
        assert_eq!(bridge.level, Level::Deck);
        assert_eq!(bridge.edges.len(), 1);
        let deck = &graph.edges()[bridge.edges[0].ix()];
        let landing = &graph.nodes()[deck.ends[1].ix()];
        assert!(landing.bridge_landing);
        assert_eq!(landing.arms.len(), 2);
        assert!(graph.connects(landing.arms[0], landing.arms[1]));
        assert!(!graph.connects(cross.arms[0], landing.arms[0]));
    }

    #[test]
    fn wide_stem_on_a_narrow_host_seats_on_its_axis() {
        // An 8 m stem stops 1 m short of a 3 m lane, at an angle.
        let host = street(&[(0.0, 0.0), (40.0, 0.0)], 3.0, 3, "lane");
        let stem = street(&[(10.0, 30.0), (19.0, 1.0)], 8.0, 1, "main");
        let (out, seats) = run(&[host, stem]);
        assert_eq!(seats.extended, 1);
        let host = out.iter().find(|s| s.role == "lane").unwrap();
        let stem = out.iter().find(|s| s.role == "main").unwrap();
        let end = *stem.path.last().unwrap();
        assert!(end.y.abs() < 1e-9, "{end:?}");
        // The seat lies on the stem's own line, not at its foot.
        let along = Point { x: 10.0 + 9.0 * 30.0 / 29.0, y: 0.0 };
        assert!(distance(end, along) < 1e-9, "{end:?}");
        assert!(on_axis(end, host));
        assert_eq!(host.path.len(), 3);
        assert_eq!(host.widths, vec![3.0; 3]);
        assert_eq!(*stem.widths.last().unwrap(), 8.0);
    }

    #[test]
    fn end_past_the_axis_is_cut_back_to_its_crossing() {
        let host = street(&[(0.0, 0.0), (40.0, 0.0)], 4.0, 2, "street");
        let stem = street(&[(20.0, 30.0), (20.0, -1.1)], 4.0, 2, "street");
        let (out, seats) = run(&[host, stem]);
        assert_eq!(seats.retracted, 1);
        let stem = &out[1];
        assert_eq!(*stem.path.last().unwrap(), Point { x: 20.0, y: 0.0 });
        assert!(on_axis(*stem.path.last().unwrap(), &out[0]));
    }

    #[test]
    fn host_split_keeps_its_curve_and_interpolates_widths() {
        let mut host = street(&[(0.0, 0.0), (20.0, 0.0), (40.0, 10.0)], 4.0, 2, "street");
        host.widths = vec![2.0, 4.0, 6.0];
        let stem = street(&[(30.0, 40.0), (30.0, 6.0)], 3.0, 3, "lane");
        let (out, _) = run(&[host.clone(), stem]);
        let h = &out[0];
        assert_eq!(h.path.len(), 4);
        assert_eq!(h.path[0..2], host.path[0..2]);
        assert_eq!(h.path[3], host.path[2]);
        assert!((h.path[2].x - 30.0).abs() < 1e-9 && (h.path[2].y - 5.0).abs() < 1e-9);
        assert!((h.widths[2] - 5.0).abs() < 1e-9);
        assert_eq!(*out[1].path.last().unwrap(), h.path[2]);
    }

    #[test]
    fn collinear_overlap_belongs_to_the_more_important_street() {
        let main = street(&[(0.0, 0.0), (100.0, 0.0)], 8.0, 1, "main");
        let lane = street(&[(50.0, 0.0), (150.0, 0.0)], 4.0, 3, "lane");
        let (out, _) = run(&[lane, main]);
        assert_eq!(out.len(), 2);
        let lane = out.iter().find(|s| s.role == "lane").unwrap();
        let main = out.iter().find(|s| s.role == "main").unwrap();
        assert_eq!(lane.path, vec![Point { x: 100.0, y: 0.0 }, Point { x: 150.0, y: 0.0 }]);
        assert_eq!(main.path.len(), 3);
    }

    #[test]
    fn run_drawn_twice_a_few_centimetres_apart_is_one_run() {
        let main = street(&[(0.0, 0.0), (100.0, 0.0)], 6.0, 1, "main");
        let copy = street(&[(-10.0, 1.0), (10.0, -0.03), (90.0, -0.03), (110.0, 1.0)], 6.0, 2, "street");
        let (out, _) = run(&[copy, main]);
        assert_eq!(out.len(), 3);
        let main = &out[0];
        assert_eq!(main.path.len(), 4);
        let (x1, x2) = (main.path[1], main.path[2]);
        assert_eq!(*out[1].path.last().unwrap(), x1);
        assert_eq!(out[2].path[0], x2);
        assert!(out[1].path.len() == 2 && out[2].path.len() == 2);
    }

    #[test]
    fn same_xy_overpass_keeps_deck_and_ground_apart() {
        let deck = street(&[(0.0, 0.0), (40.0, 0.0)], 6.0, 1, "bridge");
        let ground = street(&[(20.0, -20.0), (20.0, 20.0)], 4.0, 2, "street");
        // A street landing on the deck's end joins it.
        let landing = street(&[(40.0, 0.0), (60.0, 0.0)], 6.0, 2, "street");
        let (out, _) = run(&[deck.clone(), ground.clone(), landing]);
        assert_eq!(out[0].path, deck.path);
        assert_eq!(out[1].path, ground.path);
        let mut g = StreetGraph::load(&[deck, ground], 200.0);
        g.seat(&[], &|_, _| true);
        assert!(g.nodes.iter().all(|n| n.arms.len() <= 1));
    }

    #[test]
    fn close_ends_across_a_wall_stay_apart() {
        // Two lanes stopping 3 m apart on either side of a wall at x = 0.
        let west = street(&[(-30.0, 0.0), (-1.5, 0.0)], 3.0, 3, "lane");
        let east = street(&[(1.5, 0.0), (30.0, 0.0)], 3.0, 3, "lane");
        let wall = |a: Point, b: Point| (a.x < 0.0) == (b.x < 0.0);
        let mut g = StreetGraph::load(&[west.clone(), east.clone()], 200.0);
        assert_eq!(g.seat(&[], &wall), Seats::default());
        let out = g.export();
        assert_eq!((out[0].path.clone(), out[1].path.clone()), (west.path.clone(), east.path.clone()));
        // Without the wall they are one street interrupted.
        let (out, seats) = run(&[west, east]);
        assert_eq!(seats.joined, 1);
        assert_eq!(out[0].path.last(), out[1].path.first());
    }

    #[test]
    fn seat_near_a_junction_reuses_it() {
        // The stem's line meets the host 1.5 m from the cross street's junction.
        let host = street(&[(0.0, 0.0), (40.0, 0.0)], 4.0, 2, "street");
        let cross = street(&[(20.0, -20.0), (20.0, 20.0)], 4.0, 2, "street");
        let stem = street(&[(21.5, 30.0), (21.5, 1.0)], 3.0, 3, "lane");
        let (out, seats) = run(&[host, cross, stem]);
        assert_eq!(seats.extended, 1);
        let junction = Point { x: 20.0, y: 0.0 };
        assert_eq!(*out[2].path.last().unwrap(), junction);
        assert_eq!(out[0].path, vec![Point { x: 0.0, y: 0.0 }, junction, Point { x: 40.0, y: 0.0 }]);
    }

    #[test]
    fn near_parallel_end_stays_as_drawn() {
        let host = street(&[(0.0, 0.0), (40.0, 0.0)], 6.0, 2, "street");
        let beside = street(&[(-20.0, 2.0), (20.0, 2.5)], 3.0, 3, "lane");
        let (out, seats) = run(&[host, beside.clone()]);
        assert_eq!(seats, Seats::default());
        assert_eq!(out[1].path, beside.path);
    }

    #[test]
    fn carried_end_lands_on_the_survivor() {
        let survivor = street(&[(0.0, 0.0), (60.0, 0.0)], 8.0, 1, "main");
        let copy = street(&[(5.0, 2.0), (55.0, 2.0)], 4.0, 3, "lane");
        let side = street(&[(30.0, 40.0), (30.0, 2.0)], 4.0, 3, "lane");
        let mut g = StreetGraph::load(&[survivor, copy, side], 200.0);
        let seats = g.seat(&[(1, 0)], &|_, _| true);
        assert_eq!(seats.carried, 1);
        let out = g.export();
        assert_eq!(out.len(), 2);
        let end = *out[1].path.last().unwrap();
        assert_eq!(end, Point { x: 30.0, y: 0.0 });
        assert!(on_axis(end, &out[0]));
    }

    #[test]
    fn result_does_not_depend_on_input_order() {
        let input = vec![
            street(&[(0.0, 0.0), (40.0, 0.0), (80.0, 5.0)], 5.0, 2, "street"),
            street(&[(20.0, -30.0), (20.0, 30.0)], 4.0, 2, "street"),
            street(&[(50.0, 40.0), (51.0, 4.0)], 3.0, 3, "lane"),
            street(&[(60.0, 50.0), (60.0, 30.0)], 3.0, 3, "lane"),
            street(&[(61.5, 28.0), (70.0, 10.0)], 3.0, 3, "lane"),
            street(&[(0.0, 0.0), (40.0, 0.0)], 4.0, 2, "street"),
        ];
        let (a, sa) = run(&input);
        let reversed: Vec<Street> = input.iter().rev().cloned().collect();
        let (b, sb) = run(&reversed);
        assert_eq!(sa, sb);
        assert_eq!(sorted(&a), sorted(&b));
    }
}
