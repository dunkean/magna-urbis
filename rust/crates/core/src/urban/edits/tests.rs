//! One focused test per invariant of the structural edits (spec b.8).
use super::super::{
    Layout, LayoutConfig, ParcelConfig, ParcelOverride, Partition, Point, QuarterOverride, Shape,
    Site, Street, Surface, generate_parcels, generate_quarters, geometry as g,
};
use std::collections::BTreeSet;

/// A flat dry 2 km site crossed by two regional roads: a 2 500 inhabitant town.
fn town(cfg: &LayoutConfig) -> Layout {
    let height = vec![20.0f32; 64 * 64];
    let water = vec![0u8; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 2000.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let road = |a: (f64, f64), b: (f64, f64)| Street {
        path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
        widths: vec![7.0, 7.0],
        rank: 0,
        role: "regional".into(),
    };
    let site = Site {
        key: "edits-town".into(),
        name: "Edits town".into(),
        population: 2500,
        culture: "european-organic".into(),
        center: Point {
            x: 1000.0,
            y: 1000.0,
        },
        radius: 220.0,
    };
    generate_quarters(
        "edits",
        &[site],
        cfg,
        surface,
        &[
            road((50.0, 1000.0), (1950.0, 1010.0)),
            road((1000.0, 50.0), (1005.0, 1950.0)),
        ],
    )
    .unwrap()
    .remove(0)
}
fn lots(layout: &Layout, pcfg: &ParcelConfig) -> Partition {
    generate_parcels("edits", std::slice::from_ref(layout), pcfg)
        .unwrap()
        .remove(0)
}
fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap()
}
fn with_quarter(k: usize, o: QuarterOverride) -> LayoutConfig {
    let mut cfg = LayoutConfig::default();
    cfg.overrides.quarters.insert(k.to_string(), o);
    cfg
}
fn with_lot(id: &str, o: ParcelOverride) -> ParcelConfig {
    let mut pcfg = ParcelConfig::default();
    pcfg.overrides.parcels.insert(id.into(), o);
    pcfg
}
/// The quarter with the most ordinary blocks.
fn busiest(l: &Layout) -> usize {
    (0..l.quarters.len())
        .max_by_key(|&q| {
            l.blocks
                .iter()
                .filter(|b| b.quarter == q && b.kind == "block")
                .count()
        })
        .unwrap()
}
fn blocks_of(l: &Layout, keep: impl Fn(usize) -> bool) -> Vec<String> {
    l.blocks
        .iter()
        .filter(|b| keep(b.quarter))
        .map(json)
        .collect()
}
fn main_streets(l: &Layout) -> BTreeSet<String> {
    l.streets.iter().filter(|s| s.rank <= 1).map(json).collect()
}
/// Lots of the blocks of quarters `keep`: id, shape, use and family.
fn lot_keys(l: &Layout, p: &Partition, keep: impl Fn(usize) -> bool) -> BTreeSet<String> {
    p.parcels
        .iter()
        .filter(|x| keep(l.blocks[x.block].quarter))
        .map(|x| format!("{}|{}|{}|{}", x.id, json(&x.shape), x.use_kind, x.family))
        .collect()
}

