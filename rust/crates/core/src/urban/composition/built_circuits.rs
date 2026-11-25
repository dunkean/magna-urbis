//! Enclosure adjustment to occupied blocks and built lots.

use super::*;

/// A house stands within a few metres of a street, so only the strip of a block
/// along a street is built land: the deep back of a big block (gardens, an empty
/// field behind the first lots) is not.
const FRONT_REACH: f64 = 35.0;
/// Blocks smaller than this (m²) are built whole: their back is not worth a cut.
const BIG_BLOCK: f64 = 2_500.0;

/// Longest stretch (m) of a street ribbon built in one piece: a long road is cut
/// into chunks so that a block only meets the chunks near it.
const RIBBON_CHUNK: f64 = 250.0;

/// Land within `FRONT_REACH` of a street: the ribbons of the streets, not
/// merged, with a grid of their boxes. The union of the ribbons that meet one
/// block is all that block needs (`built_part`), so no operand spans the town.
struct StreetReach { ribbons: Vec<Shape>, grid: g::BoxGrid }

/// The ribbon of one street path in chunks of about `RIBBON_CHUNK` m. A chunk
/// boundary carries the same 12-sided disc that `ribbon` puts on an interior join.
fn street_ribbons(path: &[Point]) -> Vec<Shape> {
    let widths = |n: usize| vec![2.0 * FRONT_REACH; n];
    let join = |c: &Point| Shape {
        outer: (0..12).map(|k| { let a = k as f64 * std::f64::consts::TAU / 12.0; Point { x: c.x + FRONT_REACH * a.cos(), y: c.y + FRONT_REACH * a.sin() } }).collect(),
        holes: vec![],
    };
    let mut out = vec![];
    let (mut from, mut run) = (0, 0.0);
    for i in 1..path.len() {
        run += (path[i].x - path[i - 1].x).hypot(path[i].y - path[i - 1].y);
        if run >= RIBBON_CHUNK && i + 1 < path.len() {
            out.extend(g::ribbon(&path[from..=i], &widths(i + 1 - from)));
            out.push(join(&path[i]));
            (from, run) = (i, 0.0);
        }
    }
    out.extend(g::ribbon(&path[from..], &widths(path.len() - from)));
    out
}

fn street_reach(layout: &super::super::Layout) -> StreetReach {
    // One ribbon per street; `ribbon` already rounds the interior joins and the
    // two ends get a disc so the reach is a true round-capped buffer, as before.
    let cap = |c: &Point| Shape {
        outer: (0..16).map(|k| { let a = k as f64 * std::f64::consts::TAU / 16.0; Point { x: c.x + FRONT_REACH * a.cos(), y: c.y + FRONT_REACH * a.sin() } }).collect(),
        holes: vec![],
    };
    // Per-street ribbons are independent; collected in street order.
    let ribbons: Vec<Shape> = super::super::par::map(&layout.streets, |_, s| {
        if s.path.len() < 2 || s.role == "bridge" { return vec![]; }
        let mut v = street_ribbons(&s.path);
        v.push(cap(&s.path[0]));
        v.push(cap(&s.path[s.path.len() - 1]));
        v
    }).into_iter().flatten().collect();
    StreetReach { grid: g::BoxGrid::new(ribbons.iter().map(g::bbox).collect()), ribbons }
}

/// The built part of a block of kind "block": whole when small or when no street
/// is known, else its strip along the streets: the block clipped to the union of
/// the ribbons that meet its box (a ribbon that does not meet it adds nothing).
fn built_part(shape: &Shape, reach: &StreetReach) -> Vec<Shape> {
    if reach.ribbons.is_empty() || g::area(shape) < BIG_BLOCK { return vec![shape.clone()]; }
    let near: Vec<Shape> = reach.grid.query(g::bbox(shape), 0.0).into_iter().map(|i| reach.ribbons[i].clone()).collect();
    if near.is_empty() { return vec![]; }
    let local = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::union(&near))).unwrap_or_else(|_| near.clone());
    let b = g::bbox(shape);
    local.iter().filter(|r| g::boxes_meet(g::bbox(r), b))
        .flat_map(|r| g::intersection(shape, r)).filter(|s| g::area(s) > 50.0).collect()
}

