//! Quarter boundaries and streets inside town enclosures.

use super::*;

/// Split every quarter along a closed line, so no tissue street crosses it.
pub(super) fn partition(quarters: &mut Vec<Quarter>, regions: &[Shape]) {
    if regions.is_empty() {
        return;
    }
    let mut out = vec![];
    for q in quarters.drain(..) {
        let mut outside = vec![q.shape.clone()];
        for r in regions {
            out.extend(
                g::intersection(&q.shape, r)
                    .into_iter()
                    .filter(|s| g::area(s) > 1.0)
                    .map(|shape| Quarter {
                        shape,
                        phase: q.phase,
                        zone: q.zone.clone(),
                    }),
            );
            outside = outside.iter().flat_map(|s| g::difference(s, r)).collect();
        }
        out.extend(
            outside
                .into_iter()
                .filter(|s| g::area(s) > 1.0)
                .map(|shape| Quarter {
                    shape,
                    phase: q.phase,
                    zone: q.zone.clone(),
                }),
        );
    }
    *quarters = out;
}
/// Boxes `a` and `b` overlap or touch, within `margin`.
fn boxes_meet(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), margin: f64) -> bool {
    a.0 <= b.2 + margin && b.0 <= a.2 + margin && a.1 <= b.3 + margin && b.1 <= a.3 + margin
}
/// Straight curtains can leave narrow dry strips beyond the growth outline.
/// Give that land to an adjoining quarter; the later ribbons cut the ring road.
/// Returns the dry gaps no quarter could take (cut off by a street).
pub(super) fn fit_enclosed_quarters(quarters: &mut [Quarter], walls: &[Shape], streets: &[Street], surface: Surface<'_>) -> Vec<Shape> {
    if walls.is_empty() {
        return vec![];
    }
    use geo::Intersects;
    let occupied = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let mut gaps = walls.to_vec();
    for shape in &occupied {
        gaps = gaps.iter().flat_map(|s| g::difference(s, shape)).collect();
    }
    // Separate the strips at real roads, so a belt cannot all join one ward.
    // Only the ribbons crossing a gap are cut (a large town has many streets,
    // and a belt along a whole circuit has the town's box).
    let mut boxes: Vec<_> = gaps.iter().map(|s| (g::bbox(s), g::polygon(s))).collect();
    for st in streets {
        for ribbon in g::ribbon(&st.path, &st.widths) {
            let b = g::bbox(&ribbon);
            if !boxes.iter().any(|(gb, _)| boxes_meet(*gb, b, 0.0)) {
                continue;
            }
            let rp = g::polygon(&ribbon);
            let hit: Vec<bool> = boxes.iter().map(|(gb, gp)| boxes_meet(*gb, b, 0.0) && gp.intersects(&rp)).collect();
            if !hit.contains(&true) {
                continue;
            }
            gaps = gaps.iter().zip(&hit)
                .flat_map(|(s, &h)| if h { g::difference(s, &ribbon) } else { vec![s.clone()] })
                .collect();
            boxes = gaps.iter().map(|s| (g::bbox(s), g::polygon(s))).collect();
        }
    }
    // The gap shares a stretch of the quarter's outline (a vertex of the gap
    // lies on one of its rings): only then can they join in one piece.
    let adjoins = |q: &Shape, gap: &Shape| {
        let (x0, y0, x1, y1) = g::bbox(q);
        gap.outer.iter().chain(gap.holes.iter().flatten())
            .filter(|p| p.x >= x0 - 0.5 && p.x <= x1 + 0.5 && p.y >= y0 - 0.5 && p.y <= y1 + 0.5)
            .any(|&p| std::iter::once(&q.outer).chain(&q.holes).any(|r| {
                let n = r.len();
                (0..n).any(|i| g::distance(p, r[i], r[(i + 1) % n]).0 < 0.5)
            }))
    };
    let mut left = vec![];
    for gap in gaps.iter().flat_map(|s| g::dry_clip(&surface, s)) {
        let mut best = None;
        let reach = g::bbox(&gap);
        for (i, q) in quarters.iter().enumerate() {
            // A quarter clear of the gap cannot join it in one piece.
            if !boxes_meet(g::bbox(&q.shape), reach, 0.5) || !adjoins(&q.shape, &gap) {
                continue;
            }
            let merged = g::union(&[q.shape.clone(), gap.clone()]);
            if merged.len() != 1 { continue; }
            let added = g::area(&merged[0]) - g::area(&q.shape);
            if added < g::area(&gap) * 0.99 { continue; }
            let center = g::centroid(&q.shape);
            let c = g::centroid(&gap);
            let score = (center.x - c.x).hypot(center.y - c.y);
            if best.as_ref().is_none_or(|(_, _, old)| score < *old) {
                best = Some((i, merged.into_iter().next().unwrap(), score));
            }
        }
        match best {
            Some((i, shape, _)) => quarters[i].shape = shape,
            None => left.push(gap),
        }
    }
    left
}
/// The curtain is a rectangle: it fills most of its own tightest rectangle (a
/// corner given back to the water still counts).
pub(super) fn rectangular(wall: &Shape) -> bool {
    use geo::MinimumRotatedRect;
    g::polygon(wall).minimum_rotated_rect().is_some_and(|r| {
        let tight = g::area(&g::shapes(geo::MultiPolygon(vec![r]))[0]);
        tight > 0.0 && g::area(wall) >= 0.85 * tight
    })
}
/// Frame of a planned street grid: the length-weighted mean direction of the
/// quarter edges modulo a right angle, in (-45°, 45°]. `None` when the edges
/// share no dominant pair of axes (an organic plan).
pub(super) fn grid_frame(quarters: &[Quarter]) -> Option<f64> {
    let (mut c, mut s, mut total) = (0.0, 0.0, 0.0);
    for q in quarters {
        let n = q.shape.outer.len();
        for i in 0..n {
            let (a, b) = (q.shape.outer[i], q.shape.outer[(i + 1) % n]);
            let l = (b.x - a.x).hypot(b.y - a.y);
            let t = 4.0 * (b.y - a.y).atan2(b.x - a.x);
            (c, s, total) = (c + l * t.cos(), s + l * t.sin(), total + l);
        }
    }
    (total > 0.0 && c.hypot(s) >= 0.5 * total).then(|| s.atan2(c) / 4.0)
}
/// An enceinte (square or polygonal trace) is walled land, filled to its wall
/// street: every dry gap between the curtain and the quarters joins an
/// adjoining quarter, or becomes a quarter of its own where a street cuts it off
/// from them, and joins the land of the nearest walled epoch. Turned grids,
/// river bends and an irregular founding outline then leave no empty strip or
/// wedge in the walls.
pub(super) fn fill_enclosures(
    quarters: &mut Vec<Quarter>,
    phases: &mut [GrowthPhase],
    walls: &[Shape],
    walled: usize,
    streets: &[Street],
    surface: Surface<'_>,
) {
    if walls.is_empty() {
        return;
    }
    let before = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let left = fit_enclosed_quarters(quarters, walls, streets, surface);
    // Narrow slivers (under ~6 m across) stay with the wall street.
    let wide = |s: &Shape| {
        let n = s.outer.len();
        let perimeter: f64 = (0..n).map(|i| {
            let (a, b) = (s.outer[i], s.outer[(i + 1) % n]);
            (b.x - a.x).hypot(b.y - a.y)
        }).sum();
        let a = g::area(s);
        a >= 800.0 && 2.0 * a >= 6.0 * perimeter
    };
    let added: Vec<Shape> = left.into_iter().filter(|s| wide(s)).collect();
    // Epoch of a piece of land: the nearest walled epoch.
    let epochs = walled.min(phases.len());
    let epoch_of = |phases: &[GrowthPhase], p: Point| {
        (0..epochs).filter(|&e| !phases[e].shapes.is_empty()).min_by(|&a, &b| {
            let d = |e: usize| phases[e].shapes.iter().flat_map(|s| s.outer.iter())
                .map(|q| (q.x - p.x).hypot(q.y - p.y)).fold(f64::INFINITY, f64::min);
            d(a).total_cmp(&d(b))
        })
    };
    for shape in &added {
        if let Some(e) = epoch_of(phases, g::interior_point(shape)) {
            quarters.push(Quarter { shape: shape.clone(), phase: e, zone: phases[e].zone.clone() });
        }
    }
    // The land the quarters gained joins its epoch, outside every epoch's own land.
    let mut gained: Vec<Shape> = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    for shape in &before {
        gained = gained.iter().flat_map(|s| g::difference(s, shape)).collect();
    }
    for shape in phases.iter().flat_map(|p| p.shapes.iter()) {
        if !gained.is_empty() {
            gained = gained.iter().flat_map(|s| g::difference(s, shape)).collect();
        }
    }
    for piece in gained.into_iter().filter(|s| g::area(s) > 1.0) {
        if let Some(e) = epoch_of(phases, g::interior_point(&piece)) {
            phases[e].shapes.push(piece);
        }
    }
}