#[test]
fn contract_new_fields_are_optional_and_validated() {
    // I6 contract: configs without the new fields echo byte-identically.
    let plain = json(&LayoutConfig::default());
    assert!(!plain.contains("\"salt\"") && !plain.contains("\"shape\""));
    let mut cfg = LayoutConfig::default();
    cfg.overrides.quarters.insert(
        "2".into(),
        QuarterOverride {
            role: Some("market".into()),
            ..Default::default()
        },
    );
    assert_eq!(
        json(&cfg.overrides),
        r#"{"quarters":{"2":{"role":"market","wealth":null,"culture":null,"tissue":null,"density":null}}}"#
    );
    // camelCase round trip of the structural fields.
    let edit: ParcelOverride = serde_json::from_str(
        r#"{"shape":{"outer":[{"x":0,"y":0},{"x":4,"y":0},{"x":4,"y":4}]},"deleted":"garden","salt":3}"#,
    )
    .unwrap();
    assert_eq!(edit.salt, Some(3));
    assert_eq!(
        serde_json::from_str::<ParcelOverride>(&json(&edit)).unwrap(),
        edit
    );
    // A malformed deletion is refused; a malformed quarter outline too.
    let bad = with_lot(
        "x",
        ParcelOverride {
            deleted: Some("other".into()),
            ..Default::default()
        },
    );
    assert!(generate_parcels("edits", &[], &bad).is_err());
    let mut layout_cfg = with_quarter(
        0,
        QuarterOverride {
            shape: Some(Shape {
                outer: vec![Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 }],
                holes: vec![],
            }),
            ..Default::default()
        },
    );
    assert!(super::validate_quarters(&layout_cfg).is_err());
    layout_cfg.overrides.quarters.clear();
    assert!(super::validate_quarters(&layout_cfg).is_ok());
}

/// I4, I5, I8: a salt redraws one quarter; every other block, every main
/// street and every other quarter's lot stays; the draw reproduces itself.
#[test]
fn quarter_salt_redraws_only_that_quarter() {
    let base = town(&LayoutConfig::default());
    let k = busiest(&base);
    let salted = |s: u32| {
        town(&with_quarter(
            k,
            QuarterOverride {
                salt: Some(s),
                ..Default::default()
            },
        ))
    };
    let (one, again, two) = (salted(1), salted(1), salted(2));
    eprintln!(
        "salt: {} quarters, {} blocks, quarter {k}: {} -> {} blocks, streets {} -> {}, warnings {:?}",
        base.quarters.len(),
        base.blocks.len(),
        base.blocks.iter().filter(|b| b.quarter == k).count(),
        one.blocks.iter().filter(|b| b.quarter == k).count(),
        base.streets.len(),
        one.streets.len(),
        one.warnings
            .iter()
            .filter(|w| w.starts_with("Retouche"))
            .collect::<Vec<_>>()
    );
    assert_eq!(json(&one), json(&again), "salt 1 reproduces itself");
    assert_ne!(blocks_of(&base, |q| q == k), blocks_of(&one, |q| q == k));
    assert_ne!(
        json(&one.blocks),
        json(&two.blocks),
        "salt 2 differs from salt 1"
    );
    assert_eq!(
        blocks_of(&base, |q| q != k),
        blocks_of(&one, |q| q != k),
        "other quarters' blocks are byte-identical, in order"
    );
    assert!(main_streets(&base).is_subset(&main_streets(&one)));
    assert_eq!(base.quarters.len(), one.quarters.len());
    let pcfg = ParcelConfig::default();
    let (p0, p1) = (lots(&base, &pcfg), lots(&one, &pcfg));
    assert_eq!(
        lot_keys(&base, &p0, |q| q != k),
        lot_keys(&one, &p1, |q| q != k),
        "other quarters' lots keep id, shape, use and family"
    );
    assert_ne!(
        lot_keys(&base, &p0, |q| q == k),
        lot_keys(&one, &p1, |q| q == k)
    );
    // I1 / I2 within the redrawn quarter: inside its outline, off the streets.
    for b in one.blocks.iter().filter(|b| b.quarter == k) {
        let outside: f64 = g::difference(&b.shape, &one.quarters[k].shape)
            .iter()
            .map(g::area)
            .sum();
        assert!(outside < 0.5, "block leaves its quarter by {outside} m²");
        for s in &one.streets {
            let hit: f64 = g::ribbon(&s.path, &s.widths)
                .iter()
                .flat_map(|r| g::intersection(r, &b.shape))
                .map(|x| g::area(&x))
                .sum();
            assert!(hit < 0.5, "block under a street by {hit} m²");
        }
    }
}

