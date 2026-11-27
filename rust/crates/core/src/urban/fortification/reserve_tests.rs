//! Curtain and ditch reserves, blocks and faubourg frontage.

use crate::rng::Rng;
use crate::urban::{
    Attached, Block, Enclosure, LayoutConfig, ParcelConfig, Point, Shape,
    Street, composition, generate_parcels, geometry as g, parcels,
};
use super::build::build;
use super::geometry::{Cut, closed, curtain_body, pt, ribbon_half};
use super::moat::embedded;
use super::reserve::fronted;
use super::settle::settle;
use super::street_clearance::Near;
use super::style::styled;
use super::test_fixtures::{
    N, octagon, predicted, river, street, streets,
    surface, town, town_seeded,
};
use super::test_fixtures;

#[test]
fn review_curtain_reserves_both_faces_and_moat_cuts_stay_local() {
    let sharp = vec![pt(200.0,600.0),pt(1400.0,600.0),pt(210.0,640.0),pt(200.0,600.0)];
    assert!(curtain_body(&sharp,3.0,1.5).iter().any(|s|g::contains(s,pt(1403.0,599.94))),"mitred tip must stay unbuildable");
    let height = vec![10.0; N*N]; let water = vec![0; N*N];
    let surface = surface(&height,&water);
    let path = closed(&g::rectangle(600.0,600.0,1400.0,1400.0).outer);
    let roads = vec![street(&[(640.0,588.0),(800.0,588.0)],2,4.0)];
    let mut e = Enclosure {path,kind:"wall".into(),..Default::default()};
    let mut style = styled("curtain","european-organic",10_000);
    style.ditch = "wet".into(); style.ditch_width = [10.0;2];
    style.berm = 2.0; style.outworks.clear(); style.attached = 0.0;
    style.tower_spacing = None; style.corner_turn = None;
    build(&mut e,0,&[],&roads,surface,&style,10_000,&predicted(),&Rng::new("water2"));
    for p in [pt(1000.0,600.5),pt(1000.0,599.5)] {
        assert!(e.reserve.iter().any(|s|g::contains(s,p)),"curtain face {p:?}");
    }
    for p in [pt(1000.0,590.0),pt(1200.0,590.0),pt(1410.0,1000.0)] {
        assert!(e.ditch.iter().any(|s|g::contains(&s.shape,p)),"moat lost away from local road {p:?}");
    }
    // A river-side curtain is neither an arcade nor an open front along the bank: it stays whole.
    let water:Vec<_> = river(1000.0,1080.0).into_iter().map(|w|if w>0 {3} else {0}).collect();
    let surface = test_fixtures::surface(&height,&water);
    e.path = vec![pt(800.0,600.0),pt(1004.0,600.0),pt(1004.0,1400.0),pt(800.0,1400.0),pt(800.0,600.0)];
    let banks = composition::water_gates(&e.path,surface);
    e.gates = banks.iter().map(|b|b.0).collect();
    build(&mut e,0,&banks,&[],surface,&style,10_000,&predicted(),&Rng::new("water2-bank"));
    assert!(e.gatehouses.is_empty());
}

/// Review 03/11 (european-organic river town): a moat the town has grown
/// round on its outer side holds no water; one facing open land keeps it.
#[test]
fn review11_moat_inside_the_built_town_is_dry() {
    let (inner, outer) = (pt(1000.0, 596.0), pt(1000.0, 584.0));
    let faubourg = g::rectangle(700.0, 380.0, 1300.0, 582.0);
    assert!(embedded(inner, outer, &[(g::bbox(&faubourg), &faubourg)]));
    assert!(!embedded(inner, outer, &[]));
    // A single row of houses along the moat is a faubourg street, not the town.
    let row = g::rectangle(700.0, 555.0, 1300.0, 582.0);
    assert!(!embedded(inner, outer, &[(g::bbox(&row), &row)]));
    // A culture's wet moat keeps its pools where one built frontage faces it; a run the town has grown
    // round dries whole, and the fed reach keeps its water.
    use crate::urban::types::{MoatReach, MoatRun};
    let run = MoatRun {
        inner: vec![pt(1200.0, 596.0), pt(1300.0, 596.0), pt(1400.0, 596.0), pt(1500.0, 596.0)],
        outer: vec![pt(1200.0, 584.0), pt(1300.0, 584.0), pt(1400.0, 584.0), pt(1500.0, 584.0)],
        reaches: vec![MoatReach { from: 0, to: 2, supply: "pool".into(), level: None },
            MoatReach { from: 2, to: 3, supply: "fed".into(), level: Some(2.0) }],
        ..Default::default()
    };
    let town = g::rectangle(700.0, 380.0, 1600.0, 582.0);
    for (built, supplies) in [(&faubourg, ["pool", "fed"]), (&town, ["dry", "fed"])] {
        let mut run = run.clone();
        super::moat_line::dry_pools(&mut run, |inner, outer| embedded(inner, outer, &[(g::bbox(built), built)]));
        assert_eq!(run.reaches.iter().map(|r| r.supply.as_str()).collect::<Vec<_>>(), supplies);
        assert_eq!(run.reaches[1].level, Some(2.0));
    }
}

