//! Quay frontage and the placement of port quarters.

use super::*;

/// A port service with direct quay frontage opens onto that frontage, even
/// when its parcel also touches a rear service lane.
pub(in crate::urban) fn face_quays(layout: &Layout, partition: &mut super::super::Partition) {
    let Some(programme) = &partition.programme else { return };
    let port: std::collections::BTreeSet<&str> = programme.allocations.iter().filter(|a|
        programme.demands.iter().any(|d| d.id == a.demand_id && d.site == "quay"))
        .map(|a| a.parcel_id.as_str()).collect();
    for p in &mut partition.parcels {
        if !port.contains(p.id.as_str()) { continue; }
        let Some(c) = p.contacts.iter().filter(|c| layout.streets.get(c.street).is_some_and(|s| s.role == "quay"))
            .max_by(|a, b| a.length.total_cmp(&b.length)) else { continue };
        p.front = Some([c.a, c.b]);
        let length = (c.b.x - c.a.x).hypot(c.b.y - c.a.y).max(1e-9);
        p.axis = Point { x: (c.b.x - c.a.x) / length, y: (c.b.y - c.a.y) / length };
        p.rank = c.rank;
        p.access = Some(super::super::ParcelAccess { kind: "public".into(), street: Some(c.street), front_length: c.length });
    }
}


/// Quay frontage a block needs to count as served by a quay: one warehouse
/// door or market stall row, not a corner graze.
pub const QUAY_FRONT: f64 = 4.0;
/// Cost of a `quay` service off the quays of a harbour town. Finite so the
/// programme's sums stay numbers; `site_admissible` is the actual rule.
pub const QUAY_MISS: f64 = 1000.0;

/// Length of each block's outline that lies along a quay street (its carved
/// edge sits half a quay width from the quay axis). Sampled at three points
/// per edge; quays are few, so a bounding-box test keeps this linear in the
/// blocks' vertices.
pub fn quay_contacts(layout: &Layout) -> Vec<f64> {
    const SLACK: f64 = 1.5;
    let mut landings: Vec<_> = layout.streets.iter().filter(|s|s.role=="quay").collect();
    // Stores above a steep bank are served by the dock's retained stair,
    // just as stores on flat ground front its quay directly.
    loop {
        let added:Vec<_>=layout.streets.iter().filter(|s|s.path.len()>=2 && matches!(s.role.as_str(),"port-street"|"port-stairs"))
            .filter(|s|!landings.iter().any(|q|std::ptr::eq(*q,*s)))
            .filter(|s|landings.iter().any(|q|[s.path[0],*s.path.last().unwrap()].iter()
                .any(|&p|q.path.windows(2).any(|w|g::distance(p,w[0],w[1]).0<0.1)))).collect();
        if added.is_empty() {break;}landings.extend(added);
    }
    let quays: Vec<(&super::super::Street, (f64, f64, f64, f64), f64)> = landings.into_iter().filter(|s|s.path.len()>=2)
        .map(|s| {
            let reach = s.widths.iter().copied().fold(0.0, f64::max) * 0.5 + SLACK;
            let b = s.path.iter().fold(
                (
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                ),
                |(x0, x1, y0, y1), p| (x0.min(p.x), x1.max(p.x), y0.min(p.y), y1.max(p.y)),
            );
            (
                s,
                (b.0 - reach, b.1 + reach, b.2 - reach, b.3 + reach),
                reach,
            )
        })
        .collect();
    if quays.is_empty() {
        return vec![0.0; layout.blocks.len()];
    }
    let near = |p: Point| {
        quays.iter().any(|(s, b, reach)| {
            p.x >= b.0
                && p.x <= b.1
                && p.y >= b.2
                && p.y <= b.3
                && s.path
                    .windows(2)
                    .any(|w| g::distance(p, w[0], w[1]).0 <= *reach)
        })
    };
    // Pure per block: in parallel, in block order.
    super::super::par::map(&layout.blocks, |_, block| {
            let (x0, y0, x1, y1) = g::bbox(&block.shape);
            if !quays
                .iter()
                .any(|(_, b, _)| x1 >= b.0 && x0 <= b.1 && y1 >= b.2 && y0 <= b.3)
            {
                return 0.0;
            }
            let ring = &block.shape.outer;
            (0..ring.len())
                .map(|i| {
                    let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
                    let hits = [0.2, 0.5, 0.8]
                        .iter()
                        .filter(|&&t| {
                            near(Point {
                                x: a.x + (b.x - a.x) * t,
                                y: a.y + (b.y - a.y) * t,
                            })
                        })
                        .count();
                    dist(a, b) * hits as f64 / 3.0
                })
                .sum()
        })
}

