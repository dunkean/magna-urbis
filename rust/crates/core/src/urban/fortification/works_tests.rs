//! Towers, gatehouses, bastions and shore passages on one circuit.

use crate::rng::Rng;
use crate::urban::{Enclosure, LayoutConfig, Point, Shape, Street, Work, composition, geometry as g};
use super::build::build;
use super::geometry::{
    add, area, buffer, cross, dir, dist, dot,
    normals, overlaps, pt, ribbon_half, turn_at, unit,
};
use super::moat::{dam_stations, rounded_ends, spec};
use super::style::styled;
use super::towers::flank_stations;
use super::water::near_water;
use super::test_fixtures::{
    N, built, built_with, octagon, predicted, river,
    street, streets, structures, surface,
};

#[test]
fn review_water_edges_and_timber_are_standard() {
    let mut old = styled("curtain", "celtic-oppidum", 500);
    old.options(&LayoutConfig::default());
    let mut timber = old.clone();
    timber.options(&LayoutConfig::default());
    assert_eq!(timber.kind, "palisade");
    assert_eq!(timber.material, "timber-earth");
    assert!(timber.curtain_width <= 3.0 && timber.height <= 3.5);
    // A channel a gate spans opens on water gates whatever its water class; a wider one opens
    // nothing: the curtain stays whole (the trace keeps it off the water).
    for (code, x1, expected) in [(1, 1196.0, 2), (3, 1196.0, 2), (3, 1260.0, 0)] {
        let height = vec![10.0f32; N*N];
        let water: Vec<_> = river(1180.0,x1).into_iter().map(|w| if w != 0 { code } else { 0 }).collect();
        let surface = surface(&height,&water);
        let path = octagon();
        let banks = composition::water_gates(&path,surface);
        let gates = banks.iter().map(|b| b.0).collect();
        let mut e = Enclosure { path, gates, kind: "wall".into(), ..Default::default() };
        let mut style = styled("curtain","european-organic",500);
        style.options(&LayoutConfig::default());
        build(&mut e,0,&banks,&[],surface,&style,500,&predicted(),&Rng::new("review-water"));
        assert_eq!(e.gatehouses.len(), expected);
        assert!(e.gatehouses.iter().all(|g| g.kind == "water"));
    }
}

#[test]
fn flank_spacing_is_independent_of_front_subdivision() {
    let coarse = octagon();
    let fine: Vec<_> = coarse.windows(2).flat_map(|w| (0..40).map(move |i|
        add(w[0], dir(w[0], w[1]), dist(w[0], w[1]) * i as f64 / 40.0)))
        .chain(std::iter::once(coarse[0])).collect();
    // Keep terrain constant on each founding front while subdividing it.
    let positions = |path: &[Point], subdivisions: usize| {
        let n = path.len() - 1;
        let corners: Vec<_> = (0..n).map(|i| turn_at(&path[..n], i).to_degrees() > 28.0).collect();
        let factors: Vec<_> = (0..n).map(|i| if i / subdivisions < 4 { 1.5 } else { 1.0 }).collect();
        flank_stations(path, &corners, &factors, 55.0).iter().map(|&(i, t)|
            add(path[i], dir(path[i], path[i + 1]), t * dist(path[i], path[i + 1]))).collect::<Vec<_>>()
    };
    let (a, b) = (positions(&coarse, 1), positions(&fine, 40));
    assert!(a.len() > 20);
    assert_eq!(a.len(), b.len());
    assert!(a.iter().zip(&b).all(|(&a, &b)| dist(a, b) < 1e-6));
}

fn ring(e: &Enclosure) -> Shape {
    g::normalized(Shape {
        outer: e.path[..e.path.len() - 1].to_vec(),
        holes: vec![],
    })
}

