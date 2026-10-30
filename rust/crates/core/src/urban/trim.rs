//! Post-hoc trim of unbuilt land (stopgap before growth by accretion).
//!
//! The footprint is sized by a land budget while the programme stops placing
//! buildings once the households and services are covered, so a settlement
//! keeps whole blocks (and the lanes that serve them) nobody builds on. After
//! the quarter stage, the programme and the lots are run once on a copy of the
//! layout (`unbuilt`); every ordinary block left without a building becomes
//! open land (`reserve`, which land use turns into fields) and the streets that
//! served only such blocks are removed (`prune`): a segment that touches no
//! occupied lot is dropped when it is a dead end, or when it lies on a loop
//! (the network stays connected), so dead ends created by the removal are
//! pruned back to the last useful junction. Necessary empty links become field
//! paths; bridges, quays and gate connections remain. It runs before the fortification is settled,
//! and the footprint outline follows the built blocks (`footprint`).
use super::{Layout, LayoutConfig, ParcelConfig, Point, Shape, Street, Surface, access, geometry as g, programme};
use std::collections::{HashMap, HashSet};

/// Streets whose segments may be removed when they serve no built block.
fn prunable(role: &str) -> bool {
    matches!(role, "street" | "lane" | "radial" | "ring" | "market") || interior(role)
}
/// Access ways inside a block: they go with it.
fn interior(role: &str) -> bool {
    matches!(role, "close" | "derb" | "hutong" | "roji" | "collective" | "private" | "stairs" | "boundary")
}

/// The capacity plan's vacant land inside the wall (or core) must get the
/// same access and cadastral chance as any other block before trimming.
pub(super) fn prepare(layout: &mut Layout) {
    let rings: Vec<Shape> = layout.enclosures.iter().map(|e| Shape { outer: e.path.clone(), holes: vec![] }).collect();
    for b in &mut layout.blocks {
        if b.kind == "reserve" && (b.zone == "core" || rings.iter().any(|r| g::contains(r, g::interior_point(&b.shape)))) {
            b.kind = "block".into();
        }
    }
}

/// Wall-clipping remnants and strips thinner than the network's minimum
/// land beside a wall walk are public verges, never fictitious house lots.
fn verges(layout: &mut Layout) {
    let rings: Vec<_> = layout.enclosures.iter().map(|e|Shape {outer:e.path.clone(),holes:vec![]}).collect();
    let walks:Vec<_>=layout.streets.iter().filter(|s|s.role=="wall-lane").collect();
    for b in &mut layout.blocks {
        let area=g::area(&b.shape);
        let perimeter:f64=b.shape.outer.iter().zip(b.shape.outer.iter().cycle().skip(1)).take(b.shape.outer.len())
            .map(|(a,b)|(a.x-b.x).hypot(a.y-b.y)).sum();
        let c=g::interior_point(&b.shape);
        let wall_strip=b.kind=="block" && 2.0*area<super::network::MIN_LAND*perimeter
            && walks.iter().any(|s|s.path.windows(2).any(|w|g::distance(c,w[0],w[1]).0<=s.widths.iter().copied().fold(0.0,f64::max)*0.5+super::network::MIN_LAND));
        if (b.kind == "reserve" && area < 100. || wall_strip)
            && rings.iter().any(|r|g::contains(r,c)) {
            b.kind = "common:verge".into();
        }
    }
}

/// Blocks of the layout (indices) that hold no building after the programme and the lots, and
/// the blocks reserved for institutions.
type Unbuilt = (Vec<bool>, HashSet<usize>, HashSet<usize>, Vec<Shape>);
fn urban(p: &super::Parcel, layout: &Layout) -> bool {
    layout.blocks.get(p.block).is_some_and(|b|matches!(b.zone.as_str(),"core"|"middle"))
        || layout.enclosures.iter().any(|e|g::contains(&Shape {outer:e.path.clone(),holes:vec![]},g::interior_point(&p.shape)))
}
fn street_use(p: &super::Parcel, role: &str, layout: &Layout) -> bool {
    !role.starts_with("open.") || role != "open.garden" && (matches!(p.use_kind.as_str(),"place"|"market")
        || urban(p,layout))
}
fn unbuilt(seed: &str, layout: &Layout, config: &LayoutConfig, original: &LayoutConfig, population: u32, surface: Surface<'_>) -> Option<Unbuilt> {
    let mut probe = layout.clone();
    // The published cadastre reads the user config restored by kinds::finish.
    probe.config = Some(original.clone());
    access::summarize(&mut probe, config);
    programme::prepare(&mut probe, population, &config.programme, surface).ok()?;
    let parts = super::generate_parcels(seed, std::slice::from_ref(&probe), &ParcelConfig::default()).ok()?;
    let part = parts.first()?;
    let reserved: HashSet<usize> = probe.programme.as_ref()?.reservations.iter().map(|r| r.block).collect();
    // Blocks held for open common land stay reserved, but no street needs to run along them.
    let pr = probe.programme.as_ref()?;
    let commons: HashSet<usize> = pr
        .reservations
        .iter()
        .filter(|r| pr.demands.iter().any(|d| d.id == r.demand_id && d.role.starts_with("open.")))
        .map(|r| r.block)
        .collect();
    let roles: HashMap<&str, &str> = part
        .programme
        .iter()
        .flat_map(|p| &p.allocations)
        .map(|a| (a.parcel_id.as_str(), a.role.as_str()))
        .collect();
    let mut built = vec![false; layout.blocks.len()];
    let used = |p: &super::Parcel| roles.get(p.id.as_str()).is_some_and(|role| !role.starts_with("open."));
    for p in &part.parcels {
        let Some(slot) = built.get_mut(p.block) else { continue };
        *slot |= used(p);
    }
    let empty = layout
        .blocks
        .iter()
        .enumerate()
        .map(|(i, b)| b.kind == "block" && !built[i] && !reserved.contains(&i))
        .collect();
    // Consolidated yards can reach a different street from their house. Only
    // retained contacts justify fringe frontage; urban properties keep their yards.
    let lots = part.parcels.iter().filter(|p| roles.get(p.id.as_str()).is_some_and(|role|street_use(p,role,layout))
        || urban(p,layout) && p.access.as_ref().is_some_and(|a|a.kind == "attached")
            && p.parent_ids.iter().any(|id|roles.get(id.as_str()).is_some_and(|role|!role.starts_with("open.")))).flat_map(|p| {
        if urban(p,layout) { return vec![p.shape.clone()]; }
        let fronts: Vec<_> = p.contacts.iter().map(|c| [c.a,c.b]).chain(p.front.filter(|_| p.contacts.is_empty())).collect();
        if fronts.is_empty() { vec![p.envelope.as_ref().unwrap_or(&p.shape).clone()] }
        else { fronts.into_iter().map(|f| Shape { outer:f.to_vec(), holes:vec![] }).collect() }
    }).collect();
    Some((empty, reserved, commons, lots))
}