/// Share of a town circuit that may stay empty in one piece (no building, no
/// declared open space) before the curtain is drawn back to the built town.
/// A culture whose circuits held open land sets its own share
/// (`core.enclosure.open.share` in the catalogue).
pub(super) const VOID_SHARE: f64 = 0.03;
/// Smallest empty piece (m²) that moves a curtain, whatever the circuit size.
pub(super) const VOID_MIN: f64 = 10_000.0;
/// Reach (m) of the built edge kept inside a refitted curtain: a street and the wall lane.
const VOID_MARGIN: f64 = 30.0;
/// Half-widths (m) of the built strips given up with an empty piece, tried in
/// turn; 0 cuts the empty pieces alone.
const ARMS: [f64; 3] = [50.0, 90.0, 0.0];

/// The open land a culture keeps inside its circuits: the role its unbuilt
/// enclosed land takes and the share of a circuit one empty piece may reach
/// (`core.enclosure.open` in the catalogue; gardens and `VOID_SHARE` otherwise).
pub(in crate::urban) fn enclosed_open(culture: &str, population: u32) -> (&'static str, f64) {
    let open = &culture_data(culture, population)["core"]["enclosure"]["open"];
    (open["role"].as_str().filter(|r| r.starts_with("open.")).unwrap_or("open.garden"),
        open["share"].as_f64().filter(|s| (0.0..1.0).contains(s)).unwrap_or(VOID_SHARE))
}

/// Circuits follow the blocks that survived the occupancy trim: a broad land
/// claim is not a defensive perimeter around an empty field or slope.
/// Mountain (terrace) towns refit thin circuits to their blocks, then, like every
/// other town circuit, give back the dry land the allocation left empty
/// (`fit_to_built`). `built_lots`, when the trim's allocation probe ran, are
/// the lots that carry a building. Degenerate circuits (no area) are dropped.
pub(in crate::urban) fn fit_enclosures(layout: &mut super::super::Layout, population: u32, surface: Surface<'_>, built_lots: Option<&[Shape]>) {
    use geo::Buffer;
    layout.enclosures.retain(|e| !e.purpose.is_empty() || e.path.len() < 4
        || g::area(&Shape { outer: e.path.clone(), holes: vec![] }) >= 50.0);
    let cfg = layout.config.clone().unwrap_or_default();
    let profile = profiles::settlement_profile(&layout.culture,population,cfg.phases);
    if !profile.stairs || profile.pattern != "terraces" { return fit_to_built(layout, population, surface, built_lots); }
    // Built land: ordinary blocks and programme reservations, not open commons or fields.
    let reserved: std::collections::HashSet<_> = layout.programme.iter().flat_map(|p|p.reservations.iter()
        .filter(|r|!p.demands.iter().any(|d|d.id==r.demand_id && d.role.starts_with("open.")))).map(|r|r.block).collect();
    let reach = street_reach(layout);
    let kept: Vec<&super::super::Block> = layout.blocks.iter().enumerate()
        .filter(|(i,b)|matches!(b.kind.as_str(),"block"|"place") || reserved.contains(i)).map(|(_,b)|b).collect();
    // Per-block clips are independent: in parallel, flattened in block order.
    let occupied: Vec<_> = super::super::par::map(&kept, |_, b| if b.kind == "block" { built_part(&b.shape,&reach) } else { vec![b.shape.clone()] })
        .into_iter().flatten().collect();
    let mut result = vec![];
    for e in &layout.enclosures {
        if !e.purpose.is_empty() { result.push(e.clone());continue; }
        let old = Shape {outer:e.path.clone(),holes:vec![]};
        // Blocks wholly inside or outside the circuit are decided without an overlay.
        let region = g::Region::new(vec![old.clone()]);
        let land: Vec<_> = super::super::par::map(&occupied, |_, s| region.clip(s)).into_iter().flatten().filter(|s|g::area(s)>50.).collect();
        // A circuit around no built land (an open field, a strip) is not raised.
        if land.is_empty() { continue; }
        if land.iter().map(g::area).sum::<f64>() >= g::area(&old)*0.35 {
            result.push(e.clone());continue;
        }
        let margin: Vec<_> = super::super::par::map(&land, |_, s| g::shapes(g::polygon(s).buffer(18.))).into_iter().flatten().collect();
        let fitted: Vec<_> = union(&margin).iter().flat_map(|s|g::intersection(s,&old))
            .flat_map(|s|g::dry_clip(&surface,&s)).filter(|s|g::area(s)>5000.)
            .filter(|s|land.iter().any(|b|g::contains(s,g::interior_point(b)))).collect();
        if fitted.is_empty() { result.push(e.clone());continue; }
        for shape in fitted {
            let trace = fortification::hill_trace(&shape,surface.width/surface.n.max(1) as f64);
            let mut path = trace.outer;
            path.push(path[0]);
            if result.iter().any(|e:&Enclosure| e.path==path) {continue;}
            result.push(Enclosure {gates:gates(&path,&layout.streets),path,kind:e.kind.clone(),..Default::default()});
        }
    }
    layout.enclosures = result;
    // The same invariant as every town circuit: a big empty piece beside the town is given back.
    fit_to_built(layout, population, surface, built_lots);
}