/// The quay apron belongs to the waterfront: its street-side blocks keep
/// their physical water access even when the embankment is wider than a probe.
pub(in crate::urban) fn quay_water_fronts(layout: &Layout, surface: super::super::Surface<'_>) -> Vec<Option<(&'static str, f64)>> {
    let contact = quay_contacts(layout);
    let quays: Vec<_> = layout.streets.iter().filter(|s| s.role == "quay")
        .filter_map(|s| super::super::macroplan::harbour::front_water(surface, &s.path).map(|water| (s, water))).collect();
    super::super::par::map(&layout.blocks, |i, b| {
        if contact[i] < QUAY_FRONT { return None; }
        let c = g::interior_point(&b.shape);
        quays.iter().map(|(s, water)| (s.path.windows(2).map(|w| g::distance(c, w[0], w[1]).0)
            .fold(f64::INFINITY, f64::min), *water))
            .min_by(|a, b| a.0.total_cmp(&b.0)).map(|(_, water)| water)
    })
}

/// A `quay` service in a town with quays may only stand on a block that a
/// quay serves; elsewhere (no quay planned) it keeps the natural shore. A
/// Quay frontage per quarter (m): dry blocks served by a quay.
pub(super) fn served_quay_frontage(layout: &Layout, frame: &Frame, env: &[BlockEnvironment]) -> Vec<f64> {
    let mut out = vec![0.0; layout.quarters.len()];
    for (bi, b) in layout.blocks.iter().enumerate() {
        let c = frame.quay.get(bi).copied().unwrap_or(0.0);
        if c >= QUAY_FRONT && !env.get(bi).is_some_and(|e| e.wet) && b.quarter < out.len() {
            out[b.quarter] += c;
        }
    }
    out
}