/// Sample points along a block outline, a few metres apart.
fn outline_points(s: &Shape, out: &mut Vec<Point>) {
    for ring in std::iter::once(&s.outer).chain(s.holes.iter()) {
        for w in ring.windows(2).chain(std::iter::once(&[ring[ring.len() - 1], ring[0]][..])) {
            let len = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
            let k = (len / 5.0).ceil().max(1.0) as usize;
            for j in 0..k {
                let t = j as f64 / k as f64;
                out.push(Point { x: w[0].x + (w[1].x - w[0].x) * t, y: w[0].y + (w[1].y - w[0].y) * t });
            }
        }
    }
}

const CELL: f64 = 16.0;
fn cell(p: Point) -> (i64, i64) {
    ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64)
}

fn frontage_hash(lots: &[Shape]) -> HashMap<(i64,i64),Vec<Point>> {
    let mut hash: HashMap<(i64, i64), Vec<Point>> = HashMap::new();
    let mut points = vec![];
    for lot in lots {
        outline_points(lot, &mut points);
    }
    for p in points {
        hash.entry(cell(p)).or_default().push(p);
    }
    hash
}

fn touches(hash: &HashMap<(i64,i64),Vec<Point>>, a: Point, b: Point, reach: f64) -> bool {
    let (x0, y0) = cell(Point { x: a.x.min(b.x) - reach, y: a.y.min(b.y) - reach });
    let (x1, y1) = cell(Point { x: a.x.max(b.x) + reach, y: a.y.max(b.y) + reach });
    (x0..=x1).any(|cx| {
        (y0..=y1).any(|cy| hash.get(&(cx, cy)).is_some_and(|v| v.iter().any(|&p| g::distance(p, a, b).0 <= reach)))
    })
}

struct Seg {
    street: usize,
    a: usize,
    b: usize,
    prunable: bool,
    serves: bool,
    alive: bool,
}