/// Walls review 16/11: « Moat » is a generation parameter: none digs no
/// ditch (and keeps the faubourg fronts), dry and wet fix one kind for the
/// whole circuit, also for a style without a ditch of its own.
#[test]
fn walls16_moat_parameter_sets_the_ditch() {
    for (moat, kind) in [("none", "none"), ("dry", "dry"), ("wet", "wet")] {
        let mut st = styled("hedge", "european-organic", 5_000);
        st.options(&LayoutConfig { moat: moat.into(), ditch_wetness: Some(0.5), ..LayoutConfig::default() });
        assert_eq!(st.ditch, kind);
        assert!(st.ditch_wetness.is_none());
        if moat != "none" {
            assert!(st.ditch_width[1] > 0.0 && st.ditch_p == 1.0);
        }
    }
    let mut st = styled("curtain", "european-organic", 5_000);
    let before = st.ditch.clone();
    st.options(&LayoutConfig::default());
    assert_eq!(st.ditch, before, "the culture keeps its moat by default");
}

#[test]
fn tiny_wall_adjacent_blocks_follow_the_reserve_piece_limit() {
    let mut layout = town("curtain").remove(0);
    let template = layout.blocks[0].clone();
    let path = vec![pt(100.0, 100.0), pt(500.0, 100.0), pt(500.0, 500.0),
        pt(100.0, 500.0), pt(100.0, 100.0)];
    layout.streets.clear();
    layout.enclosures = vec![Enclosure { reserve: g::ribbon(&path, &[6.0; 5]), path,
        kind: "wall".into(), style: "curtain".into(), curtain_width_m: 6.0, ..Default::default() }];
    let near = g::rectangle(92.0, 200.0, 96.25, 206.0);
    let far = g::rectangle(50.0, 200.0, 54.25, 206.0);
    let large = g::rectangle(80.0, 300.0, 96.25, 310.0);
    layout.blocks = [&near, &far, &large].iter().map(|s| Block {
        shape: (*s).clone(), kind: "block".into(), ..template.clone() }).collect();
    let height = vec![10.0; N * N];
    let water = vec![0; N * N];
    settle(&mut layout, surface(&height, &water));
    assert_eq!(layout.blocks.len(), 2);
    assert!(layout.blocks.iter().any(|b| b.shape == far));
    assert!(layout.blocks.iter().any(|b| b.shape == large));
}

/// I3 and I6: blocks and lots never enter the reserve or the curtain
/// ribbon, and two runs give the same layout.
#[test]
fn no_block_or_lot_in_the_reserve_and_deterministic() {
    for style in ["flanked", "bastioned"] {
        let a = town(style);
        let b = town(style);
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        let layout = &a[0];
        let e = layout.enclosures.first().expect("a walled town");
        assert_eq!(e.style, style);
        let reserve = &e.reserve;
        let blocks: f64 = layout
            .blocks
            .iter()
            .flat_map(|bl| {
                reserve
                    .iter()
                    .flat_map(move |r| g::intersection(&bl.shape, r))
            })
            .map(|s| g::area(&s))
            .sum();
        assert!(
            blocks < 0.5,
            "{style}: {blocks} m² of blocks in the reserve"
        );
        let parts = generate_parcels(
            "walls",
            std::slice::from_ref(layout),
            &ParcelConfig::default(),
        )
        .unwrap();
        let ribbon = g::ribbon(&e.path, &[2.0 * ribbon_half(&e.kind)]);
        let lots: f64 = parts[0]
            .parcels
            .iter()
            .flat_map(|p| {
                reserve
                    .iter()
                    .chain(&ribbon)
                    .flat_map(move |r| g::intersection(&p.shape, r))
            })
            .map(|s| g::area(&s))
            .sum();
        assert!(lots < 0.5, "{style}: {lots} m² of lots in the reserve");
    }
}