/// I8, I7: a deleted quarter keeps its outline, owns no block nor lot; main
/// streets stay; the programme still runs; deleting everything never panics.
#[test]
fn quarter_delete_removes_its_lots_and_keeps_main_streets() {
    let base = town(&LayoutConfig::default());
    let k = busiest(&base);
    let gone = town(&with_quarter(
        k,
        QuarterOverride {
            deleted: Some(true),
            ..Default::default()
        },
    ));
    assert!(super::quarter_removed(&gone, k));
    assert_eq!(gone.quarters.len(), base.quarters.len());
    assert!(!gone.blocks.iter().any(|b| b.quarter == k));
    assert_eq!(blocks_of(&base, |q| q != k), blocks_of(&gone, |q| q != k));
    assert!(main_streets(&base).is_subset(&main_streets(&gone)));
    assert!(
        gone.streets.len() < base.streets.len(),
        "local streets removed"
    );
    assert!(gone.programme.is_some());
    let p = lots(&gone, &ParcelConfig::default());
    assert!(!p.parcels.iter().any(|x| gone.blocks[x.block].quarter == k));
    // Deleting every quarter: no panic, an empty town.
    let mut all = LayoutConfig::default();
    for i in 0..base.quarters.len() {
        all.overrides.quarters.insert(
            i.to_string(),
            QuarterOverride {
                deleted: Some(true),
                ..Default::default()
            },
        );
    }
    let empty = town(&all);
    assert!(empty.blocks.is_empty());
    assert!(lots(&empty, &ParcelConfig::default()).parcels.is_empty());
}

/// A block of at least three ordinary lots, and two adjacent ones in it.
fn adjacent_lots(p: &Partition) -> (usize, String, String) {
    let mut blocks: Vec<usize> = p.parcels.iter().map(|x| x.block).collect();
    blocks.dedup();
    for b in blocks {
        let plots: Vec<_> = p
            .parcels
            .iter()
            .filter(|x| x.block == b && x.use_kind == "plot")
            .collect();
        if plots.len() < 3 {
            continue;
        }
        for a in &plots {
            for c in &plots {
                if a.id < c.id && super::shared_length(&a.shape, &c.shape) > 4.0 {
                    return (b, a.id.clone(), c.id.clone());
                }
            }
        }
    }
    panic!("no block with three adjacent plots");
}
fn block_lots(p: &Partition, b: usize) -> Vec<&super::super::Parcel> {
    p.parcels.iter().filter(|x| x.block == b).collect()
}
fn pairwise_overlap(lots: &[&super::super::Parcel]) -> f64 {
    let mut total = 0.0;
    for (i, a) in lots.iter().enumerate() {
        for c in &lots[i + 1..] {
            total += g::intersection(&a.shape, &c.shape)
                .iter()
                .map(g::area)
                .sum::<f64>();
        }
    }
    total
}

