//! Gate reconciliation and how final streets meet the curtain.

use crate::urban::{Block, Enclosure, Layout, Point, Shape, Street, composition, geometry as g};
use super::crossings::{close_crossings, stop_at_curtains};
use super::geometry::{Cut, closed, dist, pt};
use super::reconcile::{guard_main_gates, reconcile_gates};
use super::settle::settle;
use super::street_clearance::Near;
use super::test_fixtures::{
    N, W, built, octagon, river, street, streets,
    structures, surface, town, town_on,
};

#[test]
fn review_forced_circuits_gain_water_gates_and_keep_regional_access() {
    let mut layout = town("curtain").remove(0);
    layout.culture = "chinese".into(); layout.blocks.clear();
    let path = closed(&g::rectangle(600.0,600.0,1400.0,1400.0).outer);
    layout.enclosures = vec![Enclosure {path,kind:"wall".into(),gates:vec![pt(600.0,1000.0)],..Default::default()}];
    let mut access = street(&[(600.0,1000.0),(950.0,1000.0)],1,8.0); access.role="regional".into();
    layout.streets = vec![access];
    let height=vec![10.0;N*N];
    // A channel a water gate spans (32 m): across a wider one the circuit would split per bank.
    let water:Vec<_> = river(1100.0,1132.0).into_iter().map(|w|if w>0 {3} else {0}).collect();
    settle(&mut layout,surface(&height,&water));
    assert_eq!(layout.enclosures.len(),1);
    let e=&layout.enclosures[0];
    assert!(!e.style.is_empty() && !e.reserve.is_empty());
    assert!(e.gates.iter().any(|&p|dist(p,pt(600.0,1000.0))<1.0));
    assert_eq!(e.gatehouses.iter().filter(|g|g.kind=="water").count(),2);
}

/// Walls review 16/11: a secondary street crossing the curtain away from
/// every gate opens no bare gap: it ends clear of the wall on both sides;
/// a main street keeps its crossing (it is a gate).
#[test]
fn walls16_minor_crossings_end_at_the_wall_on_both_sides() {
    let path = octagon();
    let e = Enclosure { path: path.clone(), kind: "wall".into(), style: "curtain".into(), curtain_width_m: 3.0, ..Default::default() };
    let mut streets = vec![street(&[(1000.0, 1000.0), (1500.0, 1020.0)], 2, 4.0), street(&[(1000.0, 1000.0), (1000.0, 1500.0)], 1, 8.0)];
    let (h, w) = (vec![0.0; N * N], vec![0; N * N]);
    close_crossings(&mut streets, std::slice::from_ref(&e), false, surface(&h, &w));
    let crosses = |s: &Street| s.path.windows(2).any(|w| path.windows(2).any(|c| g::segment_hit(w[0], w[1], c[0], c[1]).is_some()));
    let minor: Vec<_> = streets.iter().filter(|s| s.rank == 2).collect();
    assert_eq!(minor.len(), 2, "the minor street is split in two");
    assert!(minor.iter().all(|s| !crosses(s)), "a minor street still crosses the curtain");
    let near = Near::new(&path, 20.0);
    assert!(minor.iter().all(|s| s.path.windows(2).all(|w| near.distance(w[0], w[1]) >= 2.0)), "a split end on the wall");
    assert!(streets.iter().filter(|s| s.rank == 1).all(crosses), "the main street lost its crossing");
    // Through a gate it passes.
    let mut through = vec![street(&[(1000.0, 1000.0), (1500.0, 1000.0)], 2, 4.0)];
    let hit = through[0].path.windows(2).flat_map(|w| path.windows(2).filter_map(|c| g::segment_hit(w[0], w[1], c[0], c[1]).map(|h| h.1))).next().unwrap();
    let gated = Enclosure { gates: vec![hit], ..e.clone() };
    close_crossings(&mut through, std::slice::from_ref(&gated), false, surface(&h, &w));
    assert_eq!(through.len(), 1);
}

