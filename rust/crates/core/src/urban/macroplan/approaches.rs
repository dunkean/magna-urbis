//! Connections between regional roads, growth guides and the town.

use super::*;

/// Growth guides (footprint axes, imported as rank-1 streets) mark where
/// the town's streets run: a guide end left in the open land, a branch tip
/// short of the edge reached on a slope by a hairpin, would be a street
/// leading nowhere. Each guide is cut back from such an end to its first
/// junction with another street or the land's edge, and dropped when nothing
/// anchors it or it only touches one street; the quarter grammar lays the
/// streets there. Repeated until no
/// guide end dangles (a twig on a dropped branch dangles in turn).
pub(super) fn trim_guide_tips(streets: &mut Vec<Street>, envelope: &Shape) {
    const NEAR: f64 = 1.0;
    let guide = |s: &Street| s.rank >= 1 && s.role == "street";
    let edge = |p: Point| {
        std::iter::once(&envelope.outer)
            .chain(envelope.holes.iter())
            .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
            .any(|(&a, &b)| g::distance(p, a, b).0 < NEAR)
    };
    for _ in 0..8 {
        let mut changed = false;
        let mut i = 0;
        while i < streets.len() {
            if !guide(&streets[i]) || streets[i].path.len() < 2 {
                i += 1;
                continue;
            }
            // What holds `p`: the land's edge (`usize::MAX`) or a street.
            let anchor = |p: Point, streets: &[Street]| {
                if edge(p) {
                    return Some(usize::MAX);
                }
                streets.iter().enumerate().position(|(j, o)| {
                    j != i
                        && o.path
                            .windows(2)
                            .any(|w| g::distance(p, w[0], w[1]).0 < NEAR)
                })
            };
            let anchored = |p: Point, streets: &[Street]| anchor(p, streets).is_some();
            let mut keep = Some(streets[i].clone());
            for end in [false, true] {
                let Some(mut s) = keep.take() else {
                    break;
                };
                if end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                if !anchored(s.path[0], streets) {
                    // The first anchored point walking in from the loose end.
                    let mut cut = None;
                    'walk: for k in 0..s.path.len() - 1 {
                        let (a, b) = (s.path[k], s.path[k + 1]);
                        let steps = (dist(a, b) / 0.5).ceil().max(1.0) as usize;
                        for t in 0..=steps {
                            if anchored(point(a, b, t as f64 / steps as f64), streets) {
                                cut = Some((k, point(a, b, t as f64 / steps as f64)));
                                break 'walk;
                            }
                        }
                    }
                    changed = true;
                    match cut {
                        Some((k, p)) if s.path.len() - k >= 2 => {
                            s.path.drain(..=k);
                            s.widths.drain(..=k.min(s.widths.len() - 1));
                            s.path.insert(0, p);
                            let w = s.widths.first().copied().unwrap_or(5.0);
                            s.widths.insert(0, w);
                            s.widths.resize(s.path.len(), w);
                        }
                        _ => continue,
                    }
                }
                if end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                keep = Some(s);
            }
            // A guide held at both ends by one same street only touches it.
            let keep = keep.filter(|s| {
                s.path.len() >= 2 && dist(s.path[0], *s.path.last().unwrap()) > NEAR && {
                    let (a, b) = (
                        anchor(s.path[0], streets),
                        anchor(*s.path.last().unwrap(), streets),
                    );
                    a != b || a == Some(usize::MAX)
                }
            });
            match keep {
                Some(s) => {
                    streets[i] = s;
                    i += 1;
                }
                None => {
                    streets.remove(i);
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
}

/// Invariant (joined crossing): an imported road reaching a crossing of the
/// regional network (bridge, ford, causeway) stays joined to it. The town
/// reads the water finer than the network does: the road's last metres on
/// the bank may be wet to the town's dry test, and the crossing may begin a
/// metre beyond the land's edge, outside this domain's clip. That wet run
/// becomes part of the crossing and the crossing comes in whole; otherwise
/// the approach fails the dry test downstream and is dropped, leaving the
/// crossing a stub hanging from the other bank.
pub(super) fn join_crossing_approaches(
    streets: &mut Vec<Street>,
    roads: &[Street],
    surface: Surface<'_>,
    max_grade: f64,
) {
    let crossing = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    let near = 2.0 * surface.width / surface.n as f64 + 1.0;
    let spans: Vec<&Street> = roads
        .iter()
        .filter(|s| crossing(s) && s.path.len() >= 2)
        .collect();
    // Both ways: the raster walk is not exactly symmetric on a cell edge.
    let clear = |a: Point, b: Point| {
        routing::segment_clear(surface, a, b, max_grade)
            && routing::segment_clear(surface, b, a, max_grade)
    };
    let mut joints = vec![];
    let mut whole = vec![false; spans.len()];
    for s in streets
        .iter_mut()
        .filter(|s| !crossing(s) && s.path.len() >= 2)
    {
        for end in [false, true] {
            if end {
                s.path.reverse();
                s.widths.reverse();
            }
            let abutment = spans
                .iter()
                .enumerate()
                .flat_map(|(i, c)| [(i, c.path[0]), (i, *c.path.last().unwrap())])
                .filter(|&(_, q)| dist(q, s.path[0]) < near)
                .min_by(|a, b| dist(a.1, s.path[0]).total_cmp(&dist(b.1, s.path[0])));
            // The wet run: the leading segments the dry test refuses.
            let wet = s.path.windows(2).take_while(|w| !clear(w[0], w[1])).count();
            if let Some((i, q)) = abutment
                && wet < s.path.len() - 1
            {
                whole[i] = true;
                let mut joint = vec![q];
                if wet > 0 {
                    // The driest point of the last wet segment, walking out.
                    let (a, b) = (s.path[wet - 1], s.path[wet]);
                    let steps = (dist(a, b) / 0.5).ceil().max(1.0) as usize;
                    let p = (0..steps)
                        .map(|t| point(b, a, t as f64 / steps as f64))
                        .take_while(|&p| clear(p, b))
                        .last()
                        .unwrap_or(b);
                    joint.extend(s.path.drain(..wet));
                    s.widths.drain(..wet);
                    joint.push(p);
                    if dist(p, s.path[0]) > 0.01 {
                        s.path.insert(0, p);
                        s.widths.insert(0, s.widths.first().copied().unwrap_or(5.0));
                    }
                } else {
                    joint.push(s.path[0]);
                }
                joint.dedup_by(|a, b| dist(*a, *b) < 0.01);
                if joint.len() >= 2 {
                    let w = spans[i].widths.first().copied().unwrap_or(5.0);
                    joints.push(Street {
                        widths: vec![w; joint.len()],
                        path: joint,
                        rank: 0,
                        role: spans[i].role.clone(),
                    });
                }
            }
            if end {
                s.path.reverse();
                s.widths.reverse();
            }
        }
    }
    // A crossing already in the domain (even clipped) is not added again.
    let present = |c: &Street| {
        streets.iter().any(|t| {
            crossing(t)
                && t.path
                    .iter()
                    .any(|&p| c.path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 0.5))
        })
    };
    let missing: Vec<Street> = spans
        .iter()
        .zip(&whole)
        .filter(|&(c, &w)| w && !present(c))
        .map(|(c, _)| (*c).clone())
        .collect();
    streets.extend(missing);
    streets.extend(joints);
}

/// A camp (catalogue `campLayout`) has no street armature: its paths
/// (`parcels/camp.rs`) serve it from its entrance. The regional roads and
/// their crossings still enter it; the growth guides of its footprint stop at
/// its fence. A camp no regional road enters keeps one guide as its entrance
/// way, from the fence nearest the regional network to the edge of its heart
/// (half its radius from the centre), where the camp's paths take over; when
/// no guide reaches the fence, its longest guide whole.
/// Returns whether that generated entrance was retained.
pub(super) fn camp_entrance(
    streets: &mut Vec<Street>,
    envelope: &Shape,
    c: Point,
    radius: f64,
    roads: &[Street],
) -> bool {
    let regional =
        |s: &Street| s.rank == 0 || matches!(s.role.as_str(), "regional" | "bridge" | "ford" | "causeway" | "approach" | "outbound");
    if streets.iter().any(regional) {
        streets.retain(regional);
        return false;
    }
    let network: Vec<Street> = roads.iter().filter(|s| regional(s)).cloned().collect();
    let on_fence = |p: Point| {
        envelope
            .outer
            .iter()
            .zip(envelope.outer.iter().cycle().skip(1))
            .any(|(&a, &b)| g::distance(p, a, b).0 < 0.1)
    };
    // The guide end on the fence nearest the regional network.
    let entrance = streets
        .iter()
        .flat_map(|s| {
            [false, true].into_iter().filter_map(move |rev| {
                let mut path = s.path.clone();
                if rev {
                    path.reverse();
                }
                on_fence(path[0]).then_some((s, path))
            })
        })
        .min_by(|a, b| {
            let d = |p: Point| nearest(p, &network).map_or(dist(p, c), |n| n.0);
            d(a.1[0]).total_cmp(&d(b.1[0]))
        })
        .map(|(s, path)| {
            // Walk in from the fence, stop at the heart's edge.
            let heart = 0.5 * radius;
            let mut way = vec![path[0]];
            for w in path.windows(2) {
                let (d, t, _) = g::distance(c, w[0], w[1]);
                if d > heart {
                    way.push(w[1]);
                    continue;
                }
                // The point of this segment at the heart's edge.
                let (mut lo, mut hi) = (0.0, t);
                for _ in 0..40 {
                    let t = 0.5 * (lo + hi);
                    if dist(point(w[0], w[1], t), c) > heart {
                        lo = t;
                    } else {
                        hi = t;
                    }
                }
                way.push(point(w[0], w[1], lo));
                break;
            }
            Street {
                widths: vec![s.widths.first().copied().unwrap_or(5.0); way.len()],
                path: way,
                rank: s.rank,
                role: s.role.clone(),
            }
        });
    let entrance = entrance
        .filter(|s| s.path.len() >= 2 && dist(s.path[0], *s.path.last().unwrap()) > 1.0)
        .or_else(|| {
            // No guide reaches the fence (an axis laid inside the land, the
            // beach street of a row village): the longest one is the way in.
            streets
                .iter()
                .max_by(|a, b| {
                    let l = |s: &Street| s.path.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>();
                    l(a).total_cmp(&l(b))
                })
                .cloned()
        });
    streets.clear();
    streets.extend(entrance);
    !streets.is_empty()
}

/// End each destination approach in the entrance belt. A real through route,
/// crossings and wholly internal streets keep their physical access.
/// Camp paths take over inside, rather than a cart road bisecting the centre.
pub(super) fn camp_approaches(streets: &mut Vec<Street>, envelope: &Shape, width: f64, kerb: bool) {
    // Retain a usable kerb beside the road's half-width, not just its end cap.
    let width=width+if kerb {0.5*streets.iter().flat_map(|s|&s.widths).copied().fold(0_f64,f64::max)}else{0.0};
    // The belt must be deeper than the reserve between the envelope and the built
    // blocks (hedge, palisade ring): a thinner stub ends outside every block, the
    // camp then has no street front and builds one house (round 13, iroquoian).
    let width = width.max(24.0);
    let mut ring = envelope.outer.clone();
    if let Some(&p) = ring.first() { ring.push(p); }
    let belt: Vec<_> = g::ribbon(&ring, &[2.0 * width]).iter()
        .flat_map(|b| g::intersection(envelope, b)).collect();
    if belt.is_empty() { return; }
    *streets = streets.iter().flat_map(|s| {
        if matches!(s.role.as_str(), "bridge" | "ford" | "causeway") { return vec![s.clone()]; }
        // A regional path that enters and leaves the land is a through route.
        // Separate arms ending at the settlement nucleus are destination access,
        // not evidence for a road across the tents.
        let on_edge = |p: Point| ring.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 0.1);
        if s.path.first().is_some_and(|&p| on_edge(p)) && s.path.last().is_some_and(|&p| on_edge(p)) {
            return vec![s.clone()];
        }
        let parts: Vec<_> = belt.iter().flat_map(|b| clip(s, b)).collect();
        if parts.is_empty() { vec![s.clone()] } else { parts }
    }).collect();
}