/// I1, I2, I3: a lot grown into its neighbour keeps the block partition
/// exact; both keep their ids; other blocks are untouched; all are served.
#[test]
fn lot_reshape_keeps_the_partition_and_gives_the_remainder_to_a_neighbour() {
    let layout = town(&LayoutConfig::default());
    let base = lots(&layout, &ParcelConfig::default());
    let (b, a, c) = adjacent_lots(&base);
    let lot = |p: &Partition, id: &str| p.parcels.iter().find(|x| x.id == id).cloned().unwrap();
    let (la, lc) = (lot(&base, &a), lot(&base, &c));
    // The user outline: A slid 2 m towards C. A takes a strip of C and leaves
    // a strip of its own land on the far side: the remainder, which must go
    // to a neighbour (or become a garden lot), never vanish.
    let (ca, cc) = (g::centroid(&la.shape), g::centroid(&lc.shape));
    let l = (cc.x - ca.x).hypot(cc.y - ca.y).max(1e-9);
    let (dx, dy) = ((cc.x - ca.x) / l * 2.0, (cc.y - ca.y) / l * 2.0);
    let user = Shape {
        outer: la
            .shape
            .outer
            .iter()
            .map(|p| Point {
                x: p.x + dx,
                y: p.y + dy,
            })
            .collect(),
        holes: vec![],
    };
    let pcfg = with_lot(
        &a,
        ParcelOverride {
            shape: Some(user),
            ..Default::default()
        },
    );
    let edited = lots(&layout, &pcfg);
    let (ea, ec) = (lot(&edited, &a), lot(&edited, &c));
    let taken: f64 = g::intersection(&ea.shape, &lc.shape)
        .iter()
        .map(g::area)
        .sum();
    assert!(taken > 1.0, "A took land from C ({taken} m²)");
    // C gave up that land (it may receive A's leftover strip elsewhere).
    let given: f64 = g::difference(&lc.shape, &ec.shape)
        .iter()
        .map(g::area)
        .sum();
    assert!(given > 1.0, "C gave up land ({given} m²)");
    // The strip A left behind belongs to another lot of the block.
    let left = g::difference(&la.shape, &ea.shape);
    let left_area: f64 = left.iter().map(g::area).sum();
    let claimed: f64 = block_lots(&edited, b)
        .iter()
        .filter(|x| x.id != a && !x.id.contains("/reste-"))
        .flat_map(|x| left.iter().flat_map(|l| g::intersection(&x.shape, l)))
        .map(|x| g::area(&x))
        .sum();
    assert!(
        left_area > 1.0 && (left_area - claimed).abs() < 0.05,
        "remainder {left_area} m², claimed {claimed} m²"
    );
    assert!(ea.provenance.iter().any(|t| t == "edit:shape"));
    let area = |v: &[&super::super::Parcel]| v.iter().map(|x| g::area(&x.shape)).sum::<f64>();
    let block_area = g::area(&layout.blocks[b].shape);
    let after = block_lots(&edited, b);
    assert!(
        (area(&block_lots(&base, b)) - area(&after)).abs() < 1e-5 * block_area.max(1.0) + 0.01,
        "lot areas still sum to the block"
    );
    assert!(pairwise_overlap(&after) < 0.01, "no overlap");
    for x in &after {
        assert!(
            !x.contacts.is_empty()
                || x.access
                    .as_ref()
                    .is_some_and(|a| a.kind == "unserved" || a.kind == "reserved"),
            "lot {} neither served nor marked unserved",
            x.id
        );
    }
    let others = |p: &Partition| -> Vec<String> {
        p.parcels
            .iter()
            .filter(|x| x.block != b)
            .map(json)
            .collect()
    };
    assert_eq!(
        others(&base),
        others(&edited),
        "other blocks byte-identical"
    );
    let d = edited.diagnostics.as_ref().unwrap();
    assert!(
        d.overlap_area < 0.05
            && d.residual_area < base.diagnostics.as_ref().unwrap().residual_area + 0.05
    );
}

/// A deleted lot merges into its neighbour (area kept, id in parentIds), or
/// stays as an unbuilt garden with its id.
#[test]
fn lot_delete_merges_into_a_neighbour_or_stays_a_garden() {
    let layout = town(&LayoutConfig::default());
    let base = lots(&layout, &ParcelConfig::default());
    let (b, a, _) = adjacent_lots(&base);
    let merged = lots(
        &layout,
        &with_lot(
            &a,
            ParcelOverride {
                deleted: Some("merge".into()),
                ..Default::default()
            },
        ),
    );
    assert!(!merged.parcels.iter().any(|x| x.id == a));
    let survivor = merged
        .parcels
        .iter()
        .find(|x| x.parent_ids.contains(&a))
        .expect("a survivor absorbs the lot");
    assert_eq!(survivor.block, b);
    assert!(survivor.provenance.iter().any(|t| t == "edit:merged"));
    let area = |p: &Partition| {
        block_lots(p, b)
            .iter()
            .map(|x| g::area(&x.shape))
            .sum::<f64>()
    };
    assert!((area(&base) - area(&merged)).abs() < 0.05, "area conserved");
    assert!(pairwise_overlap(&block_lots(&merged, b)) < 0.01);
    let garden = lots(
        &layout,
        &with_lot(
            &a,
            ParcelOverride {
                deleted: Some("garden".into()),
                ..Default::default()
            },
        ),
    );
    let g_lot = garden.parcels.iter().find(|x| x.id == a).unwrap();
    assert_eq!(g_lot.use_kind, "garden");
    let built = garden
        .programme
        .as_ref()
        .unwrap()
        .allocations
        .iter()
        .find(|x| x.parcel_id == a)
        .map(|x| x.function.clone());
    assert!(
        built.as_deref().is_none_or(|f| f == "common"),
        "a garden lot gets no building ({built:?})"
    );
}