/// I1 and I2: the old fields keep their meaning (gates on the path and on
/// a street, tower anchors on the path) and nothing enters the inner side.
#[test]
fn structures_stay_outside_the_inner_face_and_anchor_on_the_curtain() {
    for style in [
        "curtain",
        "flanked",
        "concentric",
        "rammed-earth",
        "wengcheng",
        "bastioned",
    ] {
        let (e, streets) = built(style, "wall", &vec![0; N * N], 60_000);
        assert!(!e.gatehouses.is_empty(), "{style}");
        assert_eq!(e.towers.len(), e.towers_detail.len());
        for (t, d) in e.towers.iter().zip(&e.towers_detail) {
            assert!(dist(*t, d.anchor) < 1e-9);
            let on = e
                .path
                .windows(2)
                .map(|w| g::distance(*t, w[0], w[1]).0)
                .fold(f64::INFINITY, f64::min);
            assert!(on < 0.1, "{style}: tower {on} m off the curtain");
        }
        for q in &e.gates {
            assert!(
                e.path
                    .windows(2)
                    .any(|w| g::distance(*q, w[0], w[1]).0 < 0.1)
            );
            assert!(streets.iter().any(|s| {
                s.path
                    .windows(2)
                    .any(|w| g::distance(*q, w[0], w[1]).0 < 0.1)
            }));
        }
        let inner = buffer(&ring(&e), -ribbon_half("wall"));
        let overlap: f64 = structures(&e)
            .iter()
            .flat_map(|s| inner.iter().flat_map(move |i| g::intersection(s, i)))
            .map(|s| g::area(&s))
            .sum();
        assert!(
            overlap < 0.01,
            "{style}: {overlap} m² inside the inner face"
        );
    }
}

/// I4 at this stage: every land gatehouse straddles a real street crossing,
/// and no structure covers a street ribbon (passages and causeways stay open).
#[test]
fn gatehouses_straddle_street_crossings_and_streets_stay_open() {
    for style in [
        "flanked",
        "rammed-earth",
        "wengcheng",
        "bastioned",
        "palisade",
    ] {
        let kind = if style == "palisade" {
            "palisade"
        } else {
            "wall"
        };
        let (e, streets) = built(style, kind, &vec![0; N * N], 60_000);
        let ribbons: Vec<Shape> = streets
            .iter()
            .flat_map(|s| g::ribbon(&s.path, &s.widths))
            .collect();
        for gh in e.gatehouses.iter().filter(|g| g.kind != "water") {
            let q = e.gates[gh.gate];
            let [a, b] = gh.passage;
            let on_street = streets.iter().any(|s| {
                s.path.windows(2).any(|w| {
                    g::distance(a, w[0], w[1]).0 < 0.5 && g::distance(b, w[0], w[1]).0 < 0.5
                })
            });
            assert!(on_street, "{style}: passage off its street");
            if gh.passage.iter().any(|p| dist(*p, q) < 40.0) {
                assert!(
                    g::distance(q, a, b).0 < 0.5 || gh.kind == "tower",
                    "{style}: passage misses its gate"
                );
            }
            assert!(
                gh.masses.len() >= 2,
                "{style}: a gatehouse keeps a mass each side"
            );
        }
        let covered: f64 = structures(&e)
            .iter()
            .flat_map(|s| ribbons.iter().flat_map(move |r| g::intersection(s, r)))
            .map(|s| g::area(&s))
            .sum();
        assert!(
            covered < 1.0,
            "{style}: {covered} m² of street under structures"
        );
    }
}

/// I5: across a river, no tower, gatehouse or bastion has a wet vertex or
/// centre; the curtain opens on paired water gates.
#[test]
fn nothing_stands_in_the_water_and_water_gates_pair_banks() {
    // A channel a water gate spans (16 m): a wider water opens no gate, each bank keeps its ring.
    let water: Vec<u8> = river(1180.0, 1196.0).into_iter().map(|w| w * 3).collect();
    let height = vec![10.0f32; N * N];
    let s = surface(&height, &water);
    for style in ["flanked", "bastioned"] {
        let (e, _) = built(style, "wall", &water, 60_000);
        let dry = |sh: &Shape| !sh.outer.iter().any(|&p| s.wet(p)) && !s.wet(g::centroid(sh));
        assert!(
            e.towers_detail
                .iter()
                .all(|t| dry(&t.footprint) && !s.wet(t.center))
        );
        assert!(e.gatehouses.iter().all(|gh| gh.masses.iter().all(dry)));
        assert!(e.bastions.iter().all(|b| dry(&b.shape)), "{style}");
        let water_gates: Vec<_> = e.gatehouses.iter().filter(|g| g.kind == "water").collect();
        assert_eq!(
            water_gates.len(),
            2,
            "{style}: the river crosses the circuit twice"
        );
        for gh in water_gates {
            let m = pt(
                (gh.passage[0].x + gh.passage[1].x) * 0.5,
                (gh.passage[0].y + gh.passage[1].y) * 0.5,
            );
            assert!(s.wet(m) && !s.wet(gh.passage[0]) && !s.wet(gh.passage[1]));
        }
        assert!(e.ditch.iter().all(|d| {
            g::dry_clip(&s, &d.shape).iter().map(g::area).sum::<f64>()
                > 0.99 * g::area(&d.shape)
        }));
        assert!(e.ditch.iter().all(|d| d.shape.outer.iter().all(|&p| !near_water(p, 7.0, s))), "{style}: the moat stops short of the river");
    }
}