/// Refine an atomic waterfront quarter by whole served blocks. Keep its old
/// index on the connected central remainder; appended children inherit its
/// phase/tissue. Block IDs, footprints, streets and programme stay untouched.
pub(super) fn port_quarters(layout: &mut Layout, env: &[BlockEnvironment], contact: &[f64]) {
    if layout.structure.is_none() { return; }
    let original = layout.quarters.len();
    let protected: std::collections::BTreeSet<usize> = layout.programme.iter().flat_map(|pr| {
        pr.reservations.iter().filter(|r| pr.demands.iter().any(|d| d.id == r.demand_id && d.site != "quay"))
            .map(|r| r.block)
    }).collect();
    let reserved: std::collections::BTreeSet<usize> = layout.programme.iter().flat_map(|pr|
        pr.reservations.iter().filter(|r| pr.demands.iter().any(|d| d.id == r.demand_id && d.site == "quay")).map(|r| r.block)).collect();
    let margin=layout.streets.iter().filter(|s|s.role=="quay").flat_map(|s|&s.widths).copied().fold(6.0,f64::max)*3.0;
    // A quarter's plan reads only its own outline and blocks: applying the plan
    // of one quarter moves blocks of that quarter alone (to new quarters past
    // `original`), so every plan can be computed first, in parallel, and the
    // plans applied in quarter order as before.
    let jobs: Vec<(usize, Vec<usize>)> = (0..original).filter_map(|qi| {
        if layout.config.as_ref().is_some_and(|c| c.overrides.quarters.contains_key(&qi.to_string())) { return None; }
        let chosen: Vec<usize> = layout.blocks.iter().enumerate().filter(|(bi,b)|
            b.quarter == qi && (b.kind == "block" || reserved.contains(bi)) && contact[*bi] >= QUAY_FRONT
            && !env.get(*bi).is_some_and(|e| e.wet) && !protected.contains(bi)
            && !g::contains(&b.shape, layout.center)).map(|(bi,_)|bi).collect();
        if chosen.is_empty() { return None; }
        // A quarter already made of waterfront blocks needs no refinement.
        if !layout.blocks.iter().enumerate().any(|(bi,b)|b.quarter==qi && !chosen.contains(&bi)) { return None; }
        Some((qi, chosen))
    }).collect();
    let shared: &Layout = layout;
    let plans = super::super::par::map(&jobs, |_, (qi, chosen)| {
        let (qi, parent) = (*qi, &shared.quarters[*qi]);
        // The refinement is a pure function of the parent outline, the
        // quarter's blocks (and which are chosen), the centre and the margin:
        // the repeated programme probes of one run share it (`probe_cache`).
        let key = super::super::probe_cache::enabled().then(|| {
            let mut k = super::super::probe_cache::Key::new("roles.port_quarter/v1");
            k.shape(&parent.shape).point(shared.center).f64(margin);
            for (bi, b) in shared.blocks.iter().enumerate().filter(|(_, b)| b.quarter == qi) {
                k.usize(bi).shape(&b.shape).bool(chosen.contains(&bi));
            }
            k
        });
        match key.as_ref().and_then(|k| PORT_QUARTERS.get(k)) {
            Some(plan) => plan,
            None => {
                let plan = std::sync::Arc::new(port_quarter_plan(shared, qi, &parent.shape, chosen, margin));
                if let Some(k) = key { PORT_QUARTERS.put(k, plan.clone()); }
                plan
            }
        }
    });
    for ((qi, _), plan) in jobs.iter().zip(plans) {
        let qi = *qi;
        let parent = layout.quarters[qi].clone();
        let Some(plan) = plan.as_ref() else { continue };
        layout.quarters[qi].shape = plan.main.clone();
        let mut added = vec![];
        for (shape, moved) in &plan.extra {
            let q=layout.quarters.len();
            for &bi in moved { layout.blocks[bi].quarter = q; }
            layout.quarters.push(super::super::Quarter {shape: shape.clone(),..parent.clone()}); added.push(q);
        }
        for (bi,shape) in &plan.children {
            let q = layout.quarters.len();
            layout.blocks[*bi].quarter = q;
            layout.quarters.push(super::super::Quarter { shape: shape.clone(), ..parent.clone() });
            added.push(q);
        }
        if let Some(s) = layout.structure.as_mut() {
            for d in &mut s.districts { if d.quarters.contains(&qi) { d.quarters.extend(&added); } }
            if let Some(p)=&mut s.metrics.capacity {
                if p.borrowed_quarters.contains(&qi) {p.borrowed_quarters.extend(&added);}
            }
        }
    }
}

/// Port refinement of one quarter, without touching the layout: the parent's
/// remaining outline, the bank remnants that become quarters (with the
/// blocks they take, in order), then one quarter per chosen waterfront block.
struct PortQuarterPlan {
    main: super::super::Shape,
    extra: Vec<(super::super::Shape, Vec<usize>)>,
    children: Vec<(usize, super::super::Shape)>,
}
static PORT_QUARTERS: super::super::probe_cache::Memo<std::sync::Arc<Option<PortQuarterPlan>>> =
    super::super::probe_cache::Memo::new();