/// A lot salt draws an admissible use by hash of id and salt, reproducibly,
/// and reseeds the house only; a shape-only edit forces no use.
#[test]
fn lot_salt_draws_an_admissible_use_deterministically() {
    let layout = town(&LayoutConfig::default());
    let base = lots(&layout, &ParcelConfig::default());
    let role = |p: &Partition, id: &str| {
        p.programme
            .as_ref()
            .unwrap()
            .allocations
            .iter()
            .find(|x| x.parcel_id == id)
            .map(|x| x.role.clone())
    };
    let (b, _, _) = adjacent_lots(&base);
    let ids: Vec<String> = block_lots(&base, b)
        .iter()
        .filter(|x| x.use_kind == "plot")
        .map(|x| x.id.clone())
        .collect();
    let mut changed = 0;
    for id in &ids {
        let salted = |s: u32| {
            lots(
                &layout,
                &with_lot(
                    id,
                    ParcelOverride {
                        salt: Some(s),
                        ..Default::default()
                    },
                ),
            )
        };
        let (one, again) = (salted(1), salted(1));
        assert_eq!(json(&one), json(&again), "the draw is deterministic");
        let drawn = role(&one, id);
        assert!(drawn.is_some(), "a salted lot is allocated");
        let pr = one.programme.as_ref().unwrap();
        assert!(
            !pr.warnings.iter().any(|w| w.contains(id.as_str())),
            "{:?}",
            pr.warnings
        );
        changed += usize::from(drawn != role(&base, id));
        assert_eq!(
            super::building_seed("s", id, &one),
            format!("s/{id}#s1"),
            "salt reseeds the house"
        );
        if changed > 0 {
            break;
        }
    }
    assert!(changed > 0, "a salt changes at least one role of the block");
    // Shape-only edits force nothing: the allocation equals the plain one.
    let id = &ids[0];
    let own = base
        .parcels
        .iter()
        .find(|x| x.id == *id)
        .unwrap()
        .shape
        .clone();
    let shaped = lots(
        &layout,
        &with_lot(
            id,
            ParcelOverride {
                shape: Some(own),
                ..Default::default()
            },
        ),
    );
    assert!(super::sets_use(&ParcelOverride {
        salt: Some(1),
        ..Default::default()
    }));
    assert!(!super::sets_use(&ParcelOverride {
        shape: shaped.parcels[0].shape.clone().into(),
        ..Default::default()
    }));
    assert_eq!(role(&shaped, id), role(&base, id));
}