/// Faubourg gate fronts: every outer lean-to fronts the lane drawn with it
/// (an edge within 2 m of the lane ribbon), none stands in the ditch or a
/// gate street, and the lane keeps off the curtain and every structure.
#[test]
fn faubourg_lean_tos_front_their_lane_clear_of_ditch_and_gates() {
    let height = vec![10.0f32; N * N];
    let water = vec![0u8; N * N];
    let s = surface(&height, &water);
    let path = octagon();
    let streets = streets();
    let gates = composition::gates(&path, &streets);
    let land = gates.len();
    let mut e = Enclosure {
        path: path.clone(),
        kind: "wall".into(),
        gates,
        ..Default::default()
    };
    let mut st = styled("flanked", "european-organic", 12_000);
    st.forced = true;
    st.attached = 1.0;
    st.ditch = "dry".into();
    st.ditch_p = 1.0;
    // A moated circuit keeps its moat whole: no lean-to outside.
    let mut ditched = e.clone();
    build(&mut ditched, land, &[], &streets, s, &st, 12_000, &predicted(), &Rng::new("fortification-test").fork("enc:0"));
    assert!(!ditched.ditch.is_empty() && ditched.attached.is_empty(), "a lean-to outside a moated circuit");
    st.ditch = "none".into();
    let lanes = build(
        &mut e,
        land,
        &[],
        &streets,
        s,
        &st,
        12_000,
        &predicted(),
        &Rng::new("fortification-test").fork("enc:0"),
    );
    assert!(!e.attached.is_empty() && !lanes.is_empty());
    let segs: Vec<(Point, Point, f64)> = lanes
        .iter()
        .flat_map(|l| l.path.windows(2).map(|w| (w[0], w[1], l.widths[0] * 0.5)))
        .collect();
    let gate_streets: Vec<Shape> = streets
        .iter()
        .flat_map(|st| g::ribbon(&st.path, &vec![st.widths[0]; st.path.len()]))
        .collect();
    let ditch = Cut::new(e.ditch.iter().map(|d| d.shape.clone()).collect());
    let roads = Cut::new(gate_streets);
    for a in &e.attached {
        assert!(fronted(&a.shape, &segs), "a lean-to without its lane");
        assert!(ditch.hits(&a.shape) < 0.01, "a lean-to in the ditch");
        assert!(roads.hits(&a.shape) < 0.01, "a lean-to on a gate street");
    }
    let held = Cut::new(
        e.towers_detail
            .iter()
            .map(|t| t.footprint.clone())
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.clone()))
            .chain(e.ditch.iter().map(|d| d.shape.clone()))
            .chain(e.attached.iter().map(|a| a.shape.clone()))
            .collect(),
    );
    let near = Near::new(&path, 30.0);
    for l in &lanes {
        for r in g::ribbon(&l.path, &l.widths) {
            assert!(held.hits(&r) < 0.01, "a lane through a structure");
        }
        assert!(l.path.windows(2).all(|w| near.distance(w[0], w[1]) > 2.0));
    }
}

/// Reserve exception (faubourg against the wall): once the town is final,
/// a lean-to with a street edge leaves the reserve and is a lot of family
/// `faubourg`; no block takes its land, and the other lots keep out of
/// the reserve (I3 still holds).
#[test]
fn served_lean_tos_leave_the_reserve_as_faubourg_lots() {
    // Faubourg fronts lean on a curtain without a moat; a gate draws one or not, so the first seed with a front serves.
    let layouts = ["walls", "walls-b", "walls-c", "walls-d", "walls-e", "walls-f"]
        .iter()
        .map(|seed| town_seeded(seed, "flanked", vec![0u8; N * N], "none"))
        .find(|l| !l[0].enclosures[0].attached.is_empty())
        .expect("a test town with a faubourg front");
    let layout = &layouts[0];
    let e = &layout.enclosures[0];
    let segs: Vec<(Point, Point, f64)> = layout
        .streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .flat_map(|s| {
            s.path
                .windows(2)
                .enumerate()
                .map(move |(i, w)| (w[0], w[1], s.widths.get(i).copied().unwrap_or(4.0) * 0.5))
        })
        .collect();
    let reserve = Cut::new(e.reserve.clone());
    let blocks = Cut::new(layout.blocks.iter().map(|b| b.shape.clone()).collect());
    let served: Vec<&Attached> = e
        .attached
        .iter()
        .filter(|a| fronted(&a.shape, &segs))
        .collect();
    // A lean-to whose lane a later stage took stays in the reserve: the rule is about the served ones.
    assert!(!served.is_empty(), "the test town has a served lean-to");
    for a in &served {
        assert!(
            reserve.hits(&a.shape) < 0.5,
            "a served lean-to kept in the reserve"
        );
        assert!(blocks.hits(&a.shape) < 0.5, "a block on a lean-to");
    }
    // Check the cadastral contract before programme consolidation can
    // merge neighbouring lots into one occupied property.
    let cfg = ParcelConfig::default();
    let morph = crate::urban::resolve(&layout.culture, &cfg.preset, &cfg.recipe,
        "core", cfg.density, &cfg.params, "parcels").unwrap();
    let part = parcels::generate("walls", layout, &cfg, &morph).unwrap();
    let lots: Vec<_> = part
        .parcels
        .iter()
        .filter(|p| p.provenance.iter().any(|t| t.starts_with("lean-to:0:")))
        .collect();
    assert_eq!(lots.len(), served.len());
    assert!(
        lots.iter()
            .all(|p| p.family == "faubourg" && p.use_kind == "plot")
    );
}