#[test]
fn a_moat_ends_round_at_a_natural_stop_and_square_elsewhere() {
    let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
    let ditch = vec![Work { kind: "wet".into(), shape: g::rectangle(1000.0, 1000.0, 1100.0, 1012.0), height_m: 3.0, passage: None }];
    let ends = rounded_ends(ditch, vec![g::rectangle(1099.0, 980.0, 1140.0, 1030.0)], 12.0, surface(&height, &water));
    assert_eq!(ends.len(), 1);
    let holds = |x: f64, y: f64| g::contains(&ends[0].shape, pt(x, y));
    assert!(!holds(1099.5, 1000.5) && !holds(1099.5, 1011.5) && holds(1099.5, 1006.0));
    assert!(holds(1000.5, 1000.5) && holds(1000.5, 1011.5));
}

#[test]
fn a_wet_ditch_joins_the_water_it_stops_short_of_by_one_sluice() {
    let (height, water) = (vec![10.0f32; N * N], river(1112.0, 1160.0));
    let s = surface(&height, &water);
    let ditch = |kind: &str| vec![Work { kind: kind.into(), shape: g::rectangle(1000.0, 1000.0, 1104.0, 1012.0), height_m: 3.0, passage: None }];
    let moat = spec("revetted", &ditch("wet"), vec![[pt(1001.0, 1000.0), pt(1001.0, 1012.0)], [pt(400.0, 400.0), pt(400.0, 412.0)]], "abandoned", s).expect("a ditch has a form");
    // A dam stays while a reach of the ditch still ends on it.
    assert_eq!((moat.dams.len(), moat.state.as_str()), (1, "abandoned"));
    assert_eq!((moat.form.as_str(), moat.sluices.len()), ("revetted", 1));
    let [head, shore] = moat.sluices[0];
    assert!(head.x > 1103.0 && shore.x > head.x && dist(head, shore) <= 14.0 && near_water(shore, 0.0, s));
    // A dry ditch keeps its round head; no ditch, no moat.
    assert!(spec("fossa", &ditch("dry"), vec![], "", s).expect("a ditch has a form").sluices.is_empty());
    assert!(spec("fossa", &[], vec![], "", s).is_none());
}

#[test]
fn a_wet_ditch_on_a_slope_is_dammed_into_level_reaches() {
    let level: Vec<(f64, Option<usize>)> = (0..10).map(|_| (10.0, Some(0))).collect();
    assert!(dam_stations(&level).is_empty());
    // 0.3 m of rim per station: a dam every third station; the next piece starts its own reach without one.
    let slope: Vec<(f64, Option<usize>)> = (0..10).map(|k| (10.0 + 0.3 * k as f64, Some(k / 7))).collect();
    assert_eq!(dam_stations(&slope), vec![3, 6]);
}

/// Palisades are timber: no stone towers, timber gates, a thin curtain;
/// a hedge has no structure at all.
#[test]
fn palisade_is_timber_and_hedge_is_plain() {
    let (p, _) = built("palisade", "palisade", &vec![0; N * N], 3000);
    assert_eq!((p.material.as_str(), p.curtain_width_m), ("timber", 1.5));
    assert!(p.towers.is_empty());
    assert!(!p.gatehouses.is_empty() && p.gatehouses.iter().all(|g| g.kind == "timber"));
    let (gord, _) = built("gord", "palisade", &vec![0; N * N], 3000);
    assert!(
        gord.towers_detail
            .iter()
            .all(|t| t.shape == "square" && t.radius_m <= 2.5)
    );
    let (h, _) = built("hedge", "hedge", &vec![0; N * N], 3000);
    assert!(h.towers.is_empty() && h.gatehouses.is_empty() && h.ditch.is_empty());
}