/// I7, I6: stale ids (a quarter or a lot that no longer exists) warn and
/// change nothing else; the stripped plan equals the plain pipeline.
#[test]
fn stale_edits_warn_and_never_fail() {
    let base = town(&LayoutConfig::default());
    let stale = town(&with_quarter(
        999,
        QuarterOverride {
            salt: Some(4),
            ..Default::default()
        },
    ));
    assert!(
        stale
            .warnings
            .iter()
            .any(|w| w.contains("Q999") && w.contains("introuvable"))
    );
    assert_eq!(json(&base.blocks), json(&stale.blocks));
    assert_eq!(json(&base.streets), json(&stale.streets));
    let mut pcfg = ParcelConfig::default();
    for (id, o) in [
        (
            "gone/shape",
            ParcelOverride {
                shape: Some(g::rectangle(0.0, 0.0, 5.0, 5.0)),
                ..Default::default()
            },
        ),
        (
            "gone/merge",
            ParcelOverride {
                deleted: Some("merge".into()),
                ..Default::default()
            },
        ),
        (
            "gone/salt",
            ParcelOverride {
                salt: Some(2),
                ..Default::default()
            },
        ),
    ] {
        pcfg.overrides.parcels.insert(id.into(), o);
    }
    let plain = lots(&base, &ParcelConfig::default());
    let p = lots(&base, &pcfg);
    assert_eq!(json(&plain.parcels), json(&p.parcels));
    let all: Vec<&String> = p
        .warnings
        .iter()
        .chain(&p.programme.as_ref().unwrap().warnings)
        .collect();
    for id in ["gone/shape", "gone/merge", "gone/salt"] {
        assert!(
            all.iter()
                .any(|w| w.contains(id) && w.contains("introuvable")),
            "{id}: {all:?}"
        );
    }
}

/// I1, I2, I3, I5: a quarter outline pulled inwards and pushed into the
/// fields stays within the user outline and off the other quarters.
#[test]
fn quarter_reshape_stays_within_the_outline_and_off_its_neighbours() {
    let base = town(&LayoutConfig::default());
    let k = busiest(&base);
    let q = &base.quarters[k].shape;
    let c = g::interior_point(q);
    let user = Shape {
        outer: q
            .outer
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let f = if i % 2 == 0 { 0.8 } else { 1.25 };
                Point {
                    x: c.x + (p.x - c.x) * f,
                    y: c.y + (p.y - c.y) * f,
                }
            })
            .collect(),
        holes: vec![],
    };
    let shaped = town(&with_quarter(
        k,
        QuarterOverride {
            shape: Some(user.clone()),
            ..Default::default()
        },
    ));
    let fin = &shaped.quarters[k].shape;
    assert_ne!(
        json(fin),
        json(q),
        "the outline changed: {:?}",
        shaped.warnings
    );
    let user = g::union(&[g::normalized(user)]).remove(0);
    let outside: f64 = g::difference(fin, &user).iter().map(g::area).sum();
    let far = |s: &Shape, ring: &[Point]| s.outer.iter().map(|p| ring.iter().zip(ring.iter().cycle().skip(1)).map(|(a, b)| g::distance(*p, *a, *b).0).fold(f64::INFINITY, f64::min)).fold(0.0, f64::max);
    let pieces: Vec<(f64, f64, f64)> = g::difference(fin, &user).iter().map(|s| (g::area(s), far(s, &user.outer), far(s, &q.outer))).collect();
    // Within the redraw tolerance (1.75 m, so an unmoved « Valider » is no
    // edit) plus street snapping: only thin seams may lie outside the user's
    // outline, never a real overflow.
    assert!(
        pieces.iter().all(|&(_, d, _)| d <= 2.5) && outside < 0.01 * g::area(&user),
        "final outline leaves the user's by {outside} m² (area, max dist to user, max dist to old): {pieces:?}"
    );
    for (j, o) in shaped.quarters.iter().enumerate().filter(|(j, _)| *j != k) {
        let hit: f64 = g::intersection(fin, &o.shape).iter().map(g::area).sum();
        assert!(hit < 1.0, "overlaps quarter {j} by {hit} m²");
    }
    // The edited quarter wins: a neighbour block is kept byte-identical, or
    // clipped (a piece of its old self, announced by a warning).
    let kept: BTreeSet<String> = blocks_of(&base, |x| x != k).into_iter().collect();
    let mut clipped = 0;
    for b in shaped.blocks.iter().filter(|b| b.quarter != k) {
        if kept.contains(&json(b)) {
            continue;
        }
        clipped += 1;
        let inside = base.blocks.iter().any(|o| {
            o.quarter == b.quarter
                && g::difference(&b.shape, &o.shape)
                    .iter()
                    .map(g::area)
                    .sum::<f64>()
                    < 0.5
        });
        assert!(inside, "a neighbour block grew or moved");
    }
    assert!(
        clipped == 0 || shaped.warnings.iter().any(|w| w.contains("rogné")),
        "clipped neighbours are announced"
    );
    for b in shaped.blocks.iter().filter(|b| b.quarter == k) {
        let out: f64 = g::difference(&b.shape, fin).iter().map(g::area).sum();
        assert!(out < 0.5);
        assert!(b.kind != "block" || super::served(&b.shape, &shaped.streets));
    }
}

