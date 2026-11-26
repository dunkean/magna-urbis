//! Connect laid street canals to the wet reaches of their curtain's canal moat.

use super::geometry::{Box2, add, cross, dir, dist, dot, normals, quad, ribbon_half};
use super::shore::WallWalk;
use crate::urban::{Enclosure, Gatehouse, Point, Shape, Surface, geometry as g, lagoon::Waterway};

// Only the ditch guarding this front is in reach. Don't dig across a suburb or around to another front.
const JOIN_REACH: f64 = 35.0;

pub(in crate::urban) fn eligible(e: &Enclosure) -> bool {
    e.path.len() >= 4
        && e.path.first() == e.path.last()
        && e.moat.as_ref().is_some_and(|m| m.form == "canal")
        && e.ditch.iter().any(|d| d.kind == "wet")
}

pub(in crate::urban) struct Circuit<'a> {
    index: usize,
    enclosure: &'a Enclosure,
    walk: WallWalk<'a>,
    normals: Vec<(f64, f64)>,
    curtain: g::BoxGrid,
    wet: Vec<&'a Shape>,
    ditch: g::BoxGrid,
}

impl<'a> Circuit<'a> {
    pub(in crate::urban) fn new(index: usize, enclosure: &'a Enclosure) -> Self {
        let path = &enclosure.path;
        let wet: Vec<_> = enclosure
            .ditch
            .iter()
            .filter(|d| d.kind == "wet")
            .map(|d| &d.shape)
            .collect();
        let ditch = g::BoxGrid::new(wet.iter().map(|s| g::bbox(s)).collect());
        Self {
            index,
            enclosure,
            walk: WallWalk::new(path),
            normals: normals(path),
            curtain: g::BoxGrid::new(path.windows(2).map(|w| bounds(w[0], w[1])).collect()),
            wet,
            ditch,
        }
    }