/// Walls review 16/11: bank points of a curtain hugging a river are no
/// gates; only a street crossing or a water passage keeps one.
#[test]
fn walls16_bank_points_without_a_street_are_no_gates() {
    let height = vec![10.0f32; N * N];
    let water = river(1300.0, 1400.0);
    let s = surface(&height, &water);
    let path = octagon();
    let bank = pt(1296.0, 1100.0);
    let crossing = streets()[0].clone();
    let hit = crossing.path.windows(2).flat_map(|w| path.windows(2).filter_map(|c| g::segment_hit(w[0], w[1], c[0], c[1]).map(|h| h.1))).next().unwrap();
    let mut e = Enclosure { path, kind: "wall".into(), style: "curtain".into(), gates: vec![hit, bank], ..Default::default() };
    let remap = reconcile_gates(&mut e, &[crossing], s);
    assert_eq!(remap, vec![Some(0), None]);
    assert!(e.gates.iter().all(|&q| dist(q, bank) > 8.0), "a bank point stayed a gate");
}

/// Walls review 16/11: a main road crossing opened after `build` gets the
/// culture's gatehouse; a minor street never does.
#[test]
fn walls16_main_road_crossing_gets_a_gatehouse() {
    let height = vec![10.0f32; N * N];
    let water = vec![0u8; N * N];
    let s = surface(&height, &water);
    let path = octagon();
    let road = street(&[(500.0, 1010.0), (1500.0, 990.0)], 1, 8.0);
    let hits: Vec<Point> = road.path.windows(2).flat_map(|w| path.windows(2).filter_map(|c| g::segment_hit(w[0], w[1], c[0], c[1]).map(|h| h.1)).collect::<Vec<_>>()).collect();
    assert_eq!(hits.len(), 2);
    let mut e = Enclosure { path, kind: "wall".into(), style: "flanked".into(), curtain_width_m: 3.0, height_m: 8.0, gates: hits, ..Default::default() };
    let ribbons = Cut::new(g::ribbon(&road.path, &[9.0, 9.0]));
    guard_main_gates(&mut e, &[&road], &ribbons, "european-organic", 12_000, s);
    assert_eq!(e.gatehouses.len(), 2);
    assert!(e.gatehouses.iter().all(|gh| !gh.masses.is_empty() && gh.masses.iter().all(|m| ribbons.hits(m) < 0.5)));
    let lane = street(&[(500.0, 1010.0), (1500.0, 990.0)], 3, 4.0);
    let mut bare = Enclosure { gatehouses: vec![], ..e.clone() };
    guard_main_gates(&mut bare, &[&lane], &Cut::new(vec![]), "european-organic", 12_000, s);
    assert!(bare.gatehouses.is_empty());
}

/// Invariant (curtains meet the network and the water on its terms): in
/// the final layout a street crosses a curtain only at a gate, and the
/// curtain runs in water only along a water gate's passage.
#[test]
fn final_streets_cross_curtains_only_at_gates_and_water_only_at_water_gates() {
    let water = river(1150.0, 1190.0);
    let height = vec![10.0f32; N * N];
    let s = surface(&height, &water);
    let mut crossings = 0;
    for style in ["curtain", "flanked"] {
        for layout in town_on(style, water.clone()) {
            for e in layout.enclosures.iter().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
                // The town exercises crossings: through crossings of the curtain, a street across it or
                // two street ends meeting on it from both sides (a street split at its gate).
                crossings += composition::gates(&e.path, &layout.streets).len();
                for st in layout.streets.iter().filter(|st| {
                    !matches!(st.role.as_str(), "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole")
                }) {
                    for w in st.path.windows(2) {
                        for c in e.path.windows(2) {
                            let Some((t, x)) = g::segment_hit(w[0], w[1], c[0], c[1]) else { continue };
                            // A street end resting on the curtain is no crossing.
                            if t * dist(w[0], w[1]) < 0.6 || (1.0 - t) * dist(w[0], w[1]) < 0.6 {
                                continue;
                            }
                            let gate = e.gates.iter().map(|&q| dist(q, x)).fold(f64::MAX, f64::min);
                            assert!(gate <= 8.0, "{style}: {} crosses the curtain {gate:.0} m from a gate", st.role);
                        }
                    }
                }
                let mut wet = 0.0;
                for c in e.path.windows(2) {
                    let k = (dist(c[0], c[1]) / 2.0).ceil().max(1.0) as usize;
                    for j in 0..k {
                        let t = (j as f64 + 0.5) / k as f64;
                        let p = pt(c[0].x + t * (c[1].x - c[0].x), c[0].y + t * (c[1].y - c[0].y));
                        let passage = e.gatehouses.iter().filter(|gh| matches!(gh.kind.as_str(), "water" | "shore")).any(|gh| {
                            g::distance(p, gh.passage[0], gh.passage[1]).0 <= 25.0
                        });
                        // Water a full raster cell deep: the curtain hugs a bank within one cell.
                        let cell = W / N as f64;
                        let deep = (0..8).all(|k| {
                            let a = k as f64 * std::f64::consts::FRAC_PI_4;
                            s.wet(pt(p.x + cell * a.cos(), p.y + cell * a.sin()))
                        });
                        if s.wet(p) && deep && !passage {
                            wet += dist(c[0], c[1]) / k as f64;
                        }
                    }
                }
                assert!(wet <= 10.0, "{style}: {wet:.0} m of curtain in water away from a water gate");
            }
        }
    }
    assert!(crossings > 0, "the town must exercise street crossings");
}