/// The town circuits against the lots that show a building on the final
/// cadastre (`trim::finish`): the same invariant as `fit_to_built`, once more
/// when the last pruning left a circuit round land nobody builds on.
pub(in crate::urban) fn fit_built_circuits(layout: &mut super::super::Layout, population: u32, surface: Surface<'_>, built_lots: &[Shape]) {
    fit_to_built(layout, population, surface, Some(built_lots));
}

/// Longest refitted curtain, as a share of the circuit it replaces.
const MAX_REFIT_GROWTH: f64 = 1.05;
/// Farthest (m) a wall walk runs from its curtain.
const WALK_REACH: f64 = 25.0;
/// Widest out-and-back run (m) of a refitted curtain that is a sliver of the
/// cut (the straightened front beside the old trace), not a wall.
const SLIVER: f64 = 5.0;
/// Half-width (m) under which a long tongue of a refitted circuit is a
/// leftover of the cut, and smallest such tongue (m²): the corners of the
/// kept curtain, which the same opening rounds off, stay.
const FINGER: (f64, f64) = (12.0, 500.0);

/// The piece of a cut circuit without its long thin tongues (a wedge left
/// between the straightened front and the old trace): no wall runs out and
/// back round a strip a few metres wide.
fn without_fingers(piece: Shape) -> Shape {
    use geo::{Area, BooleanOps, Buffer, MultiPolygon};
    let whole = g::polygon(&piece);
    let trimmed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let core = whole.buffer(-FINGER.0).buffer(FINGER.0 + 0.5);
        let fingers: Vec<_> = whole.difference(&core).0.into_iter().filter(|f| f.unsigned_area() >= FINGER.1).collect();
        if fingers.is_empty() { return None; }
        g::shapes(whole.difference(&MultiPolygon(fingers).buffer(0.5))).into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
    })).ok().flatten();
    trimmed.unwrap_or(piece)
}