#[test]
fn enclosed_quarters_reach_the_ring_road_without_claiming_water() {
    let mut quarters = vec![Quarter { shape:g::rectangle(20.,20.,80.,80.), phase:0, zone:"core".into() }];
    let wall = g::rectangle(10.,10.,90.,90.);
    let road = Street { path:vec![Point{x:10.,y:50.},Point{x:90.,y:50.}],widths:vec![4.;2],rank:1,role:"street".into() };
    let height = vec![10.;100];
    let water: Vec<_> = (0..100).map(|i|u8::from(i % 10 >= 8)).collect();
    let surface = Surface {geometry:None,width:100.,n:10,height:&height,water:&water, interpolation: Default::default(),};
    fit_enclosed_quarters(&mut quarters, std::slice::from_ref(&wall), std::slice::from_ref(&road), surface);
    let added = g::difference(&quarters[0].shape, &g::rectangle(20.,20.,80.,80.));
    let road = g::rectangle(10.,48.,90.,52.);
    assert!(added.iter().map(g::area).sum::<f64>() > 1000.);
    assert!(added.iter().flat_map(|s|g::intersection(s,&road)).map(|s|g::area(&s)).sum::<f64>() < 0.01);
    assert!(g::difference(&quarters[0].shape,&wall).iter().map(g::area).sum::<f64>() < 0.01);
    assert!((g::area(&quarters[0].shape) - g::dry_clip(&surface,&quarters[0].shape).iter().map(g::area).sum::<f64>()).abs() < 0.01);
}