pub(in crate::urban) fn clear_probe_cache() {
    PORT_QUARTERS.clear();
}
fn port_quarter_plan(layout: &Layout, qi: usize, parent: &super::super::Shape, chosen: &[usize], margin: f64) -> Option<PortQuarterPlan> {
    let mut rest = vec![parent.clone()];
    let mut children: Vec<(usize, super::super::Shape)> = vec![];
    for &bi in chosen {
        let block=&layout.blocks[bi].shape;
        let mut ring=block.outer.clone(); ring.push(ring[0]);
        let mut padded=g::ribbon(&ring,&[margin*2.0]); padded.push(block.clone());
        let masks=g::union(&padded);
        let mut pieces:Vec<_>=masks.iter().flat_map(|s|g::intersection(parent,s)).collect();
        let bb=g::bbox(block);
        for (_,b) in layout.blocks.iter().enumerate().filter(|(other,b)|*other!=bi && b.quarter==qi) {
            let ob=g::bbox(&b.shape);
            if ob.2<bb.0-margin || ob.0>bb.2+margin || ob.3<bb.1-margin || ob.1>bb.3+margin {continue;}
            pieces=pieces.into_iter().flat_map(|s|g::difference(&s,&b.shape)).collect();
        }
        for (_,shape) in &children {pieces=pieces.into_iter().flat_map(|s|g::difference(&s,shape)).collect();}
        let Some(shape)=pieces.into_iter().find(|s|g::contains(s,g::interior_point(block))) else {continue};
        if g::contains(&shape,layout.center) || g::difference(block,&shape).iter().map(g::area).sum::<f64>()>0.1 {continue;}
        rest = rest.into_iter().flat_map(|s|g::difference(&s,&shape)).collect();
        children.push((bi,shape));
    }
    // Boolean clipping may leave disjoint bank remnants. Retain all of
    // them, with the old index on the component containing the nucleus.
    if children.is_empty() || rest.is_empty() { return None; }
    let main=rest.iter().position(|s|g::contains(s,layout.center)).unwrap_or_else(||
        (0..rest.len()).max_by(|&a,&b|g::area(&rest[a]).total_cmp(&g::area(&rest[b]))).unwrap());
    let main_shape = rest.remove(main);
    // Blocks of the quarter that are neither chosen nor moved yet.
    let mut staying: Vec<usize> = layout.blocks.iter().enumerate()
        .filter(|(bi,b)|b.quarter==qi && !chosen.contains(bi)).map(|(bi,_)|bi).collect();
    let mut extra = vec![];
    for shape in rest {
        if !staying.iter().any(|&bi| g::contains(&shape,g::interior_point(&layout.blocks[bi].shape))) {
            if let Some((index,union))=children.iter().enumerate().find_map(|(i,(_,child))| {
                let mut union=g::union(&[child.clone(),shape.clone()]); (union.len()==1).then(||(i,union.remove(0)))
            }) {children[index].1=union;continue;}
        }
        let moved: Vec<usize> = staying.iter().copied()
            .filter(|&bi| g::contains(&shape,g::interior_point(&layout.blocks[bi].shape))).collect();
        staying.retain(|bi| !moved.contains(bi));
        extra.push((shape, moved));
    }
    Some(PortQuarterPlan { main: main_shape, extra, children })
}