/// A walled rectangle (600..1400 m) with a 10 m ditch of `ditch` kind, built on `height` and `water`
/// with `streets`.
fn moated(ditch: &str, height: &[f32], water: &[u8], streets: &[Street]) -> Enclosure {
    let s = surface(height, water);
    let path = closed(&g::rectangle(600.0, 600.0, 1400.0, 1400.0).outer);
    let gates = composition::gates(&path, streets);
    let land = gates.len();
    let mut e = Enclosure { path, gates, kind: "wall".into(), ..Default::default() };
    let mut style = styled("curtain", "european-organic", 10_000);
    style.ditch = ditch.into();
    style.ditch_p = 1.0;
    style.ditch_width = [10.0; 2];
    style.berm = 2.0;
    style.outworks.clear();
    style.attached = 0.0;
    style.tower_spacing = None;
    style.corner_turn = None;
    build(&mut e, land, &[], streets, s, &style, 10_000, &predicted(), &Rng::new("moat-line"));
    e
}

/// A street through the ditch crosses it: the run stays whole and the street has one crossing record,
/// leaving by its gate.
#[test]
fn a_street_crosses_the_moat_without_cutting_it() {
    let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
    let e = moated("dry", &height, &water, &[street(&[(1000.0, 1000.0), (1000.0, 300.0)], 1, 8.0)]);
    let m = e.moat.as_ref().expect("a moat");
    assert!(m.runs.len() == 1 && m.runs[0].closed, "the ring is one closed run");
    assert_eq!(m.crossings.len(), 1);
    let c = &m.crossings[0];
    assert_eq!(c.gate, Some(0));
    let (a, b) = (c.path[0], c.path[c.path.len() - 1]);
    let middle = pt(0.5 * (a.x + b.x), 0.5 * (a.y + b.y));
    assert!(e.ditch.iter().any(|d| g::contains(&d.shape, middle)), "the ditch runs on under the street");
}

/// Beside a river the run ends at the water and its end reach is fed, the water between bed and rim.
#[test]
fn a_moat_beside_a_river_ends_at_it_and_is_fed() {
    let height = vec![10.0f32; N * N];
    let e = moated("wet", &height, &river(1410.0, 1480.0), &[]);
    let m = e.moat.as_ref().expect("a moat");
    assert_eq!(m.runs.len(), 1);
    let run = &m.runs[0];
    assert_eq!(run.ends, ["water".to_string(), "water".to_string()]);
    let first = &run.reaches[0];
    assert_eq!(first.supply, "fed");
    let level = first.level.expect("a fed reach has a level");
    assert!(run.bed[0] < level && level <= run.rim[0], "bed {} level {level} rim {}", run.bed[0], run.rim[0]);
    assert!(!m.sluices.is_empty(), "a sluice joins the river");
}

/// On a slope a dry ditch is one reach per run: no dam between dry reaches.
#[test]
fn a_dry_moat_on_a_slope_has_no_dams() {
    let height: Vec<f32> = (0..N * N).map(|i| 10.0 + 0.05 * (i % N) as f32 * 8.0).collect();
    let e = moated("dry", &height, &vec![0u8; N * N], &[]);
    let m = e.moat.as_ref().expect("a moat");
    assert!(m.dams.is_empty());
    assert!(m.runs.iter().all(|r| r.reaches.len() == 1 && r.reaches[0].supply == "dry"));
}

/// A circuit that digs no ditch has no moat.
#[test]
fn no_ditch_no_moat() {
    let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
    let e = moated("none", &height, &water, &[]);
    assert!(e.moat.is_none() && e.ditch.is_empty());
}