/// Remove the street segments that serve nothing. `open` flags the blocks that are open land.
fn prune(layout: &mut Layout, open: &[bool], lots: &[Shape]) {
    // Access ways inside open blocks.
    let open_boxes: Vec<(usize, (f64, f64, f64, f64))> =
        (0..open.len()).filter(|&i| open[i]).map(|i| (i, g::bbox(&layout.blocks[i].shape))).collect();
    let blocks = &layout.blocks;
    layout.streets.retain(|s| {
        if !interior(&s.role) || s.path.len() < 2 {
            return true;
        }
        let m = Point {
            x: (s.path[0].x + s.path[s.path.len() - 1].x) * 0.5,
            y: (s.path[0].y + s.path[s.path.len() - 1].y) * 0.5,
        };
        !open_boxes.iter().any(|&(i, b)| m.x >= b.0 && m.x <= b.2 && m.y >= b.1 && m.y <= b.3 && g::contains(&blocks[i].shape, m))
    });
    // Long segments are cut so that a street stops where its last frontage ends.
    for s in layout.streets.iter_mut().filter(|s| frontage_road(&s.role) && s.path.len() >= 2) {
        let (mut path, mut widths) = (vec![s.path[0]], vec![s.widths.first().copied().unwrap_or(4.0)]);
        for i in 1..s.path.len() {
            let (a, b) = (s.path[i - 1], s.path[i]);
            let (wa, wb) = (s.widths.get(i - 1).or(s.widths.first()).copied().unwrap_or(4.0), s.widths.get(i).or(s.widths.last()).copied().unwrap_or(4.0));
            let k = ((b.x - a.x).hypot(b.y - a.y) / 10.0 - 1e-9).ceil().max(1.0) as usize;
            for j in 1..=k {
                let t = j as f64 / k as f64;
                path.push(Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
                widths.push(wa + (wb - wa) * t);
            }
        }
        s.path = path;
        s.widths = widths;
    }
    // Only occupied lots justify a terminal street, not a whole half-empty block.
    let hash = frontage_hash(lots);
    // Segment graph; coincident vertices are one node.
    let mut nodes: HashMap<(i64, i64), usize> = HashMap::new();
    let mut pos: Vec<Point> = vec![];
    let mut node = |p: Point| {
        *nodes.entry(((p.x * 2.0).round() as i64, (p.y * 2.0).round() as i64)).or_insert_with(|| {
            pos.push(p);
            pos.len() - 1
        })
    };
    let mut segs: Vec<Seg> = vec![];
    let mut first_seg: Vec<usize> = vec![];
    let mut ends: Vec<(usize, usize, usize)> = vec![];
    for (si, s) in layout.streets.iter().enumerate() {
        first_seg.push(segs.len());
        let can = prunable(&s.role);
        for i in 1..s.path.len() {
            let (p, q) = (s.path[i - 1], s.path[i]);
            let w = s.widths.get(i - 1).or(s.widths.first()).copied().unwrap_or(4.0);
            let serves = touches(&hash,p, q, w * 0.5 + 3.0);
            segs.push(Seg { street: si, a: node(p), b: node(q), prunable: can, serves, alive: true });
        }
        if s.path.len() >= 2 {
            ends.push((si, node(s.path[0]), node(s.path[s.path.len() - 1])));
        }
    }
    first_seg.push(segs.len());
    let n = pos.len();
    // A street end resting on the side of another street is joined to it.
    let mut by_cell: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (k, sg) in segs.iter().enumerate() {
        let (a, b) = (pos[sg.a], pos[sg.b]);
        let (x0, y0) = cell(Point { x: a.x.min(b.x), y: a.y.min(b.y) });
        let (x1, y1) = cell(Point { x: a.x.max(b.x), y: a.y.max(b.y) });
        for cx in x0..=x1 {
            for cy in y0..=y1 {
                by_cell.entry((cx, cy)).or_default().push(k);
            }
        }
    }
    let mut link: Vec<Vec<(usize, usize, usize)>> = vec![vec![]; n];
    for &(si, e0, e1) in &ends {
        for (e, source) in [(e0, first_seg[si]), (e1, first_seg[si + 1] - 1)] {
            let p = pos[e];
            let (cx, cy) = cell(p);
            let mut best: Option<(f64, usize)> = None;
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &k in by_cell.get(&(cx + dx, cy + dy)).into_iter().flatten() {
                        let sg = &segs[k];
                        if sg.street == si || sg.a == e || sg.b == e {
                            continue;
                        }
                        let w = layout.streets[sg.street].widths.first().copied().unwrap_or(4.0);
                        let d = g::distance(p, pos[sg.a], pos[sg.b]).0;
                        if d <= w * 0.5 + 1.5 && best.is_none_or(|(bd, _)| d < bd) {
                            best = Some((d, k));
                        }
                    }
                }
            }
            if let Some((_, k)) = best {
                let sg = &segs[k];
                let to = if (pos[sg.a].x - p.x).hypot(pos[sg.a].y - p.y) < (pos[sg.b].x - p.x).hypot(pos[sg.b].y - p.y) { sg.a } else { sg.b };
                // The contact disappears with either incident segment. Permanent
                // virtual links otherwise keep phantom junctions after pruning.
                link[e].push((to, source, k));
                link[to].push((e, source, k));
            }
        }
    }
    let mut adj: Vec<Vec<usize>> = vec![vec![]; n];
    for (k, sg) in segs.iter().enumerate() {
        adj[sg.a].push(k);
        adj[sg.b].push(k);
    }
    let degree = |segs: &[Seg], v: usize| adj[v].iter().filter(|&&k| segs[k].alive).count()
        + link[v].iter().filter(|&&(_, a, b)| segs[a].alive && segs[b].alive).count();
    let mut contacts = vec![vec![]; segs.len()];
    for (v, links) in link.iter().enumerate() {
        for &(to, a, b) in links {
            contacts[a].extend([v, to]);
            contacts[b].extend([v, to]);
        }
    }
    // Dead ends that serve nothing, back to the last junction.
    let dead_ends = |segs: &mut Vec<Seg>| {
        let mut queue: Vec<usize> = (0..n).filter(|&v| degree(segs, v) <= 1).collect();
        while let Some(v) = queue.pop() {
            for &k in &adj[v] {
                let sg = &segs[k];
                if !sg.alive || !sg.prunable || sg.serves || degree(segs, v) > 1 {
                    continue;
                }
                let other = if sg.a == v { sg.b } else { sg.a };
                segs[k].alive = false;
                queue.push(other);
                queue.extend(&contacts[k]);
            }
        }
    };
    dead_ends(&mut segs);
    // A segment on a loop that serves nothing: the network stays connected without it.
    let mut loops: Vec<usize> = (0..segs.len()).filter(|&k| segs[k].alive && segs[k].prunable && !segs[k].serves).collect();
    let centre = layout.center;
    loops.sort_by(|&x, &y| {
        let far = |k: usize| {
            let (a, b) = (pos[segs[k].a], pos[segs[k].b]);
            ((a.x + b.x) * 0.5 - centre.x).hypot((a.y + b.y) * 0.5 - centre.y)
        };
        far(y).total_cmp(&far(x))
    });
    let connected = |segs: &[Seg], from: usize, to: usize| {
        let mut seen = vec![false; n];
        let mut stack = vec![from];
        let mut useful = false;
        seen[from] = true;
        while let Some(v) = stack.pop() {
            if v == to {
                return (true, useful);
            }
            useful |= adj[v].iter().any(|&k| segs[k].alive && (segs[k].serves || !segs[k].prunable));
            let next = adj[v].iter().filter(|&&k| segs[k].alive).map(|&k| if segs[k].a == v { segs[k].b } else { segs[k].a })
                .chain(link[v].iter().filter(|&&(_, a, b)| segs[a].alive && segs[b].alive).map(|&(to, _, _)| to));
            for w in next {
                if !seen[w] {
                    seen[w] = true;
                    stack.push(w);
                }
            }
        }
        (false, useful)
    };
    for k in loops {
        if !segs[k].alive {
            continue;
        }
        segs[k].alive = false;
        let (mut a, mut b) = (segs[k].a, segs[k].b);
        if degree(&segs, a) > degree(&segs, b) { std::mem::swap(&mut a, &mut b); }
        let (joined, useful) = connected(&segs, a, b);
        // A disappearing side-contact may isolate an unused endpoint, rather
        // than a place. Preserve connectivity between useful places only.
        if !joined && useful && connected(&segs, b, a).1 {
            segs[k].alive = true;
        }
    }
    dead_ends(&mut segs);
    // Streets again, cut where a segment went.
    let old = std::mem::take(&mut layout.streets);
    let walls: Vec<_> = layout.enclosures.iter().map(|e| Shape { outer:e.path.clone(), holes:vec![] }).collect();
    for (si, s) in old.into_iter().enumerate() {
        let range = first_seg[si]..first_seg[si + 1];
        let split = matches!(s.role.as_str(), "outbound" | "peripheral");
        let any_front = range.clone().any(|k| segs[k].alive && segs[k].serves);
        let mut rural = vec![false; range.len()];
        let mut from = 0;
        while from < range.len() {
            let candidate = |i: usize| {
                let sg = &segs[range.start+i];
                let (a,b) = (pos[sg.a],pos[sg.b]);
                let mid = Point { x:(a.x+b.x)*0.5, y:(a.y+b.y)*0.5 };
                sg.alive && !sg.serves && (split || !walls.iter().any(|r|g::contains(r,mid)))
            };
            if !candidate(from) { from += 1; continue; }
            let mut to = from+1;
            while to < range.len() && candidate(to) { to += 1; }
            let length: f64 = (from..to).map(|i| { let sg=&segs[range.start+i]; (pos[sg.a].x-pos[sg.b].x).hypot(pos[sg.a].y-pos[sg.b].y) }).sum();
            // Keep short garden gaps continuous; a long empty fringe is a path.
            if split || length >= 30. { rural[from..to].fill(true); }
            from = to;
        }
        if !range.clone().any(|k| !segs[k].alive || frontage_road(&s.role) && (!any_front || rural[k-range.start])) {
            layout.streets.push(s);
            continue;
        }
        let mut start: Option<usize> = None;
        let mut track = false;
        let emit_run = |from: usize, to: usize, track: bool, out: &mut Vec<Street>| {
            let empty = frontage_road(&s.role) && !(from..to).any(|i| segs[first_seg[si]+i].serves);
            emit_kind(&s, from, to, track || empty, out);
        };
        for (i, k) in range.clone().enumerate() {
            let next_track = frontage_road(&s.role) && (!any_front || rural[i]);
            if let Some(from) = start && (!segs[k].alive || next_track != track) {
                emit_run(from, i, track, &mut layout.streets);
                start = None;
            }
            match (segs[k].alive, start) {
                (true, None) => { start = Some(i); track = next_track; }
                _ => {}
            }
        }
        if let Some(from) = start {
            emit_run(from, range.len(), track, &mut layout.streets);
        }
    }
}