/// A bastioned trace has a bastion (or, failing it, a corner tower) at
/// every salient corner away from the gates, and ravelins at major gates.
#[test]
fn bastioned_trace_fortifies_every_salient() {
    let (e, _) = built("bastioned", "wall", &vec![0; N * N], 60_000);
    assert!(e.towers_detail.iter().all(|t| t.kind != "flank"));
    let n = e.path.len() - 1;
    let ns = normals(&e.path);
    for i in 0..n {
        let prev = (i + n - 1) % n;
        let (a, v, b) = (e.path[(i + n - 1) % n], e.path[i], e.path[i + 1]);
        let (u, w) = (dir(a, v), dir(v, b));
        let deg = cross(u, w).atan2(dot(u, w)).abs().to_degrees();
        if dot(ns[prev], w) >= 0.0
            || !(15.0..=110.0).contains(&deg)
            || e.gates.iter().any(|q| dist(*q, v) < 50.0)
        {
            continue;
        }
        let b = unit((ns[prev].0 + ns[i].0, ns[prev].1 + ns[i].1));
        let held = e
            .bastions
            .iter()
            .any(|bw| g::contains(&bw.shape, add(v, b, 5.0)))
            || e.towers_detail.iter().any(|t| dist(t.anchor, v) < 1.0);
        assert!(held, "salient {i} unfortified");
    }
    assert!(e.bastions.len() >= 4, "{} bastions", e.bastions.len());
    assert!(e.outworks.iter().filter(|w| w.kind == "ravelin").count() >= 2);
    assert!(!e.ditch.is_empty() && e.outworks.iter().any(|w| w.kind == "glacis"));
}

/// Pairwise overlap (m²) of towers, gatehouse masses and bastions; the
/// masses of one gatehouse are one structure.
fn stacked(e: &Enclosure) -> f64 {
    let items: Vec<(usize, &Shape)> = e
        .towers_detail
        .iter()
        .enumerate()
        .map(|(i, t)| (i, &t.footprint))
        .chain(
            e.gatehouses
                .iter()
                .enumerate()
                .flat_map(|(i, gh)| gh.masses.iter().map(move |m| (1000 + i, m))),
        )
        .chain(
            e.bastions
                .iter()
                .enumerate()
                .map(|(i, b)| (2000 + i, &b.shape)),
        )
        .collect();
    let mut total = 0.0;
    for (i, (a, sa)) in items.iter().enumerate() {
        for (b, sb) in &items[i + 1..] {
            if a != b && overlaps(g::bbox(sa), g::bbox(sb), 0.0) {
                total += area(&g::intersection(sa, sb));
            }
        }
    }
    total
}

/// Defect 2: crossings a few metres apart never stack gatehouses and
/// towers; the lesser crossing stays a plain opening.
#[test]
fn close_crossings_never_stack_structures() {
    let mut streets = streets();
    // Two streets 14 m apart through the eastern front, and a third 9 m
    // from the first.
    streets.push(street(&[(1000.0, 1180.0), (1500.0, 1180.0)], 1, 8.0));
    streets.push(street(&[(1000.0, 1194.0), (1500.0, 1194.0)], 2, 5.0));
    streets.push(street(&[(1000.0, 1203.0), (1500.0, 1203.0)], 2, 4.0));
    for style in ["flanked", "rammed-earth", "bastioned", "wengcheng"] {
        let (e, _) = built_with(style, "wall", &vec![0; N * N], 60_000, streets.clone());
        let s = stacked(&e);
        assert!(s < 1.0, "{style}: {s:.1} m² of stacked structures");
        assert!(
            e.gatehouses.iter().all(|gh| !gh.masses.is_empty()),
            "{style}: a gatehouse without masses"
        );
    }
}

/// A regional road enters through a gatehouse: where a wider city street
/// crosses the curtain next to it, the regional crossing is served first.
#[test]
fn a_regional_road_enters_through_a_gatehouse() {
    let mut regional = street(&[(1000.0, 1000.0), (1600.0, 1000.0)], 1, 5.0);
    regional.role = "regional".into();
    let streets = vec![
        street(&[(1000.0, 1015.0), (1600.0, 1015.0)], 0, 12.0),
        regional,
        street(&[(1005.0, 500.0), (995.0, 1500.0)], 1, 8.0),
    ];
    let (e, streets) = built_with("flanked", "wall", &vec![0; N * N], 60_000, streets);
    let on = |s: &Street, p: Point| {
        s.path
            .windows(2)
            .any(|w| g::distance(p, w[0], w[1]).0 < 1.0)
    };
    let served: Vec<&str> = e
        .gatehouses
        .iter()
        .filter(|gh| gh.kind != "water")
        .filter_map(|gh| {
            streets
                .iter()
                .filter(|s| on(s, e.gates[gh.gate]))
                .min_by_key(|s| s.rank)
                .map(|s| s.role.as_str())
        })
        .collect();
    assert!(served.contains(&"regional"), "{served:?}");
    assert!(e.gates.iter().filter(|&&q| on(&streets[1], q)).all(|&q| {
        e.gatehouses
            .iter()
            .any(|gh| dist(e.gates[gh.gate], q) < 1.0)
    }));
}