#[test]
fn rectangular_enclosure_runs_on_its_grid_and_is_filled_to_the_wall() {
    let (height, water) = (vec![10.; 100], vec![0u8; 100]);
    let surface = Surface { geometry: None, width: 1000., n: 10, height: &height, water: &water, interpolation: Default::default() };
    let turn = |a: f64, x: f64, y: f64| Point { x: 500. + x * a.cos() - y * a.sin(), y: 500. + x * a.sin() + y * a.cos() };
    let square = |a: f64, x0: f64, y0: f64, x1: f64, y1: f64| g::normalized(Shape {
        outer: vec![turn(a, x0, y0), turn(a, x1, y0), turn(a, x1, y1), turn(a, x0, y1)], holes: vec![] });
    let axes = |s: &Shape| -> Vec<f64> {
        let n = s.outer.len();
        (0..n).map(|i| { let (a, b) = (s.outer[i], s.outer[(i + 1) % n]);
            (b.y - a.y).atan2(b.x - a.x).to_degrees().rem_euclid(90.0) }).collect()
    };
    // A grid turned 3° from the compass: the cardinal box is tight enough for a
    // cardinal culture, but the circuit now runs on the grid's own axes.
    let a = 3f64.to_radians();
    let outline = square(a, -150., -100., 150., 100.);
    let cardinal = fortification::square_trace(&outline, surface, true, false, None).unwrap();
    assert!(axes(&cardinal).iter().all(|d| d.min(90. - d) < 0.5), "{:?}", axes(&cardinal));
    let quarters: Vec<Quarter> = [(-150., -100.), (0., -100.), (-150., 0.), (0., 0.)].iter()
        .map(|&(x, y)| Quarter { shape: square(a, x, y, x + 150., y + 100.), phase: 0, zone: "core".into() }).collect();
    let grid = grid_frame(&quarters).unwrap();
    assert!((grid.to_degrees() - 3.).abs() < 0.1, "{}", grid.to_degrees());
    let wall = fortification::square_trace(&outline, surface, true, false, Some(grid)).unwrap();
    assert!(axes(&wall).iter().all(|d| (d - 3.).abs() < 0.5), "{:?}", axes(&wall));
    assert!(rectangular(&wall) && g::area(&wall) < 1.05 * g::area(&outline));
    // A 20° grid in a cardinal box (a forced rectangle): the four corner wedges
    // join the town; the one a street cuts off becomes a quarter of its own.
    let a = 20f64.to_radians();
    let mut quarters: Vec<Quarter> = [(-100., -100.), (0., -100.), (-100., 0.), (0., 0.)].iter()
        .map(|&(x, y)| Quarter { shape: square(a, x, y, x + 100., y + 100.), phase: 0, zone: "core".into() }).collect();
    let outline = square(a, -100., -100., 100., 100.);
    let (x0, y0, x1, y1) = g::bbox(&outline);
    let wall = g::rectangle(x0, y0, x1, y1);
    let street = Street { path: vec![turn(a, -120., 100.), turn(a, 120., 100.)], widths: vec![6.; 2], rank: 1, role: "street".into() };
    let mut phases = vec![GrowthPhase { culture: "chinese".into(), kind: "foundation".into(), zone: "core".into(), recipe: String::new(),
        population: 1000., target_area: 40_000., shapes: vec![outline.clone()] }];
    fill_enclosures(&mut quarters, &mut phases, std::slice::from_ref(&wall), 1, std::slice::from_ref(&street), surface);
    let covered: f64 = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>()).iter().map(g::area).sum();
    assert!(covered >= 0.97 * g::area(&wall), "{covered} of {}", g::area(&wall));
    assert_eq!(quarters.len(), 5);
    let land: f64 = phases[0].shapes.iter().map(g::area).sum();
    assert!((land - covered).abs() < 5.0, "{land} {covered}");
}