fn frontage_road(role: &str) -> bool {
    prunable(role) || matches!(role, "peripheral" | "outbound")
}

fn emit_kind(s: &Street, from: usize, to: usize, track: bool, out: &mut Vec<Street>) {
    emit(s, from, to, out);
    if track && let Some(s) = out.last_mut() { super::network::downgrade_path(s); }
}

/// The part of `s` from vertex `from` to vertex `to` (inclusive).
fn emit(s: &Street, from: usize, to: usize, out: &mut Vec<Street>) {
    if to <= from {
        return;
    }
    let widths: Vec<f64> = (from..=to).map(|i| s.widths.get(i).or(s.widths.last()).copied().unwrap_or(4.0)).collect();
    out.push(Street { path: s.path[from..=to].to_vec(), widths, rank: s.rank, role: s.role.clone() });
}

/// The unbuilt blocks become open land and the streets that served only them go. Returns the
/// number of blocks released.
pub(super) fn run(seed: &str, layout: &mut Layout, config: &LayoutConfig, original: &LayoutConfig, population: u32, surface: Surface<'_>) -> usize {
    let mut released = 0;
    verges(layout);
    // Trimming changes the next cadastre's frontages. Reach a fixed point,
    // rather than leaving the last pass's newly exposed empty terminals.
    loop {
        let before: f64 = layout.streets.iter().filter(|s| frontage_road(&s.role)).flat_map(|s| s.path.windows(2)).map(|w| (w[1].x-w[0].x).hypot(w[1].y-w[0].y)).sum();
        let Some((empty, reserved, commons, occupied)) = unbuilt(seed, layout, config, original, population, surface) else { break };
        let count = empty.iter().filter(|&&e| e).count();
        let ordinary = layout.blocks.iter().filter(|b| b.kind == "block").count();
        // The place always keeps one built block.
        if count >= ordinary && ordinary > 0 {
            break;
        }
        for (b, &e) in layout.blocks.iter_mut().zip(&empty) {
            if e {
                b.kind = "reserve".into();
            }
        }
        verges(layout);
        let open: Vec<bool> = layout.blocks.iter().enumerate().map(|(i, b)| (b.kind == "reserve" && !reserved.contains(&i)) || commons.contains(&i)).collect();
        prune(layout, &open, &occupied);
        released += count;
        let after: f64 = layout.streets.iter().filter(|s| frontage_road(&s.role)).flat_map(|s| s.path.windows(2)).map(|w| (w[1].x-w[0].x).hypot(w[1].y-w[0].y)).sum();
        if count == 0 && (before-after).abs() < 1e-6 { break; }
    }
    if released > 0 {
        layout.warnings.push(format!("{released} îlot(s) sans construction rendu(s) aux champs, avec leurs rues."));
    }
    released
}