    /// Called as each laid canal segment or outlet is emitted. Probe only the curtain it reaches.
    pub(in crate::urban) fn connect(
        &self,
        water: &Waterway,
        surface: Surface<'_>,
        rise: f64,
        clear: &impl Fn(&Shape) -> bool,
        joins: &mut Vec<Join>,
    ) {
        let [a, b] = water.path[..] else { return };
        let shape_box = g::bbox(&water.shape);
        let inner = ribbon_half(&self.enclosure.kind);
        for k in self.curtain.query(shape_box, inner) {
            let [p, q] = [self.enclosure.path[k], self.enclosure.path[k + 1]];
            let normal = self.normals[k];
            let (a, b) = if dot(dir(a, b), normal) > 0.0 {
                (a, b)
            } else {
                (b, a)
            };
            let run = dir(a, b);
            let across = dot(run, normal);
            if across < 0.5 {
                continue; // A canal along the curtain belongs to its own bank.
            }
            // The centreline crosses the trace, or its end reaches the inner face of the wall.
            let tip = add(b, run, inner / across + 0.1);
            let Some((_, at)) = g::segment_hit(a, tip, p, q) else {
                continue;
            };
            if dot(dir(p, a), normal) >= 0.0 {
                continue;
            }
            let half = water.width_m * 0.5;
            let wall_arc = self.walk.arc(at);
            let gate = self.gate(wall_arc, half / across + 0.25, at, run, joins);
            let Some((gate, previous)) = gate else {
                continue;
            };
            let face = self.enclosure.curtain_width_m - inner;
            // Hold the canal's direction through the wall. Turn only once the full ribbon clears it.
            let outer = add(at, run, (face + half + 0.5).max(1.0) / across);
            let from = add(at, run, -((inner + 1.0) / across).min(dist(a, at)));
            if g::ribbon(&[from, outer], &[water.width_m])
                .iter()
                .any(|s| self.obstructed(s))
            {
                continue;
            }
            let outside = |p: Point| (p.x - at.x) * normal.0 + (p.y - at.y) * normal.1;
            let reach_box = bounds(at, outer);
            let wet: Vec<&Shape> = self
                .ditch
                .query(reach_box, JOIN_REACH)
                .into_iter()
                .map(|i| self.wet[i])
                .collect();

            // An existing reach can already cross the wet ring. Otherwise give it the shortest local
            // branch to an accessible wet reach, including the side of a road-cut moat.
            let beyond = if outside(b) > face {
                add(at, run, face.max(0.0) / across)
            } else {
                b
            };
            let existing = if outside(b) > face {
                g::ribbon(&[beyond, b], &[water.width_m])
            } else {
                vec![]
            };
            if existing.iter().any(|s| wet.iter().any(|d| overlaps(s, d))) {
                joins.push(Join {
                    circuit: self.index,
                    gate,
                    previous,
                    channel: None,
                });
                continue;
            }
            let mut targets: Vec<_> = wet
                .iter()
                .flat_map(|&ditch| {
                    std::iter::once(&ditch.outer)
                        .chain(&ditch.holes)
                        .flat_map(move |ring| {
                            ring.iter()
                                .zip(ring.iter().cycle().skip(1))
                                .map(move |(&a, &b)| {
                                    let (distance, _, point) = g::distance(outer, a, b);
                                    (distance, point, ditch)
                                })
                        })
                })
                .filter(|(distance, point, _)| {
                    *distance > 0.05
                        && dist(*point, at) <= JOIN_REACH
                        && outside(*point) >= face + 0.5
                })
                .collect();
            targets.sort_by(|a, b| a.0.total_cmp(&b.0));
            for (_, target, ditch) in targets {
                // Push the cap just into the ditch rather than leaving a butt joint at the bank.
                let end = add(target, dir(outer, target), 0.5);
                let path = if dist(outer, end) < 0.5 {
                    vec![from, end]
                } else {
                    vec![from, outer, end]
                };
                let mut ribbon = g::ribbon(&path, &[water.width_m]);
                let [shape] = ribbon.as_slice() else { continue };
                let bank = surface.height_at(outer).min(surface.height_at(target));
                let recrosses = path[1..].windows(2).any(|w| {
                    self.curtain
                        .query(bounds(w[0], w[1]), water.width_m * 0.5)
                        .into_iter()
                        .any(|j| {
                            g::segment_hit(
                                w[0],
                                w[1],
                                self.enclosure.path[j],
                                self.enclosure.path[j + 1],
                            )
                            .is_some()
                        })
                });
                if [outer, target]
                    .iter()
                    .any(|&p| (surface.height_at(p) - water.bank_m).abs() > rise)
                    || recrosses
                    || !overlaps(shape, ditch)
                    || !clear(shape)
                    || self.obstructed(shape)
                {
                    continue;
                }
                let channel = Waterway {
                    shape: ribbon.pop().unwrap(),
                    level_m: water.level_m,
                    crossings: vec![],
                    kind: "mouth".into(),
                    rank: water.rank,
                    path,
                    width_m: water.width_m,
                    bank_m: bank.min(water.bank_m),
                    locks: vec![],
                };
                joins.push(Join {
                    circuit: self.index,
                    gate,
                    previous,
                    channel: Some(channel),
                });
                break;
            }
        }
    }