/// The empty pieces of a circuit with the thin built strips they hold against
/// the curtain. The town inside `town` without `empty` is opened by `arm`: what
/// the opening removes is narrower than twice `arm` (a row of houses along the
/// wall walk, a lone house in a field). Such a strip goes with the empty land
/// when it lies along it more than along the body of the town; a narrow built
/// end of the town, which touches no empty piece, stays.
fn voids_with_arms(town: &geo::Polygon<f64>, empty: &geo::MultiPolygon<f64>, arm: f64) -> geo::MultiPolygon<f64> {
    use geo::{Area, BooleanOps, Buffer, MultiPolygon};
    if arm <= 0.0 { return empty.clone(); }
    let body = town.difference(empty);
    let thick = body.buffer(-arm).buffer(arm);
    let mut given = empty.0.clone();
    for strip in body.difference(&thick).0 {
        if strip.unsigned_area() < 50.0 { continue; }
        let edge = strip.buffer(3.0);
        if edge.intersection(empty).unsigned_area() > edge.intersection(&thick).unsigned_area() {
            given.push(strip);
        }
    }
    // One metre joins each strip to the empty piece it lies along.
    MultiPolygon(given).buffer(1.0).intersection(town)
}

/// Side of the square tiles `buffered` splits its shapes into.
const BUFFER_TILE: f64 = 250.0;

/// The union of `shapes` grown by `margin`. One buffer over thousands of lots
/// is one huge overlay: the shapes are grown per tile (by bbox centre) in
/// parallel, then the tiles are joined pairwise, neighbours first. `None` when
/// the geometry kernel panics.
fn buffered(shapes: &[Shape], margin: f64) -> Option<geo::MultiPolygon<f64>> {
    use geo::{BooleanOps, Buffer, MultiPolygon};
    let grow = |v: &[&Shape]| std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
        MultiPolygon(v.iter().map(|s| g::polygon(s)).collect()).buffer(margin))).ok();
    let mut tiles: std::collections::BTreeMap<(i64, i64), Vec<&Shape>> = Default::default();
    for s in shapes {
        let (x0, y0, x1, y1) = g::bbox(s);
        tiles.entry((((y0 + y1) * 0.5 / BUFFER_TILE).floor() as i64, ((x0 + x1) * 0.5 / BUFFER_TILE).floor() as i64)).or_default().push(s);
    }
    let tiles: Vec<Vec<&Shape>> = tiles.into_values().collect();
    if tiles.len() < 2 { return grow(&tiles.into_iter().flatten().collect::<Vec<_>>()); }
    let mut parts: Vec<MultiPolygon<f64>> = super::super::par::map(&tiles, |_, v| grow(v)).into_iter().collect::<Option<_>>()?;
    while parts.len() > 1 {
        let pairs: Vec<&[MultiPolygon<f64>]> = parts.chunks(2).collect();
        parts = super::super::par::map(&pairs, |_, p| if p.len() == 2 {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p[0].union(&p[1]))).ok()
        } else { Some(p[0].clone()) }).into_iter().collect::<Option<_>>()?;
    }
    parts.pop()
}

/// Reach (m) that `buffered(_, VOID_MARGIN)` is sure to cover round each of
/// its shapes: its round joins are polygons inscribed in the arc (0.2 rad
/// steps, so radius × cos 0.1), less a metre for the overlay's snapping grid.
const VOID_HELD: f64 = VOID_MARGIN * 0.995 - 1.0;
/// Most cells of the raster that bounds the empty land of one circuit.
const VOID_CELLS: f64 = 16.0e6;