/// Bridge/stilt finishing can change the last allocation after the main trim.
pub(super) fn finish(seed: &str, layout: &mut Layout, surface: Surface<'_>) {
    if !surface.water.iter().any(|&w|w != 0) { return; }
    if layout.programme.as_ref().is_none_or(|p| super::roles::is_isolated(&p.context.intent)) { return; }
    loop {
        let Ok(parts) = super::generate_parcels(seed,std::slice::from_ref(layout),&ParcelConfig::default()) else { break };
        let Some(part) = parts.first() else { break };
        let layouts = std::slice::from_ref(&*layout);
        let Ok(index) = super::building_sites::BuildingSiteIndex::prepare(layouts,&parts,&[0]) else { break };
        // The lots whose building request would show a silhouette, without
        // generating the requests (a failing request leaves the streets as they are).
        // They are previewed lazily: a street needs one occupied lot in reach.
        let Ok(previews) = super::building_sites::SitePreviews::new(&index,seed,layouts,&parts) else { return };
        let explicit: HashSet<&str> = part.programme.iter().flat_map(|p|&p.allocations).filter(|a|a.role != "open.garden"
                && matches!(a.function.as_str(),"market"|"common")
                && part.parcels.iter().any(|p|p.id == a.parcel_id && street_use(p,&a.role,layout)))
                .map(|a|a.parcel_id.as_str()).collect();
        let active = |id: &str| explicit.contains(id) || previews.previewed(id);
        let memo: Vec<std::cell::OnceCell<bool>> = part.parcels.iter().map(|_| std::cell::OnceCell::new()).collect();
        let lot = |i: usize| *memo[i].get_or_init(|| {
            let p = &part.parcels[i];
            active(p.id.as_str())
                || urban(p,layout) && p.access.as_ref().is_some_and(|a|a.kind == "attached")
                    && p.parent_ids.iter().any(|id|active(id.as_str()))
        });
        // Outline points of every parcel; a point counts when its lot does.
        let mut hash: HashMap<(i64, i64), Vec<(Point, usize)>> = HashMap::new();
        let mut points = vec![];
        for (i, p) in part.parcels.iter().enumerate() {
            points.clear();
            outline_points(&p.shape, &mut points);
            for &q in &points {
                hash.entry(cell(q)).or_default().push((q, i));
            }
        }
        let touches = |a: Point, b: Point, reach: f64| {
            let (x0, y0) = cell(Point { x: a.x.min(b.x) - reach, y: a.y.min(b.y) - reach });
            let (x1, y1) = cell(Point { x: a.x.max(b.x) + reach, y: a.y.max(b.y) + reach });
            (x0..=x1).any(|cx| (y0..=y1).any(|cy| hash.get(&(cx, cy))
                .is_some_and(|v| v.iter().any(|&(q, i)| g::distance(q, a, b).0 <= reach && lot(i)))))
        };
        let empty: Vec<bool> = layout.streets.iter().map(|s| frontage_road(&s.role) && {
            let reach = s.widths.iter().copied().fold(0.,f64::max)*0.5+3.5;
            !s.path.windows(2).any(|w|touches(w[0],w[1],reach))
        }).collect();
        let changed = empty.iter().any(|&e| e);
        for (s, e) in layout.streets.iter_mut().zip(empty) {
            if e { super::network::downgrade_path(s); }
        }
        if !changed { break; }
    }
}