/// The outline as the inspector sends it untouched: rounded to 0.1 m and,
/// for a quarter, decimated within `eps` (Douglas–Peucker-like chords).
fn echoed(s: &Shape, eps: f64) -> Shape {
    let r = |v: f64| (v * 10.0).round() / 10.0;
    let mut ring: Vec<Point> = s.outer.clone();
    // Drop a vertex within `eps` of its chord, never two in a row (so every
    // chord stays within `eps` of the outline).
    let mut i = 1;
    while eps > 0.0 && ring.len() > 3 && i + 1 < ring.len() {
        if g::distance(ring[i], ring[i - 1], ring[i + 1]).0 < eps {
            ring.remove(i);
        }
        i += 1;
    }
    Shape {
        outer: ring
            .into_iter()
            .map(|p| Point {
                x: r(p.x),
                y: r(p.y),
            })
            .collect(),
        holes: vec![],
    }
}

/// Review 1 and 9: « Valider » on an unmoved outline is no edit at all, for a
/// lot (rounding) and for a quarter (rounding and simplification).
#[test]
fn unmoved_outlines_change_nothing() {
    let layout = town(&LayoutConfig::default());
    let base = lots(&layout, &ParcelConfig::default());
    let mut pcfg = ParcelConfig::default();
    for x in base
        .parcels
        .iter()
        .filter(|x| x.use_kind == "plot")
        .take(20)
    {
        pcfg.overrides.parcels.insert(
            x.id.clone(),
            ParcelOverride {
                shape: Some(echoed(&x.shape, 0.0)),
                ..Default::default()
            },
        );
    }
    let same = lots(&layout, &pcfg);
    assert_eq!(json(&base.parcels), json(&same.parcels), "lots unchanged");
    assert_eq!(
        same.warnings
            .iter()
            .filter(|w| w.contains("identique"))
            .count(),
        20
    );
    let k = busiest(&layout);
    let shaped = town(&with_quarter(
        k,
        QuarterOverride {
            shape: Some(echoed(&layout.quarters[k].shape, 0.8)),
            ..Default::default()
        },
    ));
    assert_eq!(
        json(&layout.blocks),
        json(&shaped.blocks),
        "blocks unchanged"
    );
    assert_eq!(json(&layout.quarters), json(&shaped.quarters));
    assert!(
        shaped
            .warnings
            .iter()
            .any(|w| w.starts_with(&format!("Retouche Q{k} :")) && w.contains("identique")),
        "{:?}",
        shaped.warnings
    );
}