/// Gather the quarters a quay serves into the port district(s), before roles
/// are scored: one district per connected cluster of quay quarters, the
/// longest frontage first. The nucleus quarter and user-pinned quarters stay
/// where they are; frontage left outside the port is reported.
#[allow(clippy::too_many_arguments)]
pub(super) fn carve_port<'a>(
    layout: &Layout,
    frame: &Frame,
    front: &[f64],
    groups: &mut Vec<UrbanDistrict>,
    fixed: &mut Vec<Option<&'a QuarterOverride>>,
    fixed_roles: &mut Vec<Option<String>>,
    warnings: &mut Vec<String>,
) {
    let total: f64 = front.iter().sum();
    if total < QUAY_FRONT || fixed_roles.iter().any(|r| r.as_deref() == Some("port")) {
        return;
    }
    let nucleus = layout
        .quarters
        .iter()
        .position(|q| g::contains(&q.shape, frame.center))
        .or_else(|| {
            (0..layout.quarters.len()).min_by(|&a, &b| {
                dist(g::interior_point(&layout.quarters[a].shape), frame.center).total_cmp(&dist(
                    g::interior_point(&layout.quarters[b].shape),
                    frame.center,
                ))
            })
        });
    let pinned = |q: usize| {
        groups
            .iter()
            .position(|d| d.quarters.contains(&q))
            .is_none_or(|gi| fixed[gi].is_some())
    };
    let local = layout.config.as_ref().is_some_and(super::super::macroplan::harbour::parameterized);
    let contact = &frame.quay;
    let quay_quarters: Vec<usize> = (0..front.len())
        .filter(|&q| front[q] >= QUAY_FRONT && Some(q) != nucleus && !pinned(q))
        // Refinement leaves inland blocks and protected institutions in the
        // parent. A surviving waterfront block cannot turn that parent port.
        .filter(|&q| !local || layout.blocks.iter().enumerate().filter(|(_,b)|b.quarter==q)
            .all(|(bi,_)|contact[bi]>=QUAY_FRONT))
        .collect();
    // Clusters of quay quarters that touch (within a street and a quay).
    const TOUCH: f64 = 30.0;
    let rings: Vec<Vec<Point>> = quay_quarters
        .iter()
        .map(|&q| {
            let r = &layout.quarters[q].shape.outer;
            let stride = r.len().div_ceil(240).max(1);
            r.iter().step_by(stride).copied().collect()
        })
        .collect();
    let boxes: Vec<(f64, f64, f64, f64)> = quay_quarters
        .iter()
        .map(|&q| g::bbox(&layout.quarters[q].shape))
        .collect();
    let touch = |a: usize, b: usize| {
        let (p, q) = (boxes[a], boxes[b]);
        if p.2 + TOUCH < q.0 || q.2 + TOUCH < p.0 || p.3 + TOUCH < q.1 || q.3 + TOUCH < p.1 {
            return false;
        }
        let near = |pts: &[Point], other: &[Point]| {
            pts.iter().any(|&v| {
                (0..other.len())
                    .any(|i| g::distance(v, other[i], other[(i + 1) % other.len()]).0 < TOUCH)
            })
        };
        near(&rings[a], &rings[b]) || near(&rings[b], &rings[a])
    };
    fn root(c: &mut [usize], i: usize) -> usize {
        let mut r = i;
        while c[r] != r {
            r = c[r];
        }
        c[i] = r;
        r
    }
    let mut cluster: Vec<usize> = (0..quay_quarters.len()).collect();
    for a in 0..quay_quarters.len() {
        for b in a + 1..quay_quarters.len() {
            if touch(a, b) {
                let (ra, rb) = (root(&mut cluster, a), root(&mut cluster, b));
                cluster[ra.max(rb)] = ra.min(rb);
            }
        }
    }
    let mut by_root: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, &q) in quay_quarters.iter().enumerate() {
        let r = root(&mut cluster, i);
        by_root.entry(r).or_default().push(q);
    }
    let mut clusters: Vec<(f64, Vec<usize>)> = by_root
        .into_values()
        .map(|qs| (qs.iter().map(|&q| front[q]).sum(), qs))
        .collect();
    clusters.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut served = 0.0;
    for (length, mut qs) in clusters {
        qs.sort_unstable();
        // The new district keeps the tissue and phase of its largest quarter.
        let Some(template) = qs
            .iter()
            .max_by(|&&a, &&b| {
                g::area(&layout.quarters[a].shape)
                    .total_cmp(&g::area(&layout.quarters[b].shape))
                    .then(b.cmp(&a))
            })
            .and_then(|&q| groups.iter().find(|d| d.quarters.contains(&q)))
            .cloned()
        else {
            continue;
        };
        for d in groups.iter_mut() {
            d.quarters.retain(|q| !qs.contains(q));
        }
        groups.push(UrbanDistrict {
            quarters: qs,
            ..template
        });
        fixed.push(None);
        fixed_roles.push(Some("port".into()));
        served += length;
    }
    let keep: Vec<bool> = groups.iter().map(|d| !d.quarters.is_empty()).collect();
    let mut it = keep.iter();
    groups.retain(|_| *it.next().unwrap());
    let mut it = keep.iter();
    fixed.retain(|_| *it.next().unwrap());
    let mut it = keep.iter();
    fixed_roles.retain(|_| *it.next().unwrap());
    if served + 0.5 < total {
        warnings.push(warnings::quays_outside_port(total - served, total));
    }
}