/// Defects 4 and 6: once the town is final, gates are its real crossings,
/// gatehouses stand on its streets, no structure covers a final street and
/// no block keeps land in the reserve.
#[test]
fn settle_follows_the_final_streets_and_blocks() {
    let water = vec![0u8; N * N];
    let height = vec![10.0f32; N * N];
    let s = surface(&height, &water);
    let (e, mut streets) = built("flanked", "wall", &water, 60_000);
    // The diagonal street is pruned, a later minor street crosses the
    // north-east front: it opens no gap, it ends at the wall on both sides.
    streets.remove(2);
    streets.push(street(&[(1000.0, 1000.0), (1400.0, 1400.0)], 2, 5.0));
    let tower = e.towers_detail[e.towers_detail.len() / 2].center;
    let block = Block {
        shape: g::rectangle(
            tower.x - 25.0,
            tower.y - 25.0,
            tower.x + 25.0,
            tower.y + 25.0,
        ),
        quarter: 0,
        kind: "block".into(),
        axis: pt(1.0, 0.0),
        zone: "core".into(),
        phase: None,
    };
    let mut layout = Layout {
        config: None,
        programme: None,
        key: "settle".into(),
        culture: "european-organic".into(),
        center: pt(1000.0, 1000.0),
        quarters: vec![],
        streets: streets.clone(),
        blocks: vec![block],
        warnings: vec![],
        enclosures: vec![e],
        phases: vec![],
        archetype: String::new(),
        structure: None,
        claim: Default::default(),
    };
    settle(&mut layout, s);
    let e = &layout.enclosures[0];
    let later = (pt(1000.0, 1000.0), pt(1400.0, 1400.0));
    assert!(e.gates.iter().all(|&q| g::distance(q, later.0, later.1).0 > 1.0), "the later minor street opened a gate");
    let streets = layout.streets.clone();
    let crossings = composition::gates(&e.path, &streets);
    assert_eq!(e.gates.len(), crossings.len());
    assert!(
        crossings
            .iter()
            .all(|c| e.gates.iter().any(|q| dist(*q, *c) < 8.0))
    );
    let ribbons: Vec<Shape> = streets
        .iter()
        .flat_map(|st| g::ribbon(&st.path, &st.widths))
        .collect();
    for gh in e.gatehouses.iter().filter(|gh| gh.kind != "water") {
        let m = pt(
            (gh.passage[0].x + gh.passage[1].x) * 0.5,
            (gh.passage[0].y + gh.passage[1].y) * 0.5,
        );
        assert!(
            ribbons.iter().any(|r| g::contains(r, m)),
            "gatehouse off street"
        );
    }
    let covered: f64 = structures(e)
        .iter()
        .flat_map(|sh| ribbons.iter().flat_map(move |r| g::intersection(sh, r)))
        .map(|sh| g::area(&sh))
        .sum();
    assert!(covered < 1.0, "{covered:.1} m² of street under structures");
    let in_reserve: f64 = layout
        .blocks
        .iter()
        .flat_map(|b| e.reserve.iter().flat_map(|r| g::intersection(&b.shape, r)))
        .map(|sh| g::area(&sh))
        .sum();
    assert!(
        in_reserve < 1.0,
        "{in_reserve:.1} m² of block in the reserve"
    );
    assert_eq!(e.towers.len(), e.towers_detail.len());
}

