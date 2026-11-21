//! Structural block and lot edits: reshape, split, delete, idempotent preparation.
use super::super::super::{
    Block, BlockOverride, GrowthPhase, Layout, LayoutConfig, ParcelConfig, ParcelOverride,
    Partition, Point, Quarter, Shape, Street, generate_parcels, geometry as g, partition_layout,
};
use super::{DELETED, prepare};

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    Shape {
        outer: vec![
            Point { x: x0, y: y0 },
            Point { x: x1, y: y0 },
            Point { x: x1, y: y1 },
            Point { x: x0, y: y1 },
        ],
        holes: vec![],
    }
}
/// Two 120 × 30 m blocks along one street, in one quarter.
fn strip() -> Layout {
    let block = |x: f64| Block {
        key: None,
        shape: rect(x, 0.0, x + 120.0, 30.0),
        quarter: 0,
        kind: "block".into(),
        axis: Point { x: 1.0, y: 0.0 },
        zone: "edge".into(),
        fill: None,
        phase: None,
    };
    Layout {
        regional_road_result: None,
        config: Some(LayoutConfig::default()),
        programme: None,
        key: "block-edits".into(),
        culture: "european-organic".into(),
        center: Point { x: 0.0, y: 0.0 },
        quarters: vec![Quarter { key: None, shape: rect(-500.0, -500.0, 500.0, 500.0), phase: 0, zone: "edge".into() }],
        streets: vec![Street {
            key: None,
            path: vec![Point { x: -10.0, y: -3.0 }, Point { x: 260.0, y: -3.0 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "street".into(),
        }],
        blocks: vec![block(0.0), block(130.0)],
        warnings: vec![],
        enclosures: vec![],
        phases: vec![GrowthPhase {
            culture: "european-organic".into(),
            kind: "core".into(),
            zone: "edge".into(),
            recipe: "core".into(),
            population: 1000.0,
            target_area: 0.0,
            shapes: vec![],
        }],
        archetype: "district".into(),
        structure: None,
        claim: Default::default(),
    }
}
fn with_block(key: &str, o: BlockOverride) -> ParcelConfig {
    let mut cfg = ParcelConfig::default();
    cfg.overrides.blocks.insert(key.into(), o);
    cfg
}
fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap()
}
fn cut(layout: &Layout, cfg: &ParcelConfig) -> Partition {
    generate_parcels("block-edits", std::slice::from_ref(layout), cfg).unwrap().remove(0)
}
fn halves() -> BlockOverride {
    BlockOverride {
        parts: Some(vec![rect(0.0, 0.0, 60.0, 30.0), rect(60.0, 0.0, 120.0, 30.0)]),
        ..Default::default()
    }
}

#[test]
fn no_structural_edit_leaves_layout_and_config_borrowed() {
    let layout = strip();
    let cfg = with_block("1", BlockOverride { salt: Some(3), ..Default::default() });
    let p = prepare(&layout, &cfg);
    assert!(matches!(p.layout, std::borrow::Cow::Borrowed(_)));
    assert!(matches!(p.config, std::borrow::Cow::Borrowed(_)));
    assert!(cut(&layout, &cfg).prepared.is_none());
}

#[test]
fn reshape_changes_only_the_edited_block() {
    let layout = strip();
    let cfg = with_block("0", BlockOverride { shape: Some(rect(0.0, 0.0, 120.0, 45.0)), ..Default::default() });
    let p = prepare(&layout, &cfg);
    let l = p.layout.as_ref();
    assert_eq!(l.blocks.len(), 2, "a reshape appends nothing");
    assert_eq!(json(&l.blocks[1]), json(&layout.blocks[1]), "the untouched block keeps its geometry");
    assert!((g::area(&l.blocks[0].shape) - 120.0 * 45.0).abs() < 1.0, "the new outline is applied");
    let marker = l.config.as_ref().unwrap().block_edits.as_ref().unwrap();
    assert_eq!((marker.count, marker.originals.len(), marker.origins.len()), (2, 1, 1));
    let part = cut(&layout, &cfg);
    let prepared = part.prepared.as_ref().expect("prepared blocks published");
    assert_eq!(json(&prepared.blocks), json(&l.blocks));
    // Every lot of the reshaped block lies in its new outline.
    for lot in part.parcels.iter().filter(|x| x.block == 0) {
        let inside: f64 = g::intersection(&lot.shape, &l.blocks[0].shape).iter().map(g::area).sum();
        assert!(inside >= g::area(&lot.shape) - 0.5, "lot {} leaves the block", lot.id);
    }
    assert!(part.parcels.iter().any(|x| x.block == 0 && g::bbox(&x.shape).3 > 31.0), "lots use the gained land");
}

#[test]
fn split_gives_disjoint_stable_parts_addressable_by_key() {
    let layout = strip();
    let mut cfg = with_block("0", halves());
    cfg.overrides.blocks.insert("0/1".into(), BlockOverride { operator: Some("garden".into()), ..Default::default() });
    let p = prepare(&layout, &cfg);
    let l = p.layout.as_ref();
    assert_eq!(l.blocks.len(), 3, "part 1 is appended after the input blocks");
    assert_eq!(json(&l.blocks[1]), json(&layout.blocks[1]), "untouched block index and geometry kept");
    let (a, b) = (&l.blocks[0].shape, &l.blocks[2].shape);
    assert!((g::area(a) - 1800.0).abs() < 1.0 && (g::area(b) - 1800.0).abs() < 1.0, "no land lost");
    assert!(g::intersection(a, b).iter().map(g::area).sum::<f64>() < 0.01, "parts never overlap");
    assert!(g::bbox(a).2 <= 60.01 && g::bbox(b).0 >= 59.99, "part order is the user's");
    let origins = &l.config.as_ref().unwrap().block_edits.as_ref().unwrap().origins;
    assert_eq!(
        origins.iter().map(|o| (o.block, o.source, o.part)).collect::<Vec<_>>(),
        vec![(0, 0, 0), (2, 0, 1)]
    );
    assert_eq!(p.config.overrides.blocks["2"].operator.as_deref(), Some("garden"), "part key resolved to its index");
    let part = cut(&layout, &cfg);
    assert!(part.parcels.iter().any(|x| x.block == 0));
    let second: Vec<_> = part.parcels.iter().filter(|x| x.block == 2).collect();
    assert!(!second.is_empty() && second.iter().all(|x| x.use_kind == "garden"), "part 1 has its own settings");
    // Same edit, same parts: stable across requests.
    assert_eq!(json(&cut(&layout, &cfg).prepared.unwrap().blocks), json(&part.prepared.unwrap().blocks));
}

#[test]
fn preparing_a_prepared_layout_never_applies_twice() {
    let layout = strip();
    let cfg = with_block("0", halves());
    let once = cut(&layout, &cfg);
    let prepared = partition_layout(&layout, &once);
    assert_eq!(prepared.blocks.len(), 3);
    let again = prepare(&prepared, &cfg);
    assert_eq!(json(&again.layout.blocks), json(&prepared.blocks), "no part added on a second request");
    // Its lots are the lots of the input layout.
    let twice = cut(&prepared, &cfg);
    assert_eq!(json(&twice.parcels), json(&once.parcels));
    // The edit withdrawn: the input blocks come back.
    let withdrawn = ParcelConfig::default();
    let undone = prepare(&prepared, &withdrawn);
    assert_eq!(json(&undone.layout.blocks), json(&layout.blocks));
    assert!(undone.layout.config.as_ref().unwrap().block_edits.is_none());
}

#[test]
fn deleted_block_and_part_hold_no_lot() {
    let layout = strip();
    let mut cfg = with_block("1", BlockOverride { deleted: Some(true), ..Default::default() });
    cfg.overrides.blocks.insert("0".into(), halves());
    cfg.overrides.blocks.insert("0/1".into(), BlockOverride { deleted: Some(true), ..Default::default() });
    let part = cut(&layout, &cfg);
    let blocks = &part.prepared.as_ref().unwrap().blocks;
    assert_eq!((blocks[1].kind.as_str(), blocks[2].kind.as_str()), (DELETED, DELETED));
    assert!(part.parcels.iter().all(|x| x.block == 0), "only the kept part holds lots");
    assert!(part.parcels.iter().any(|x| x.block == 0));
}

#[test]
fn deleting_part_zero_keeps_its_sibling() {
    let layout = strip();
    let mut edit = halves();
    edit.deleted_parts = vec![0];
    let part = cut(&layout, &with_block("0", edit));
    let blocks = &part.prepared.as_ref().unwrap().blocks;
    assert_eq!(blocks[0].kind, DELETED);
    assert_ne!(blocks[2].kind, DELETED);
    assert!(part.parcels.iter().any(|p| p.block == 2));
    assert!(part.parcels.iter().all(|p| p.block != 0));
}

#[test]
fn malformed_block_edits_are_refused() {
    let layout = strip();
    let both = BlockOverride { shape: Some(rect(0.0, 0.0, 1.0, 1.0)), ..halves() };
    let one_part = BlockOverride { parts: Some(vec![rect(0.0, 0.0, 60.0, 30.0)]), ..Default::default() };
    let part_shape = BlockOverride { shape: Some(rect(0.0, 0.0, 60.0, 30.0)), ..Default::default() };
    for (key, o) in [("0", both), ("0", one_part), ("0/1", part_shape), ("x", BlockOverride::default())] {
        assert!(generate_parcels("block-edits", std::slice::from_ref(&layout), &with_block(key, o)).is_err(), "{key}");
    }
}

#[test]
fn lot_split_keeps_its_id_and_adds_a_part() {
    let layout = strip();
    let base = cut(&layout, &ParcelConfig::default());
    let lot = base
        .parcels
        .iter()
        .filter(|x| x.block == 0 && x.use_kind == "plot")
        .max_by(|a, b| g::area(&a.shape).total_cmp(&g::area(&b.shape)))
        .expect("a plot");
    let (x0, y0, x1, y1) = g::bbox(&lot.shape);
    let mid = (y0 + y1) * 0.5;
    let half = |a: f64, b: f64| {
        g::intersection(&lot.shape, &rect(x0 - 1.0, a, x1 + 1.0, b))
            .into_iter()
            .max_by(|p, q| g::area(p).total_cmp(&g::area(q)))
            .unwrap()
    };
    let parts = vec![half(y0 - 1.0, mid), half(mid, y1 + 1.0)];
    let mut cfg = ParcelConfig::default();
    cfg.overrides.parcels.insert(lot.id.clone(), ParcelOverride { parts: Some(parts), ..Default::default() });
    let split = cut(&layout, &cfg);
    let first = split.parcels.iter().find(|x| x.id == lot.id).expect("source id kept");
    let second = split.parcels.iter().find(|x| x.id == format!("{}/part-1", lot.id)).expect("part 1");
    let total = g::area(&first.shape) + g::area(&second.shape);
    assert!((total - g::area(&lot.shape)).abs() < 1.0, "the cut loses no land");
    assert!(g::intersection(&first.shape, &second.shape).iter().map(g::area).sum::<f64>() < 0.01);
    assert_eq!(second.block, lot.block);
}