#[test]
fn polygonal_enclosure_is_filled_to_the_wall_and_frames_its_grid() {
    let (height, water) = (vec![10.; 100], vec![0u8; 100]);
    let surface = Surface { geometry: None, width: 1000., n: 10, height: &height, water: &water, interpolation: Default::default() };
    let at = |x: f64, y: f64| Point { x: 500. + x, y: 500. + y };
    let a = 20f64.to_radians();
    let turn = |x: f64, y: f64| at(x * a.cos() - y * a.sin(), x * a.sin() + y * a.cos());
    let square = |x0: f64, y0: f64, x1: f64, y1: f64| g::normalized(Shape {
        outer: vec![turn(x0, y0), turn(x1, y0), turn(x1, y1), turn(x0, y1)], holes: vec![] });
    // A 20° grid inside a hexagonal curtain: the belt between them is town land.
    let wall = g::normalized(Shape { outer: (0..6).map(|k| { let t = k as f64 * 60f64.to_radians();
        at(170. * t.cos(), 170. * t.sin()) }).collect(), holes: vec![] });
    assert!(!rectangular(&wall));
    let mut quarters: Vec<Quarter> = [(-100., -100.), (0., -100.), (-100., 0.), (0., 0.)].iter()
        .map(|&(x, y)| Quarter { shape: square(x, y, x + 100., y + 100.), phase: 0, zone: "core".into() }).collect();
    let outline = square(-100., -100., 100., 100.);
    let street = Street { path: vec![turn(-250., 100.), turn(250., 100.)], widths: vec![6.; 2], rank: 1, role: "street".into() };
    let mut phases = vec![GrowthPhase { culture: "chinese".into(), kind: "foundation".into(), zone: "core".into(), recipe: String::new(),
        population: 1000., target_area: 40_000., shapes: vec![outline] }];
    fill_enclosures(&mut quarters, &mut phases, std::slice::from_ref(&wall), 1, std::slice::from_ref(&street), surface);
    let covered: f64 = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>()).iter().map(g::area).sum();
    assert!(covered >= 0.97 * g::area(&wall), "{covered} of {}", g::area(&wall));
    assert_eq!(quarters.len(), 5);
    let land: f64 = phases[0].shapes.iter().map(g::area).sum();
    assert!((land - covered).abs() < 5.0, "{land} {covered}");
    // A curtain mostly on the compass whose tightest box runs on its one long
    // diagonal: the grid takes the curtain's axes, not the box's.
    let stairs = g::normalized(Shape { outer: [(0., 0.), (200., 0.), (500., 300.), (500., 500.), (300., 500.), (300., 400.),
        (200., 400.), (200., 300.), (100., 300.), (100., 200.), (0., 200.)].iter().map(|&(x, y)| at(x, y)).collect(), holes: vec![] });
    let off = |r: f64| { let d = r.to_degrees().rem_euclid(90.); d.min(90. - d) };
    assert!(off(super::super::quarters::outline_frame(&stairs)) > 40.);
    assert!(off(super::super::quarters::enclosure_frame(&stairs)) < 0.5, "{}", super::super::quarters::enclosure_frame(&stairs).to_degrees());
    // A rectangle keeps its box.
    let rect = square(-100., -50., 100., 50.);
    let d = super::super::quarters::enclosure_frame(&rect) - super::super::quarters::outline_frame(&rect);
    assert!(d.abs() < 1e-9, "{d}");
}
