//! Parcel stage regressions for coverage, block edits and parallel replay.

use super::contacts::{Front, FrontageIndex, block_contacts, frontages};
use super::cut_geometry::{dot, normal, sub, unit};
use super::depth::lot_depth;
use super::identity::parcel;
use super::neighbour_repair::share_out;
use super::seams::shared;
use crate::urban::{Block, Layout, Parcel, ParcelConfig, Partition, Point, Shape, Street};
use crate::urban::geometry::{area, rectangle};
use std::collections::BTreeMap;

/// A quarter edit (« éditer un quartier ») reaches the lot cutting: a lower
/// density on the quarter widens its lots, other quarters are unchanged.
#[test]
fn quarter_density_override_reaches_the_lots() {
    let (mut layout, lots) = two_quarters("core");
    let (a0, a1) = (lots(&layout, 0), lots(&layout, 1));
    layout.config.as_mut().unwrap().overrides.quarters.insert(
        "1".into(),
        crate::urban::QuarterOverride {
            density: Some(0.25),
            ..Default::default()
        },
    );
    let (b0, b1) = (lots(&layout, 0), lots(&layout, 1));
    assert_eq!(a0, b0, "an unedited quarter keeps its lots");
    assert!(
        b1 < a1,
        "a sparser quarter has fewer, wider lots: {a1} -> {b1}"
    );
}

/// A ring quarter set to `core` by the user is cut as the densest tissue:
/// more, narrower lots; a high density does the same; other quarters keep theirs.
#[test]
fn quarter_zone_override_densifies_the_lots() {
    let (mut layout, lots) = two_quarters("edge");
    let (a0, a1) = (lots(&layout, 0), lots(&layout, 1));
    let edit = |layout: &mut Layout, o: crate::urban::QuarterOverride| {
        layout.config.as_mut().unwrap().overrides.quarters.insert("1".into(), o);
    };
    edit(&mut layout, crate::urban::QuarterOverride { zone: Some("core".into()), ..Default::default() });
    let (b0, b1) = (lots(&layout, 0), lots(&layout, 1));
    assert_eq!(a0, b0, "an unedited quarter keeps its lots");
    assert!(b1 > a1, "a core quarter has more lots: {a1} -> {b1}");
    edit(&mut layout, crate::urban::QuarterOverride { density: Some(10.0), ..Default::default() });
    let c1 = lots(&layout, 1);
    assert!(c1 > a1, "a ×10 quarter has more lots: {a1} -> {c1}");
}