    fn gate(
        &self,
        arc: f64,
        half: f64,
        at: Point,
        run: (f64, f64),
        joins: &[Join],
    ) -> Option<(Gatehouse, Option<usize>)> {
        let e = self.enclosure;
        let walk = &self.walk;
        let mut span = (arc - half, arc + half);
        let mut previous = None;
        // Reuse a land gate at the crossing and keep both its opening width and its masonry.
        for (i, &point) in e.gates.iter().enumerate() {
            if dist(point, at) >= JOIN_REACH {
                continue;
            }
            let land = e
                .gatehouses
                .iter()
                .find(|g| g.gate == i && !matches!(g.kind.as_str(), "water" | "shore" | "ravelin"));
            let s = arc + (walk.arc(point) - arc + walk.total * 0.5).rem_euclid(walk.total)
                - walk.total * 0.5;
            let width = land.map_or(2.5, |g| {
                let heading = dir(g.passage[0], g.passage[1]);
                0.5 * g.passage_width_m
                    / dot(heading, self.normals[walk.segment_of(point)])
                        .abs()
                        .max(0.5)
            }) + 0.3;
            if s + width > span.0 && s - width < span.1 {
                if previous.is_some()
                    || e.gatehouses
                        .iter()
                        .any(|g| g.gate == i && matches!(g.kind.as_str(), "water" | "shore"))
                {
                    return None;
                }
                span = (span.0.min(s - width), span.1.max(s + width));
                previous = Some(i);
            }
        }
        let covered = |g: &Gatehouse| {
            let a = walk.arc(g.passage[0]);
            let b = walk.arc(g.passage[1]);
            let length = (b - a).rem_euclid(walk.total);
            (span.0 - a).rem_euclid(walk.total) <= length
                || (a - span.0).rem_euclid(walk.total) <= span.1 - span.0
        };
        if e.gatehouses
            .iter()
            .any(|g| matches!(g.kind.as_str(), "water" | "shore") && covered(g))
            || joins
                .iter()
                .any(|j| j.circuit == self.index && covered(&j.gate))
        {
            return None;
        }
        let passage = [walk.along(span.0).0, walk.along(span.1).0];
        // A sharp corner may turn the arc back into the channel. Only open a span whose two banks
        // actually stand on opposite sides of the channel.
        let side = |p: Point| cross(run, (p.x - at.x, p.y - at.y));
        if side(passage[0]) * side(passage[1]) >= 0.0 || span.1 - span.0 >= walk.total * 0.5 {
            return None;
        }
        let tangent = dir(passage[0], passage[1]);
        let k = walk.segment_of(at);
        let inner = ribbon_half(&e.kind);
        let shape = quad(
            passage[0],
            tangent,
            self.normals[k],
            [0.0, dist(passage[0], passage[1])],
            [-inner, e.curtain_width_m - inner],
        );
        let land = previous.and_then(|i| {
            e.gatehouses
                .iter()
                .find(|g| g.gate == i && g.kind != "ravelin")
        });
        Some((
            Gatehouse {
                gate: previous.unwrap_or(e.gates.len()),
                kind: "water".into(),
                shape,
                masses: land.map_or_else(Vec::new, |g| g.masses.clone()),
                passage,
                passage_width_m: span.1 - span.0,
                height_m: e.height_m,
            },
            previous,
        ))
    }

    fn obstructed(&self, channel: &Shape) -> bool {
        let e = self.enclosure;
        e.towers_detail
            .iter()
            .map(|t| &t.footprint)
            .chain(e.gatehouses.iter().flat_map(|g| &g.masses))
            .chain(e.outworks.iter().chain(&e.bastions).map(|w| &w.shape))
            .chain(e.attached.iter().map(|a| &a.shape))
            .any(|s| overlaps(channel, s))
    }
}

pub(in crate::urban) fn bounds(a: Point, b: Point) -> Box2 {
    (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))
}

pub(in crate::urban) fn overlaps(a: &Shape, b: &Shape) -> bool {
    g::boxes_meet(g::bbox(a), g::bbox(b))
        && g::intersection(a, b).iter().map(g::area).sum::<f64>() > 0.01
}

pub(in crate::urban) struct Join {
    circuit: usize,
    gate: Gatehouse,
    previous: Option<usize>,
    pub(in crate::urban) channel: Option<Waterway>,
}

impl Join {
    pub(in crate::urban) fn open(self, enclosures: &mut [Enclosure]) {
        let e = &mut enclosures[self.circuit];
        let mut gate = self.gate;
        // The water-gate renderer recognizes a real gate point at the bank and cuts only its span.
        if let Some(i) = self.previous {
            e.gates[i] = gate.passage[0];
            e.gatehouses.retain(|g| g.gate != i || g.kind == "ravelin");
        } else {
            gate.gate = e.gates.len();
            e.gates.push(gate.passage[0]);
        }
        e.gatehouses.push(gate);
        if let Some(channel) = self.channel {
            e.reserve.push(channel.shape);
        }
    }
}