/// The footprint outline follows the built land: the allocated land within reach of a block that
/// is not open ground.
pub(super) fn footprint(layout: &mut Layout) {
    let reserved: HashSet<usize> = layout.programme.iter().flat_map(|p| &p.reservations).map(|r| r.block).collect();
    let commons: HashSet<usize> = layout
        .programme
        .iter()
        .flat_map(|p| p.reservations.iter().filter(|r| p.demands.iter().any(|d| d.id == r.demand_id && d.role.starts_with("open."))))
        .map(|r| r.block)
        .collect();
    let open: Vec<&Shape> = layout
        .blocks
        .iter()
        .enumerate()
        .filter(|(i, b)| (b.kind == "reserve" && !reserved.contains(i)) || commons.contains(i))
        .map(|(_, b)| &b.shape)
        .collect();
    let built: Vec<Shape> = layout
        .blocks
        .iter()
        .enumerate()
        .filter(|(i, b)| (b.kind != "reserve" || reserved.contains(i)) && !commons.contains(i))
        .map(|(_, b)| b.shape.clone())
        .collect();
    if open.is_empty() || built.is_empty() {
        return;
    }
    let Some(s) = layout.structure.as_mut() else { return };
    use geo::Buffer;
    let reach = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        g::shapes(geo::MultiPolygon(built.iter().map(g::polygon).collect::<Vec<_>>()).buffer(12.0))
    }))
    .unwrap_or_default();
    if reach.is_empty() {
        return;
    }
    let mut kept = vec![];
    for a in &s.allocated {
        for r in &reach {
            kept.extend(g::intersection(a, r));
        }
    }
    if kept.is_empty() {
        return;
    }
    s.allocated = g::union(&kept);
    s.metrics.allocated_area = s.allocated.iter().map(g::area).sum();
    s.metrics.components = s.allocated.len();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FRINGE_CASES: &[(&str, u32)] = &[
        ("al-andalus",500),("barbarian",500),("mississippian",500),("oasis-caravan",500),
        ("merfolk-tidal",500),("persian",500),("goblin-warren",500),("ksar-oasis",500),("roman-core",500),
        ("khmer",10000),("maya",10000),("norse-ringfort",10000),("great-zimbabwe",10000),
        ("ethiopian-highland",10000),("barbarian-celtic",10000),("dwarven",10000),
    ];

    fn audited(culture: &str, population: u32, river: bool) -> (Layout, super::super::Partition, Vec<serde_json::Value>) {
        let n = 128;
        let height = vec![10.;n*n];
        let mut water = vec![0;n*n];
        if river { for y in 0..n { for x in n/2..n/2+2 { water[y*n+x] = 3; } } }
        let level = vec![10.;n*n];
        let surface = Surface { geometry:None, width:6000., n, height:&height, water:&water };
        let site = super::super::Site { key:"fill3".into(),name:String::new(),population,culture:culture.into(),center:Point{x:if river {2800.} else {3000.},y:3000.},radius:150. };
        let cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        let roads = if river { vec![Street { path:vec![Point{x:0.,y:3000.},Point{x:6000.,y:3000.}],widths:vec![8.;2],rank:1,role:"regional".into() }] } else { vec![] };
        let l = super::super::generate_quarters("fill3", &[site], &cfg, surface, &roads).unwrap().remove(0);
        let part = super::super::generate_parcels("fill3", std::slice::from_ref(&l), &ParcelConfig::default()).unwrap().remove(0);
        let requests = super::super::building_sites::requests("fill3",std::slice::from_ref(&l),std::slice::from_ref(&part),surface,&level,None).unwrap();
        if let Ok(dir) = std::env::var("FILL3_OUT") {
            std::fs::create_dir_all(&dir).unwrap();
            let previews: Vec<_> = requests.iter().map(|r|json!({"parcel_id":r["parcel_id"],"preview":r["preview"]})).collect();
            std::fs::write(std::path::Path::new(&dir).join(format!("{culture}-{population}-{}.json",if river {"river"} else {"flat"})),serde_json::to_vec(&json!({"layout":l,"partition":part,"requests":previews})).unwrap()).unwrap();
        }
        (l,part,requests)
    }

    #[test]
    #[ignore]
    fn survey_fringe() {
        for &(culture,population) in FRINGE_CASES {
            let (l,part,requests) = audited(culture,population,false);
            let mut counts = std::collections::BTreeMap::new();
            for p in &part.parcels { *counts.entry((&p.use_kind,&p.reason)).or_insert(0) += 1; }
            let built = requests.iter().filter(|r|r["preview"].as_array().is_some_and(|p|!p.is_empty())).count();
            println!("FRINGE {culture} {population}: silhouettes {built}/{} lots {counts:?}",part.parcels.len());
            if let Ok(dir) = std::env::var("FILL3_OUT") {
                std::fs::create_dir_all(&dir).unwrap();
                let previews: Vec<_> = requests.iter().map(|r|json!({"parcel_id":r["parcel_id"],"preview":r["preview"]})).collect();
                std::fs::write(std::path::Path::new(&dir).join(format!("{culture}-{population}.json")),serde_json::to_vec(&json!({"layout":l,"partition":part,"requests":previews})).unwrap()).unwrap();
            }
        }
    }

    #[test]
    fn fringe_rows_are_occupied_and_empty_connections_are_paths() {
        let mut failures = vec![];
        for (culture,population,river) in FRINGE_CASES.iter().map(|&(c,p)|(c,p,false)).chain(
            ["khmer","maya","norse-ringfort","great-zimbabwe"].map(|c|(c,10000,true))) {
            let (l,part,requests) = audited(culture,population,river);
            let pr = part.programme.as_ref().unwrap();
            let used: HashSet<_> = requests.iter().filter(|r|r["preview"].as_array().is_some_and(|p|!p.is_empty())).filter_map(|r|r["parcel_id"].as_str()).collect();
            let rings: Vec<_> = l.enclosures.iter().map(|e|Shape{outer:e.path.clone(),holes:vec![]}).collect();
            let enclosed = |p: &super::super::Parcel| rings.iter().any(|r|g::contains(r,g::interior_point(&p.shape)));
            let explicit_open = |p: &super::super::Parcel| pr.allocations.iter().any(|a|a.parcel_id == p.id && a.role != "open.garden" && (a.role.starts_with("open.") || matches!(a.function.as_str(),"common"|"market")));
            let rows: Vec<_> = part.parcels.iter().filter(|p| !enclosed(p) && p.family != "reserve"
                && matches!(p.use_kind.as_str(),"plot"|"compound"|"residual"|"garden")
                && p.access.as_ref().is_some_and(|a| a.street.is_some() && a.kind != "attached") && !explicit_open(p)).collect();
            let bare: Vec<_> = rows.iter().filter(|p| !used.contains(p.id.as_str())).collect();
            if bare.len() as f64 > rows.len() as f64 * 0.05 { failures.push(format!("{culture} river={river}: bare fringe {}/{} {:?}",bare.len(),rows.len(),bare.iter().map(|p|(&p.use_kind,&p.reason)).collect::<Vec<_>>())); }
            let indoor: Vec<_> = part.parcels.iter().filter(|p| enclosed(p) && matches!(p.use_kind.as_str(),"plot"|"compound"|"residual") && !used.contains(p.id.as_str()) && !explicit_open(p)).collect();
            if !indoor.is_empty() { failures.push(format!("{culture} river={river}: {} vacant intra-muros lots",indoor.len())); }
            let mut points = vec![];
            for p in part.parcels.iter().filter(|p| used.contains(p.id.as_str()) || explicit_open(p)
                || (enclosed(p) || matches!(l.blocks[p.block].zone.as_str(),"core"|"middle"))
                    && p.access.as_ref().is_some_and(|a|a.kind == "attached") && p.parent_ids.iter().any(|id|used.contains(id.as_str()))) {
                outline_points(&p.shape,&mut points);
            }
            let empty: Vec<_> = l.streets.iter().filter(|s| frontage_road(&s.role) && !s.path.windows(2).any(|w|
                points.iter().any(|&p|g::distance(p,w[0],w[1]).0 <= s.widths.iter().copied().fold(0.,f64::max)*0.5+3.5))).collect();
            if !empty.is_empty() { failures.push(format!("{culture} river={river}: empty streets {:?}",empty.iter().map(|s|(&s.role,s.path.len())).collect::<Vec<_>>())); }
            assert!(l.streets.iter().filter(|s|s.role == "track").all(|s|s.rank == 4 && s.widths.iter().all(|&w|w <= 2.)));
            assert!(part.parcels.iter().flat_map(|p|&p.contacts).all(|c|l.streets[c.street].role != "track" || l.streets[c.street].rank < 4));
            assert!(!part.parcels.iter().any(|p|p.reason == "edge-enclosure"));
            let wanted: f64 = pr.demands.iter().filter(|d|d.unit == "domesticUnits").map(|d|d.requested).sum();
            assert!(pr.allocations.iter().map(|a|a.households).sum::<f64>() <= (wanted*1.3).floor().max(wanted.ceil()),"{culture}: population cap");
            println!("FILL3 {culture} {population} river={river}: {} silhouettes; fringe vacant {}/{}; empty streets {}",used.len(),bare.len(),rows.len(),empty.len());
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }

    /// `trim::finish` reads the previewed lots without generating the requests.
    #[test]
    fn previewed_parcels_are_the_requests_with_a_preview() {
        for (culture, population, river) in [("roman-core",500,false),("persian",500,false),("khmer",10000,true),("maya",10000,true)] {
            let (l, part, requests) = audited(culture, population, river);
            let index = super::super::building_sites::BuildingSiteIndex::prepare(std::slice::from_ref(&l), std::slice::from_ref(&part), &[0]).unwrap();
            let fast = super::super::building_sites::previewed_parcels(&index, "fill3", std::slice::from_ref(&l), std::slice::from_ref(&part), None).unwrap();
            let slow: Vec<String> = requests.iter().filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty()))
                .filter_map(|r| r["parcel_id"].as_str().map(str::to_owned)).collect();
            println!("{culture}: {} previews of {} requests", slow.len(), requests.len());
            assert_eq!(fast, slow, "{culture}");
            // The lazy form used by `finish` answers the same, lot by lot.
            let lazy = super::super::building_sites::SitePreviews::new(&index, "fill3", std::slice::from_ref(&l), std::slice::from_ref(&part)).unwrap();
            for p in &part.parcels {
                assert_eq!(lazy.previewed(&p.id), fast.contains(&p.id), "{culture}: {}", p.id);
            }
        }
    }

    fn layout(streets: serde_json::Value) -> Layout {
        serde_json::from_value(json!({"key":"trim", "culture":"european-organic",
            "center":{"x":0.,"y":0.},"quarters":[],"blocks":[],"streets":streets,"warnings":[]})).unwrap()
    }

    #[test]
    fn dead_end_chains_and_empty_loops_are_pruned_back_to_occupied_frontage() {
        let mut l = layout(json!([
            {"path":[{"x":-100.,"y":0.},{"x":200.,"y":0.}],"widths":[6.,6.],"rank":1,"role":"road"},
            {"path":[{"x":0.,"y":0.},{"x":0.,"y":100.},{"x":80.,"y":100.},{"x":80.,"y":200.}],"widths":[4.],"rank":3,"role":"lane"},
            {"path":[{"x":80.,"y":100.},{"x":160.,"y":100.}],"widths":[2.],"rank":3,"role":"derb"},
            {"path":[{"x":0.,"y":60.},{"x":-50.,"y":60.},{"x":-50.,"y":110.},{"x":0.,"y":110.},{"x":0.,"y":60.}],"widths":[4.],"rank":3,"role":"lane"}
        ]));
        let road = serde_json::to_value(&l.streets[0]).unwrap();
        prune(&mut l, &[], &[g::rectangle(3., 1., 18., 20.)]);
        assert_eq!(serde_json::to_value(&l.streets[0]).unwrap(), road);
        assert!(l.streets.iter().skip(1).flat_map(|s| &s.path).all(|p| p.y <= 30.), "empty chains remain: {:?}", l.streets);
        assert!(l.streets.iter().skip(1).any(|s| s.path.iter().any(|p|p.y>=20.)), "occupied frontage lost");
    }

    #[test]
    fn an_unbuilt_connection_between_two_built_places_is_kept() {
        let mut l = layout(json!([
            {"path":[{"x":0.,"y":0.},{"x":0.,"y":30.}],"widths":[4.],"rank":2,"role":"street"},
            {"path":[{"x":0.,"y":30.},{"x":0.,"y":150.},{"x":130.,"y":150.}],"widths":[4.],"rank":2,"role":"street"},
            {"path":[{"x":130.,"y":150.},{"x":160.,"y":150.}],"widths":[4.],"rank":2,"role":"street"}
        ]));
        prune(&mut l, &[], &[g::rectangle(3., 0., 20., 20.),g::rectangle(140., 153., 160., 170.)]);
        assert!(l.streets.iter().any(|s| s.path.iter().any(|p|p.y==150. && p.x==0.)));
        assert!(l.streets.iter().any(|s| s.path.iter().any(|p|p.x==160.)));
        assert!(l.streets.iter().any(|s| s.role == "track"));
        assert!(l.streets.iter().filter(|s|s.role == "track").all(|s|s.rank == 4 && s.widths.iter().all(|&w|w <= 2.)));
    }

    #[test]
    fn field_access_is_kept_as_a_path_but_empty_local_branches_go() {
        let mut l = layout(json!([
            {"path":[{"x":0.,"y":0.},{"x":100.,"y":0.}],"widths":[6.],"rank":2,"role":"outbound"},
            {"path":[{"x":50.,"y":0.},{"x":50.,"y":80.}],"widths":[4.],"rank":3,"role":"lane"}
        ]));
        prune(&mut l, &[], &[g::rectangle(0.,3.,20.,20.)]);
        assert!(l.streets.iter().all(|s|s.role != "lane"));
        assert!(l.streets.iter().any(|s|s.role == "track" && s.path.last().unwrap().x == 100.));
        assert!(l.streets.iter().filter(|s|s.role == "track").all(|s|s.widths.iter().all(|&w|w <= 2.)));
        assert!(l.streets.iter().any(|s|s.role == "outbound"));
    }

    #[test]
    fn nearby_ends_do_not_hold_each_others_empty_chains() {
        let mut l = layout(json!([
            {"path":[{"x":-100.,"y":0.},{"x":200.,"y":0.}],"widths":[6.],"rank":1,"role":"road"},
            {"path":[{"x":0.,"y":0.},{"x":0.,"y":100.}],"widths":[6.],"rank":2,"role":"street"},
            {"path":[{"x":4.2,"y":0.},{"x":4.2,"y":100.}],"widths":[4.],"rank":2,"role":"street"}
        ]));
        prune(&mut l, &[], &[g::rectangle(-20., 1., -3., 20.)]);
        assert!(l.streets.iter().skip(1).flat_map(|s|&s.path).all(|p|p.y<=30.), "mutually supported empty ends: {:?}",l.streets);
    }
}