/// Review 1, 4, 6, 12: a lot pushed into its neighbours keeps its block an
/// exact partition of valid shapes, never cuts a served lot off its street
/// (the edit is refused instead), and leaves no sliver lot.
#[test]
fn lot_reshape_keeps_every_served_lot_served() {
    let layout = town(&LayoutConfig::default());
    let base = lots(&layout, &ParcelConfig::default());
    let mut tried = 0;
    let (mut applied, mut refused) = (0, 0);
    for x in base
        .parcels
        .iter()
        .filter(|x| x.use_kind == "plot")
        .step_by(7)
        .take(12)
    {
        tried += 1;
        let c = g::centroid(&x.shape);
        let grown = Shape {
            outer: x
                .shape
                .outer
                .iter()
                .map(|p| Point {
                    x: c.x + (p.x - c.x) * 1.8,
                    y: c.y + (p.y - c.y) * 1.8,
                })
                .collect(),
            holes: vec![],
        };
        let edited = lots(
            &layout,
            &with_lot(
                &x.id,
                ParcelOverride {
                    shape: Some(grown),
                    ..Default::default()
                },
            ),
        );
        let after = block_lots(&edited, x.block);
        if edited.warnings.iter().any(|w| w.contains("desserte")) {
            refused += 1;
            assert_eq!(
                json(&base.parcels),
                json(&edited.parcels),
                "refused = unchanged"
            );
            continue;
        }
        applied += 1;
        let served =
            |p: &super::super::Parcel| p.access.as_ref().is_none_or(|a| a.kind != "unserved");
        for b in block_lots(&base, x.block).into_iter().filter(|p| served(p)) {
            if let Some(a) = after.iter().find(|a| a.id == b.id) {
                assert!(served(a), "{} lost its street", a.id);
            }
        }
        assert!(pairwise_overlap(&after) < 0.01, "no overlap");
        for p in &after {
            assert!(
                !p.id.contains("/reste-") || g::area(&p.shape) >= super::MIN_REMAINDER,
                "sliver lot {} of {} m²",
                p.id,
                g::area(&p.shape)
            );
            assert!(
                p.shape.holes.iter().all(|h| h.len() >= 3),
                "degenerate hole"
            );
        }
    }
    eprintln!("lot ×1.8: {tried} tried, {applied} applied, {refused} refused");
    assert!(applied > 0);
}

/// Review 5: a lot hosting a service or a public space is not deleted (the
/// service would stay on a garden); the edit warns.
#[test]
fn service_lots_cannot_be_deleted() {
    let layout = town(&LayoutConfig::default());
    let base = lots(&layout, &ParcelConfig::default());
    let x = base
        .parcels
        .iter()
        .find(|x| super::service_lot(x, &layout))
        .expect("a service lot");
    for mode in ["merge", "garden"] {
        let p = lots(
            &layout,
            &with_lot(
                &x.id,
                ParcelOverride {
                    deleted: Some(mode.into()),
                    ..Default::default()
                },
            ),
        );
        assert_eq!(json(&base.parcels), json(&p.parcels), "{mode}: unchanged");
        assert!(
            p.warnings
                .iter()
                .any(|w| w.contains(&x.id) && w.contains("service"))
        );
    }
}

/// Review 2: rerolling a quarter keeps every service of the town reserved,
/// those of the rerolled quarter included.
#[test]
fn quarter_salt_keeps_its_services() {
    let base = town(&LayoutConfig::default());
    let reserved = |l: &Layout| -> Vec<String> {
        let mut v: Vec<String> = l
            .programme
            .as_ref()
            .unwrap()
            .reservations
            .iter()
            .map(|r| r.demand_id.clone())
            .collect();
        v.sort();
        v
    };
    let hosts: BTreeSet<usize> = base
        .programme
        .as_ref()
        .unwrap()
        .reservations
        .iter()
        .map(|r| base.blocks[r.block].quarter)
        .collect();
    assert!(!hosts.is_empty(), "the town reserves services");
    for &k in hosts.iter().take(3) {
        let salted = town(&with_quarter(
            k,
            QuarterOverride {
                salt: Some(1),
                ..Default::default()
            },
        ));
        assert_eq!(
            reserved(&base),
            reserved(&salted),
            "Q{k}: {:?}",
            salted.warnings
        );
        assert!(
            !salted
                .warnings
                .iter()
                .any(|w| w.contains("sans îlot réservé"))
        );
    }
}