/// Gates are through crossings: a lane run up to the curtain opens none,
/// a street through it or two street ends meeting on it from both sides do.
#[test]
fn a_street_ending_on_the_curtain_opens_no_gate() {
    let path = octagon();
    let near = Near::new(&path, 40.0);
    // The east side at y = 1000, where the plain streets cross.
    let on = |y: f64| {
        let a = pt(900.0, y);
        let b = pt(1600.0, y);
        let k = near.crossed(a, b)[0..]
            .iter()
            .copied()
            .find(|&k| g::segment_hit(a, b, path[k], path[k + 1]).is_some())
            .unwrap();
        g::segment_hit(a, b, path[k], path[k + 1]).unwrap().1
    };
    let (p, q) = (on(950.0), on(1050.0));
    let lane = street(&[(900.0, 950.0), (p.x, p.y)], 3, 3.0);
    assert!(composition::gates(&path, std::slice::from_ref(&lane)).is_empty());
    let inner = street(&[(900.0, 1050.0), (q.x, q.y)], 2, 4.0);
    let outer = street(&[(q.x, q.y), (1600.0, 1050.0)], 2, 4.0);
    let through = street(&[(900.0, 1000.0), (1600.0, 1000.0)], 2, 4.0);
    let gates = composition::gates(&path, &[lane, inner, outer, through]);
    assert_eq!(gates.len(), 2, "{gates:?}");
    assert!(
        gates
            .iter()
            .all(|g| (g.y - 1000.0).abs() < 1.0 || dist(*g, q) < 1.0)
    );
}

/// Dead ends stop at the wall face: a street from the town ending on the
/// curtain axis, and one from outside ending in the reserve, are cut back
/// to the inner face and the reserve edge; a street through the curtain
/// (a gate), even one ending in the berm beyond, and a street with a
/// junction on the curtain are untouched.
#[test]
fn dead_ends_stop_at_the_wall_face() {
    let square: Vec<Point> = [
        (0.0, 0.0),
        (200.0, 0.0),
        (200.0, 200.0),
        (0.0, 200.0),
        (0.0, 0.0),
    ]
    .iter()
    .map(|&(x, y)| pt(x, y))
    .collect();
    // Reserve: the curtain body and a 10 m berm outside the east front.
    let reserve = vec![g::rectangle(200.0, -5.0, 210.0, 205.0)];
    let mut enclosures = vec![Enclosure {
        path: square,
        kind: "wall".into(),
        style: "curtain".into(),
        reserve,
        ..Default::default()
    }];
    let mut streets = vec![
        street(&[(100.0, 50.0), (200.0, 50.0)], 2, 4.0),
        street(&[(260.0, 100.0), (204.0, 100.0)], 2, 4.0),
        street(&[(100.0, 150.0), (300.0, 150.0)], 2, 4.0),
        street(&[(100.0, 120.0), (200.0, 120.0)], 2, 4.0),
        street(&[(200.0, 120.0), (200.0, 130.0), (150.0, 130.0)], 3, 3.0),
        // Through the curtain, ending on the causeway in the berm.
        street(&[(100.0, 180.0), (206.0, 180.0)], 2, 4.0),
    ];
    let before = streets.clone();
    stop_at_curtains(&mut streets, &mut enclosures);
    let end = |s: &Street| *s.path.last().unwrap();
    assert!(
        (end(&streets[0]).x - 198.5).abs() < 0.3,
        "{:?}",
        end(&streets[0])
    );
    assert!(
        (end(&streets[1]).x - 210.0).abs() < 0.3,
        "{:?}",
        end(&streets[1])
    );
    assert_eq!(streets[2].path, before[2].path);
    assert_eq!(streets[3].path, before[3].path);
    assert_eq!(streets[4].path, before[4].path);
    assert_eq!(
        streets[5].path, before[5].path,
        "a gate street keeps its gate"
    );
    // The corridor freed on the curtain body is the fortification's again.
    assert!(enclosures[0].reserve.len() > 1);
}