/// Whether the land of the circuit `old` farther than `VOID_MARGIN` from
/// every shape of `held` may hold one piece of `floor` m² or more. A raster
/// bound that errs only towards `true`, so that `fit_to_built` runs its
/// overlays of the whole town (`buffered`, then the difference) only for a
/// circuit that may give land back: a dense town proves in a fraction of a
/// second that its wall stays where it is.
///
/// A grid cell is held when every point of it lies within `VOID_HELD` of a
/// point of a held shape (a seed cell holds a point of the shape; a cell is
/// held by a seed cell whose centre lies within `VOID_HELD / cell - √2`
/// cells of its own). Every other cell that meets the circuit counts whole,
/// water included; one empty piece is connected, so it lies within one
/// 8-connected group of such cells, whose area bounds it. `held` must be
/// shapes that the overlay grows (a subset is fine: fewer seeds only weaken
/// the bound); a shape that is not a simple polygon of positive area seeds
/// nothing.
pub(super) fn may_hold_void(old: &Shape, held: &[&Shape], floor: f64) -> bool {
    let (x0, y0, x1, y1) = g::bbox(old);
    let (w, h) = (x1 - x0, y1 - y0);
    if !(w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 && old.outer.len() >= 3) { return true; }
    let c = (w * h / VOID_CELLS).sqrt().max(2.0);
    // Holding radius in cells, centre to centre.
    let r = VOID_HELD / c - std::f64::consts::SQRT_2;
    if r < 2.0 { return true; }
    let cap = r.floor() as usize + 1;
    let m = cap + 1;
    let (ox, oy) = (x0 - m as f64 * c, y0 - m as f64 * c);
    let nx = (w / c).ceil() as usize + 2 * m + 1;
    let ny = (h / c).ceil() as usize + 2 * m + 1;
    let at = |p: Point| -> Option<usize> {
        let (i, j) = (((p.x - ox) / c).floor(), ((p.y - oy) / c).floor());
        (i >= 0.0 && j >= 0.0 && (i as usize) < nx && (j as usize) < ny).then(|| j as usize * nx + i as usize)
    };
    // Seed cells: points of the outlines every half cell, and the cells whose centre lies inside.
    let seeds: Vec<Vec<usize>> = super::super::par::map(held, |_, s| {
        let mut cells = vec![];
        if !(g::area(s) > 1.0 && g::simple(s)) { return cells; }
        for ring in std::iter::once(&s.outer).chain(&s.holes) {
            for k in 0..ring.len() {
                let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
                let n = ((b.x - a.x).hypot(b.y - a.y) / (0.5 * c)).ceil().max(1.0) as usize;
                for t in 0..n {
                    let t = t as f64 / n as f64;
                    cells.extend(at(Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
                }
            }
        }
        let (sx0, sy0, sx1, sy1) = g::bbox(s);
        let span = |lo: f64, hi: f64, o: f64, n: usize| {
            let a = ((lo - o) / c - 0.5).ceil().max(0.0) as usize;
            let b = ((hi - o) / c - 0.5).floor();
            (a, if b < 0.0 { None } else { Some((b as usize).min(n - 1)) })
        };
        let ((i0, i1), (j0, j1)) = (span(sx0, sx1, ox, nx), span(sy0, sy1, oy, ny));
        if let (Some(i1), Some(j1)) = (i1, j1) {
            for j in j0..=j1 {
                for i in i0..=i1 {
                    if g::contains(s, Point { x: ox + (i as f64 + 0.5) * c, y: oy + (j as f64 + 0.5) * c }) { cells.push(j * nx + i); }
                }
            }
        }
        cells
    });
    let mut seed = vec![false; nx * ny];
    for i in seeds.into_iter().flatten() { seed[i] = true; }
    // Per row, the distance (cells, capped) to the nearest seed of that row.
    let rows: Vec<Vec<u8>> = super::super::par::range(ny, |j| {
        let row = &seed[j * nx..(j + 1) * nx];
        let mut d = vec![cap as u8; nx];
        let mut last: Option<usize> = None;
        for i in 0..nx {
            if row[i] { last = Some(i); }
            if let Some(l) = last { d[i] = (i - l).min(cap) as u8; }
        }
        last = None;
        for i in (0..nx).rev() {
            if row[i] { last = Some(i); }
            if let Some(l) = last { d[i] = d[i].min((l - i).min(cap) as u8); }
        }
        d
    });
    drop(seed);
    // The circuit's boundary cells and their neighbours: a cell that meets the
    // circuit has its centre inside or is crossed by the outline.
    let mut edge = vec![false; nx * ny];
    for k in 0..old.outer.len() {
        let (a, b) = (old.outer[k], old.outer[(k + 1) % old.outer.len()]);
        let n = ((b.x - a.x).hypot(b.y - a.y) / (0.5 * c)).ceil().max(1.0) as usize;
        for t in 0..=n {
            let t = t as f64 / n as f64;
            let p = Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            let (i, j) = (((p.x - ox) / c).floor() as i64, ((p.y - oy) / c).floor() as i64);
            for (di, dj) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
                let (i, j) = (i + di, j + dj);
                if i >= 0 && j >= 0 && (i as usize) < nx && (j as usize) < ny { edge[j as usize * nx + i as usize] = true; }
            }
        }
    }
    let r2 = r * r;
    let open: Vec<Vec<bool>> = super::super::par::range(ny, |j| {
        let y = oy + (j as f64 + 0.5) * c;
        let mut xs: Vec<f64> = old.outer.iter().zip(old.outer.iter().cycle().skip(1)).take(old.outer.len())
            .filter(|(a, b)| (a.y > y) != (b.y > y))
            .map(|(a, b)| (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x).collect();
        xs.sort_by(f64::total_cmp);
        let mut inside = vec![false; nx];
        for pair in xs.chunks_exact(2) {
            let a = ((pair[0] - ox) / c - 0.5).ceil().max(0.0) as usize;
            let b = ((pair[1] - ox) / c - 0.5).floor();
            if b < 0.0 { continue; }
            for v in inside.iter_mut().take((b as usize).min(nx - 1) + 1).skip(a) { *v = true; }
        }
        (0..nx).map(|i| {
            if !(inside[i] || edge[j * nx + i]) { return false; }
            let covered = (j.saturating_sub(cap)..(j + cap + 1).min(ny)).any(|k| {
                let (dx, dy) = (f64::from(rows[k][i]), j.abs_diff(k) as f64);
                rows[k][i] < cap as u8 && dx * dx + dy * dy <= r2
            });
            !covered
        }).collect()
    });
    drop(rows);
    drop(edge);
    // 8-connected groups of open cells, by area.
    let mut open: Vec<bool> = open.into_iter().flatten().collect();
    let most = (floor / (c * c)).ceil() as usize;
    let mut stack = vec![];
    for start in 0..open.len() {
        if !open[start] { continue; }
        open[start] = false;
        stack.push(start);
        let mut count = 0usize;
        while let Some(k) = stack.pop() {
            count += 1;
            if count >= most { return true; }
            let (i, j) = ((k % nx) as i64, (k / nx) as i64);
            for (di, dj) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
                let (i, j) = (i + di, j + dj);
                if i < 0 || j < 0 || i as usize >= nx || j as usize >= ny { continue; }
                let q = j as usize * nx + i as usize;
                if open[q] { open[q] = false; stack.push(q); }
            }
        }
    }
    false
}

/// A town circuit holds its town: dry land more than `VOID_MARGIN` from any
/// built lot, place or programme reservation (open spaces included) is
/// empty; empty pieces of at least `max(share × circuit, VOID_MIN)` are
/// cut out, with the thin built strips they hold against the curtain
/// (`voids_with_arms`), and the curtain is retraced round what is left: the
/// houses of such a strip stand outside the wall. Water is never empty land,
/// so a circuit keeps its river crossings. The refitted circuit carries no
/// works yet: `fortification::settle` builds it.
///
/// With `built_lots` (the allocation probe of the trim), an ordinary block
/// counts by its built lots only, each by its strip along the streets when it
/// is big (a house lot merged with its back land is not built to its far
/// end): a block that holds a house or two and empty housing plots does not
/// hold the curtain out round its empty land. Without them, an ordinary block
/// counts whole (its street strip when big).
fn fit_to_built(layout: &mut super::super::Layout, population: u32, surface: Surface<'_>, built_lots: Option<&[Shape]>) {
    use geo::{BooleanOps, MultiPolygon};
    if !layout.enclosures.iter().any(|e| e.purpose.is_empty() && e.path.len() >= 4) { return; }
    let share = enclosed_open(&layout.culture, population).1;
    let reserved: std::collections::HashSet<_> = layout.programme.iter().flat_map(|p| p.reservations.iter().map(|r| r.block)).collect();
    let mut laps = super::super::profile::Lap::new("fit");
    let kept: Vec<(bool, &super::super::Block)> = layout.blocks.iter().enumerate()
        .filter(|(i, b)| matches!(b.kind.as_str(), "block" | "place") || reserved.contains(i))
        .map(|(i, b)| (reserved.contains(&i), b)).collect();
    // First the circuits that may give land back (`may_hold_void`), from the
    // shapes the overlay below grows whole whatever the streets: places,
    // reservations, and the blocks or lots under `BIG_BLOCK` (`built_part`
    // keeps those whole). A circuit proven full keeps its trace, exactly as
    // the overlay would decide, without the street reach or the overlay.
    let whole: Vec<(&Shape, (f64, f64, f64, f64))> = kept.iter()
        .filter(|(held, b)| b.kind != "block" || *held || built_lots.is_none() && g::area(&b.shape) < BIG_BLOCK)
        .map(|(_, b)| &b.shape)
        .chain(built_lots.unwrap_or_default().iter().filter(|lot| g::area(lot) < BIG_BLOCK))
        .map(|s| (s, g::bbox(s))).collect();
    let open: Vec<bool> = layout.enclosures.iter().map(|e| e.purpose.is_empty() && e.path.len() >= 4 && {
        let old = g::normalized(Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] });
        let (x0, y0, x1, y1) = g::bbox(&old);
        let held: Vec<&Shape> = whole.iter().filter(|(_, b)| b.0 <= x1 && b.2 >= x0 && b.1 <= y1 && b.3 >= y0).map(|(s, _)| *s).collect();
        may_hold_void(&old, &held, (share * g::area(&old)).max(VOID_MIN))
    }).collect();
    drop(whole);
    laps.lap("void_bound");
    if !open.contains(&true) { return; }
    let reach = street_reach(layout);
    laps.lap("street_reach");
    // Per-block and per-lot clips are independent: in parallel, flattened in input order.
    let occupied: Vec<(Shape, (f64, f64, f64, f64))> = super::super::par::map(&kept, |_, &(held, b)|
            if b.kind != "block" || held { vec![b.shape.clone()] }
            else if built_lots.is_some() { vec![] }
            else { built_part(&b.shape, &reach) })
        .into_iter().flatten()
        .chain(super::super::par::map(built_lots.unwrap_or_default(), |_, lot| built_part(lot, &reach)).into_iter().flatten())
        .map(|s| { let bb = g::bbox(&s); (s, bb) }).collect();
    let safe = |f: &dyn Fn() -> MultiPolygon<f64>| std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok();
    let mp = |v: &[Shape]| MultiPolygon(v.iter().map(g::polygon).collect());
    let mut result = Vec::with_capacity(layout.enclosures.len());
    let mut refitted = false;
    // A refitted front obeys the rule of the first trace (dry land, wall walk, harbour side); the
    // water gates of the circuit keep their place.
    let harbour = harbour_fronts(layout);
    laps.lap("occupied");
    for (e, open) in std::mem::take(&mut layout.enclosures).into_iter().zip(open) {
        if !open { result.push(e); continue; }
        let old = g::normalized(Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] });
        let (area, (x0, y0, x1, y1)) = (g::area(&old), g::bbox(&old));
        let near: Vec<Shape> = occupied.iter().filter(|(_, b)| b.0 <= x1 && b.2 >= x0 && b.1 <= y1 && b.3 >= y0)
            .map(|(s, _)| s.clone()).collect();
        laps.lap("near");
        let Some(reach) = buffered(&near, VOID_MARGIN) else { result.push(e); continue; };
        laps.lap("buffer");
        let dry = mp(&g::dry_clip(&surface, &old));
        laps.lap("dry_clip");
        let Some(empty) = safe(&|| dry.difference(&reach)) else { result.push(e); continue; };
        laps.lap("difference");
        let floor = (share * area).max(VOID_MIN);
        let big = MultiPolygon(g::shapes(empty).iter().filter(|s| g::area(s) >= floor).map(g::polygon).collect());
        if big.0.is_empty() { result.push(e); continue; }
        // A circuit round no built land at all is not raised.
        if near.iter().all(|s| g::intersection(s, &old).is_empty()) { continue; }
        let town = g::polygon(&old);
        // The first cut whose curtain holds built land and does not grow.
        let mut fitted: Option<Vec<Vec<Point>>> = None;
        for arm in ARMS {
            let Some(given) = safe(&|| voids_with_arms(&town, &big, arm)) else { continue };
            // The new front runs in straight stretches (10 m tolerance, within the margin).
            let void: Vec<Shape> = g::shapes(given).into_iter().filter(|s| g::area(s) >= floor)
                .map(|s| { let mut r = g::simplify(&closed(&s.outer), 10.0, |_| false); r.pop(); g::normalized(Shape { outer: r, holes: vec![] }) })
                .filter(|s| s.outer.len() >= 3 && g::simple(s)).collect();
            if void.is_empty() { continue; }
            let Some(kept) = safe(&|| town.difference(&mp(&void))) else { continue };
            let mut refit = vec![];
            for piece in g::shapes(kept) {
                if g::area(&piece) < floor || !near.iter().any(|s| g::contains(&piece, g::interior_point(s))) { continue; }
                let piece = without_fingers(piece);
                // The kept curtain stays where it was; only the cut is new.
                // Out-and-back runs (the old trace along a bank, a sliver left
                // between the straightened front and the old trace) are dropped here.
                let mut ring = g::simplify(&closed(&g::unneedled(&g::cleaned(&piece).outer, SLIVER)), 1.0, |_| false);
                ring.pop();
                let plain = g::normalized(Shape { outer: g::unneedled(&ring, SLIVER), holes: vec![] });
                let trace = if g::simple(&plain) { plain } else { fortification::curtain_trace(&Shape { outer: piece.outer, holes: vec![] }) };
                if trace.outer.len() < 3 || !g::simple(&trace) { refit.clear(); break; }
                refit.push(closed(&trace.outer));
            }
            // A curtain that gives land back never grows: tracing round thin arms of houses
            // would raise a longer, tentacled wall (review 04/11, giant-hold 10k).
            if refit.is_empty() || refit.iter().map(|p| length(p)).sum::<f64>() > MAX_REFIT_GROWTH * length(&e.path) { continue; }
            fitted = Some(refit);
            break;
        }
        laps.lap("refit");
        let Some(refit) = fitted else { result.push(e); continue; };
        refitted = true;
        let rings: Vec<Shape> = refit.into_iter().map(|path| Shape { outer: path[..path.len() - 1].to_vec(), holes: vec![] }).collect();
        for ring in fortification::kept_fronts(rings, &near, &harbour, surface, e.curtain_width_m - fortification::ribbon_half(&e.kind)) {
            let path = closed(&ring.outer);
            result.push(Enclosure { gates: gates(&path, &layout.streets), path, kind: e.kind.clone(), ..Default::default() });
        }
    }
    layout.enclosures = result;
    if !refitted { return; }
    // The wall walk of a curtain that was drawn back is an ordinary lane where
    // it no longer runs along a curtain: it opens a gate where it crosses the
    // new front, and serves lots or goes like any other lane.
    let curtains: Vec<fortification::Near> = layout.enclosures.iter().filter(|e| e.path.len() >= 2).map(|e| fortification::Near::new(&e.path, 40.0)).collect();
    let paths: Vec<&[Point]> = layout.enclosures.iter().filter(|e| e.path.len() >= 2).map(|e| e.path.as_slice()).collect();
    for s in layout.streets.iter_mut().filter(|s| s.role == "wall-lane") {
        let along = s.path.iter().all(|&p| curtains.iter().zip(&paths).any(|(near, path)|
            near.crossed(p, p).into_iter().any(|k| g::distance(p, path[k], path[k + 1]).0 <= WALK_REACH)));
        if !along { s.role = "lane".into(); }
    }
}