/// Two quarters of one block each along a street, every phase in `zone`.
fn two_quarters(zone: &str) -> (Layout, impl Fn(&Layout, usize) -> usize) {
    let block = |x: f64, q: usize| Block {
        phase: None,
        shape: rectangle(x, 0.0, x + 120.0, 30.0),
        quarter: q,
        kind: "block".into(),
        axis: Point { x: 1.0, y: 0.0 },
        zone: zone.into(),
    };
    let layout = Layout {
        config: Some(crate::urban::LayoutConfig::default()),
        programme: None,
        key: "edited-quarter".into(),
        structure: None,
        phases: vec![crate::urban::GrowthPhase {
            culture: "european-organic".into(),
            kind: "core".into(),
            zone: zone.into(),
            recipe: "core".into(),
            population: 1000.0,
            target_area: 0.0,
            shapes: vec![],
        }],
        archetype: "district".into(),
        culture: "european-organic".into(),
        center: Point { x: 120.0, y: 15.0 },
        quarters: (0..2)
            .map(|q| crate::urban::Quarter {
                shape: rectangle(q as f64 * 130.0, 0.0, q as f64 * 130.0 + 120.0, 30.0),
                phase: 0,
                zone: zone.into(),
            })
            .collect(),
        enclosures: vec![],
        warnings: vec![],
        blocks: vec![block(0.0, 0), block(130.0, 1)],
        streets: vec![Street {
            path: vec![Point { x: -10.0, y: -3.0 }, Point { x: 260.0, y: -3.0 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "street".into(),
        }],
        claim: Default::default(),
    };
    let lots = |layout: &Layout, b: usize| {
        crate::urban::generate_parcels(
            "edit",
            std::slice::from_ref(layout),
            &ParcelConfig::default(),
        )
        .unwrap()[0]
            .parcels
            .iter()
            .filter(|p| p.block == b && p.front.is_some())
            .count()
    };
    (layout, lots)
}

#[test]
fn block_edit_recuts_only_its_own_lots_and_retains_streets() {
    let blocks = [0.0, 130.0].into_iter().map(|x| Block { phase: None,
        shape: rectangle(x, 0., x + 120., 30.), quarter: 0, kind: "block".into(),
        axis: Point { x: 1., y: 0. }, zone: "edge".into() }).collect();
    let layout = strip_layout("edited-block", blocks, vec![Street {
        path: vec![Point { x: -10., y: -3. }, Point { x: 260., y: -3. }],
        widths: vec![6.; 2], rank: 1, role: "street".into() }]);
    let original = serde_json::to_value(&layout).unwrap();
    let mut cfg = ParcelConfig::default();
    let base = crate::urban::generate_parcels("block-edit", std::slice::from_ref(&layout), &cfg).unwrap().remove(0);
    cfg.overrides.blocks.insert("1".into(), crate::urban::BlockOverride { salt: Some(4567), density: Some(0.25), ..Default::default() });
    let changed = crate::urban::generate_parcels("block-edit", std::slice::from_ref(&layout), &cfg).unwrap().remove(0);
    let lots = |p: &Partition, b| serde_json::to_value(p.parcels.iter().filter(|p| p.block == b).collect::<Vec<_>>()).unwrap();
    assert_eq!(lots(&base, 0), lots(&changed, 0), "the neighbouring block is unchanged");
    assert_ne!(lots(&base, 1), lots(&changed, 1), "the edited block is recut");
    assert_eq!(original, serde_json::to_value(&layout).unwrap(), "streets and block borders are retained");
    let repeat = crate::urban::generate_parcels("block-edit", std::slice::from_ref(&layout), &cfg).unwrap().remove(0);
    assert_eq!(lots(&changed, 1), lots(&repeat, 1), "saved block seeds replay exactly");
    cfg.overrides.blocks.get_mut("1").unwrap().operator = Some("garden".into());
    let garden = crate::urban::generate_parcels("block-edit", &[layout], &cfg).unwrap().remove(0);
    assert_eq!(lots(&base, 0), lots(&garden, 0));
    assert!(garden.parcels.iter().filter(|p| p.block == 1).all(|p| p.use_kind == "garden"));
}

/// A one-quarter european layout of the given blocks and streets.
fn strip_layout(key: &str, blocks: Vec<Block>, streets: Vec<Street>) -> Layout {
    Layout {
        config: Some(crate::urban::LayoutConfig::default()),
        programme: None,
        key: key.into(),
        structure: None,
        phases: vec![crate::urban::GrowthPhase {
            culture: "european-organic".into(),
            kind: "core".into(),
            zone: "edge".into(),
            recipe: "core".into(),
            population: 1000.0,
            target_area: 0.0,
            shapes: vec![],
        }],
        archetype: "district".into(),
        culture: "european-organic".into(),
        center: Point { x: 0.0, y: 0.0 },
        quarters: vec![crate::urban::Quarter {
            shape: rectangle(-500.0, -500.0, 500.0, 500.0),
            phase: 0,
            zone: "edge".into(),
        }],
        enclosures: vec![],
        warnings: vec![],
        blocks,
        streets,
        claim: Default::default(),
    }
}
fn road(a: (f64, f64), b: (f64, f64), rank: usize) -> Street {
    Street {
        path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
        widths: vec![6.0; 2],
        rank,
        role: "street".into(),
    }
}
fn edge_block(shape: Shape, kind: &str) -> Block {
    Block {
        phase: None,
        shape,
        quarter: 0,
        kind: kind.into(),
        axis: Point { x: 1.0, y: 0.0 },
        zone: "edge".into(),
    }
}

/// Fields remain whole, even alongside a street; no vacant cadastral row.
#[test]
fn edge_reserve_on_a_street_stays_uncut_field() {
    let shape = rectangle(0.0, 0.0, 240.0, 120.0);
    let layout = strip_layout(
        "edge-reserve",
        vec![edge_block(shape.clone(), "reserve")],
        vec![road((-20.0, -3.0), (260.0, -3.0), 2)],
    );
    let lots = &crate::urban::generate_parcels("edge", &[layout], &ParcelConfig::default())
        .unwrap()[0]
        .parcels;
    assert_eq!(lots.len(), 1);
    assert!(
        lots.iter()
            .all(|p| p.use_kind == "reserve" && p.family == "reserve" && p.envelope.is_none())
    );
    let total: f64 = lots.iter().map(|p| area(&p.shape)).sum();
    assert!((total - area(&shape)).abs() < 1e-3 * area(&shape));
    assert_eq!(lots[0].shape.outer, shape.outer);
}

#[test]
fn field_paths_never_create_parcel_frontage() {
    let mut s = road((-20.,-3.),(80.,-3.),2);
    crate::urban::network::downgrade_path(&mut s);
    let l = strip_layout("field-path",vec![],vec![s]);
    let shape = rectangle(0.,0.,60.,30.);
    assert!(frontages(&shape,&l,&FrontageIndex::new(&l)).is_empty());
    assert!(block_contacts(&shape,&l).is_empty());
}

/// Invariant (residual slivers): the strip left along a street when the
/// lots behind it were cut at their maximum depth holds no house; it is
/// shared out among those lots along their common side, extending each to
/// the street, and never left as a residual.
#[test]
fn street_strip_left_behind_deep_lots_is_shared_out_to_the_street() {
    let street_front = Front {
        a: Point { x: 0.0, y: 34.0 },
        b: Point { x: 30.0, y: 34.0 },
        rank: 2,
        street: 0,
        shared: false,
        gate: false,
    };
    let back_front = Front {
        a: Point { x: 30.0, y: 0.0 },
        b: Point { x: 0.0, y: 0.0 },
        rank: 1,
        street: 1,
        shared: false,
        gate: false,
    };
    let fronts = [street_front, back_front];
    let axis = Point { x: 1.0, y: 0.0 };
    let lot = |x0: f64, x1: f64| {
        let mut p = parcel(rectangle(x0, 0.0, x1, 30.0), 0, axis, &fronts, "plot");
        p.envelope = Some(rectangle(x0 + 1.0, 1.0, x1 - 1.0, 12.0));
        p
    };
    let strip = parcel(rectangle(0.0, 30.0, 30.0, 34.0), 0, axis, &fronts, "plot");
    let mut cells = vec![lot(0.0, 12.0), lot(12.0, 30.0), strip];
    let accept = |s: &Shape| Some(s.clone());
    let shallow = |_: &Shape| false;
    assert!(share_out(
        &mut cells,
        2,
        &fronts,
        &accept,
        &shallow,
        f64::INFINITY
    ));
    assert_eq!(cells.len(), 2);
    let areas: Vec<f64> = cells.iter().map(|p| area(&p.shape)).collect();
    assert!((areas[0] - 12.0 * 34.0).abs() < 1e-6, "{areas:?}");
    assert!((areas[1] - 18.0 * 34.0).abs() < 1e-6, "{areas:?}");
    assert!(
        cells
            .iter()
            .all(|p| p.provenance.iter().any(|q| q == "residual-shared"))
    );
    // A strip whose receivers would lose their witness stays residual.
    let mut cells = vec![lot(0.0, 12.0), lot(12.0, 30.0), cells[0].clone()];
    cells[2] = parcel(rectangle(0.0, 30.0, 30.0, 34.0), 0, axis, &fronts, "plot");
    let refuse = |_: &Shape| None;
    assert!(!share_out(
        &mut cells,
        2,
        &fronts,
        &refuse,
        &shallow,
        f64::INFINITY
    ));
    assert_eq!(cells.len(), 3);
}

/// Blocks are cut in parallel and merged in block order: one thread and
/// many give the same partition. The same town also checks the lot
/// balance invariant (neighbours with similar fronts stay within a 3x
/// area ratio) and the depth bound (no admitted lot deeper than 100 m).
#[test]
fn parallel_parcel_stage_matches_serial_and_neighbours_stay_balanced() {
    let (n, width) = (256, 3000.0);
    let (height, water) = (vec![10.0_f32; n * n], vec![0_u8; n * n]);
    let surface = crate::urban::Surface {
        geometry: None,
        width,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let c = width * 0.5;
    let mut roads = vec![
        road((1.0, c - 40.0), (width - 1.0, c + 60.0), 0),
        road((c + 30.0, 1.0), (c - 50.0, width - 1.0), 0),
    ];
    for r in &mut roads {
        r.role = "regional".into();
        r.widths = vec![7.0; 2];
    }
    let site = crate::urban::Site {
        key: "probe".into(),
        name: "Probe".into(),
        population: 8_000,
        culture: "european-organic".into(),
        center: Point { x: c, y: c },
        radius: 300.0,
        neighbours: Vec::new(),
    };
    let layout = crate::urban::generate_quarters(
        "probe-city",
        std::slice::from_ref(&site),
        &crate::urban::LayoutConfig::default(),
        surface,
        &roads,
    )
    .unwrap()
    .remove(0);
    let run = |threads| {
        crate::urban::par::with_threads(threads, || {
            crate::urban::generate_parcels(
                "parallel",
                std::slice::from_ref(&layout),
                &ParcelConfig::default(),
            )
            .unwrap()
            .remove(0)
        })
    };
    let serial = run(1);
    let parallel = run(8);
    assert!(serial.parcels.len() > 200, "{} lots", serial.parcels.len());
    assert!(
        serde_json::to_string(&serial).unwrap() == serde_json::to_string(&parallel).unwrap(),
        "parallel parcel stage differs from serial"
    );
    let lots: Vec<&Parcel> = serial
        .parcels
        .iter()
        .filter(|p| p.use_kind == "plot" && p.envelope.is_some()
            && !p.provenance.iter().any(|s| s == "occupied-yard-merge"))
        .collect();
    let mut by_block: BTreeMap<usize, Vec<&Parcel>> = BTreeMap::new();
    for p in &lots {
        by_block.entry(p.block).or_default().push(p);
    }
    let front = |p: &Parcel| p.access.as_ref().map_or(0.0, |a| a.front_length);
    let mut unbalanced = 0;
    for lots in by_block.values() {
        for (i, a) in lots.iter().enumerate() {
            for b in &lots[i + 1..] {
                let (fa, fb) = (front(a), front(b));
                if fa.min(fb) <= 0.0 || fa.max(fb) / fa.min(fb) > 1.5 {
                    continue;
                }
                let (aa, ab) = (area(&a.shape), area(&b.shape));
                if aa.max(ab) / aa.min(ab) >= 3.0 && shared(&a.shape, &b.shape) >= 1.0 {
                    unbalanced += 1;
                }
            }
        }
    }
    assert!(
        unbalanced * 100 <= lots.len(),
        "{unbalanced} unbalanced pairs among {} lots",
        lots.len()
    );
    let layout_ref = &layout;
    let index = FrontageIndex::new(layout_ref);
    let deepest = lots
        .iter()
        .map(|p| match (p.family.as_str(), p.front) {
            // Faubourg lean-tos stand outside their block, on an outer road:
            // their depth runs from their own front, not the block's streets.
            ("faubourg", Some([a, b])) => {
                let n = normal(unit(sub(b, a)));
                p.shape
                    .outer
                    .iter()
                    .map(|q| dot(sub(*q, a), n).abs())
                    .fold(0.0, f64::max)
            }
            _ => lot_depth(
                &p.shape,
                &frontages(&layout_ref.blocks[p.block].shape, layout_ref, &index),
            ),
        })
        .fold(0.0, f64::max);
    assert!(deepest <= 100.0, "deepest admitted lot {deepest:.1} m");
}
